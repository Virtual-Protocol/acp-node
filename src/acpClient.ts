import { Address, SignTypedDataParameters, zeroAddress } from "viem";
import { io } from "socket.io-client";
import { jwtDecode } from "jwt-decode";
import BaseAcpContractClient, {
  AcpJobPhases,
  MemoType,
  OperationPayload,
} from "./contractClients/baseAcpContractClient";
import AcpJob from "./acpJob";
import AcpMemo from "./acpMemo";
import AcpJobOffering, { PriceType } from "./acpJobOffering";
import {
  IAcpAgent,
  AcpAgentSort,
  AcpGraduationStatus,
  AcpMemoState,
  AcpOnlineStatus,
  IAcpAccount,
  IAcpClientOptions,
  ISubscriptionCheckResponse,
  ISubscriptionTier,
  SubscriptionPaymentRequirementResult,
  IAcpJob,
  IAcpMemoData,
  IAcpResponse,
  IAcpMemoContent,
  IAgentCardSignupResult,
  IAgentCardSignupPollResult,
  IAgentCardPurchaseResult,
  IAgentCardPurchaseStatusResult,
  IAgentCardListResult,
  IAgentCardDetails,
  IAgentCardRefundResult,
  IAgentCardRefundStatusResult,
  IAgentCardTrackOptions,
} from "./interfaces";
import AcpError from "./acpError";
import { FareAmountBase } from "./acpFare";
import { AcpAccount } from "./acpAccount";
import {
  baseAcpConfig,
  baseAcpX402Config,
  baseSepoliaAcpConfig,
  baseSepoliaAcpX402Config,
} from "./configs/acpConfigs";
import { preparePayload } from "./utils";
import { USDC_TOKEN_ADDRESS } from "./constants";
import axios, { AxiosError, AxiosInstance } from "axios";
import AcpAgent from "./acpAgent";

const { version } = require("../package.json");

enum SocketEvents {
  ROOM_JOINED = "roomJoined",
  ON_EVALUATE = "onEvaluate",
  ON_NEW_TASK = "onNewTask",
}

interface IAcpGetAgentOptions {
  showHiddenOfferings?: boolean;
}

interface IAcpBrowseAgentsOptions {
  cluster?: string;
  sortBy?: AcpAgentSort[];
  topK?: number;
  sort_by?: AcpAgentSort[]; // deprecated
  top_k?: number; // deprecated
  graduationStatus?: AcpGraduationStatus;
  onlineStatus?: AcpOnlineStatus;
  showHiddenOfferings?: boolean;
}

export class EvaluateResult {
  isApproved: boolean;
  reasoning: string;

  constructor(isApproved: boolean, reasoning: string) {
    this.isApproved = isApproved;
    this.reasoning = reasoning;
  }
}

class AcpClient {
  private contractClients: BaseAcpContractClient[];
  private onNewTask?: (job: AcpJob, memoToSign?: AcpMemo) => void;
  private onEvaluate?: (job: AcpJob) => void;
  private acpClient: AxiosInstance;
  private noAuthAcpClient: AxiosInstance;
  private accessToken: string | null = null;
  private accessTokenInflight: Promise<string | null> | null = null;

  constructor(options: IAcpClientOptions) {
    this.contractClients = Array.isArray(options.acpContractClient)
      ? options.acpContractClient
      : [options.acpContractClient];

    if (this.contractClients.length === 0) {
      throw new AcpError("ACP contract client is required");
    }

    this.contractClients.forEach((client) => {
      if (client.walletAddress !== this.contractClients[0].walletAddress) {
        throw new AcpError(
          "All contract clients must have the same agent wallet address"
        );
      }
    });

    this.acpClient = axios.create({
      baseURL: `${this.acpUrl}/api`,
      headers: {
        "wallet-address": this.walletAddress,
      },
    });

    this.noAuthAcpClient = axios.create({
      baseURL: `${this.acpUrl}/api`,
    });

    this.acpClient.interceptors.request.use(async (config) => {
      const accessToken = await this.getAccessToken();

      config.headers["authorization"] = `Bearer ${accessToken}`;
      return config;
    });

    this.acpClient.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        if (
          error.response?.status === 401 &&
          originalRequest &&
          !originalRequest._retried
        ) {
          originalRequest._retried = true;
          this.accessToken = null;

          return this.acpClient(originalRequest);
        }
        return Promise.reject(error);
      }
    );

    this.onNewTask = options.onNewTask;
    this.onEvaluate = options.onEvaluate || this.defaultOnEvaluate;

    this.init(options.skipSocketConnection);
  }

  private async getAccessToken() {
    if (this.accessTokenInflight) {
      return await this.accessTokenInflight;
    }

    let refreshToken = this.accessToken ? false : true;

    if (this.accessToken) {
      const decodedToken = jwtDecode(this.accessToken);
      if (
        decodedToken.exp &&
        decodedToken.exp - 60 * 5 < Math.floor(Date.now() / 1000) // 5 minutes before expiration
      ) {
        refreshToken = true;
      }
    }

    if (!refreshToken) {
      return this.accessToken;
    }

    this.accessTokenInflight = (async () => {
      this.accessToken = await this.refreshToken();

      return this.accessToken;
    })().finally(() => {
      this.accessTokenInflight = null;
    });

    return await this.accessTokenInflight;
  }

  private async refreshToken() {
    const challenge = await this.getAuthChallenge();
    const signature = await this.acpContractClient.signTypedData(challenge);

    const verified = await this.verifyAuthChallenge(
      challenge.message["walletAddress"] as Address,
      challenge.message["nonce"] as string,
      challenge.message["expiresAt"] as number,
      signature as `0x${string}`
    );

    return verified.accessToken;
  }

  private async getAuthChallenge() {
    try {
      const response = await this.noAuthAcpClient.get<{
        data: SignTypedDataParameters;
      }>("/auth/challenge", {
        params: {
          walletAddress: this.walletAddress,
        },
      });

      return response.data.data;
    } catch (err) {
      console.error(
        "Failed to get auth challenge",
        (err as AxiosError).response?.data
      );
      throw new AcpError("Failed to get auth challenge", err);
    }
  }

  private async verifyAuthChallenge(
    walletAddress: Address,
    nonce: string,
    expiresAt: number,
    signature: string
  ) {
    try {
      const response = await this.noAuthAcpClient.post<{
        data: {
          accessToken: string;
        };
      }>("/auth/verify-typed-signature", {
        walletAddress,
        nonce,
        expiresAt,
        signature,
      });

      return response.data.data;
    } catch (err: any) {
      console.log("err->>", err.response.data);
      throw new AcpError("Failed to verify auth challenge", err);
    }
  }

  public contractClientByAddress(address: Address | undefined) {
    if (!address) {
      return this.contractClients[0];
    }

    const result = this.contractClients.find(
      (client) => client.contractAddress === address
    );

    if (!result) {
      throw new AcpError("ACP contract client not found");
    }

    return result;
  }

  get acpContractClient() {
    return this.contractClients[0];
  }

  get acpUrl() {
    return this.acpContractClient.config.acpUrl;
  }

  private async defaultOnEvaluate(job: AcpJob) {
    await job.evaluate(true, "Evaluated by default");
  }

  get walletAddress() {
    return this.acpContractClient.walletAddress;
  }

  async init(skipSocketConnection: boolean = false) {
    if (skipSocketConnection) {
      return;
    }

    console.log("Initializing socket");
    const socket = io(this.acpUrl, {
      auth: async (cb) => {
        cb({
          walletAddress: this.walletAddress,
          accessToken: await this.getAccessToken(),
        });
      },
      extraHeaders: {
        "x-sdk-version": version,
        "x-sdk-language": "node",
        "x-contract-address": this.contractClients[0].contractAddress, // always prioritize the first client
      },
      transports: ["websocket"],
    });

    socket.on(SocketEvents.ROOM_JOINED, (_, callback) => {
      console.log("Joined ACP Room");
      callback(true);
    });

    socket.on(SocketEvents.ON_EVALUATE, async (data: IAcpJob, callback) => {
      callback(true);

      if (this.onEvaluate) {
        const job = await this._hydrateJob(data);

        this.onEvaluate(job);
      }
    });

    socket.on(SocketEvents.ON_NEW_TASK, async (data: IAcpJob, callback) => {
      callback(true);

      if (this.onNewTask) {
        const job = await this._hydrateJob(data);

        if (job.phase === AcpJobPhases.EXPIRED) {
          console.warn(`onNewTask skipped for job ${data.id}: job has expired`);
          return;
        }

        try {
          await this.onNewTask(
            job,
            job.memos.find((m) => m.id == data.memoToSign),
          );
        } catch (err) {
          console.error(`onNewTask error for job ${data.id}:`, err);
        }
      }
    });

    const cleanup = async () => {
      if (socket) {
        socket.disconnect();
      }
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }

  private async _fetch<T>(
    url: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    params?: Record<string, any>,
    data?: Record<string, any>,
    errCallback?: (err: AxiosError) => void
  ): Promise<IAcpResponse<T>["data"] | undefined> {
    try {
      const response = await this.acpClient.request<IAcpResponse<T>>({
        url,
        method,
        params,
        data,
      });

      return response.data.data;
    } catch (err) {
      if (err instanceof AxiosError) {
        if (errCallback) {
          errCallback(err);
        } else if (err.response?.data.error?.message) {
          throw new AcpError(err.response?.data.error.message as string);
        }
      } else {
        throw new AcpError(
          `Failed to fetch ACP Endpoint: ${url} (network error)`,
          err
        );
      }
    }
  }

  private async _hydrateMemo(memo: IAcpMemoData): Promise<AcpMemo> {
    try {
      return await AcpMemo.build(
        this,
        memo.id,
        memo.memoType,
        memo.content,
        memo.nextPhase,
        memo.status,
        memo.senderAddress,
        memo.signedReason,
        memo.expiry ? new Date(parseInt(memo.expiry) * 1000) : undefined,
        memo.payableDetails,
        memo.txHash,
        memo.signedTxHash,
        memo.state
      );
    } catch (err) {
      throw new AcpError(`Failed to hydrate memo ${memo.id}`, err);
    }
  }

  private async _hydrateJob(job: IAcpJob): Promise<AcpJob> {
    try {
      return new AcpJob(
        this,
        job.id,
        job.clientAddress,
        job.providerAddress,
        job.evaluatorAddress,
        job.price,
        job.priceTokenAddress,
        await Promise.all(job.memos.map((memo) => this._hydrateMemo(memo))),
        job.phase,
        job.context,
        job.contractAddress,
        job.netPayableAmount
      );
    } catch (err) {
      throw new AcpError(`Failed to hydrate job ${job.id}`, err);
    }
  }

  private async _hydrateJobs(
    rawJobs: IAcpJob[],
    options?: {
      logPrefix?: string;
    }
  ): Promise<AcpJob[]> {
    const jobs = await Promise.all(
      rawJobs.map((job) => {
        try {
          return this._hydrateJob(job);
        } catch (err) {
          console.warn(`${options?.logPrefix ?? "Skipped"}`, err);
          return null;
        }
      })
    );

    return jobs.filter((job) => !!job) as AcpJob[];
  }

  private _hydrateAgent(agent: IAcpAgent): AcpAgent {
    const acpContractClient = this.contractClients.find(
      (client) =>
        client.contractAddress.toLowerCase() ===
        agent.contractAddress.toLowerCase()
    );

    if (!acpContractClient) {
      throw new AcpError("ACP contract client not found");
    }

    return new AcpAgent({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      jobOfferings: agent.jobs
        .filter(
          (offering) =>
            offering.priceV2?.value != null || offering.price != null
        )
        .map((offering) => {
          const price = offering.priceV2?.value ?? offering.price!;

          const priceType = offering.priceV2?.type ?? PriceType.FIXED;

          return new AcpJobOffering(
            this,
            acpContractClient,
            agent.walletAddress,
            offering.name,
            price,
            priceType,
            offering.requiredFunds,
            offering.slaMinutes,
            offering.requirement,
            offering.deliverable,
            offering.subscriptionTiers ?? [],
            offering.isPrivate
          );
        }),
      contractAddress: agent.contractAddress,
      twitterHandle: agent.twitterHandle,
      walletAddress: agent.walletAddress,
      metrics: agent.metrics,
      resources: agent.resources,
      subscriptions: agent.subscriptions ?? [],
    });
  }

  async browseAgents(
    keyword: string,
    options: IAcpBrowseAgentsOptions = {}
  ): Promise<AcpAgent[]> {
    const {
      cluster,
      sortBy,
      topK = 5,
      sort_by,
      top_k = 5,
      graduationStatus,
      onlineStatus,
      showHiddenOfferings,
    } = options;

    const params: Record<string, string | number | boolean> = {
      search: keyword,
    };

    params.top_k = topK || top_k;
    params.walletAddressesToExclude = this.walletAddress;

    const sortByArray = sortBy || sort_by;
    if (sortByArray && sortByArray.length > 0) {
      params.sortBy = sortByArray.join(",");
    }

    if (cluster) {
      params.cluster = cluster;
    }

    if (graduationStatus) {
      params.graduationStatus = graduationStatus;
    }

    if (onlineStatus) {
      params.onlineStatus = onlineStatus;
    }

    if (showHiddenOfferings) {
      params.showHiddenOfferings = true;
    }

    const agents =
      (await this._fetch<IAcpAgent[]>("/agents/v4/search", "GET", params)) ||
      [];

    const availableContractClientAddresses = this.contractClients.map(
      (client) => client.contractAddress.toLowerCase()
    );

    return agents
      .filter(
        (agent) =>
          agent.walletAddress.toLowerCase() !== this.walletAddress.toLowerCase()
      )
      .filter((agent) =>
        availableContractClientAddresses.includes(
          agent.contractAddress.toLowerCase()
        )
      )
      .map((agent) => {
        return this._hydrateAgent(agent);
      });
  }

  async initiateJob(
    providerAddress: Address,
    serviceRequirement: Object | string,
    fareAmount: FareAmountBase,
    evaluatorAddress?: Address,
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 60 * 24),
    offeringName?: string,
    preferredSubscriptionTier?: string,
  ) {
    if (providerAddress === this.walletAddress) {
      throw new AcpError(
        "Provider address cannot be the same as the client address"
      );
    }

    const subscriptionRequired = preferredSubscriptionTier != null;

    // Resolve subscription account (no-ops when offeringName is absent)
    const { account } =
      await this._resolveSubscriptionAccount(
        providerAddress,
        offeringName,
        preferredSubscriptionTier,
      );

    const budget = subscriptionRequired ? 0n : fareAmount.amount;
    const subscriptionMetadata = subscriptionRequired
      ? JSON.stringify({ name: preferredSubscriptionTier ?? "" })
      : "";

    const isV1 = [
      baseSepoliaAcpConfig.contractAddress,
      baseSepoliaAcpX402Config.contractAddress,
      baseAcpConfig.contractAddress,
      baseAcpX402Config.contractAddress,
    ].includes(this.acpContractClient.config.contractAddress);

    const resolvedEvaluator =
      evaluatorAddress || (isV1 ? this.walletAddress : zeroAddress);

    const chainId = this.acpContractClient.config.chain
      .id as keyof typeof USDC_TOKEN_ADDRESS;

    const isX402Job =
      this.acpContractClient.config.x402Config &&
      USDC_TOKEN_ADDRESS[chainId].toLowerCase() ===
        fareAmount.fare.contractAddress.toLowerCase();

    // Build job-creation operations
    const createJobOperations: OperationPayload[] = [];

    if (isV1 || !account) {
      createJobOperations.push(
        this.acpContractClient.createJob(
          providerAddress,
          resolvedEvaluator,
          expiredAt,
          fareAmount.fare.contractAddress,
          budget,
          subscriptionMetadata,
          isX402Job,
        ),
      );
    } else {
      createJobOperations.push(
        this.acpContractClient.createJobWithAccount(
          account.id,
          resolvedEvaluator,
          budget,
          fareAmount.fare.contractAddress,
          expiredAt,
          isX402Job,
        ),
      );
    }

    const { userOpHash } =
      await this.acpContractClient.handleOperation(createJobOperations);

    const jobId = await this.acpContractClient.getJobId(
      userOpHash,
      this.walletAddress,
      providerAddress
    );

    // Set budget & initial memo
    const payloads: OperationPayload[] = [];

    if (!subscriptionRequired) {
      const setBudgetPayload =
        this.acpContractClient.setBudgetWithPaymentToken(
          jobId,
          fareAmount.amount,
          fareAmount.fare.contractAddress
        );

      if (setBudgetPayload) {
        payloads.push(setBudgetPayload);
      }
    }

    const memoPayload =
      subscriptionRequired && typeof serviceRequirement === "object"
        ? preparePayload({
            ...serviceRequirement,
            priceValue: 0,
            priceType: PriceType.SUBSCRIPTION,
          })
        : preparePayload(serviceRequirement);
    const isPrivate =
      typeof serviceRequirement === "object" &&
      "isPrivate" in serviceRequirement &&
      serviceRequirement.isPrivate;

    let content = memoPayload;

    if (isPrivate) {
      const memoContent = await this.createMemoContent(jobId, memoPayload);
      content = memoContent.url;
    }

    payloads.push(
      this.acpContractClient.createMemo(
        jobId,
        isPrivate ? content : memoPayload,
        isPrivate ? MemoType.OBJECT_URL : MemoType.MESSAGE,
        true,
        AcpJobPhases.NEGOTIATION
      )
    );

    await this.acpContractClient.handleOperation(payloads);

    return jobId;
  }

  async getActiveJobs(
    page: number = 1,
    pageSize: number = 10
  ): Promise<AcpJob[]> {
    const rawJobs = await this._fetch<IAcpJob[]>("/jobs/active", "GET", {
      pagination: {
        page: page,
        pageSize: pageSize,
      },
    });
    return this._hydrateJobs(rawJobs ?? [], { logPrefix: "Active jobs" });
  }

  async getPendingMemoJobs(
    page: number = 1,
    pageSize: number = 10
  ): Promise<AcpJob[]> {
    const rawJobs = await this._fetch<IAcpJob[]>("/jobs/pending-memos", "GET", {
      pagination: {
        page: page,
        pageSize: pageSize,
      },
    });
    return this._hydrateJobs(rawJobs ?? [], { logPrefix: "Pending memo jobs" });
  }

  async getCompletedJobs(
    page: number = 1,
    pageSize: number = 10
  ): Promise<AcpJob[]> {
    const rawJobs = await this._fetch<IAcpJob[]>("/jobs/completed", "GET", {
      pagination: {
        page: page,
        pageSize: pageSize,
      },
    });
    return this._hydrateJobs(rawJobs ?? [], { logPrefix: "Completed jobs" });
  }

  async getCancelledJobs(
    page: number = 1,
    pageSize: number = 10
  ): Promise<AcpJob[]> {
    const rawJobs = await this._fetch<IAcpJob[]>("/jobs/cancelled", "GET", {
      pagination: {
        page: page,
        pageSize: pageSize,
      },
    });
    return this._hydrateJobs(rawJobs ?? [], { logPrefix: "Cancelled jobs" });
  }

  async getJobById(jobId: number): Promise<AcpJob | null> {
    const job = await this._fetch<IAcpJob>(`/jobs/${jobId}`);

    if (!job) {
      return null;
    }

    return this._hydrateJob(job);
  }

  async getMemoById(jobId: number, memoId: number): Promise<AcpMemo | null> {
    const memo = await this._fetch<IAcpMemoData>(
      `/jobs/${jobId}/memos/${memoId}`
    );

    if (!memo) {
      return null;
    }

    return this._hydrateMemo(memo);
  }

  async getAgent(walletAddress: Address, options: IAcpGetAgentOptions = {}) {
    const params: Record<string, string | number | boolean> = {
      "filters[walletAddress]": walletAddress,
    };

    const { showHiddenOfferings } = options;

    if (showHiddenOfferings) {
      params.showHiddenOfferings = true;
    }

    const agentsResponse = await this.noAuthAcpClient.get<
      IAcpResponse<IAcpAgent[]>
    >("/agents", {
      params,
    });

    if (agentsResponse.data.data.length === 0) {
      return null;
    }

    return this._hydrateAgent(agentsResponse.data.data[0]);
  }

  async getAccountByJobId(
    jobId: number,
    acpContractClient?: BaseAcpContractClient
  ) {
    const account = await this._fetch<IAcpAccount>(`/accounts/job/${jobId}`);

    if (!account) {
      return null;
    }

    return new AcpAccount(
      acpContractClient || this.contractClients[0],
      account.id,
      account.clientAddress,
      account.providerAddress,
      account.metadata,
      account.expiryAt,
    );
  }

  /**
   * Gets account or subscription data for a client–provider pair.
   * When offeringName is provided, the backend may return subscription tiers and accounts
   * (ISubscriptionCheckResponse). When not provided, returns a single AcpAccount or null.
   */
  async getByClientAndProvider(
    clientAddress: Address,
    providerAddress: Address,
    acpContractClient?: BaseAcpContractClient,
    offeringName?: string,
  ): Promise<AcpAccount | ISubscriptionCheckResponse | null> {
    let endpoint = `/accounts/client/${clientAddress}/provider/${providerAddress}`;

    if (offeringName) {
      endpoint = `/accounts/sub/client/${clientAddress}/provider/${providerAddress}`;
    }

    const response = await this._fetch<
      IAcpAccount | ISubscriptionCheckResponse
    >(endpoint, "GET", {}, {}, (err) => {
      if (err.response?.status === 404) {
        return;
      }
      throw new AcpError("Failed to get account by client and provider", err);
    });

    if (!response) {
      return null;
    }

    // Subscription response shape (has accounts array)
    if (
      typeof response === "object" &&
      "accounts" in response &&
      Array.isArray((response as ISubscriptionCheckResponse).accounts)
    ) {
      const sub = response as ISubscriptionCheckResponse;
      // Map backend `expiry` to SDK `expiryAt`
      sub.accounts = sub.accounts.map((a) => ({
        ...a,
        expiryAt: a.expiryAt ?? (a as any).expiry,
      }));
      return sub;
    }

    // Single account response
    const account = response as IAcpAccount;
    const expiryAt = account.expiryAt ?? (account as any).expiry;
    return new AcpAccount(
      acpContractClient || this.contractClients[0],
      account.id,
      account.clientAddress,
      account.providerAddress,
      account.metadata,
      expiryAt,
    );
  }

  /**
   * Narrows a backend response to ISubscriptionCheckResponse if it has an accounts array.
   */
  private _asSubscriptionCheck(
    raw: AcpAccount | ISubscriptionCheckResponse | null,
  ): ISubscriptionCheckResponse | null {
    return raw && typeof raw === "object" && "accounts" in raw
      ? (raw as ISubscriptionCheckResponse)
      : null;
  }

  /**
   * Resolve the account to use for the job.
   *
   * For subscription jobs, priority:
   *   1. Valid account matching preferred tier
   *   2. Any valid (non-expired) account
   *   3. Unactivated account (expiryAt = 0) to reuse
   *   4. null — createJob will create a new one
   */
  private async _resolveSubscriptionAccount(
    providerAddress: Address,
    offeringName?: string,
    preferredSubscriptionTier?: string,
  ): Promise<{
    account: AcpAccount | null;
  }> {
    if (!offeringName) return { account: null };

    const raw = await this.getByClientAndProvider(
      this.walletAddress,
      providerAddress,
      this.acpContractClient,
      offeringName,
    );

    const subscriptionCheck =
      raw && typeof raw === "object" && "accounts" in raw
        ? (raw as ISubscriptionCheckResponse)
        : null;

    if (!subscriptionCheck) return { account: null };

    const now = Math.floor(Date.now() / 1000);
    const allAccounts = subscriptionCheck.accounts ?? [];

    const matchedAccount =
      this._findPreferredAccount(allAccounts, preferredSubscriptionTier, now) ??
      allAccounts.find((a) => a.expiryAt != null && a.expiryAt > now) ??
      allAccounts.find((a) => a.expiryAt == null || a.expiryAt === 0);

    if (!matchedAccount) return { account: null };

    return {
      account: new AcpAccount(
        this.acpContractClient,
        matchedAccount.id,
        matchedAccount.clientAddress ?? this.walletAddress,
        matchedAccount.providerAddress ?? providerAddress,
        matchedAccount.metadata,
        matchedAccount.expiryAt,
      ),
    };
  }

  private _findPreferredAccount(
    accounts: IAcpAccount[],
    preferredTier: string | undefined,
    now: number,
  ): IAcpAccount | undefined {
    if (!preferredTier) return undefined;

    return accounts.find((a) => {
      if (a.expiryAt == null || a.expiryAt <= now) return false;
      const meta =
        typeof a.metadata === "string"
          ? (() => {
              try {
                return JSON.parse(a.metadata);
              } catch {
                return {};
              }
            })()
          : (a.metadata ?? {});
      return meta?.name === preferredTier;
    });
  }

  /**
   * Returns the first subscription account with expiryAt > now, or null.
   */
  private _getValidSubscriptionAccountFromResponse(
    response: ISubscriptionCheckResponse,
    acpContractClient: BaseAcpContractClient,
  ): AcpAccount | null {
    const now = Math.floor(Date.now() / 1000);
    const valid = response.accounts?.find(
      (a) => a.expiryAt != null && a.expiryAt > now,
    );
    if (!valid) return null;
    return new AcpAccount(
      acpContractClient,
      valid.id,
      valid.clientAddress,
      valid.providerAddress,
      valid.metadata,
      valid.expiryAt,
    );
  }

  /**
   * Seller-facing: determines whether to create a subscription payment request memo.
   * Call this when handling a new job (e.g. in REQUEST phase); then branch on
   * needsSubscriptionPayment and use tier when true.
   */
  async getSubscriptionPaymentRequirement(
    clientAddress: Address,
    providerAddress: Address,
    offeringName: string,
  ): Promise<SubscriptionPaymentRequirementResult> {
    let raw: AcpAccount | ISubscriptionCheckResponse | null;
    try {
      raw = await this.getByClientAndProvider(
        clientAddress,
        providerAddress,
        undefined,
        offeringName,
      );
    } catch {
      return {
        needsSubscriptionPayment: false,
        action: "no_subscription_required",
      };
    }

    const response = this._asSubscriptionCheck(raw);

    if (!response?.accounts?.length) {
      return {
        needsSubscriptionPayment: false,
        action: "no_subscription_required",
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const hasValidSubscription = response.accounts.some(
      (a) => a.expiryAt != null && a.expiryAt > now,
    );
    if (hasValidSubscription) {
      return {
        needsSubscriptionPayment: false,
        action: "valid_subscription",
      };
    }

    const firstAccount = response.accounts[0];
    const tier: ISubscriptionTier = {
      name: firstAccount.metadata?.name ?? "",
      price: firstAccount.metadata?.price ?? 0,
      duration: firstAccount.metadata?.duration ?? 0,
    };
    return {
      needsSubscriptionPayment: true,
      tier,
    };
  }

  async getValidSubscriptionAccount(
    providerAddress: Address,
    offeringName: string,
    clientAddress: Address,
    acpContractClient?: BaseAcpContractClient,
  ): Promise<AcpAccount | null> {
    const raw = await this.getByClientAndProvider(
      clientAddress,
      providerAddress,
      acpContractClient,
      offeringName,
    );

    const subscriptionCheck = this._asSubscriptionCheck(raw);
    if (!subscriptionCheck) return null;

    const contractClient = acpContractClient || this.contractClients[0];
    const account = this._getValidSubscriptionAccountFromResponse(
      subscriptionCheck,
      contractClient,
    );
    if (account) return account;

    // Legacy shape: optional account / hasValidSubscription from backend
    const legacy = subscriptionCheck as ISubscriptionCheckResponse & {
      subscriptionRequired?: boolean;
      hasValidSubscription?: boolean;
      account?: IAcpAccount;
    };
    if (
      legacy.subscriptionRequired &&
      legacy.hasValidSubscription &&
      legacy.account
    ) {
      return new AcpAccount(
        contractClient,
        legacy.account.id,
        legacy.account.clientAddress,
        legacy.account.providerAddress,
        legacy.account.metadata,
        legacy.account.expiryAt,
      );
    }
    return null;
  }

  async createMemoContent(jobId: number, content: string) {
    const response = await this._fetch<IAcpMemoContent>(
      `/memo-contents`,
      "POST",
      {},
      {
        data: {
          onChainJobId: jobId,
          content,
        },
      }
    );

    if (!response) {
      throw new AcpError("Failed to create memo content");
    }

    return response;
  }

  async getMemoContent(url: string) {
    const response = await this._fetch<{
      id: number;
      content: string;
    }>(url);

    if (!response) {
      throw new AcpError("Failed to get memo content");
    }

    return response.content;
  }

  async getTokenBalances() {
    const response = await this._fetch<{ tokens: Record<string, any> }>(
      `/chains/token-balances`,
      "GET"
    );

    return response;
  }

  // -- AgentCard (virtual card) methods --

  async cardSignup(email: string): Promise<IAgentCardSignupResult | undefined> {
    return this._fetch<IAgentCardSignupResult>(
      "/me/card/signup",
      "POST",
      undefined,
      { email }
    );
  }

  async cardSignupPoll(state: string): Promise<IAgentCardSignupPollResult | undefined> {
    return this._fetch<IAgentCardSignupPollResult>(
      "/me/card/signup/poll",
      "GET",
      { state }
    );
  }

  async cardWhoami(): Promise<{ email: string } | undefined> {
    return this._fetch<{ email: string }>("/me/card/whoami");
  }

  async cardPurchase(amountCents: number): Promise<IAgentCardPurchaseResult | undefined> {
    return this._fetch<IAgentCardPurchaseResult>(
      "/me/card/purchase",
      "POST",
      undefined,
      { amountCents }
    );
  }

  async cardPurchaseStatus(sessionId: string): Promise<IAgentCardPurchaseStatusResult | undefined> {
    return this._fetch<IAgentCardPurchaseStatusResult>(
      "/me/card/purchase/status",
      "GET",
      { session_id: sessionId }
    );
  }

  async cardList(): Promise<IAgentCardListResult | undefined> {
    return this._fetch<IAgentCardListResult>("/me/card");
  }

  async cardDetails(cardId: string): Promise<IAgentCardDetails | undefined> {
    return this._fetch<IAgentCardDetails>(`/me/card/${cardId}/details`);
  }

  async cardBalance(cardId: string): Promise<{ amountCents: number } | undefined> {
    return this._fetch<{ amountCents: number }>(`/me/card/${cardId}/balance`);
  }

  async cardTrack(opts: IAgentCardTrackOptions): Promise<void> {
    await this._fetch<void>(
      "/me/card/track",
      "POST",
      undefined,
      opts
    );
  }

  async cardRefund(cardId: string, amountCents: number): Promise<IAgentCardRefundResult | undefined> {
    return this._fetch<IAgentCardRefundResult>(
      `/me/card/${cardId}/refund`,
      "POST",
      undefined,
      { amountCents }
    );
  }

  async cardRefundStatus(sessionId: string): Promise<IAgentCardRefundStatusResult | undefined> {
    return this._fetch<IAgentCardRefundStatusResult>(
      "/me/card/refund/status",
      "GET",
      { session_id: sessionId }
    );
  }
}

export default AcpClient;

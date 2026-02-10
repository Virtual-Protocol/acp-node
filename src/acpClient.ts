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
import AcpJobOffering from "./acpJobOffering";
import {
  IAcpAgent,
  AcpAgentSort,
  AcpGraduationStatus,
  AcpMemoState,
  AcpOnlineStatus,
  IAcpAccount,
  IAcpClientOptions,
  IAcpJob,
  IAcpMemoData,
  IAcpResponse,
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

declare module "axios" {
  interface InternalAxiosRequestConfig {
    _retryCount?: number;
  }
}

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

    this.noAuthAcpClient = this.acpClient.create({
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
          (originalRequest._retryCount ?? 0) < 2
        ) {
          originalRequest._retryCount = (originalRequest._retryCount ?? 0) + 1;

          const newToken = await this.forceRefreshToken();
          originalRequest.headers["authorization"] = `Bearer ${newToken}`;

          return this.acpClient.request(originalRequest);
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

  private async forceRefreshToken() {
    this.accessToken = null;
    return await this.getAccessToken();
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
    } catch (err) {
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
        const job = this._hydrateJob(data);

        this.onEvaluate(job);
      }
    });

    socket.on(SocketEvents.ON_NEW_TASK, async (data: IAcpJob, callback) => {
      callback(true);

      if (this.onNewTask) {
        const job = this._hydrateJob(data);

        this.onNewTask(
          job,
          job.memos.find((m) => m.id == data.memoToSign)
        );
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

  private _hydrateMemo(
    memo: IAcpMemoData,
    contractClient: BaseAcpContractClient
  ): AcpMemo {
    try {
      return new AcpMemo(
        contractClient,
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

  private _hydrateJob(job: IAcpJob): AcpJob {
    try {
      return new AcpJob(
        this,
        job.id,
        job.clientAddress,
        job.providerAddress,
        job.evaluatorAddress,
        job.price,
        job.priceTokenAddress,
        job.memos.map((memo) =>
          this._hydrateMemo(
            memo,
            this.contractClientByAddress(job.contractAddress)
          )
        ),
        job.phase,
        job.context,
        job.contractAddress,
        job.netPayableAmount
      );
    } catch (err) {
      throw new AcpError(`Failed to hydrate job ${job.id}`, err);
    }
  }

  private _hydrateJobs(
    rawJobs: IAcpJob[],
    options?: {
      logPrefix?: string;
    }
  ): AcpJob[] {
    const jobs = rawJobs.map((job) => {
      try {
        return this._hydrateJob(job);
      } catch (err) {
        console.warn(`${options?.logPrefix ?? "Skipped"}`, err);
        return null;
      }
    });

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
      jobOfferings: agent.jobs.map((jobs) => {
        return new AcpJobOffering(
          this,
          acpContractClient,
          agent.walletAddress,
          jobs.name,
          jobs.priceV2.value,
          jobs.priceV2.type,
          jobs.requirement
        );
      }),
      contractAddress: agent.contractAddress,
      twitterHandle: agent.twitterHandle,
      walletAddress: agent.walletAddress,
      metrics: agent.metrics,
      resources: agent.resources,
    });
  }

  async browseAgents(
    keyword: string,
    options: IAcpBrowseAgentsOptions = {}
  ): Promise<AcpAgent[] | undefined> {
    const {
      cluster,
      sortBy,
      topK = 5,
      graduationStatus,
      onlineStatus,
      showHiddenOfferings,
    } = options;

    const params: Record<string, string | number | boolean> = {
      search: keyword,
    };

    params.top_k = topK;
    params.walletAddressesToExclude = this.walletAddress;

    if (sortBy && sortBy.length > 0) {
      params.sortBy = sortBy.join(",");
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
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 60 * 24)
  ) {
    if (providerAddress === this.walletAddress) {
      throw new AcpError(
        "Provider address cannot be the same as the client address"
      );
    }

    const account = await this.getByClientAndProvider(
      this.walletAddress,
      providerAddress,
      this.acpContractClient
    );

    const isV1 = [
      baseSepoliaAcpConfig.contractAddress,
      baseSepoliaAcpX402Config.contractAddress,
      baseAcpConfig.contractAddress,
      baseAcpX402Config.contractAddress,
    ].includes(this.acpContractClient.config.contractAddress);

    const defaultEvaluatorAddress =
      isV1 && !evaluatorAddress ? this.walletAddress : zeroAddress;

    const chainId = this.acpContractClient.config.chain
      .id as keyof typeof USDC_TOKEN_ADDRESS;

    const isUsdcPaymentToken =
      USDC_TOKEN_ADDRESS[chainId].toLowerCase() ===
      fareAmount.fare.contractAddress.toLowerCase();

    const isX402Job =
      this.acpContractClient.config.x402Config && isUsdcPaymentToken;

    const createJobPayload =
      isV1 || !account
        ? this.acpContractClient.createJob(
            providerAddress,
            evaluatorAddress || defaultEvaluatorAddress,
            expiredAt,
            fareAmount.fare.contractAddress,
            fareAmount.amount,
            "",
            isX402Job
          )
        : this.acpContractClient.createJobWithAccount(
            account.id,
            evaluatorAddress || defaultEvaluatorAddress,
            fareAmount.amount,
            fareAmount.fare.contractAddress,
            expiredAt,
            isX402Job
          );

    const { userOpHash } = await this.acpContractClient.handleOperation([
      createJobPayload,
    ]);

    const jobId = await this.acpContractClient.getJobId(
      userOpHash,
      this.walletAddress,
      providerAddress
    );

    const payloads: OperationPayload[] = [];

    const setBudgetWithPaymentTokenPayload =
      this.acpContractClient.setBudgetWithPaymentToken(
        jobId,
        fareAmount.amount,
        fareAmount.fare.contractAddress
      );

    if (setBudgetWithPaymentTokenPayload) {
      payloads.push(setBudgetWithPaymentTokenPayload);
    }

    payloads.push(
      this.acpContractClient.createMemo(
        jobId,
        preparePayload(serviceRequirement),
        MemoType.MESSAGE,
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

    return this._hydrateMemo(
      memo,
      this.contractClientByAddress(memo.contractAddress)
    );
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
      account.metadata
    );
  }

  async getByClientAndProvider(
    clientAddress: Address,
    providerAddress: Address,
    acpContractClient?: BaseAcpContractClient
  ) {
    const response = await this._fetch<IAcpAccount>(
      `/accounts/client/${clientAddress}/provider/${providerAddress}`,
      "GET",
      {},
      {},
      (err) => {
        if (err.response?.status === 404) {
          return;
        }
        throw new AcpError("Failed to get account by client and provider", err);
      }
    );

    if (!response) {
      return null;
    }

    return new AcpAccount(
      acpContractClient || this.contractClients[0],
      response.id,
      response.clientAddress,
      response.providerAddress,
      response.metadata
    );
  }

  async createMemoContent(jobId: number, content: string) {
    const response = await this._fetch(
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

  async getTokenBalances() {
    const response = await this._fetch<{ tokens: Record<string, any> }>(
      `/chains/token-balances`,
      "GET"
    );

    return response;
  }
}

export default AcpClient;

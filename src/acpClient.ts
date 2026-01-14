import { Address, zeroAddress } from "viem";
import { io } from "socket.io-client";
import BaseAcpContractClient, {
  AcpJobPhases,
  MemoType,
  OperationPayload,
} from "./contractClients/baseAcpContractClient";
import AcpJob from "./acpJob";
import AcpMemo from "./acpMemo";
import AcpJobOffering from "./acpJobOffering";
import {
  AcpAgent,
  AcpAgentSort,
  AcpGraduationStatus,
  AcpMemoState,
  AcpOnlineStatus,
  IAcpAccount,
  IAcpClientOptions,
  IAcpJob,
  IAcpJobResponse,
  IAcpMemo,
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

const { version } = require("../package.json");

enum SocketEvents {
  ROOM_JOINED = "roomJoined",
  ON_EVALUATE = "onEvaluate",
  ON_NEW_TASK = "onNewTask",
}

interface IAcpBrowseAgentsOptions {
  cluster?: string;
  sort_by?: AcpAgentSort[];
  top_k?: number;
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

    this.onNewTask = options.onNewTask;
    this.onEvaluate = options.onEvaluate || this.defaultOnEvaluate;

    this.init(options.skipSocketConnection);
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

    const socket = io(this.acpUrl, {
      auth: {
        walletAddress: this.walletAddress,
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

    socket.on(
      SocketEvents.ON_EVALUATE,
      async (data: IAcpJob["data"], callback) => {
        callback(true);

        if (this.onEvaluate) {
          const job = new AcpJob(
            this,
            data.id,
            data.clientAddress,
            data.providerAddress,
            data.evaluatorAddress,
            data.price,
            data.priceTokenAddress,
            data.memos.map((memo) => {
              return new AcpMemo(
                this.contractClientByAddress(data.contractAddress),
                memo.id,
                memo.memoType,
                memo.content,
                memo.nextPhase,
                memo.status,
                memo.senderAddress,
                memo.signedReason,
                memo.expiry
                  ? new Date(parseInt(memo.expiry) * 1000)
                  : undefined,
                memo.payableDetails,
                memo.txHash,
                memo.signedTxHash,
                memo.state
              );
            }),
            data.phase,
            data.context,
            data.contractAddress,
            data.netPayableAmount
          );

          this.onEvaluate(job);
        }
      }
    );

    socket.on(
      SocketEvents.ON_NEW_TASK,
      async (data: IAcpJob["data"], callback) => {
        callback(true);

        if (this.onNewTask) {
          const job = new AcpJob(
            this,
            data.id,
            data.clientAddress,
            data.providerAddress,
            data.evaluatorAddress,
            data.price,
            data.priceTokenAddress,
            data.memos.map((memo) => {
              return new AcpMemo(
                this.contractClientByAddress(data.contractAddress),
                memo.id,
                memo.memoType,
                memo.content,
                memo.nextPhase,
                memo.status,
                memo.senderAddress,
                memo.signedReason,
                memo.expiry
                  ? new Date(parseInt(memo.expiry) * 1000)
                  : undefined,
                memo.payableDetails,
                memo.txHash,
                memo.signedTxHash,
                memo.state
              );
            }),
            data.phase,
            data.context,
            data.contractAddress,
            data.netPayableAmount
          );

          this.onNewTask(
            job,
            job.memos.find((m) => m.id == data.memoToSign)
          );
        }
      }
    );

    const cleanup = async () => {
      if (socket) {
        socket.disconnect();
      }
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }

  async browseAgents(keyword: string, options: IAcpBrowseAgentsOptions) {
    let {
      cluster,
      sort_by,
      top_k,
      graduationStatus,
      onlineStatus,
      showHiddenOfferings,
    } = options;
    top_k = top_k ?? 5;

    let url = `${this.acpUrl}/api/agents/v4/search?search=${keyword}`;

    if (sort_by && sort_by.length > 0) {
      url += `&sortBy=${sort_by.map((s) => s).join(",")}`;
    }

    if (top_k) {
      url += `&top_k=${top_k}`;
    }

    if (this.walletAddress) {
      url += `&walletAddressesToExclude=${this.walletAddress}`;
    }

    if (cluster) {
      url += `&cluster=${cluster}`;
    }

    if (graduationStatus) {
      url += `&graduationStatus=${graduationStatus}`;
    }

    if (onlineStatus) {
      url += `&onlineStatus=${onlineStatus}`;
    }

    if (showHiddenOfferings) {
      url += `&showHiddenOfferings=${showHiddenOfferings}`;
    }

    const response = await fetch(url);
    const data: {
      data: AcpAgent[];
    } = await response.json();

    const availableContractClientAddresses = this.contractClients.map(
      (client) => client.contractAddress.toLowerCase()
    );

    return data.data
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
        const acpContractClient = this.contractClients.find(
          (client) =>
            client.contractAddress.toLowerCase() ===
            agent.contractAddress.toLowerCase()
        );

        if (!acpContractClient) {
          throw new AcpError("ACP contract client not found");
        }

        return {
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
        };
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
    const url = `${this.acpUrl}/api/jobs/active?pagination[page]=${page}&pagination[pageSize]=${pageSize}`;
    const rawJobs = await this._fetchJobList(url);
    return this._hydrateJobs(rawJobs, { logPrefix: "Active jobs" });
  }

  async getPendingMemoJobs(
    page: number = 1,
    pageSize: number = 10
  ): Promise<AcpJob[]> {
    const url = `${this.acpUrl}/api/jobs/pending-memos?pagination[page]=${page}&pagination[pageSize]=${pageSize}`;
    const rawJobs = await this._fetchJobList(url);
    return this._hydrateJobs(rawJobs, { logPrefix: "Pending memo jobs" });
  }

  async getCompletedJobs(
    page: number = 1,
    pageSize: number = 10
  ): Promise<AcpJob[]> {
    const url = `${this.acpUrl}/api/jobs/completed?pagination[page]=${page}&pagination[pageSize]=${pageSize}`;
    const rawJobs = await this._fetchJobList(url);
    return this._hydrateJobs(rawJobs, { logPrefix: "Completed jobs" });
  }

  async getCancelledJobs(
    page: number = 1,
    pageSize: number = 10
  ): Promise<AcpJob[]> {
    const url = `${this.acpUrl}/api/jobs/cancelled?pagination[page]=${page}&pagination[pageSize]=${pageSize}`;
    const rawJobs = await this._fetchJobList(url);
    return this._hydrateJobs(rawJobs, { logPrefix: "Cancelled jobs" });
  }

  private async _fetchJobList(url: string): Promise<IAcpJobResponse["data"]> {
    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          "wallet-address": this.walletAddress,
        },
      });
    } catch (err) {
      throw new AcpError("Failed to fetch ACP jobs (network error)", err);
    }

    let data: IAcpJobResponse;
    try {
      data = await response.json();
    } catch (err) {
      throw new AcpError("Failed to parse ACP jobs response", err);
    }

    if (data.error) {
      throw new AcpError(data.error.message);
    }

    return data.data;
  }

  private _hydrateJobs(
    rawJobs: IAcpJobResponse["data"],
    options?: {
      logPrefix?: string;
    }
  ): AcpJob[] {
    const jobs: AcpJob[] = [];
    const errors: { jobId?: number; error: Error }[] = [];

    for (const job of rawJobs) {
      try {
        const memos = job.memos.map(
          (memo) =>
            new AcpMemo(
              this.contractClientByAddress(job.contractAddress),
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
            )
        );

        jobs.push(
          new AcpJob(
            this,
            job.id,
            job.clientAddress,
            job.providerAddress,
            job.evaluatorAddress,
            job.price,
            job.priceTokenAddress,
            memos,
            job.phase,
            job.context,
            job.contractAddress,
            job.netPayableAmount
          )
        );
      } catch (err) {
        errors.push({ jobId: job.id, error: err as Error });
      }
    }

    if (errors.length > 0) {
      console.warn(
        `${options?.logPrefix ?? "Skipped"} ${
          errors.length
        } malformed job(s)\n` +
          JSON.stringify(
            errors.map((e) => ({ jobId: e.jobId, message: e.error.message })),
            null,
            2
          )
      );
    }

    return jobs;
  }

  async getJobById(jobId: number): Promise<AcpJob | undefined> {
    const url = `${this.acpUrl}/api/jobs/${jobId}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "wallet-address": this.acpContractClient.walletAddress,
        },
      });
    } catch (err) {
      throw new AcpError("Failed to fetch job by id (network error)", err);
    }

    let data: IAcpJob;
    try {
      data = await response.json();
    } catch (err) {
      throw new AcpError("Failed to parse job by id response", err);
    }

    if (data.error) {
      throw new AcpError(data.error.message);
    }

    const job = data.data;
    if (!job) {
      return undefined;
    }

    try {
      const memos = job.memos.map(
        (memo) =>
          new AcpMemo(
            this.contractClientByAddress(job.contractAddress),
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
          )
      );

      return new AcpJob(
        this,
        job.id,
        job.clientAddress,
        job.providerAddress,
        job.evaluatorAddress,
        job.price,
        job.priceTokenAddress,
        memos,
        job.phase,
        job.context,
        job.contractAddress,
        job.netPayableAmount
      );
    } catch (err) {
      throw new AcpError(`Failed to hydrate job ${jobId}`, err);
    }
  }

  async getMemoById(
    jobId: number,
    memoId: number
  ): Promise<AcpMemo | undefined> {
    const url = `${this.acpUrl}/api/jobs/${jobId}/memos/${memoId}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "wallet-address": this.walletAddress,
        },
      });
    } catch (err) {
      throw new AcpError("Failed to fetch memo by id (network error)", err);
    }

    let data: IAcpMemo;
    try {
      data = await response.json();
    } catch (err) {
      throw new AcpError("Failed to parse memo by id response", err);
    }

    if (data.error) {
      throw new AcpError(data.error.message);
    }

    const memo = data.data;
    if (!memo) {
      return undefined;
    }

    try {
      return new AcpMemo(
        this.contractClientByAddress(memo.contractAddress),
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
      throw new AcpError(
        `Failed to hydrate memo ${memoId} for job ${jobId}`,
        err
      );
    }
  }

  async getAgent(walletAddress: Address) {
    const url = `${this.acpUrl}/api/agents?filters[walletAddress]=${walletAddress}`;

    const response = await fetch(url);
    const data: {
      data: AcpAgent[];
    } = await response.json();

    const agents = data.data || [];

    if (agents.length === 0) {
      return;
    }

    return agents[0];
  }

  async getAccountByJobId(
    jobId: number,
    acpContractClient?: BaseAcpContractClient
  ) {
    try {
      const url = `${this.acpUrl}/api/accounts/job/${jobId}`;

      const response = await fetch(url);
      const data: {
        data: IAcpAccount;
      } = await response.json();

      if (!data.data) {
        return null;
      }

      return new AcpAccount(
        acpContractClient || this.contractClients[0],
        data.data.id,
        data.data.clientAddress,
        data.data.providerAddress,
        data.data.metadata
      );
    } catch (error) {
      throw new AcpError("Failed to get account by job id", error);
    }
  }

  async getByClientAndProvider(
    clientAddress: Address,
    providerAddress: Address,
    acpContractClient?: BaseAcpContractClient
  ) {
    try {
      const url = `${this.acpUrl}/api/accounts/client/${clientAddress}/provider/${providerAddress}`;

      const response = await fetch(url);
      const data: {
        data: IAcpAccount;
      } = await response.json();

      if (!data.data) {
        return null;
      }

      return new AcpAccount(
        acpContractClient || this.contractClients[0],
        data.data.id,
        data.data.clientAddress,
        data.data.providerAddress,
        data.data.metadata
      );
    } catch (error) {
      throw new AcpError("Failed to get account by client and provider", error);
    }
  }
}

export default AcpClient;

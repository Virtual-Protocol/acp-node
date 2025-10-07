import { Address } from "viem";
import { io } from "socket.io-client";
import BaseAcpContractClient, {
  AcpJobPhases,
  FeeType,
  MemoType,
} from "./contractClients/baseAcpContractClient";
import AcpJob from "./acpJob";
import AcpMemo from "./acpMemo";
import AcpJobOffering from "./acpJobOffering";
import {
  AcpAgent,
  AcpAgentSort,
  AcpGraduationStatus,
  AcpOnlineStatus,
  GenericPayload,
  IAcpAccount,
  IAcpClientOptions,
  IAcpJob,
  IAcpJobResponse,
  IAcpMemo,
  IDeliverable,
  PayableDetails,
} from "./interfaces";
import AcpError from "./acpError";
import {
  ethFare,
  FareAmount,
  FareAmountBase,
  FareBigInt,
  wethFare,
} from "./acpFare";
import { AcpAccount } from "./acpAccount";
import { baseAcpConfig, baseSepoliaAcpConfig } from "./configs/acpConfigs";
import { tryParseJson } from "./utils";
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

    this.contractClients.every((client) => {
      if (client.contractAddress !== this.contractClients[0].contractAddress) {
        throw new AcpError(
          "All contract clients must have the same agent wallet address"
        );
      }
    });

    this.onNewTask = options.onNewTask;
    this.onEvaluate = options.onEvaluate || this.defaultOnEvaluate;

    this.init();
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
    // always prioritize the first client
    if (Array.isArray(this.acpContractClient)) {
      return this.acpContractClient[0].walletAddress;
    }
    return this.acpContractClient.walletAddress;
  }

  async init() {
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
                memo.payableDetails
              );
            }),
            data.phase,
            data.context,
            data.contractAddress
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
                memo.payableDetails
              );
            }),
            data.phase,
            data.context,
            data.contractAddress
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
    let { cluster, sort_by, top_k, graduationStatus, onlineStatus } = options;
    top_k = top_k ?? 5;

    let url = `${this.acpUrl}/api/agents/v3/search?search=${keyword}`;

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
              jobs.price,
              jobs.requirement
            );
          }),
          contractAddress: agent.contractAddress,
          twitterHandle: agent.twitterHandle,
          walletAddress: agent.walletAddress,
          metrics: agent.metrics,
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

    const { jobId, txHash } =
      [
        baseSepoliaAcpConfig.contractAddress,
        baseAcpConfig.contractAddress,
      ].includes(this.acpContractClient.config.contractAddress) || !account
        ? await this.acpContractClient.createJob(
            providerAddress,
            evaluatorAddress || this.walletAddress,
            expiredAt,
            fareAmount.fare.contractAddress,
            fareAmount.amount,
            ""
          )
        : await this.acpContractClient.createJobWithAccount(
            account.id,
            providerAddress,
            evaluatorAddress || this.walletAddress,
            fareAmount.amount,
            fareAmount.fare.contractAddress,
            expiredAt
          );

    await this.acpContractClient.createMemo(
      jobId,
      JSON.stringify(serviceRequirement),
      MemoType.MESSAGE,
      true,
      AcpJobPhases.NEGOTIATION
    );

    return jobId;
  }

  async createMemo(jobId: number, content: string, nextPhase: AcpJobPhases) {
    return await this.acpContractClient.createMemo(
      jobId,
      content,
      MemoType.MESSAGE,
      false,
      nextPhase
    );
  }

  async createPayableMemo(
    jobId: number,
    content: string,
    amount: FareAmountBase,
    recipient: Address,
    nextPhase: AcpJobPhases,
    type: MemoType.PAYABLE_REQUEST | MemoType.PAYABLE_TRANSFER_ESCROW,
    expiredAt: Date
  ) {
    if (type === MemoType.PAYABLE_TRANSFER_ESCROW) {
      await this.acpContractClient.approveAllowance(
        amount.amount,
        amount.fare.contractAddress
      );
    }

    const feeAmount = new FareAmount(0, this.acpContractClient.config.baseFare);

    return await this.acpContractClient.createPayableMemo(
      jobId,
      content,
      amount.amount,
      recipient,
      feeAmount.amount,
      FeeType.NO_FEE,
      nextPhase,
      type,
      expiredAt,
      amount.fare.contractAddress
    );
  }

  async respondJob(
    jobId: number,
    memoId: number,
    accept: boolean,
    content?: string,
    reason?: string
  ) {
    await this.acpContractClient.signMemo(memoId, accept, reason);

    if (!accept) {
      return;
    }

    return await this.acpContractClient.createMemo(
      jobId,
      content ?? `Job ${jobId} accepted. ${reason ?? ""}`,
      MemoType.MESSAGE,
      false,
      AcpJobPhases.TRANSACTION
    );
  }

  async payJob(
    jobId: number,
    amountBaseUnit: bigint,
    memoId: number,
    reason?: string
  ) {
    if (amountBaseUnit > BigInt(0)) {
      await this.acpContractClient.approveAllowance(amountBaseUnit);
    }

    await this.acpContractClient.signMemo(memoId, true, reason);

    return await this.acpContractClient.createMemo(
      jobId,
      `Payment made. ${reason ?? ""}`,
      MemoType.MESSAGE,
      false,
      AcpJobPhases.EVALUATION
    );
  }

  async requestFunds<T>(
    jobId: number,
    transferFareAmount: FareAmountBase,
    recipient: Address,
    feeFareAmount: FareAmountBase,
    feeType: FeeType,
    reason: GenericPayload<T>,
    nextPhase: AcpJobPhases,
    expiredAt: Date
  ) {
    return await this.acpContractClient.createPayableMemo(
      jobId,
      JSON.stringify(reason),
      transferFareAmount.amount,
      recipient,
      feeFareAmount.amount,
      feeType,
      nextPhase,
      MemoType.PAYABLE_REQUEST,
      expiredAt
    );
  }

  async responseFundsRequest(
    memoId: number,
    accept: boolean,
    amountBaseUnit: bigint,
    reason?: string
  ) {
    if (!accept) {
      return await this.acpContractClient.signMemo(memoId, accept, reason);
    }

    if (amountBaseUnit > BigInt(0)) {
      await this.acpContractClient.approveAllowance(amountBaseUnit);
    }

    return await this.acpContractClient.signMemo(memoId, true, reason);
  }

  async transferFunds<T>(
    jobId: number,
    transferFareAmount: FareAmountBase,
    recipient: Address,
    feeFareAmount: FareAmountBase,
    feeType: FeeType,
    reason: GenericPayload<T>,
    nextPhase: AcpJobPhases,
    expiredAt: Date
  ) {
    if (transferFareAmount.fare.contractAddress === ethFare.contractAddress) {
      await this.acpContractClient.wrapEth(transferFareAmount.amount);
      transferFareAmount = new FareBigInt(transferFareAmount.amount, wethFare);
    }

    if (
      feeFareAmount.amount > 0 &&
      feeFareAmount.fare.contractAddress !==
        this.acpContractClient.config.baseFare.contractAddress
    ) {
      throw new AcpError("Fee token address is not the same as the base fare");
    }

    const isFeeTokenDifferent =
      feeFareAmount.fare.contractAddress !==
      transferFareAmount.fare.contractAddress;

    if (isFeeTokenDifferent) {
      await this.acpContractClient.approveAllowance(
        feeFareAmount.amount,
        feeFareAmount.fare.contractAddress
      );
    }

    const finalAmount = isFeeTokenDifferent
      ? transferFareAmount
      : transferFareAmount.add(feeFareAmount);

    await this.acpContractClient.approveAllowance(
      finalAmount.amount,
      transferFareAmount.fare.contractAddress
    );

    return await this.acpContractClient.createPayableMemo(
      jobId,
      JSON.stringify(reason),
      transferFareAmount.amount,
      recipient,
      feeFareAmount.amount,
      feeType,
      nextPhase,
      MemoType.PAYABLE_TRANSFER_ESCROW,
      expiredAt,
      transferFareAmount.fare.contractAddress
    );
  }

  async sendMessage<T>(
    jobId: number,
    message: GenericPayload<T>,
    nextPhase: AcpJobPhases
  ) {
    return await this.acpContractClient.createMemo(
      jobId,
      JSON.stringify(message),
      MemoType.MESSAGE,
      false,
      nextPhase
    );
  }

  async responseFundsTransfer(
    memoId: number,
    accept: boolean,
    reason?: string
  ) {
    return await this.acpContractClient.signMemo(memoId, accept, reason);
  }

  async rejectJob(jobId: number, reason?: string) {
    return await this.acpContractClient.createMemo(
      jobId,
      `Job ${jobId} rejected. ${reason || ""}`,
      MemoType.MESSAGE,
      false,
      AcpJobPhases.REJECTED
    );
  }

  async deliverJob(jobId: number, deliverable: IDeliverable) {
    return await this.acpContractClient.createMemo(
      jobId,
      JSON.stringify(deliverable),
      MemoType.OBJECT_URL,
      true,
      AcpJobPhases.COMPLETED
    );
  }

  async getActiveJobs(page: number = 1, pageSize: number = 10) {
    let url = `${this.acpUrl}/api/jobs/active?pagination[page]=${page}&pagination[pageSize]=${pageSize}`;

    try {
      const response = await fetch(url, {
        headers: {
          "wallet-address": this.walletAddress,
        },
      });

      const data: IAcpJobResponse = await response.json();

      if (data.error) {
        throw new AcpError(data.error.message);
      }

      return data.data.map((job) => {
        return new AcpJob(
          this,
          job.id,
          job.clientAddress,
          job.providerAddress,
          job.evaluatorAddress,
          job.price,
          job.priceTokenAddress,
          job.memos.map((memo) => {
            return new AcpMemo(
              this.contractClientByAddress(job.contractAddress),
              memo.id,
              memo.memoType,
              memo.content,
              memo.nextPhase,
              memo.status,
              memo.senderAddress,
              memo.signedReason,
              memo.expiry ? new Date(parseInt(memo.expiry) * 1000) : undefined,
              memo.payableDetails
            );
          }),
          job.phase,
          job.context,
          job.contractAddress
        );
      });
    } catch (error) {
      throw new AcpError("Failed to get active jobs", error);
    }
  }

  async getPendingMemoJobs(page: number = 1, pageSize: number = 10) {
    let url = `${this.acpUrl}/api/jobs/pending-memos?pagination[page]=${page}&pagination[pageSize]=${pageSize}`;

    try {
      const response = await fetch(url, {
        headers: {
          "wallet-address": this.acpContractClient.walletAddress,
        },
      });

      const data: IAcpJobResponse = await response.json();

      if (data.error) {
        throw new AcpError(data.error.message);
      }

      return data.data.map((job) => {
        return new AcpJob(
          this,
          job.id,
          job.clientAddress,
          job.providerAddress,
          job.evaluatorAddress,
          job.price,
          job.priceTokenAddress,
          job.memos.map((memo) => {
            return new AcpMemo(
              this.contractClientByAddress(job.contractAddress),
              memo.id,
              memo.memoType,
              memo.content,
              memo.nextPhase,
              memo.status,
              memo.senderAddress,
              memo.signedReason,
              memo.expiry ? new Date(parseInt(memo.expiry) * 1000) : undefined,
              typeof memo.payableDetails === "string"
                ? tryParseJson<PayableDetails>(memo.payableDetails) || undefined
                : memo.payableDetails
            );
          }),
          job.phase,
          job.context,
          job.contractAddress
        );
      });
    } catch (error) {
      throw new AcpError("Failed to get pending memo jobs", error);
    }
  }

  async getCompletedJobs(page: number = 1, pageSize: number = 10) {
    let url = `${this.acpUrl}/api/jobs/completed?pagination[page]=${page}&pagination[pageSize]=${pageSize}`;

    try {
      const response = await fetch(url, {
        headers: {
          "wallet-address": this.acpContractClient.walletAddress,
        },
      });

      const data: IAcpJobResponse = await response.json();

      if (data.error) {
        throw new AcpError(data.error.message);
      }

      return data.data.map((job) => {
        return new AcpJob(
          this,
          job.id,
          job.clientAddress,
          job.providerAddress,
          job.evaluatorAddress,
          job.price,
          job.priceTokenAddress,
          job.memos.map((memo) => {
            return new AcpMemo(
              this.contractClientByAddress(job.contractAddress),
              memo.id,
              memo.memoType,
              memo.content,
              memo.nextPhase,
              memo.status,
              memo.senderAddress,
              memo.signedReason,
              memo.expiry ? new Date(parseInt(memo.expiry) * 1000) : undefined,
              memo.payableDetails
            );
          }),
          job.phase,
          job.context,
          job.contractAddress
        );
      });
    } catch (error) {
      throw new AcpError("Failed to get completed jobs", error);
    }
  }

  async getCancelledJobs(page: number = 1, pageSize: number = 10) {
    let url = `${this.acpUrl}/api/jobs/cancelled?pagination[page]=${page}&pagination[pageSize]=${pageSize}`;

    try {
      const response = await fetch(url, {
        headers: {
          "wallet-address": this.walletAddress,
        },
      });

      const data: IAcpJobResponse = await response.json();

      if (data.error) {
        throw new AcpError(data.error.message);
      }
      return data.data.map((job) => {
        return new AcpJob(
          this,
          job.id,
          job.clientAddress,
          job.providerAddress,
          job.evaluatorAddress,
          job.price,
          job.priceTokenAddress,
          job.memos.map((memo) => {
            return new AcpMemo(
              this.contractClientByAddress(job.contractAddress),
              memo.id,
              memo.memoType,
              memo.content,
              memo.nextPhase,
              memo.status,
              memo.senderAddress,
              memo.signedReason,
              memo.expiry ? new Date(parseInt(memo.expiry) * 1000) : undefined,
              memo.payableDetails
            );
          }),
          job.phase,
          job.context,
          job.contractAddress
        );
      });
    } catch (error) {
      throw new AcpError("Failed to get cancelled jobs", error);
    }
  }

  async getJobById(jobId: number) {
    let url = `${this.acpUrl}/api/jobs/${jobId}`;

    try {
      const response = await fetch(url, {
        headers: {
          "wallet-address": this.acpContractClient.walletAddress,
        },
      });

      const data: IAcpJob = await response.json();

      if (data.error) {
        throw new AcpError(data.error.message);
      }

      const job = data.data;
      if (!job) {
        return;
      }

      return new AcpJob(
        this,
        job.id,
        job.clientAddress,
        job.providerAddress,
        job.evaluatorAddress,
        job.price,
        job.priceTokenAddress,
        job.memos.map((memo) => {
          return new AcpMemo(
            this.contractClientByAddress(job.contractAddress),
            memo.id,
            memo.memoType,
            memo.content,
            memo.nextPhase,
            memo.status,
            memo.senderAddress,
            memo.signedReason,
            memo.expiry ? new Date(parseInt(memo.expiry) * 1000) : undefined,
            memo.payableDetails
          );
        }),
        job.phase,
        job.context,
        job.contractAddress
      );
    } catch (error) {
      throw new AcpError("Failed to get job by id", error);
    }
  }

  async getMemoById(jobId: number, memoId: number) {
    let url = `${this.acpUrl}/api/jobs/${jobId}/memos/${memoId}`;

    try {
      const response = await fetch(url, {
        headers: {
          "wallet-address": this.walletAddress,
        },
      });

      const data: IAcpMemo = await response.json();

      if (data.error) {
        throw new AcpError(data.error.message);
      }

      const memo = data.data;
      if (!memo) {
        return;
      }

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
        memo.payableDetails
      );
    } catch (error) {
      throw new AcpError("Failed to get memo by id", error);
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

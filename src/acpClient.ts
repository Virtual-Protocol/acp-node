import { Address } from "viem";
import { io } from "socket.io-client";
import AcpContractClient, {
  AcpJobPhases,
  FeeType,
  MemoType,
} from "./acpContractClient";
import AcpJob from "./acpJob";
import AcpMemo from "./acpMemo";
import AcpJobOffering from "./acpJobOffering";
import {
  AcpAgent,
  AcpAgentSort,
  AcpGraduationStatus,
  AcpOnlineStatus,
  GenericPayload,
  IAcpClientOptions,
  IAcpJob,
  IAcpJobResponse,
  IAcpMemo,
  IDeliverable,
} from "./interfaces";
import { ethFare, FareBigInt, IFareAmount, wethFare } from "./acpFare";
import AcpError from "./acpError";
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
  private acpUrl;
  public acpContractClient: AcpContractClient;
  private onNewTask?: (job: AcpJob, memoToSign?: AcpMemo) => void;
  private onEvaluate?: (job: AcpJob) => void;

  constructor(options: IAcpClientOptions) {
    this.acpContractClient = options.acpContractClient;
    this.onNewTask = options.onNewTask;
    this.onEvaluate = options.onEvaluate || this.defaultOnEvaluate;

    this.acpUrl = this.acpContractClient.config.acpUrl;
    this.init();
  }

  private async defaultOnEvaluate(job: AcpJob) {
    await job.evaluate(true, "Evaluated by default");
  }

  async init() {
    const socket = io(this.acpUrl, {
      auth: {
        walletAddress: this.acpContractClient.walletAddress,
        ...(this.onEvaluate !== this.defaultOnEvaluate && {
          evaluatorAddress: this.acpContractClient.walletAddress,
        }),
      },
      extraHeaders: {
        "x-sdk-version": version,
        "x-sdk-language": "node",
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
                this,
                memo.id,
                memo.memoType,
                memo.content,
                memo.nextPhase,
                memo.status,
                memo.signedReason,
                memo.expiry
                  ? new Date(parseInt(memo.expiry) * 1000)
                  : undefined,
                memo.payableDetails
              );
            }),
            data.phase,
            data.context
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
                this,
                memo.id,
                memo.memoType,
                memo.content,
                memo.nextPhase,
                memo.status,
                memo.signedReason,
                memo.expiry
                  ? new Date(parseInt(memo.expiry) * 1000)
                  : undefined,
                memo.payableDetails
              );
            }),
            data.phase,
            data.context
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

    let url = `${this.acpUrl}/api/agents/v2/search?search=${keyword}`;

    if (sort_by && sort_by.length > 0) {
      url += `&sortBy=${sort_by.map((s) => s).join(",")}`;
    }

    if (top_k) {
      url += `&top_k=${top_k}`;
    }

    if (this.acpContractClient.walletAddress) {
      url += `&walletAddressesToExclude=${this.acpContractClient.walletAddress}`;
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

    return data.data.map((agent) => {
      return {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        offerings: agent.offerings.map((offering) => {
          return new AcpJobOffering(
            this,
            agent.walletAddress,
            offering.name,
            offering.priceUsd,
            offering.requirementSchema
          );
        }),
        twitterHandle: agent.twitterHandle,
        walletAddress: agent.walletAddress,
        metrics: agent.metrics,
      };
    });
  }

  async initiateJob(
    providerAddress: Address,
    serviceRequirement: Object | string,
    fareAmount: IFareAmount,
    evaluatorAddress?: Address,
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 60 * 24)
  ) {
    if (providerAddress === this.acpContractClient.walletAddress) {
      throw new AcpError(
        "Provider address cannot be the same as the client address"
      );
    }

    const { jobId } = await this.acpContractClient.createJob(
      providerAddress,
      evaluatorAddress || this.acpContractClient.walletAddress,
      expiredAt
    );

    await this.acpContractClient.setBudgetWithPaymentToken(
      jobId,
      fareAmount.amount,
      fareAmount.fare.contractAddress
    );

    await this.acpContractClient.createMemo(
      jobId,
      typeof serviceRequirement === "string"
        ? serviceRequirement
        : JSON.stringify(serviceRequirement),
      MemoType.MESSAGE,
      true,
      AcpJobPhases.NEGOTIATION
    );

    return jobId;
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
    transferFareAmount: IFareAmount,
    recipient: Address,
    feeFareAmount: IFareAmount,
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
    transferFareAmount: IFareAmount,
    recipient: Address,
    feeFareAmount: IFareAmount,
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
              this,
              memo.id,
              memo.memoType,
              memo.content,
              memo.nextPhase,
              memo.status,
              memo.signedReason,
              memo.expiry ? new Date(parseInt(memo.expiry) * 1000) : undefined,
              memo.payableDetails
            );
          }),
          job.phase,
          job.context
        );
      });
    } catch (error) {
      throw new AcpError("Failed to get active jobs", error);
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
              this,
              memo.id,
              memo.memoType,
              memo.content,
              memo.nextPhase,
              memo.status,
              memo.signedReason,
              memo.expiry ? new Date(parseInt(memo.expiry) * 1000) : undefined,
              memo.payableDetails
            );
          }),
          job.phase,
          job.context
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
              this,
              memo.id,
              memo.memoType,
              memo.content,
              memo.nextPhase,
              memo.status,
              memo.signedReason,
              memo.expiry ? new Date(parseInt(memo.expiry) * 1000) : undefined,
              memo.payableDetails
            );
          }),
          job.phase,
          job.context
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
            this,
            memo.id,
            memo.memoType,
            memo.content,
            memo.nextPhase,
            memo.status,
            memo.signedReason,
            memo.expiry ? new Date(parseInt(memo.expiry) * 1000) : undefined,
            memo.payableDetails
          );
        }),
        job.phase,
        job.context
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
          "wallet-address": this.acpContractClient.walletAddress,
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
        this,
        memo.id,
        memo.memoType,
        memo.content,
        memo.nextPhase,
        memo.status,
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
}

export default AcpClient;

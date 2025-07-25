import { Address, http, parseEther } from "viem";
import { io } from "socket.io-client";
import AcpContractClient, { AcpJobPhases, MemoType } from "./acpContractClient";
import { AcpAgent, AcpAgentSort } from "./interfaces";
import AcpJob from "./acpJob";
import AcpMemo from "./acpMemo";
import AcpJobOffering from "./acpJobOffering";
import {
  IAcpClientOptions,
  IAcpJob,
  IAcpJobResponse,
  IAcpMemo,
} from "./interfaces";
const { version } = require("../package.json");
import { publicActionsL2 } from 'viem/op-stack';
import { createPublicClient, PublicClient } from "viem";

enum SocketEvents {
  ROOM_JOINED = "roomJoined",
  ON_EVALUATE = "onEvaluate",
  ON_NEW_TASK = "onNewTask",
}

interface IAcpBrowseAgentsOptions {
  cluster?: string;
  sort_by?: AcpAgentSort[];
  rerank?: boolean;
  top_k?: number;
  graduated?: boolean;
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
  private onNewTask?: (job: AcpJob) => void;
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
            data.memos.map((memo) => {
              return new AcpMemo(
                this,
                memo.id,
                memo.memoType,
                memo.content,
                memo.nextPhase
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
            data.memos.map((memo) => {
              return new AcpMemo(
                this,
                memo.id,
                memo.memoType,
                memo.content,
                memo.nextPhase
              );
            }),
            data.phase,
            data.context
          );

          this.onNewTask(job);
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
    let { cluster, sort_by, rerank, top_k, graduated } = options;
    rerank = rerank ?? true;
    top_k = top_k ?? 5;
    graduated = graduated ?? true;

    let url = `${this.acpUrl}/api/agents?search=${keyword}`;

    if (sort_by && sort_by.length > 0) {
      url += `&sort=${sort_by.map((s) => s).join(",")}`;
    }

    if (top_k) {
      url += `&top_k=${top_k}`;
    }

    if (rerank) {
      url += `&rerank=true`;
    }

    if (this.acpContractClient.walletAddress) {
      url += `&filters[walletAddress][$notIn]=${this.acpContractClient.walletAddress}`;
    }

    if (cluster) {
      url += `&filters[cluster]=${cluster}`;
    }

    if (graduated === false) {
      url += `&filters[hasGraduated]=false`;
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
            offering.price,
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
    amount: number,
    evaluatorAddress?: Address,
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 60 * 24)
  ) {
    const { jobId } = await this.acpContractClient.createJob(
      providerAddress,
      evaluatorAddress || this.acpContractClient.walletAddress,
      expiredAt
    );

    await this.acpContractClient.setBudget(
      jobId,
      parseEther(amount.toString())
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
    reason?: string
  ) {
    await this.acpContractClient.signMemo(memoId, accept, reason);

    if (!accept) {
      return;
    }

    return await this.acpContractClient.createMemo(
      jobId,
      `Job ${jobId} accepted. ${reason ?? ""}`,
      MemoType.MESSAGE,
      false,
      AcpJobPhases.TRANSACTION
    );
  }

  async payJob(jobId: number, amount: number, memoId: number, reason?: string) {
    await this.acpContractClient.approveAllowance(
      parseEther(amount.toString())
    );

    await this.acpContractClient.signMemo(memoId, true, reason);

    return await this.acpContractClient.createMemo(
      jobId,
      `Payment of ${amount} made. ${reason ?? ""}`,
      MemoType.MESSAGE,
      false,
      AcpJobPhases.EVALUATION
    );
  }

  async deliverJob(jobId: number, deliverable: string) {
    return await this.acpContractClient.createMemo(
      jobId,
      deliverable,
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
        throw new Error(data.error.message);
      }

      return data.data.map((job) => {
        return new AcpJob(
          this,
          job.id,
          job.clientAddress,
          job.providerAddress,
          job.evaluatorAddress,
          job.price,
          job.memos.map((memo) => {
            return new AcpMemo(
              this,
              memo.id,
              memo.memoType,
              memo.content,
              memo.nextPhase
            );
          }),
          job.phase,
          job.context
        );
      });
    } catch (error) {
      throw error;
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
        throw new Error(data.error.message);
      }

      return data.data.map((job) => {
        return new AcpJob(
          this,
          job.id,
          job.clientAddress,
          job.providerAddress,
          job.evaluatorAddress,
          job.price,
          job.memos.map((memo) => {
            return new AcpMemo(
              this,
              memo.id,
              memo.memoType,
              memo.content,
              memo.nextPhase
            );
          }),
          job.phase,
          job.context
        );
      });
    } catch (error) {
      throw error;
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
        throw new Error(data.error.message);
      }
      return data.data.map((job) => {
        return new AcpJob(
          this,
          job.id,
          job.clientAddress,
          job.providerAddress,
          job.evaluatorAddress,
          job.price,
          job.memos.map((memo) => {
            return new AcpMemo(
              this,
              memo.id,
              memo.memoType,
              memo.content,
              memo.nextPhase
            );
          }),
          job.phase,
          job.context
        );
      });
    } catch (error) {
      throw error;
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
        throw new Error(data.error.message);
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
        job.memos.map((memo) => {
          return new AcpMemo(
            this,
            memo.id,
            memo.memoType,
            memo.content,
            memo.nextPhase
          );
        }),
        job.phase,
        job.context
      );
    } catch (error) {
      throw error;
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
        throw new Error(data.error.message);
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
        memo.nextPhase
      );
    } catch (error) {
      throw error;
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

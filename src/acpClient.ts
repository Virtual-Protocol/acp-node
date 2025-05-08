import { Address, parseEther } from "viem";
import AcpContractClient, { AcpJobPhases, MemoType } from "./acpContractClient";
import { AcpAgent } from "../interfaces";
import AcpJob from "./acpJob";
import AcpMemo from "./acpMemo";
import { io, Socket } from "socket.io-client";

export interface IDeliverable {
  type: string;
  value: string;
}

interface IAcpMemoData {
  onChainJobId?: number;
  type: string;
  content: string;
  createdAt: string;
  memoId: number;
  memoType: MemoType;
  nextPhase: AcpJobPhases;
}
interface IAcpMemo {
  data: IAcpMemoData;
  error?: Error;
}

interface IAcpJob {
  data: {
    onChainJobId: number;
    phase: AcpJobPhases;
    description: string;
    buyerAddress: `0x${string}`;
    sellerAddress: `0x${string}`;
    evaluatorAddress: `0x${string}`;
    price: number;
    deliverable: IDeliverable | null;
    memos: IAcpMemoData[];
    createdAt: string;
  };
  error?: Error;
}
interface IAcpJobResponse {
  data: IAcpJob["data"][];
  meta?: {
    pagination: {
      page: number;
      pageSize: number;
      pageCount: number;
      total: number;
    };
  };
  error?: Error;
}

interface IAcpClientOptions {
  acpContractClient: AcpContractClient;
  onNewTask?: (job: AcpJob) => void;
  onEvaluate?: (job: AcpJob) => void;
}

enum SocketEvents {
  JOIN_EVALUATOR_ROOM = "joinEvaluatorRoom",
  LEAVE_EVALUATOR_ROOM = "leaveEvaluatorRoom",
  ROOM_JOINED = "roomJoined",
  ON_PHASE_CHANGE = "onPhaseChange",
  ON_EVALUATE = "onEvaluate",
  ON_NEW_TASK = "onNewTask",
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

  private async defaultOnEvaluate(_: AcpJob) {
    return new EvaluateResult(true, "Evaluated by default");
  }

  async init() {
    const socket = io("http://localhost:1337", {
      auth: {
        walletAddress: this.acpContractClient.walletAddress,
      },
    });

    socket.on("connect", () => {
      console.log("Connected to socket");
    });

    socket.on(SocketEvents.ON_EVALUATE, async (data: IAcpJob) => {
      if (this.onEvaluate) {
        const job = new AcpJob(
          this,
          data.data.onChainJobId,
          data.data.sellerAddress,
          data.data.memos.map((memo) => {
            return new AcpMemo(
              this,
              memo.memoId,
              memo.memoType,
              memo.content,
              memo.nextPhase
            );
          }),
          data.data.phase
        );

        this.onEvaluate(job);
      }
    });

    socket.on(SocketEvents.ON_NEW_TASK, async (data: IAcpJob) => {
      if (this.onNewTask) {
        const job = new AcpJob(
          this,
          data.data.onChainJobId,
          data.data.sellerAddress,
          data.data.memos.map((memo) => {
            return new AcpMemo(
              this,
              memo.memoId,
              memo.memoType,
              memo.content,
              memo.nextPhase
            );
          }),
          data.data.phase
        );

        this.onNewTask(job);
      }
    });

    const cleanup = async () => {
      if (socket) {
        socket.emit(
          SocketEvents.LEAVE_EVALUATOR_ROOM,
          this.acpContractClient.walletAddress
        );
        socket.disconnect();
      }
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }

  handleSocketConnection(socket: Socket) {
    socket.on(SocketEvents.ROOM_JOINED, () => {
      console.log("Room joined");
    });
  }

  async browseAgent(keyword: string, cluster?: string) {
    let url = `${this.acpUrl}/agents?search=${keyword}&filters[walletAddress][$neq]=${this.acpContractClient.walletAddress}`;
    if (cluster) {
      url += `&filters[cluster]=${cluster}`;
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
        offerings: agent.offerings,
        twitterHandle: agent.twitterHandle,
        walletAddress: agent.walletAddress,
      };
    });
  }

  async initiateJob(
    providerAddress: Address,
    serviceRequirement: string,
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 60 * 24),
    evaluatorAddress?: Address
  ) {
    const { jobId } = await this.acpContractClient.createJob(
      providerAddress,
      evaluatorAddress || this.acpContractClient.walletAddress,
      expiredAt
    );

    await this.acpContractClient.createMemo(
      jobId,
      serviceRequirement,
      MemoType.MESSAGE,
      true,
      AcpJobPhases.NEGOTIOATION
    );

    console.log("Job created", jobId);

    return jobId;
  }

  async respondJob(memoId: number, accept: boolean, reason?: string) {
    return await this.acpContractClient.signMemo(memoId, accept, reason);
  }

  async payJob(jobId: number, amount: number) {
    await this.acpContractClient.setBudget(
      jobId,
      parseEther(amount.toString())
    );

    return await this.acpContractClient.approveAllowance(
      parseEther(amount.toString())
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
    let url = `${this.acpUrl}/jobs/active?pagination[page]=${page}&pagination[pageSize]=${pageSize}`;

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
      return data;
    } catch (error) {
      throw error;
    }
  }

  async getCompletedJobs(page: number = 1, pageSize: number = 10) {
    let url = `${this.acpUrl}/jobs/completed?pagination[page]=${page}&pagination[pageSize]=${pageSize}`;

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
      return data;
    } catch (error) {
      throw error;
    }
  }

  async getCancelledJobs(page: number = 1, pageSize: number = 10) {
    let url = `${this.acpUrl}/jobs/cancelled?pagination[page]=${page}&pagination[pageSize]=${pageSize}`;

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
      return data;
    } catch (error) {
      throw error;
    }
  }

  async getJobByOnChainJobId(onChainJobId: number) {
    let url = `${this.acpUrl}/jobs/${onChainJobId}`;

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
      return data;
    } catch (error) {
      throw error;
    }
  }

  async getMemoById(onChainJobId: number, memoId: number) {
    let url = `${this.acpUrl}/jobs/${onChainJobId}/memos/${memoId}`;

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
      return data;
    } catch (error) {
      throw error;
    }
  }
}

export default AcpClient;

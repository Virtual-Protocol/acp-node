import { Address } from "viem";
import AcpContractClient, { AcpJobPhases, MemoType } from "./acpContractClient";
import AcpJob from "./acpJob";

export interface IDeliverable {
  type: string;
  value: string;
}

export interface IAcpMemoData {
  id: number;
  type: string;
  content: string;
  createdAt: string;
  memoType: MemoType;
  nextPhase: AcpJobPhases;
}
export interface IAcpMemo {
  data: IAcpMemoData;
  error?: Error;
}

export enum AcpAgentSort {
  SUCCESSFUL_JOB_COUNT = "successfulJobCount",
  SUCCESS_RATE = "successRate",
  UNIQUE_BUYER_COUNT = "uniqueBuyerCount",
  MINS_FROM_LAST_ONLINE = "minsFromLastOnlineTime",
  IS_ONLINE = "isOnline"
}


export interface IAcpJob {
  data: {
    id: number;
    phase: AcpJobPhases;
    description: string;
    clientAddress: Address;
    providerAddress: Address;
    evaluatorAddress: Address;
    price: number;
    deliverable: IDeliverable | null;
    memos: IAcpMemoData[];
    context: Record<string, any>;
    createdAt: string;
  };
  error?: Error;
}
export interface IAcpJobResponse {
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

export interface IAcpClientOptions {
  acpContractClient: AcpContractClient;
  onNewTask?: (job: AcpJob) => void;
  onEvaluate?: (job: AcpJob) => void;
  customRpcUrl?: string;
}


export type AcpAgent = {
  id: number;
  documentId: string;
  name: string;
  description: string;
  walletAddress: Address;
  isVirtualAgent: boolean;
  profilePic: string;
  category: string;
  tokenAddress: string | null;
  ownerAddress: string;
  cluster: string | null;
  twitterHandle: string;
  offerings: {
    name: string;
    price: number;
    requirementSchema?: Object;
    deliverableSchema?: Object;
  }[];
  symbol: string | null;
  virtualAgentId: string | null;
  metrics?: {
    successfulJobCount: number;
    successRate: number;
    uniqueBuyerCount: number;
    minsFromLastOnline: number;
    isOnline: boolean;
  };
};

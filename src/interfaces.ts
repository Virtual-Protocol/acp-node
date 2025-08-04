import { Address } from "viem";
import AcpContractClient, { AcpJobPhases, MemoType } from "./acpContractClient";
import AcpJob from "./acpJob";
import acpMemo from "./acpMemo";

export interface IDeliverable {
  type: string;
  value: string | object;
}

export enum AcpMemoStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}

export interface IAcpMemoData {
  id: number;
  type: string;
  content: string;
  createdAt: string;
  memoType: MemoType;
  nextPhase: AcpJobPhases;
  status: AcpMemoStatus;
  signedReason?: string;
  expiry?: string;
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
}

export enum AcpGraduationStatus {
  ALL = "all",
  GRADUATED = "graduated",
  NOT_GRADUATED = "not_graduated",
}

export enum AcpOnlineStatus {
  ALL = "all",
  ONLINE = "online",
  OFFLINE = "offline",
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
    memoToSign?: number;
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
  onNewTask?: (job: AcpJob, memoToSign?: acpMemo) => void;
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

export enum PayloadType {
  FUND_RESPONSE = "fund_response",
  OPEN_POSITION = "open_position",
  CLOSE_PARTIAL_POSITION = "close_partial_position",
  CLOSE_POSITION = "close_position",
  POSITION_FULFILLED = "position_fulfilled",
  CLOSE_JOB_AND_WITHDRAW = "close_job_and_withdraw",
  UNFULFILLED_POSITION = "unfulfilled_position",
}

export type GenericPayload<T = any> = {
  type: PayloadType;
  data: T;
};

export type FundResponsePayload = {
  reportingApiEndpoint: string;
  walletAddress?: Address;
};

export type OpenPositionPayload = {
  symbol: string;
  amount: number;
  chain?: string;
  contractAddress?: string;
  tp: {
    price?: number;
    percentage?: number;
  };
  sl: {
    price?: number;
    percentage?: number;
  };
};

export type UpdatePositionPayload = {
  symbol: string;
  contractAddress?: string;
  tp?: {
    amountPercentage?: number;
    price?: number;
    percentage?: number;
  };
  sl?: {
    amountPercentage?: number;
    price?: number;
    percentage?: number;
  };
};

export type ClosePositionPayload = {
  positionId: number;
  amount: number;
};

export type PositionFulfilledPayload = {
  symbol: string;
  amount: number;
  contractAddress: string;
  type: "TP" | "SL" | "CLOSE";
  pnl: number;
  entryPrice: number;
  exitPrice: number;
};

export type UnfulfilledPositionPayload = {
  symbol: string;
  amount: number;
  contractAddress: string;
  type: "ERROR" | "PARTIAL";
  reason?: string;
};

export type CloseJobAndWithdrawPayload = {
  message: string;
};

export type RequestClosePositionPayload = {
  positionId: number;
};

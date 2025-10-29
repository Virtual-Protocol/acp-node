import { Address } from "viem";
import AcpContractClient, {
  AcpJobPhases,
  MemoType,
} from "./contractClients/baseAcpContractClient";
import AcpJob from "./acpJob";
import acpMemo from "./acpMemo";
import { PriceType } from "./acpJobOffering";

export type DeliverablePayload = string | Record<string, unknown>;

/** @deprecated Use DeliverablePayload instead */
export type IDeliverable = DeliverablePayload;

export enum AcpMemoStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}

export interface PayableDetails {
  amount: bigint;
  token: Address;
  recipient: Address;
  feeAmount: bigint;
}

export interface IAcpMemoData {
  id: number;
  type: string;
  content: string;
  createdAt: string;
  memoType: MemoType;
  nextPhase: AcpJobPhases;
  status: AcpMemoStatus;
  senderAddress: Address;
  signedReason?: string;
  expiry?: string;
  payableDetails?: PayableDetails;
  contractAddress?: Address;
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
    priceTokenAddress: Address;
    deliverable: DeliverablePayload | null;
    memos: IAcpMemoData[];
    context: Record<string, any>;
    createdAt: string;
    contractAddress: Address;
    memoToSign?: number;
  };
  error?: Error;
}

export interface IAcpJobX402PaymentDetails {
  isX402: boolean;
  isBudgetReceived: boolean;
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
  acpContractClient: AcpContractClient | AcpContractClient[];
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
  jobs: {
    name: string;
    priceV2: {
      type: PriceType;
      value: number;
    };
    requirement?: Object | string;
    deliverable?: Object | string;
  }[];
  resources: {
    name: string;
    description: string;
    url: string;
    parameters?: Object;
    id: number;
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
  contractAddress: Address;
};

export type IAcpAccount = {
  id: number;
  clientAddress: Address;
  providerAddress: Address;
  metadata: Record<string, any>;
};

export enum PayloadType {
  FUND_RESPONSE = "fund_response",
  OPEN_POSITION = "open_position",
  SWAP_TOKEN = "swap_token",
  RESPONSE_SWAP_TOKEN = "response_swap_token",
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

export enum PositionDirection {
  LONG = "long",
  SHORT = "short",
}

export type OpenPositionPayload = {
  symbol: string;
  amount: number;
  chain?: string;
  contractAddress?: string;
  direction?: PositionDirection;
  tp: {
    price?: number;
    percentage?: number;
  };
  sl: {
    price?: number;
    percentage?: number;
  };
};

export type SwapTokenPayload = {
  fromSymbol: string;
  fromContractAddress: Address;
  amount: number;
  toSymbol: string;
  toContractAddress?: Address;
};

export type ResponseSwapTokenPayload = {
  txnHash?: Address;
  error?: string;
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

export type X402Config = {
  url: string;
};

export type X402PayableRequirements = {
  x402Version: number;
  error: string;
  accepts: X402Requirement[];
};

export type X402Requirement = {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  asset: Address;
  extra: {
    name: string;
    version: string;
  };
  outputSchema: any;
};

export type X402PayableRequest = {
  to: Address;
  value: number;
  maxTimeoutSeconds: number;
  asset: Address;
};

export type X402Payment = {
  encodedPayment: string;
  nonce: string;
};

export type OffChainJob = {
  id: number;
  documentId: string;
  txHash: Address;
  clientId: number;
  providerId: number;
  budget: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  locale: string | null;
  clientAddress: Address;
  providerAddress: Address;
  evaluators: Address[];
  budgetTxHash: Address | null;
  phase: AcpJobPhases;
  agentIdPair: string;
  onChainJobId: string;
  summary: string;
  userOpHash: Address | null;
  amountClaimed: number;
  context: Record<string, any> | null;
  expiry: string;
  refundRetryTimes: number;
  additionalFees: number;
  budgetTokenAddress: Address;
  budgetUSD: number;
  amountClaimedUSD: number | null;
  additionalFeesUSD: number | null;
  contractAddress: Address;
  accountId: number | null;
  x402Nonce: string;
};

export type X402PaymentResponse = {
  isPaymentRequired: boolean;
  data: X402PayableRequirements;
};

import { Address } from "viem";
import AcpContractClient, {
  AcpJobPhases,
  MemoType,
} from "./contractClients/baseAcpContractClient";
import AcpJob from "./acpJob";
import acpMemo from "./acpMemo";
import { PriceType } from "./acpJobOffering";

export type DeliverablePayload = string | Record<string, unknown>;

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
  txHash?: `0x${string}`;
  signedTxHash?: `0x${string}`;
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
  netPayableAmount?: number;
}

export interface IAcpJobX402PaymentDetails {
  isX402: boolean;
  isBudgetReceived: boolean;
}

export interface IAcpResponse<T> {
  error?: {
    message: string;
  };
  data: T;
  meta?: {
    pagination: {
      page: number;
      pageSize: number;
    };
  };
}

export interface IAcpClientOptions {
  acpContractClient: AcpContractClient | AcpContractClient[];
  onNewTask?: (job: AcpJob, memoToSign?: acpMemo) => void;
  onEvaluate?: (job: AcpJob) => void;
  customRpcUrl?: string;
  skipSocketConnection?: boolean;
}

export interface IAcpAgent {
  id: number;
  name: string;
  description: string;
  walletAddress: Address;
  isVirtualAgent: boolean;
  cluster: string | null;
  profilePic: string;
  category: string | null;
  tokenAddress: string | null;
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
}

export type IAcpAccount = {
  id: number;
  clientAddress: Address;
  providerAddress: Address;
  metadata: Record<string, any>;
  expiry?: number;
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
  signature: string;
  message: {
    from: Address;
    to: Address;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
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

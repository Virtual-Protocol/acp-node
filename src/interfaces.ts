import { Address } from "viem";
import AcpContractClient, {
  AcpJobPhases,
  AcpNegoStatus,
  MemoType,
} from "./acpContractClient";
import AcpJob from "./acpJob";
import AcpMessage from "./acpMessage";

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
    createdAt: string;
    negoStatus: AcpNegoStatus;
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
  onNewMsg?: (msg: AcpMessage, job: AcpJob) => void;
}

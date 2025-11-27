import { Address } from "viem";
import BaseAcpContractClient, {
  AcpJobPhases,
  MemoType,
} from "./contractClients/baseAcpContractClient";
import {
  AcpMemoStatus,
  GenericPayload,
  PayableDetails,
  PayloadType,
} from "./interfaces";
import { tryParseJson } from "./utils";

class AcpMemo {
  structuredContent: GenericPayload | undefined;

  constructor(
    private contractClient: BaseAcpContractClient,
    public id: number,
    public type: MemoType,
    public content: string,
    public nextPhase: AcpJobPhases,
    public status: AcpMemoStatus,
    public senderAddress: Address,
    public signedReason?: string,
    public expiry?: Date,
    public payableDetails?: PayableDetails,
    public txHash?: `0x${string}`,
    public signedTxHash?: `0x${string}`,
  ) {
    if (this.payableDetails) {
      this.payableDetails.amount = BigInt(this.payableDetails.amount);
      this.payableDetails.feeAmount = BigInt(this.payableDetails.feeAmount);
    }

    this.structuredContent =
      tryParseJson<GenericPayload>(this.content) || undefined;
  }

  get payloadType(): PayloadType | undefined {
    return this.structuredContent?.type;
  }

  getStructuredContent<T>(): GenericPayload<T> | undefined {
    return this.structuredContent as GenericPayload<T> | undefined;
  }

  async create(jobId: number, isSecured: boolean = true) {
    return await this.contractClient.createMemo(
      jobId,
      this.content,
      this.type,
      isSecured,
      this.nextPhase
    );
  }

  async sign(approved: boolean, reason?: string) {
    const payload = this.contractClient.signMemo(this.id, approved, reason);
    return await this.contractClient.handleOperation([payload]);
  }
}

export default AcpMemo;

import { Address } from "viem";
import BaseAcpContractClient, {
  AcpJobPhases,
  MemoType,
} from "./contractClients/baseAcpContractClient";
import {
  AcpMemoStatus,
  PayableDetails,
} from "./interfaces";
import util from "util";

class AcpMemo {
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
  }

  async create(jobId: number, isSecured: boolean = true) {
    return this.contractClient.createMemo(
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

  [util.inspect.custom]() {
    return {
      id: this.id,
      senderAddress: this.senderAddress,
      type: MemoType[this.type],
      status: this.status,
      content: this.content,
      signedReason: this.signedReason,
      txHash: this.txHash,
      signedTxHash: this.signedTxHash,
      nextPhase: AcpJobPhases[this.nextPhase],
      expiry: this.expiry,
      payableDetails: this.payableDetails,
    };
  }

}

export default AcpMemo;

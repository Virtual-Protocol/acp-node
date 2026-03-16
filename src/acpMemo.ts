import { Address } from "viem";
import {
  AcpJobPhases,
  MemoType,
} from "./contractClients/baseAcpContractClient";
import { AcpMemoState, AcpMemoStatus, PayableDetails } from "./interfaces";
import util from "util";
import AcpClient from "./acpClient";

class AcpMemo {
  constructor(
    private acpClient: AcpClient,
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
    public state?: AcpMemoState
  ) {
    if (this.payableDetails) {
      this.payableDetails.amount = BigInt(this.payableDetails.amount);
      this.payableDetails.feeAmount = BigInt(this.payableDetails.feeAmount);
    }
  }

  static async build(
    acpClient: AcpClient,
    id: number,
    type: MemoType,
    content: string,
    nextPhase: AcpJobPhases,
    status: AcpMemoStatus,
    senderAddress: Address,
    signedReason?: string,
    expiry?: Date,
    payableDetails?: PayableDetails,
    txHash?: `0x${string}`,
    signedTxHash?: `0x${string}`,
    state?: AcpMemoState
  ) {
    let memoContent = content;

    const regex = /api\/memo-contents\/([0-9]+)$/;
    const result = memoContent.match(regex);

    if (result) {
      memoContent = await acpClient.getMemoContent(content);
    }

    return new AcpMemo(
      acpClient,
      id,
      type,
      memoContent,
      nextPhase,
      status,
      senderAddress,
      signedReason,
      expiry,
      payableDetails,
      txHash,
      signedTxHash,
      state
    );
  }

  public async getContent() {
    const regex = /api\/memo-contents\/([0-9]+)$/;
    const result = this.content.match(regex);

    if (!result) {
      return this.content;
    }

    return this.acpClient.getMemoContent(this.content);
  }

  async create(jobId: number, isSecured: boolean = true) {
    return this.acpClient.acpContractClient.createMemo(
      jobId,
      this.content,
      this.type,
      isSecured,
      this.nextPhase
    );
  }

  async sign(approved: boolean, reason?: string) {
    const payload = this.acpClient.acpContractClient.signMemo(
      this.id,
      approved,
      reason
    );
    return await this.acpClient.acpContractClient.handleOperation([payload]);
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

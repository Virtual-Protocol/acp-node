import { Address } from "viem";
import AcpClient from "./acpClient";
import { AcpJobPhases, MemoType } from "./acpContractClient";
import AcpMemo from "./acpMemo";

class AcpJob {
  constructor(
    private acpClient: AcpClient,
    public id: number,
    public clientAddress: Address,
    public providerAddress: Address,
    public evaluatorAddress: Address,
    public price: number,
    public memos: AcpMemo[],
    public phase: AcpJobPhases,
    public context: Record<string, any>
  ) {}

  public get latestMemo() {
    return this.memos.pop();
  }

  public get serviceRequirement() {
    return this.memos.find((m) => m.nextPhase === AcpJobPhases.NEGOTIATION)
      ?.content;
  }

  public get deliverable() {
    return this.memos.find((m) => m.nextPhase === AcpJobPhases.COMPLETED)
      ?.content;
  }

  public get providerAgent() {
    return this.acpClient.getAgent(this.providerAddress);
  }

  public get clientAgent() {
    return this.acpClient.getAgent(this.clientAddress);
  }

  public get evaluatorAgent() {
    return this.acpClient.getAgent(this.evaluatorAddress);
  }

  async pay(amount: number, reason?: string) {
    const memo = this.memos.find(
      (m) => m.nextPhase === AcpJobPhases.TRANSACTION
    );

    if (!memo) {
      throw new Error("No transaction memo found");
    }

    return await this.acpClient.payJob(this.id, amount, memo.id, reason);
  }

  async respond(accept: boolean, reason?: string) {
    const memo = this.memos.find(
      (m) => m.nextPhase === AcpJobPhases.NEGOTIATION
    );

    if (!memo) {
      throw new Error("No negotiation memo found");
    }

    return await this.acpClient.respondJob(this.id, memo.id, accept, reason);
  }

  async deliver(deliverable: string) {
    const memo = this.memos.find(
      (m) => m.nextPhase === AcpJobPhases.EVALUATION
    );

    if (!memo) {
      throw new Error("No transaction memo found");
    }

    return await this.acpClient.deliverJob(this.id, deliverable);
  }

  async evaluate(accept: boolean, reason?: string) {
    const memo = this.memos.find((m) => m.nextPhase === AcpJobPhases.COMPLETED);

    if (!memo) {
      throw new Error("No evaluation memo found");
    }

    return await this.acpClient.acpContractClient.signMemo(
      memo.id,
      accept,
      reason
    );
  }

  async requestFunds(amount: number, reportingApiUrl: string) {
    return await this.acpClient.requestFunds(
      this.id,
      amount,
      this.clientAddress,
      reportingApiUrl
    );
  }

  async resposneFundsRequest(amount: number, accept: boolean, reason?: string) {
    const memo = this.memos
      .reverse()
      .find(
        (m) =>
          m.nextPhase === AcpJobPhases.TRANSACTION &&
          m.type === MemoType.PAYABLE_REQUEST
      );

    if (!memo) {
      throw new Error("No funds request memo found");
    }

    return await this.acpClient.responseFundsRequest(
      this.id,
      memo.id,
      accept,
      amount,
      reason
    );
  }

  async transferFunds(
    amount: number,
    nextPhase?: AcpJobPhases,
    reason?: string
  ) {
    return await this.acpClient.transferFunds(
      this.id,
      amount,
      this.clientAddress,
      nextPhase ?? this.phase,
      reason
    );
  }

  async responseFundsTransfer(
    amount: number,
    accept: boolean,
    reason?: string
  ) {
    const memo = this.memos
      .reverse()
      .find(
        (m) =>
          m.nextPhase === AcpJobPhases.TRANSACTION &&
          m.type === MemoType.PAYABLE_TRANSFER
      );

    if (!memo) {
      throw new Error("No funds transfer memo found");
    }

    return await this.acpClient.responseFundsTransfer(
      this.id,
      memo.id,
      accept,
      amount,
      reason
    );
  }

  async sendMessage(content: string, nextPhase?: AcpJobPhases) {
    return await this.acpClient.acpContractClient.createMemo(
      this.id,
      content,
      MemoType.MESSAGE,
      false,
      nextPhase ?? this.phase
    );
  }
}

export default AcpJob;

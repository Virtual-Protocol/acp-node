import { Address } from "viem";
import AcpClient from "./acpClient";
import { AcpJobPhases, AcpNegoStatus } from "./acpContractClient";
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
    public negoStatus?: AcpNegoStatus
  ) {}

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
}

export default AcpJob;

import { Address } from "viem";
import AcpClient from "./acpClient";
import {
  AcpJobPhases,
  FeeType,
  MemoType,
  OperationPayload,
} from "./contractClients/baseAcpContractClient";
import AcpMemo from "./acpMemo";
import { DeliverablePayload, AcpMemoStatus } from "./interfaces";
import { preparePayload, tryParseJson } from "./utils";
import { FareAmount, FareAmountBase } from "./acpFare";
import AcpError from "./acpError";

class AcpJob {
  public name: string | undefined;
  public requirement: Record<string, any> | string | undefined;

  constructor(
    private acpClient: AcpClient,
    public id: number,
    public clientAddress: Address,
    public providerAddress: Address,
    public evaluatorAddress: Address,
    public price: number,
    public priceTokenAddress: Address,
    public memos: AcpMemo[],
    public phase: AcpJobPhases,
    public context: Record<string, any>,
    public contractAddress: Address
  ) {
    const content = this.memos.find(
      (m) => m.nextPhase === AcpJobPhases.NEGOTIATION
    )?.content;

    if (!content) {
      return;
    }

    const contentObj = tryParseJson<{
      name: string;
      requirement: Record<string, any> | string;
      serviceName: string;
      serviceRequirement: Record<string, any>;
    }>(content);

    if (!contentObj) {
      return;
    }

    if (contentObj.serviceRequirement || contentObj.requirement) {
      this.requirement =
        contentObj.requirement || contentObj.serviceRequirement;
    }

    if (contentObj.serviceName || contentObj.name) {
      this.name = contentObj.name || contentObj.serviceName;
    }
  }

  public get acpContractClient() {
    return this.acpClient.contractClientByAddress(this.contractAddress);
  }

  public get config() {
    return this.acpContractClient.config;
  }

  public get baseFare() {
    return this.acpContractClient.config.baseFare;
  }

  public get deliverable() {
    return this.memos.find((m) => m.nextPhase === AcpJobPhases.COMPLETED)
      ?.content;
  }

  public get rejectionReason() {
    const requestMemo = this.memos.find(
      (m) =>
        m.nextPhase === AcpJobPhases.NEGOTIATION &&
        m.status === AcpMemoStatus.REJECTED
    );

    if (requestMemo) {
      return requestMemo.signedReason;
    }

    return this.memos.find((m) => m.nextPhase === AcpJobPhases.REJECTED)
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

  public get account() {
    return this.acpClient.getAccountByJobId(this.id, this.acpContractClient);
  }

  public get latestMemo(): AcpMemo | undefined {
    return this.memos[this.memos.length - 1];
  }

  async createRequirement(content: string) {
    const operations: OperationPayload[] = [];

    operations.push(
      this.acpContractClient.createMemo(
        this.id,
        content,
        MemoType.MESSAGE,
        true,
        AcpJobPhases.TRANSACTION
      )
    );

    return await this.acpContractClient.handleOperation(operations);
  }

  async createPayableRequirement(
    content: string,
    type: MemoType.PAYABLE_REQUEST | MemoType.PAYABLE_TRANSFER_ESCROW,
    amount: FareAmountBase,
    recipient: Address,
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 5) // 5 minutes
  ) {
    const operations: OperationPayload[] = [];

    if (type === MemoType.PAYABLE_TRANSFER_ESCROW) {
      operations.push(
        this.acpContractClient.approveAllowance(
          amount.amount,
          amount.fare.contractAddress
        )
      );
    }

    const feeAmount = new FareAmount(0, this.acpContractClient.config.baseFare);

    operations.push(
      this.acpContractClient.createPayableMemo(
        this.id,
        content,
        amount.amount,
        recipient,
        feeAmount.amount,
        FeeType.NO_FEE,
        AcpJobPhases.TRANSACTION,
        type,
        expiredAt,
        amount.fare.contractAddress
      )
    );

    return await this.acpContractClient.handleOperation(operations);
  }

  async payAndAcceptRequirement(reason?: string) {
    const memo = this.memos.find(
      (m) => m.nextPhase === AcpJobPhases.TRANSACTION
    );

    if (!memo) {
      throw new AcpError("No notification memo found");
    }

    const x402PaymentDetails =
      await this.acpContractClient.getX402PaymentDetails(this.id);

    if (x402PaymentDetails.isX402) {
      await this.performX402Payment(this.price);
    }

    const operations: OperationPayload[] = [];

    const baseFareAmount = new FareAmount(this.price, this.baseFare);
    const transferAmount = memo.payableDetails
      ? await FareAmountBase.fromContractAddress(
          memo.payableDetails.amount,
          memo.payableDetails.token,
          this.config
        )
      : new FareAmount(0, this.baseFare);

    const totalAmount =
      baseFareAmount.fare.contractAddress ===
      transferAmount.fare.contractAddress
        ? baseFareAmount.add(transferAmount)
        : baseFareAmount;

    operations.push(
      this.acpContractClient.approveAllowance(
        totalAmount.amount,
        this.baseFare.contractAddress
      )
    );

    if (
      baseFareAmount.fare.contractAddress !==
      transferAmount.fare.contractAddress
    ) {
      operations.push(
        this.acpContractClient.approveAllowance(
          transferAmount.amount,
          transferAmount.fare.contractAddress
        )
      );
    }

    operations.push(this.acpContractClient.signMemo(memo.id, true, reason));

    operations.push(
      this.acpContractClient.createMemo(
        this.id,
        `Payment made. ${reason ?? ""}`.trim(),
        MemoType.MESSAGE,
        true,
        AcpJobPhases.EVALUATION
      )
    );

    return await this.acpContractClient.handleOperation(operations);
  }

  async respond(accept: boolean, reason?: string) {
    const memoContent = `${
      reason || `Job ${this.id} ${accept ? "accepted" : "rejected"}.`
    }`;
    if (accept) {
      await this.accept(memoContent);
      return await this.createRequirement(memoContent);
    }

    return await this.reject(memoContent);
  }

  async accept(reason?: string) {
    const memoContent = `Job ${this.id} accepted. ${reason || ""}`;
    const operations: OperationPayload[] = [];

    if (this.latestMemo?.nextPhase !== AcpJobPhases.NEGOTIATION) {
      throw new AcpError("No request memo found");
    }

    const memo = this.latestMemo;

    operations.push(
      this.acpContractClient.signMemo(memo.id, true, memoContent)
    );
    return await this.acpContractClient.handleOperation(operations);
  }

  async reject(reason?: string) {
    const memoContent = `Job ${this.id} rejected. ${reason || ""}`;
    const operations: OperationPayload[] = [];

    if (this.phase === AcpJobPhases.REQUEST) {
      if (this.latestMemo?.nextPhase !== AcpJobPhases.NEGOTIATION) {
        throw new AcpError("No request memo found");
      }
      const memo = this.latestMemo;
      operations.push(
        this.acpContractClient.signMemo(memo.id, false, memoContent)
      );
      return await this.acpContractClient.handleOperation(operations);
    }

    operations.push(
      this.acpContractClient.createMemo(
        this.id,
        memoContent,
        MemoType.MESSAGE,
        true,
        AcpJobPhases.REJECTED
      )
    );
    return await this.acpContractClient.handleOperation(operations);
  }

  async deliver(deliverable: DeliverablePayload) {
    if (this.latestMemo?.nextPhase !== AcpJobPhases.EVALUATION) {
      throw new AcpError("No transaction memo found");
    }

    const operations: OperationPayload[] = [];

    operations.push(
      this.acpContractClient.createMemo(
        this.id,
        preparePayload(deliverable),
        MemoType.MESSAGE,
        true,
        AcpJobPhases.COMPLETED
      )
    );

    return await this.acpContractClient.handleOperation(operations);
  }

  async deliverPayable(
    deliverable: DeliverablePayload,
    amount: FareAmountBase,
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 5) // 5 minutes
  ) {
    if (this.latestMemo?.nextPhase !== AcpJobPhases.EVALUATION) {
      throw new AcpError("No transaction memo found");
    }

    const operations: OperationPayload[] = [];

    operations.push(
      this.acpContractClient.approveAllowance(
        amount.amount,
        amount.fare.contractAddress
      )
    );

    const feeAmount = new FareAmount(0, this.acpContractClient.config.baseFare);

    operations.push(
      this.acpContractClient.createPayableMemo(
        this.id,
        preparePayload(deliverable),
        amount.amount,
        this.clientAddress,
        feeAmount.amount,
        FeeType.NO_FEE,
        AcpJobPhases.COMPLETED,
        MemoType.PAYABLE_TRANSFER,
        expiredAt,
        amount.fare.contractAddress
      )
    );

    return await this.acpContractClient.handleOperation(operations);
  }

  async evaluate(accept: boolean, reason?: string) {
    if (this.latestMemo?.nextPhase !== AcpJobPhases.COMPLETED) {
      throw new AcpError("No evaluation memo found");
    }

    const memo = this.latestMemo;

    await memo.sign(accept, reason);
  }

  async createNotification(content: string) {
    const operations: OperationPayload[] = [];

    operations.push(
      this.acpContractClient.createMemo(
        this.id,
        content,
        MemoType.NOTIFICATION,
        true,
        AcpJobPhases.COMPLETED
      )
    );

    return await this.acpContractClient.handleOperation(operations);
  }

  async createPayableNotification(
    content: string,
    amount: FareAmountBase,
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 5) // 5 minutes
  ) {
    const operations: OperationPayload[] = [];

    operations.push(
      this.acpContractClient.approveAllowance(
        amount.amount,
        amount.fare.contractAddress
      )
    );

    const feeAmount = new FareAmount(0, this.acpContractClient.config.baseFare);

    operations.push(
      this.acpContractClient.createPayableMemo(
        this.id,
        content,
        amount.amount,
        this.clientAddress,
        feeAmount.amount,
        FeeType.NO_FEE,
        AcpJobPhases.COMPLETED,
        MemoType.PAYABLE_NOTIFICATION,
        expiredAt,
        amount.fare.contractAddress
      )
    );

    return await this.acpContractClient.handleOperation(operations);
  }

  private async performX402Payment(budget: number) {
    const paymentUrl = "/acp-budget";

    const x402PayableREquirements =
      await this.acpContractClient.performX402Request(
        paymentUrl,
        budget.toString()
      );

    if (!x402PayableREquirements.isPaymentRequired) {
      return;
    }

    if (!x402PayableREquirements.data.accepts.length) {
      throw new AcpError("No X402 payment requirements found");
    }

    const requirement = x402PayableREquirements.data.accepts[0];

    const { encodedPayment, nonce } =
      await this.acpContractClient.generateX402Payment(
        {
          to: requirement.payTo,
          value: Number(requirement.maxAmountRequired),
          maxTimeoutSeconds: requirement.maxTimeoutSeconds,
          asset: requirement.asset,
        },
        x402PayableREquirements.data
      );

    await this.acpContractClient.updateJobX402Nonce(this.id, nonce);

    const x402Response = await this.acpContractClient.performX402Request(
      paymentUrl,
      budget.toString(),
      encodedPayment
    );

    if (x402Response.isPaymentRequired) {
      throw new AcpError("X402 payment failed");
    }

    let waitMs = 2000;
    const maxWaitMs = 30000; // max 30 seconds of polling
    let iterationCount = 0;
    const maxIterations = 10;

    while (true) {
      const x402PaymentDetails =
        await this.acpContractClient.getX402PaymentDetails(this.id);

      if (x402PaymentDetails.isBudgetReceived) {
        break;
      }

      iterationCount++;

      if (iterationCount >= maxIterations) {
        throw new AcpError("X402 payment timed out");
      }

      await new Promise((resolve) => setTimeout(resolve, waitMs));
      waitMs = Math.min(waitMs * 2, maxWaitMs);
    }
  }
}

export default AcpJob;

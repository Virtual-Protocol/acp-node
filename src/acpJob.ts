import { Address } from "viem";
import AcpClient from "./acpClient";
import { AcpJobPhases, FeeType, MemoType } from "./acpContractClient";
import AcpMemo from "./acpMemo";
import {
  CloseJobAndWithdrawPayload,
  ClosePositionPayload,
  GenericPayload,
  OpenPositionPayload,
  PayloadType,
  PositionFulfilledPayload,
  UnfulfilledPositionPayload,
  RequestClosePositionPayload,
  IDeliverable,
  SwapTokenPayload,
} from "./interfaces";
import { tryParseJson } from "./utils";
import { Fare, FareAmount, FareAmountBase } from "./acpFare";
import AcpError from "./acpError";

class AcpJob {
  private baseFare: Fare;

  public jobName: string | undefined;
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
    public context: Record<string, any>
  ) {
    this.baseFare = acpClient.acpContractClient.config.baseFare;

    const content = this.memos.find(
      (m) => m.nextPhase === AcpJobPhases.NEGOTIATION
    )?.content;

    if (!content) {
      return;
    }

    const contentObj = tryParseJson<{
      jobName: string;
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

    if (contentObj.serviceName || contentObj.jobName) {
      this.jobName = contentObj.jobName || contentObj.serviceName;
    }
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
  public get latestMemo(): AcpMemo | undefined {
    return this.memos[this.memos.length - 1];
  }

  async createRequirementMemo(content: string) {
    return await this.acpClient.createMemo(
      this.id,
      content,
      AcpJobPhases.TRANSACTION
    );
  }

  async createRequirementPayableMemo(
    content: string,
    type: MemoType.PAYABLE_REQUEST | MemoType.PAYABLE_TRANSFER_ESCROW,
    amount: FareAmountBase,
    recipient: Address,
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 5) // 5 minutes
  ) {
    return await this.acpClient.createPayableMemo(
      this.id,
      content,
      amount,
      recipient,
      AcpJobPhases.TRANSACTION,
      type,
      expiredAt
    );
  }

  async payAndAcceptRequirement(reason?: string) {
    const memo = this.memos.find(
      (m) => m.nextPhase === AcpJobPhases.TRANSACTION
    );

    if (!memo) {
      throw new Error("No transaction memo found");
    }

    const baseFareAmount = new FareAmount(this.price, this.baseFare);
    const transferAmount = memo.payableDetails
      ? await FareAmountBase.fromContractAddress(
          memo.payableDetails.amount,
          memo.payableDetails.token,
          this.acpClient.acpContractClient.config
        )
      : new FareAmount(0, this.baseFare);

    const totalAmount =
      baseFareAmount.fare.contractAddress ===
      transferAmount.fare.contractAddress
        ? baseFareAmount.add(transferAmount)
        : baseFareAmount;

    await this.acpClient.acpContractClient.approveAllowance(
      totalAmount.amount,
      this.baseFare.contractAddress
    );

    if (
      baseFareAmount.fare.contractAddress !==
      transferAmount.fare.contractAddress
    ) {
      await this.acpClient.acpContractClient.approveAllowance(
        transferAmount.amount,
        transferAmount.fare.contractAddress
      );
    }

    await memo.sign(true, reason);

    return await this.acpClient.createMemo(
      this.id,
      `Payment made. ${reason ?? ""}`.trim(),
      AcpJobPhases.EVALUATION
    );
  }

  async pay(amount: number, reason?: string) {
    const memo = this.memos.find(
      (m) => m.nextPhase === AcpJobPhases.TRANSACTION
    );

    if (!memo) {
      throw new AcpError("No transaction memo found");
    }

    return await this.acpClient.payJob(
      this.id,
      this.baseFare.formatAmount(amount),
      memo.id,
      reason
    );
  }

  async respond<T>(
    accept: boolean,
    payload?: GenericPayload<T>,
    reason?: string
  ) {
    if (this.latestMemo?.nextPhase !== AcpJobPhases.NEGOTIATION) {
      throw new AcpError("No negotiation memo found");
    }

    return await this.acpClient.respondJob(
      this.id,
      this.latestMemo.id,
      accept,
      payload ? JSON.stringify(payload) : undefined,
      reason
    );
  }

  async deliver(deliverable: IDeliverable) {
    if (this.latestMemo?.nextPhase !== AcpJobPhases.EVALUATION) {
      throw new AcpError("No transaction memo found");
    }

    return await this.acpClient.deliverJob(this.id, deliverable);
  }

  async evaluate(accept: boolean, reason?: string) {
    if (this.latestMemo?.nextPhase !== AcpJobPhases.COMPLETED) {
      throw new AcpError("No evaluation memo found");
    }

    return await this.acpClient.acpContractClient.signMemo(
      this.latestMemo.id,
      accept,
      reason
    );
  }

  async openPosition(
    payload: OpenPositionPayload[],
    feeAmount: number,
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 3), // 3 minutes
    walletAddress?: Address
  ) {
    if (payload.length === 0) {
      throw new AcpError("No positions to open");
    }

    const sumAmount = payload.reduce((acc, curr) => acc + curr.amount, 0);

    return await this.acpClient.transferFunds<OpenPositionPayload[]>(
      this.id,
      new FareAmount(sumAmount, this.baseFare),
      walletAddress || this.providerAddress,
      new FareAmount(feeAmount, this.baseFare),
      FeeType.IMMEDIATE_FEE,
      {
        type: PayloadType.OPEN_POSITION,
        data: payload,
      },
      AcpJobPhases.TRANSACTION,
      expiredAt
    );
  }

  async swapToken(
    payload: SwapTokenPayload,
    decimals: number,
    feeAmount: number,
    walletAddress?: Address
  ) {
    return await this.acpClient.transferFunds<SwapTokenPayload>(
      this.id,
      new FareAmount(
        payload.amount,
        new Fare(payload.fromContractAddress, decimals)
      ),
      walletAddress || this.providerAddress,
      new FareAmount(feeAmount, this.baseFare),
      FeeType.IMMEDIATE_FEE,
      {
        type: PayloadType.SWAP_TOKEN,
        data: payload,
      },
      AcpJobPhases.TRANSACTION,
      new Date(Date.now() + 1000 * 60 * 30)
    );
  }

  async responseSwapToken(memoId: number, accept: boolean, reason: string) {
    const memo = this.memos.find((m) => m.id === memoId);

    if (
      memo?.nextPhase !== AcpJobPhases.TRANSACTION ||
      memo?.type !== MemoType.PAYABLE_TRANSFER_ESCROW
    ) {
      throw new AcpError("No swap token memo found");
    }

    const payload = tryParseJson<GenericPayload<OpenPositionPayload>>(
      memo.content
    );

    if (payload?.type !== PayloadType.SWAP_TOKEN) {
      throw new AcpError("Invalid swap token memo");
    }

    return await memo.sign(accept, reason);
  }

  async transferFunds<T>(
    payload: GenericPayload<T>,
    fareAmount: FareAmountBase,
    walletAddress?: Address,
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 30)
  ) {
    return await this.acpClient.transferFunds<T>(
      this.id,
      fareAmount,
      walletAddress || this.clientAddress,
      new FareAmount(0, this.baseFare),
      FeeType.NO_FEE,
      payload,
      AcpJobPhases.TRANSACTION,
      expiredAt
    );
  }

  async responseOpenPosition(memoId: number, accept: boolean, reason: string) {
    const memo = this.memos.find((m) => m.id === memoId);

    if (
      memo?.nextPhase !== AcpJobPhases.TRANSACTION ||
      memo?.type !== MemoType.PAYABLE_TRANSFER_ESCROW
    ) {
      throw new AcpError("No open position memo found");
    }

    const payload = tryParseJson<GenericPayload<OpenPositionPayload>>(
      memo.content
    );

    if (payload?.type !== PayloadType.OPEN_POSITION) {
      throw new AcpError("Invalid open position memo");
    }

    return await this.acpClient.responseFundsTransfer(memo.id, accept, reason);
  }

  async closePartialPosition(
    payload: ClosePositionPayload,
    expireAt: Date = new Date(Date.now() + 1000 * 60 * 60 * 24) // 24 hours
  ) {
    return await this.acpClient.requestFunds<ClosePositionPayload>(
      this.id,
      new FareAmount(payload.amount, this.baseFare),
      this.clientAddress,
      new FareAmount(0, this.baseFare),
      FeeType.NO_FEE,
      {
        type: PayloadType.CLOSE_PARTIAL_POSITION,
        data: payload,
      },
      AcpJobPhases.TRANSACTION,
      expireAt
    );
  }

  async responseClosePartialPosition(
    memoId: number,
    accept: boolean,
    reason: string
  ) {
    const memo = this.memos.find((m) => m.id === memoId);

    if (
      memo?.nextPhase !== AcpJobPhases.TRANSACTION ||
      memo?.type !== MemoType.PAYABLE_REQUEST
    ) {
      throw new AcpError("No close position memo found");
    }

    const payload = tryParseJson<GenericPayload<ClosePositionPayload>>(
      memo.content
    );

    if (payload?.type !== PayloadType.CLOSE_PARTIAL_POSITION) {
      throw new AcpError("Invalid close position memo");
    }

    return await this.acpClient.responseFundsRequest(
      memo.id,
      accept,
      this.baseFare.formatAmount(payload.data.amount),
      reason
    );
  }

  async requestClosePosition(payload: RequestClosePositionPayload) {
    return await this.acpClient.sendMessage<RequestClosePositionPayload>(
      this.id,
      {
        type: PayloadType.CLOSE_POSITION,
        data: payload,
      },
      AcpJobPhases.TRANSACTION
    );
  }

  async responseRequestClosePosition(
    memoId: number,
    accept: boolean,
    payload: ClosePositionPayload,
    reason?: string,
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 60 * 24) // 24 hours
  ) {
    const memo = this.memos.find((m) => m.id === memoId);

    if (
      memo?.nextPhase !== AcpJobPhases.TRANSACTION ||
      memo?.type !== MemoType.MESSAGE
    ) {
      throw new AcpError("No message memo found");
    }

    const messagePayload = tryParseJson<
      GenericPayload<RequestClosePositionPayload>
    >(memo.content);

    if (messagePayload?.type !== PayloadType.CLOSE_POSITION) {
      throw new AcpError("Invalid close position memo");
    }

    await memo.sign(accept, reason);

    if (accept) {
      return await this.acpClient.transferFunds<ClosePositionPayload>(
        this.id,
        new FareAmount(payload.amount, this.baseFare),
        this.clientAddress,
        new FareAmount(0, this.baseFare),
        FeeType.NO_FEE,
        {
          type: PayloadType.CLOSE_POSITION,
          data: payload,
        },
        AcpJobPhases.TRANSACTION,
        expiredAt
      );
    }
  }

  async confirmClosePosition(memoId: number, accept: boolean, reason?: string) {
    const memo = this.memos.find((m) => m.id === memoId);

    if (
      memo?.nextPhase !== AcpJobPhases.TRANSACTION ||
      memo?.type !== MemoType.PAYABLE_TRANSFER_ESCROW
    ) {
      throw new AcpError("No payable transfer memo found");
    }

    const payload = tryParseJson<GenericPayload<ClosePositionPayload>>(
      memo.content
    );

    if (payload?.type !== PayloadType.CLOSE_POSITION) {
      throw new AcpError("Invalid close position memo");
    }

    await memo.sign(accept, reason);
  }

  async positionFulfilled(
    payload: PositionFulfilledPayload,
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 60 * 24) // 24 hours
  ) {
    return await this.acpClient.transferFunds<PositionFulfilledPayload>(
      this.id,
      new FareAmount(payload.amount, this.baseFare),
      this.clientAddress,
      new FareAmount(0, this.baseFare),
      FeeType.NO_FEE,
      {
        type: PayloadType.POSITION_FULFILLED,
        data: payload,
      },
      AcpJobPhases.TRANSACTION,
      expiredAt
    );
  }

  async unfulfilledPosition(
    payload: UnfulfilledPositionPayload,
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 60 * 24) // 24 hours
  ) {
    return await this.acpClient.transferFunds<UnfulfilledPositionPayload>(
      this.id,
      new FareAmount(payload.amount, this.baseFare),
      this.clientAddress,
      new FareAmount(0, this.baseFare),
      FeeType.NO_FEE,
      {
        type: PayloadType.UNFULFILLED_POSITION,
        data: payload,
      },
      AcpJobPhases.TRANSACTION,
      expiredAt
    );
  }

  async responseUnfulfilledPosition(
    memoId: number,
    accept: boolean,
    reason: string
  ) {
    const memo = this.memos.find((m) => m.id === memoId);

    if (
      memo?.nextPhase !== AcpJobPhases.TRANSACTION ||
      memo?.type !== MemoType.PAYABLE_TRANSFER_ESCROW
    ) {
      throw new AcpError("No unfulfilled position memo found");
    }

    const payload = tryParseJson<GenericPayload<UnfulfilledPositionPayload>>(
      memo.content
    );

    if (payload?.type !== PayloadType.UNFULFILLED_POSITION) {
      throw new AcpError("Invalid unfulfilled position memo");
    }

    return await this.acpClient.responseFundsTransfer(memo.id, accept, reason);
  }

  async responsePositionFulfilled(
    memoId: number,
    accept: boolean,
    reason: string
  ) {
    const memo = this.memos.find((m) => m.id === memoId);

    if (
      memo?.nextPhase !== AcpJobPhases.TRANSACTION ||
      memo?.type !== MemoType.PAYABLE_TRANSFER_ESCROW
    ) {
      throw new AcpError("No position fulfilled memo found");
    }

    const payload = tryParseJson<GenericPayload<PositionFulfilledPayload>>(
      memo.content
    );

    if (payload?.type !== PayloadType.POSITION_FULFILLED) {
      throw new AcpError("Invalid position fulfilled memo");
    }

    return await this.acpClient.responseFundsTransfer(memo.id, accept, reason);
  }

  async closeJob(message: string = "Close job and withdraw all") {
    return await this.acpClient.sendMessage<CloseJobAndWithdrawPayload>(
      this.id,
      {
        type: PayloadType.CLOSE_JOB_AND_WITHDRAW,
        data: {
          message,
        },
      },
      AcpJobPhases.TRANSACTION
    );
  }

  async responseCloseJob(
    memoId: number,
    accept: boolean,
    fulfilledPositions: PositionFulfilledPayload[],
    reason?: string,
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 60 * 24) // 24 hours
  ) {
    const memo = this.memos.find((m) => m.id === memoId);

    if (
      memo?.nextPhase !== AcpJobPhases.TRANSACTION ||
      memo?.type !== MemoType.MESSAGE
    ) {
      throw new AcpError("No message memo found");
    }

    const payload = tryParseJson<GenericPayload<CloseJobAndWithdrawPayload>>(
      memo.content
    );

    if (payload?.type !== PayloadType.CLOSE_JOB_AND_WITHDRAW) {
      throw new AcpError("Invalid close job and withdraw memo");
    }

    await memo.sign(accept, reason);

    if (!accept) {
      return;
    }

    const totalAmount = fulfilledPositions.reduce(
      (acc, curr) => acc + curr.amount,
      0
    );

    if (totalAmount === 0) {
      return await this.acpClient.sendMessage<PositionFulfilledPayload[]>(
        this.id,
        {
          type: PayloadType.CLOSE_JOB_AND_WITHDRAW,
          data: fulfilledPositions,
        },
        AcpJobPhases.COMPLETED
      );
    }

    return await this.acpClient.transferFunds<PositionFulfilledPayload[]>(
      this.id,
      new FareAmount(totalAmount, this.baseFare),
      this.clientAddress,
      new FareAmount(0, this.baseFare),
      FeeType.NO_FEE,
      {
        type: PayloadType.CLOSE_JOB_AND_WITHDRAW,
        data: fulfilledPositions,
      },
      AcpJobPhases.COMPLETED,
      expiredAt
    );
  }

  async confirmJobClosure(memoId: number, accept: boolean, reason?: string) {
    const memo = this.memos.find((m) => m.id === memoId);

    if (!memo) {
      throw new AcpError("Memo not found");
    }

    const payload = tryParseJson<GenericPayload<CloseJobAndWithdrawPayload>>(
      memo.content
    );

    if (payload?.type !== PayloadType.CLOSE_JOB_AND_WITHDRAW) {
      throw new AcpError("Invalid close job and withdraw memo");
    }

    await memo.sign(accept, reason);
  }
}

export default AcpJob;

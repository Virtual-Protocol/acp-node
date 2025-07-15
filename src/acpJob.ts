import { Address } from "viem";
import AcpClient from "./acpClient";
import { AcpJobPhases, MemoType } from "./acpContractClient";
import AcpMemo from "./acpMemo";
import {
  CloseJobAndWithdrawPayload,
  ClosePositionPayload,
  GenericPayload,
  OpenPositionPayload,
  PayloadType,
  PositionFulfilledPayload,
  FundRequestFeePayload,
  UnfulfilledPositionPayload,
} from "./interfaces";
import { tryParseJson } from "./utils";

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
  public get latestMemo(): AcpMemo | undefined {
    return this.memos[this.memos.length - 1];
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
    if (this.latestMemo?.nextPhase !== AcpJobPhases.NEGOTIATION) {
      throw new Error("No negotiation memo found");
    }

    return await this.acpClient.respondJob(
      this.id,
      this.latestMemo.id,
      accept,
      reason
    );
  }

  async responseWithFeeRequest(
    accept: boolean,
    reason?: string,
    payload?: GenericPayload<FundRequestFeePayload>
  ) {
    if (this.latestMemo?.nextPhase !== AcpJobPhases.NEGOTIATION) {
      throw new Error("No negotiation memo found");
    }

    return await this.acpClient.responseWithFeeRequest(
      this.id,
      this.latestMemo.id,
      accept,
      reason,
      payload
    );
  }

  async deliver(deliverable: string) {
    if (this.latestMemo?.nextPhase !== AcpJobPhases.EVALUATION) {
      throw new Error("No transaction memo found");
    }

    return await this.acpClient.deliverJob(this.id, deliverable);
  }

  async evaluate(accept: boolean, reason?: string) {
    if (this.latestMemo?.nextPhase !== AcpJobPhases.COMPLETED) {
      throw new Error("No evaluation memo found");
    }

    return await this.acpClient.acpContractClient.signMemo(
      this.latestMemo.id,
      accept,
      reason
    );
  }

  async openPosition(payload: OpenPositionPayload[], walletAddress?: Address) {
    if (payload.length === 0) {
      throw new Error("No positions to open");
    }

    return await this.acpClient.transferFunds<OpenPositionPayload[]>(
      this.id,
      payload.reduce((acc, curr) => acc + curr.amount, 0),
      walletAddress || this.providerAddress,
      {
        type: PayloadType.OPEN_POSITION,
        data: payload,
      },
      AcpJobPhases.TRANSACTION
    );
  }

  async responseOpenPosition(memoId: number, accept: boolean, reason: string) {
    const memo = this.memos.find((m) => m.id === memoId);

    if (
      memo?.nextPhase !== AcpJobPhases.TRANSACTION ||
      memo?.type !== MemoType.PAYABLE_TRANSFER
    ) {
      throw new Error("No open position memo found");
    }

    const payload = tryParseJson<GenericPayload<OpenPositionPayload>>(
      memo.content
    );

    if (payload?.type !== PayloadType.OPEN_POSITION) {
      throw new Error("Invalid open position memo");
    }

    return await this.acpClient.responseFundsTransfer(memo.id, accept, reason);
  }

  async closePosition(payload: ClosePositionPayload) {
    return await this.acpClient.requestFunds<ClosePositionPayload>(
      this.id,
      payload.amount,
      this.providerAddress,
      {
        type: PayloadType.CLOSE_POSITION,
        data: payload,
      },
      AcpJobPhases.TRANSACTION
    );
  }

  async responseClosePosition(memoId: number, accept: boolean, reason: string) {
    const memo = this.memos.find((m) => m.id === memoId);

    if (
      memo?.nextPhase !== AcpJobPhases.TRANSACTION ||
      memo?.type !== MemoType.MESSAGE
    ) {
      throw new Error("No close position memo found");
    }

    const payload = tryParseJson<GenericPayload<ClosePositionPayload>>(
      memo.content
    );

    if (payload?.type !== PayloadType.CLOSE_POSITION) {
      throw new Error("Invalid close position memo");
    }

    return await this.acpClient.responseFundsRequest(
      memo.id,
      accept,
      payload.data.amount,
      reason
    );
  }

  async positionFulfilled(amount: number, payload: PositionFulfilledPayload) {
    return await this.acpClient.transferFunds<PositionFulfilledPayload>(
      this.id,
      amount,
      this.providerAddress,
      {
        type: PayloadType.POSITION_FULFILLED,
        data: payload,
      },
      AcpJobPhases.TRANSACTION
    );
  }

  async unfulfilledPosition(payload: UnfulfilledPositionPayload) {
    return await this.acpClient.transferFunds<UnfulfilledPositionPayload>(
      this.id,
      payload.amount,
      this.providerAddress,
      {
        type: PayloadType.UNFULFILLED_POSITION,
        data: payload,
      },
      AcpJobPhases.TRANSACTION
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
      memo?.type !== MemoType.PAYABLE_TRANSFER
    ) {
      throw new Error("No unfulfilled position memo found");
    }

    const payload = tryParseJson<GenericPayload<UnfulfilledPositionPayload>>(
      memo.content
    );

    if (payload?.type !== PayloadType.UNFULFILLED_POSITION) {
      throw new Error("Invalid unfulfilled position memo");
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
      memo?.type !== MemoType.PAYABLE_TRANSFER
    ) {
      throw new Error("No position fulfilled memo found");
    }

    const payload = tryParseJson<GenericPayload<PositionFulfilledPayload>>(
      memo.content
    );

    if (payload?.type !== PayloadType.POSITION_FULFILLED) {
      throw new Error("Invalid position fulfilled memo");
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
    reason?: string
  ) {
    const memo = this.memos.find((m) => m.id === memoId);

    if (
      memo?.nextPhase !== AcpJobPhases.TRANSACTION ||
      memo?.type !== MemoType.MESSAGE
    ) {
      throw new Error("No message memo found");
    }

    const payload = tryParseJson<GenericPayload<CloseJobAndWithdrawPayload>>(
      memo.content
    );

    if (payload?.type !== PayloadType.CLOSE_JOB_AND_WITHDRAW) {
      throw new Error("Invalid close job and withdraw memo");
    }

    await memo.sign(accept, reason);

    return await this.acpClient.transferFunds<PositionFulfilledPayload[]>(
      this.id,
      fulfilledPositions.reduce((acc, curr) => acc + curr.amount, 0),
      this.providerAddress,
      {
        type: PayloadType.POSITION_FULFILLED,
        data: fulfilledPositions,
      },
      AcpJobPhases.EVALUATION
    );
  }

  async confirmJobClosure(memoId: number, accept: boolean, reason?: string) {
    const memo = this.memos.find((m) => m.id === memoId);

    if (
      memo?.nextPhase !== AcpJobPhases.EVALUATION ||
      memo?.type !== MemoType.PAYABLE_TRANSFER
    ) {
      throw new Error("No payble transfer memo found");
    }

    const payload = tryParseJson<GenericPayload<CloseJobAndWithdrawPayload>>(
      memo.content
    );

    if (payload?.type !== PayloadType.CLOSE_JOB_AND_WITHDRAW) {
      throw new Error("Invalid close job and withdraw memo");
    }

    await memo.sign(accept, reason);
  }
}

export default AcpJob;

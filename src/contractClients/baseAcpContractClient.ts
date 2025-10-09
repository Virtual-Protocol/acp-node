import {
  AbiEvent,
  Address,
  Chain,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  toEventSignature,
  toHex,
} from "viem";
import { AcpContractConfig, baseAcpConfig } from "../configs/acpConfigs";
import ACP_V2_ABI from "../aibs/acpAbiV2";
import ACP_ABI from "../aibs/acpAbi";
import AcpError from "../acpError";
import WETH_ABI from "../aibs/wethAbi";
import { wethFare } from "../acpFare";

export enum MemoType {
  MESSAGE, // 0 - Text message
  CONTEXT_URL, // 1 - URL for context
  IMAGE_URL, // 2 - Image URL
  VOICE_URL, // 3 - Voice/audio URL
  OBJECT_URL, // 4 - Object/file URL
  TXHASH, // 5 - Transaction hash reference
  PAYABLE_REQUEST, // 6 - Payment request
  PAYABLE_TRANSFER, // 7 - Direct payment transfer
  PAYABLE_TRANSFER_ESCROW, // 8 - Escrowed payment transfer
  MILESTONE_PROPOSAL, // 9 - Milestone proposal
  MILESTONE_COMPLETION, // 10 - Milestone completion claim
  DELIVERABLE_SUBMISSION, // 11 - Deliverable submission
  FEEDBACK, // 12 -  temp for notification
  REVISION_REQUEST, // 13 - Request for revisions
}

export enum AcpJobPhases {
  REQUEST = 0,
  NEGOTIATION = 1,
  TRANSACTION = 2,
  EVALUATION = 3,
  COMPLETED = 4,
  REJECTED = 5,
  EXPIRED = 6,
}

export enum FeeType {
  NO_FEE,
  IMMEDIATE_FEE,
  DEFERRED_FEE,
}

abstract class BaseAcpContractClient {
  public contractAddress: Address;
  public chain: Chain;
  public abi: typeof ACP_ABI | typeof ACP_V2_ABI;
  public jobCreatedSignature: string;

  constructor(
    public agentWalletAddress: Address,
    public config: AcpContractConfig = baseAcpConfig
  ) {
    this.chain = config.chain;
    this.abi = config.abi;
    this.contractAddress = config.contractAddress;

    const jobCreated = ACP_ABI.find(
      (abi) => abi.name === "JobCreated"
    ) as AbiEvent;
    const signature = toEventSignature(jobCreated);
    this.jobCreatedSignature = keccak256(toHex(signature));
  }

  abstract handleOperation(
    data: `0x${string}`,
    contractAddress: Address,
    value?: bigint
  ): Promise<Address>;

  abstract getJobId(
    hash: Address,
    clientAddress: Address,
    providerAddress: Address
  ): Promise<number>;

  get walletAddress() {
    return this.agentWalletAddress;
  }

  async createJobWithAccount(
    accountId: number,
    providerAddress: Address,
    evaluatorAddress: Address,
    budgetBaseUnit: bigint,
    paymentTokenAddress: Address,
    expiredAt: Date
  ): Promise<{ txHash: string; jobId: number }> {
    try {
      const data = encodeFunctionData({
        abi: this.abi,
        functionName: "createJobWithAccount",
        args: [
          accountId,
          evaluatorAddress,
          budgetBaseUnit,
          paymentTokenAddress,
          expiredAt,
        ],
      });

      const hash = await this.handleOperation(data, this.contractAddress);

      const jobId = await this.getJobId(
        hash,
        this.agentWalletAddress,
        providerAddress
      );

      return { txHash: hash, jobId: jobId };
    } catch (error) {
      throw new AcpError("Failed to create job with account", error);
    }
  }

  async createJob(
    providerAddress: Address,
    evaluatorAddress: Address,
    expireAt: Date,
    paymentTokenAddress: Address,
    budgetBaseUnit: bigint,
    metadata: string
  ): Promise<{ txHash: string; jobId: number }> {
    try {
      const data = encodeFunctionData({
        abi: this.abi,
        functionName: "createJob",
        args: [
          providerAddress,
          evaluatorAddress,
          Math.floor(expireAt.getTime() / 1000),
          paymentTokenAddress,
          budgetBaseUnit,
          metadata,
        ],
      });

      const hash = await this.handleOperation(data, this.contractAddress);

      const jobId = await this.getJobId(
        hash,
        this.agentWalletAddress,
        providerAddress
      );

      return { txHash: hash, jobId: jobId };
    } catch (error) {
      throw new AcpError("Failed to create job", error);
    }
  }

  async approveAllowance(
    amountBaseUnit: bigint,
    paymentTokenAddress: Address = this.config.baseFare.contractAddress
  ) {
    try {
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [this.contractAddress, amountBaseUnit],
      });

      return await this.handleOperation(data, paymentTokenAddress);
    } catch (error) {
      throw new AcpError("Failed to approve allowance", error);
    }
  }

  async createPayableMemo(
    jobId: number,
    content: string,
    amountBaseUnit: bigint,
    recipient: Address,
    feeAmountBaseUnit: bigint,
    feeType: FeeType,
    nextPhase: AcpJobPhases,
    type:
      | MemoType.PAYABLE_REQUEST
      | MemoType.PAYABLE_TRANSFER_ESCROW
      | MemoType.PAYABLE_TRANSFER,
    expiredAt: Date,
    token: Address = this.config.baseFare.contractAddress,
    secured: boolean = true
  ) {
    try {
      const data = encodeFunctionData({
        abi: this.abi,
        functionName: "createPayableMemo",
        args: [
          jobId,
          content,
          token,
          amountBaseUnit,
          recipient,
          feeAmountBaseUnit,
          feeType,
          type,
          Math.floor(expiredAt.getTime() / 1000),
          secured,
          nextPhase,
        ],
      });

      return await this.handleOperation(data, this.contractAddress);
    } catch (error) {
      throw new AcpError("Failed to create payable memo", error);
    }
  }

  async createMemo(
    jobId: number,
    content: string,
    type: MemoType,
    isSecured: boolean,
    nextPhase: AcpJobPhases
  ): Promise<Address> {
    try {
      const data = encodeFunctionData({
        abi: this.abi,
        functionName: "createMemo",
        args: [jobId, content, type, isSecured, nextPhase],
      });

      return await this.handleOperation(data, this.contractAddress);
    } catch (error) {
      throw new AcpError("Failed to create memo", error);
    }
  }

  async signMemo(memoId: number, isApproved: boolean, reason?: string) {
    try {
      const data = encodeFunctionData({
        abi: this.abi,
        functionName: "signMemo",
        args: [memoId, isApproved, reason],
      });

      const hash = await this.handleOperation(data, this.contractAddress);

      return hash;
    } catch (error) {
      throw new AcpError("Failed to sign memo", error);
    }
  }

  async setBudgetWithPaymentToken(
    jobId: number,
    budgetBaseUnit: bigint,
    paymentTokenAddress: Address = this.config.baseFare.contractAddress
  ) {
    try {
      const data = encodeFunctionData({
        abi: this.abi,
        functionName: "setBudgetWithPaymentToken",
        args: [jobId, budgetBaseUnit, paymentTokenAddress],
      });

      return await this.handleOperation(data, this.contractAddress);
    } catch (error) {
      throw new AcpError("Failed to set budget", error);
    }
  }

  async updateAccountMetadata(accountId: number, metadata: string) {
    try {
      const data = encodeFunctionData({
        abi: this.abi,
        functionName: "updateAccountMetadata",
        args: [accountId, metadata],
      });

      return await this.handleOperation(data, this.contractAddress);
    } catch (error) {
      throw new AcpError("Failed to update account metadata", error);
    }
  }

  async wrapEth(amountBaseUnit: bigint) {
    try {
      const data = encodeFunctionData({
        abi: WETH_ABI,
        functionName: "deposit",
      });

      return await this.handleOperation(
        data,
        wethFare.contractAddress,
        amountBaseUnit
      );
    } catch (error) {
      throw new AcpError("Failed to wrap eth", error);
    }
  }
}

export default BaseAcpContractClient;

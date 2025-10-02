import {
  Address,
  Chain,
  encodeFunctionData,
  erc20Abi,
  zeroAddress,
} from "viem";
import { AcpContractConfig, baseAcpConfig } from "../configs/acpConfigs";
import ACP_V2_ABI from "../aibs/acpAbiV2";
import ACP_ABI from "../aibs/acpAbi";
import AcpError from "../acpError";
import WETH_ABI from "../aibs/wethAbi";
import { wethFare } from "../acpFare";

export enum MemoType {
  MESSAGE,
  CONTEXT_URL,
  IMAGE_URL,
  VOICE_URL,
  OBJECT_URL,
  TXHASH,
  PAYABLE_REQUEST,
  PAYABLE_TRANSFER,
  PAYABLE_TRANSFER_ESCROW,
  NOTIFICATION,
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

  constructor(
    public agentWalletAddress: Address,
    public config: AcpContractConfig = baseAcpConfig
  ) {
    this.chain = config.chain;
    this.abi = config.abi;
    this.contractAddress = config.contractAddress;
  }

  abstract handleOperation(
    data: `0x${string}`,
    contractAddress: Address,
    value?: bigint
  ): Promise<Address>;

  abstract getJobId(hash: Address): Promise<number>;

  get walletAddress() {
    return this.agentWalletAddress;
  }

  async createJobWithAccount(
    accountId: number,
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
          evaluatorAddress === this.agentWalletAddress
            ? zeroAddress
            : evaluatorAddress,
          budgetBaseUnit,
          paymentTokenAddress,
          expiredAt,
        ],
      });

      const hash = await this.handleOperation(data, this.contractAddress);

      const jobId = await this.getJobId(hash);

      return { txHash: hash, jobId: jobId };
    } catch (error) {
      throw new AcpError("Failed to create job with account", error);
    }
  }

  async createJob(
    providerAddress: string,
    evaluatorAddress: string,
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
          evaluatorAddress === this.agentWalletAddress
            ? zeroAddress
            : evaluatorAddress,
          Math.floor(expireAt.getTime() / 1000),
          paymentTokenAddress,
          budgetBaseUnit,
          metadata,
        ],
      });

      const hash = await this.handleOperation(data, this.contractAddress);

      const jobId = await this.getJobId(hash);

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
    type: MemoType.PAYABLE_REQUEST | MemoType.PAYABLE_TRANSFER_ESCROW,
    expiredAt: Date,
    token: Address = this.config.baseFare.contractAddress
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
          nextPhase,
          Math.floor(expiredAt.getTime() / 1000),
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

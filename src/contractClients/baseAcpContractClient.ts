import {
  AbiEvent,
  Address,
  Chain,
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  keccak256,
  toEventSignature,
  toHex,
  zeroAddress,
} from "viem";
import { AcpContractConfig, baseAcpConfig } from "../configs/acpConfigs";
import ACP_V2_ABI from "../abis/acpAbiV2";
import ACP_ABI from "../abis/acpAbi";
import AcpError from "../acpError";
import WETH_ABI from "../abis/wethAbi";
import { wethFare } from "../acpFare";
import {
  IAcpJobX402PaymentDetails,
  X402Payment,
  X402PayableRequest,
  X402PayableRequirements,
  OffChainJob,
  X402PaymentResponse,
} from "../interfaces";
import FIAT_TOKEN_V2_ABI from "../abis/fiatTokenV2Abi";
import SINGLE_SIGNER_VALIDATION_MODULE_ABI from "../abis/singleSignerValidationModuleAbi";
import { SINGLE_SIGNER_VALIDATION_MODULE_ADDRESS } from "../constants";

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
  NOTIFICATION, // 9 - Notification
  PAYABLE_NOTIFICATION, // 10 - Payable notification
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
  PERCENTAGE_FEE,
}

export interface OperationPayload {
  data: `0x${string}`;
  contractAddress: Address;
  value?: bigint;
}

abstract class BaseAcpContractClient {
  public contractAddress: Address;
  public chain: Chain;
  public abi: typeof ACP_ABI | typeof ACP_V2_ABI;
  public jobCreatedSignature: string;
  public publicClient: ReturnType<typeof createPublicClient>;
  public publicClients: Record<number, ReturnType<typeof createPublicClient>> =
    {};

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
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(this.config.rpcEndpoint),
    });
  }

  protected async validateSessionKeyOnChain(
    sessionSignerAddress: Address,
    sessionEntityKeyId: number
  ): Promise<void> {
    const onChainSignerAddress = (
      (await this.publicClient.readContract({
        address: SINGLE_SIGNER_VALIDATION_MODULE_ADDRESS,
        abi: SINGLE_SIGNER_VALIDATION_MODULE_ABI,
        functionName: "signers",
        args: [sessionEntityKeyId, this.agentWalletAddress],
      })) as Address
    ).toLowerCase();

    if (onChainSignerAddress === zeroAddress.toLowerCase()) {
      throw new AcpError(
        `ACP Contract Client validation failed:\n${JSON.stringify(
          {
            reason: "no whitelisted wallet registered on-chain for entity id",
            entityId: sessionEntityKeyId,
            agentWalletAddress: this.agentWalletAddress,
          },
          null,
          2
        )}`
      );
    }

    if (onChainSignerAddress !== sessionSignerAddress.toLowerCase()) {
      throw new AcpError(
        `ACP Contract Client validation failed:\n${JSON.stringify(
          {
            agentWalletAddress: this.agentWalletAddress,
            entityId: sessionEntityKeyId,
            givenWhitelistedWalletAddress: sessionSignerAddress,
            expectedWhitelistedWalletAddress: onChainSignerAddress,
            reason: "session signer address mismatch",
          },
          null,
          2
        )}`
      );
    }
  }

  abstract handleOperation(
    operations: OperationPayload[],
    chainId?: number
  ): Promise<{ userOpHash: Address; txnHash: Address }>;

  abstract getJobId(
    createJobUserOpHash: Address,
    clientAddress: Address,
    providerAddress: Address
  ): Promise<number>;

  get walletAddress() {
    return this.agentWalletAddress;
  }

  createJobWithAccount(
    accountId: number,
    evaluatorAddress: Address,
    budgetBaseUnit: bigint,
    paymentTokenAddress: Address,
    expiredAt: Date,
    isX402Job?: boolean
  ): OperationPayload {
    try {
      const data = encodeFunctionData({
        abi: this.abi,
        functionName: isX402Job
          ? "createX402JobWithAccount"
          : "createJobWithAccount",
        args: [
          accountId,
          evaluatorAddress,
          budgetBaseUnit,
          paymentTokenAddress,
          Math.floor(expiredAt.getTime() / 1000),
        ],
      });

      const payload: OperationPayload = {
        data: data,
        contractAddress: this.contractAddress,
      };

      return payload;
    } catch (error) {
      throw new AcpError("Failed to create job with account", error);
    }
  }

  createJob(
    providerAddress: Address,
    evaluatorAddress: Address,
    expiredAt: Date,
    paymentTokenAddress: Address,
    budgetBaseUnit: bigint,
    metadata: string,
    isX402Job?: boolean
  ): OperationPayload {
    try {
      const data = encodeFunctionData({
        abi: this.abi,
        functionName: isX402Job ? "createX402Job" : "createJob",
        args: [
          providerAddress,
          evaluatorAddress,
          Math.floor(expiredAt.getTime() / 1000),
          paymentTokenAddress,
          budgetBaseUnit,
          metadata,
        ],
      });

      const payload: OperationPayload = {
        data: data,
        contractAddress: this.contractAddress,
      };

      return payload;
    } catch (error) {
      throw new AcpError("Failed to create job", error);
    }
  }

  approveAllowance(
    amountBaseUnit: bigint,
    paymentTokenAddress: Address = this.config.baseFare.contractAddress,
    targetAddress?: Address
  ): OperationPayload {
    try {
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [targetAddress ?? this.contractAddress, amountBaseUnit],
      });

      const payload: OperationPayload = {
        data: data,
        contractAddress: paymentTokenAddress,
      };

      return payload;
    } catch (error) {
      throw new AcpError("Failed to approve allowance", error);
    }
  }

  createPayableMemo(
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
      | MemoType.PAYABLE_TRANSFER
      | MemoType.PAYABLE_NOTIFICATION,
    expiredAt: Date,
    token: Address = this.config.baseFare.contractAddress,
    secured: boolean = true
  ): OperationPayload {
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

      const payload: OperationPayload = {
        data: data,
        contractAddress: this.contractAddress,
      };

      return payload;
    } catch (error) {
      throw new AcpError("Failed to create payable memo", error);
    }
  }

  createCrossChainPayableMemo(
    jobId: number,
    content: string,
    token: Address,
    amountBaseUnit: bigint,
    recipient: Address,
    feeAmountBaseUnit: bigint,
    feeType: FeeType,
    type:
      | MemoType.PAYABLE_REQUEST
      | MemoType.PAYABLE_TRANSFER
      | MemoType.PAYABLE_NOTIFICATION,
    expiredAt: Date,
    nextPhase: AcpJobPhases,
    destinationEid: number,
    secured: boolean = true
  ): OperationPayload {
    try {
      const data = encodeFunctionData({
        abi: this.abi,
        functionName: "createCrossChainPayableMemo",
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
          destinationEid,
        ],
      });

      const payload: OperationPayload = {
        data: data,
        contractAddress: this.contractAddress,
      };

      return payload;
    } catch (error) {
      throw new AcpError("Failed to create cross chain payable memo", error);
    }
  }

  createMemo(
    jobId: number,
    content: string,
    type: MemoType,
    isSecured: boolean,
    nextPhase: AcpJobPhases
  ): OperationPayload {
    try {
      const data = encodeFunctionData({
        abi: this.abi,
        functionName: "createMemo",
        args: [jobId, content, type, isSecured, nextPhase],
      });

      const payload: OperationPayload = {
        data: data,
        contractAddress: this.contractAddress,
      };

      return payload;
    } catch (error) {
      throw new AcpError("Failed to create memo", error);
    }
  }

  createMemoWithMetadata(
    jobId: number,
    content: string,
    type: MemoType,
    isSecured: boolean,
    nextPhase: AcpJobPhases,
    metadata: string
  ): OperationPayload {
    try {
      const data = encodeFunctionData({
        abi: this.abi,
        functionName: "createMemoWithMetadata",
        args: [jobId, content, type, isSecured, nextPhase, metadata],
      });

      const payload: OperationPayload = {
        data: data,
        contractAddress: this.contractAddress,
      };

      return payload;
    } catch (error) {
      throw new AcpError("Failed to create memo with metadata", error);
    }
  }

  signMemo(
    memoId: number,
    isApproved: boolean,
    reason?: string
  ): OperationPayload {
    try {
      const data = encodeFunctionData({
        abi: this.abi,
        functionName: "signMemo",
        args: [memoId, isApproved, reason],
      });

      const payload: OperationPayload = {
        data: data,
        contractAddress: this.contractAddress,
      };

      return payload;
    } catch (error) {
      throw new AcpError("Failed to sign memo", error);
    }
  }

  setBudgetWithPaymentToken(
    jobId: number,
    budgetBaseUnit: bigint,
    paymentTokenAddress: Address = this.config.baseFare.contractAddress
  ): OperationPayload | undefined {
    return undefined;
  }

  updateAccountMetadata(accountId: number, metadata: string): OperationPayload {
    try {
      const data = encodeFunctionData({
        abi: this.abi,
        functionName: "updateAccountMetadata",
        args: [accountId, metadata],
      });

      const payload: OperationPayload = {
        data: data,
        contractAddress: this.contractAddress,
      };

      return payload;
    } catch (error) {
      throw new AcpError("Failed to update account metadata", error);
    }
  }

  wrapEth(amountBaseUnit: bigint): OperationPayload {
    try {
      const data = encodeFunctionData({
        abi: WETH_ABI,
        functionName: "deposit",
      });

      const payload: OperationPayload = {
        data: data,
        contractAddress: wethFare.contractAddress,
        value: amountBaseUnit,
      };

      return payload;
    } catch (error) {
      throw new AcpError("Failed to wrap eth", error);
    }
  }

  async getX402PaymentDetails(
    jobId: number
  ): Promise<IAcpJobX402PaymentDetails> {
    try {
      const result = (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: this.abi,
        functionName: "x402PaymentDetails",
        args: [BigInt(jobId)],
      })) as [boolean, boolean];

      return {
        isX402: result[0],
        isBudgetReceived: result[1],
      };
    } catch (error) {
      throw new AcpError("Failed to get X402 payment details", error);
    }
  }

  abstract updateJobX402Nonce(
    jobId: number,
    nonce: string
  ): Promise<OffChainJob>;

  abstract generateX402Payment(
    payableRequest: X402PayableRequest,
    requirements: X402PayableRequirements
  ): Promise<X402Payment>;

  abstract performX402Request(
    url: string,
    version: string,
    budget?: string,
    signature?: string
  ): Promise<X402PaymentResponse>;

  async submitTransferWithAuthorization(
    from: Address,
    to: Address,
    value: bigint,
    validAfter: bigint,
    validBefore: bigint,
    nonce: string,
    signature: string
  ): Promise<OperationPayload[]> {
    try {
      const operations: OperationPayload[] = [];

      const data = encodeFunctionData({
        abi: FIAT_TOKEN_V2_ABI,
        functionName: "transferWithAuthorization",
        args: [from, to, value, validAfter, validBefore, nonce, signature],
      });

      const payload: OperationPayload = {
        data: data,
        contractAddress: this.config.baseFare.contractAddress,
      };

      operations.push(payload);

      return operations;
    } catch (error) {
      throw new AcpError("Failed to submit TransferWithAuthorization", error);
    }
  }

  async getERC20Balance(
    chainId: number,
    tokenAddress: Address,
    walletAddress: Address
  ): Promise<bigint> {
    const publicClient = this.publicClients[chainId];
    if (!publicClient) {
      throw new AcpError(`Public client for chainId ${chainId} not found`);
    }

    return await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletAddress],
    });
  }

  async getERC20Allowance(
    chainId: number,
    tokenAddress: Address,
    walletAddress: Address,
    spenderAddress: Address
  ): Promise<bigint> {
    const publicClient = this.publicClients[chainId];
    if (!publicClient) {
      throw new AcpError(`Public client for chainId ${chainId} not found`);
    }

    return await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [walletAddress, spenderAddress],
    });
  }

  async getERC20Symbol(
    chainId: number,
    tokenAddress: Address
  ): Promise<string> {
    const publicClient = this.publicClients[chainId];
    if (!publicClient) {
      throw new AcpError(`Public client for chainId ${chainId} not found`);
    }

    return await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "symbol",
    });
  }

  abstract getAssetManager(): Promise<Address>;

  abstract getAcpVersion(): string;
}

export default BaseAcpContractClient;

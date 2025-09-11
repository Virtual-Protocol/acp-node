import { Address, LocalAccountSigner, SmartAccountSigner } from "@aa-sdk/core";
import { alchemy } from "@account-kit/infra";
import {
  ModularAccountV2Client,
  createModularAccountV2Client,
} from "@account-kit/smart-contracts";
import ACP_ABI from "./acpAbi";
import { decodeEventLog, encodeFunctionData, erc20Abi, fromHex } from "viem";
import { AcpContractConfig, baseAcpConfig } from "./acpConfigs";
import WETH_ABI from "./wethAbi";
import { wethFare } from "./acpFare";
import AcpError from "./acpError";

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

class AcpContractClient {
  private MAX_RETRIES = 3;
  private PRIORITY_FEE_MULTIPLIER = 2;
  private MAX_FEE_PER_GAS = 20000000;
  private MAX_PRIORITY_FEE_PER_GAS = 21000000;

  private _sessionKeyClient: ModularAccountV2Client | undefined;
  private chain;
  private contractAddress: Address;

  constructor(
    private walletPrivateKey: Address,
    private sessionEntityKeyId: number,
    private agentWalletAddress: Address,
    public config: AcpContractConfig = baseAcpConfig
  ) {
    this.chain = config.chain;
    this.contractAddress = config.contractAddress;
  }

  static async build(
    walletPrivateKey: Address,
    sessionEntityKeyId: number,
    agentWalletAddress: Address,
    config: AcpContractConfig = baseAcpConfig
  ) {
    const acpContractClient = new AcpContractClient(
      walletPrivateKey,
      sessionEntityKeyId,
      agentWalletAddress,
      config
    );

    await acpContractClient.init();

    return acpContractClient;
  }

  async init() {
    const sessionKeySigner: SmartAccountSigner =
      LocalAccountSigner.privateKeyToAccountSigner(this.walletPrivateKey);

    this._sessionKeyClient = await createModularAccountV2Client({
      chain: this.chain,
      transport: alchemy({
        rpcUrl: this.config.alchemyRpcUrl,
      }),
      signer: sessionKeySigner,
      policyId: "186aaa4a-5f57-4156-83fb-e456365a8820",
      accountAddress: this.agentWalletAddress,
      signerEntity: {
        entityId: this.sessionEntityKeyId,
        isGlobalValidation: true,
      },
    });
  }

  getRandomNonce(bits = 152) {
    const bytes = bits / 8;
    const array = new Uint8Array(bytes);
    crypto.getRandomValues(array);

    let hex = Array.from(array, (b) => b.toString(16).padStart(2, "0")).join(
      ""
    );
    return BigInt("0x" + hex);
  }

  get sessionKeyClient() {
    if (!this._sessionKeyClient) {
      throw new AcpError("Session key client not initialized");
    }

    return this._sessionKeyClient;
  }

  get walletAddress() {
    return this.sessionKeyClient.account.address as Address;
  }

  private async calculateGasFees() {
    const finalMaxFeePerGas =
      BigInt(this.MAX_FEE_PER_GAS) +
      BigInt(this.MAX_PRIORITY_FEE_PER_GAS) *
        BigInt(Math.max(0, this.PRIORITY_FEE_MULTIPLIER - 1));

    return finalMaxFeePerGas;
  }

  private async handleSendUserOperation(
    data: `0x${string}`,
    contractAddress: Address = this.contractAddress,
    value?: bigint
  ) {
    const payload: any = {
      uo: {
        target: contractAddress,
        data: data,
        value: value,
      },
      overrides: {
        nonceKey: this.getRandomNonce(),
      },
    };

    let retries = this.MAX_RETRIES;
    let finalError: unknown;

    while (retries > 0) {
      try {
        if (this.MAX_RETRIES > retries) {
          const gasFees = await this.calculateGasFees();

          payload["overrides"] = {
            maxFeePerGas: `0x${gasFees.toString(16)}`,
          };
        }

        const { hash } = await this.sessionKeyClient.sendUserOperation(payload);

        await this.sessionKeyClient.waitForUserOperationTransaction({
          hash,
        });

        return hash;
      } catch (error) {
        retries -= 1;
        if (retries === 0) {
          finalError = error;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 2000 * retries));
      }
    }

    throw new AcpError(`Failed to send user operation`, finalError);
  }

  private async getJobId(hash: Address) {
    const result = await this.sessionKeyClient.getUserOperationReceipt(hash);

    if (!result) {
      throw new AcpError("Failed to get user operation receipt");
    }

    const contractLogs = result.logs.find(
      (log: any) =>
        log.address.toLowerCase() === this.contractAddress.toLowerCase()
    ) as any;

    if (!contractLogs) {
      throw new AcpError("Failed to get contract logs");
    }

    return fromHex(contractLogs.data, "number");
  }

  async createJob(
    providerAddress: string,
    evaluatorAddress: string,
    expireAt: Date
  ): Promise<{ txHash: string; jobId: number }> {
    try {
      const data = encodeFunctionData({
        abi: ACP_ABI,
        functionName: "createJob",
        args: [
          providerAddress,
          evaluatorAddress,
          Math.floor(expireAt.getTime() / 1000),
        ],
      });

      const hash = await this.handleSendUserOperation(data);

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

      return await this.handleSendUserOperation(data, paymentTokenAddress);
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
        abi: ACP_ABI,
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

      return await this.handleSendUserOperation(data);
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
        abi: ACP_ABI,
        functionName: "createMemo",
        args: [jobId, content, type, isSecured, nextPhase],
      });

      return await this.handleSendUserOperation(data);
    } catch (error) {
      throw new AcpError("Failed to create memo", error);
    }
  }

  async getMemoId(hash: Address) {
    const result = await this.sessionKeyClient.getUserOperationReceipt(hash);

    if (!result) {
      throw new AcpError("Failed to get user operation receipt");
    }

    const contractLogs = result.logs.find(
      (log: any) =>
        log.address.toLowerCase() === this.contractAddress.toLowerCase()
    ) as any;

    if (!contractLogs) {
      throw new AcpError("Failed to get contract logs");
    }

    const decoded = decodeEventLog({
      abi: ACP_ABI,
      data: contractLogs.data,
      topics: contractLogs.topics,
    });

    if (!decoded.args) {
      throw new AcpError("Failed to decode event logs");
    }

    return parseInt((decoded.args as any).memoId);
  }

  async signMemo(memoId: number, isApproved: boolean, reason?: string) {
    try {
      const data = encodeFunctionData({
        abi: ACP_ABI,
        functionName: "signMemo",
        args: [memoId, isApproved, reason],
      });

      return await this.handleSendUserOperation(data);
    } catch (error) {
      throw new AcpError("Failed to sign memo", error);
    }
  }

  async setBudget(jobId: number, budgetBaseUnit: bigint) {
    try {
      const data = encodeFunctionData({
        abi: ACP_ABI,
        functionName: "setBudget",
        args: [jobId, budgetBaseUnit],
      });

      return await this.handleSendUserOperation(data);
    } catch (error) {
      throw new AcpError("Failed to set budget", error);
    }
  }

  async setBudgetWithPaymentToken(
    jobId: number,
    budgetBaseUnit: bigint,
    paymentTokenAddress: Address = this.config.baseFare.contractAddress
  ) {
    try {
      const data = encodeFunctionData({
        abi: ACP_ABI,
        functionName: "setBudgetWithPaymentToken",
        args: [jobId, budgetBaseUnit, paymentTokenAddress],
      });

      return await this.handleSendUserOperation(data);
    } catch (error) {
      throw new AcpError("Failed to set budget", error);
    }
  }

  async wrapEth(amountBaseUnit: bigint) {
    try {
      const data = encodeFunctionData({
        abi: WETH_ABI,
        functionName: "deposit",
      });

      return await this.handleSendUserOperation(
        data,
        wethFare.contractAddress,
        amountBaseUnit
      );
    } catch (error) {
      throw new AcpError("Failed to wrap eth", error);
    }
  }
}

export default AcpContractClient;

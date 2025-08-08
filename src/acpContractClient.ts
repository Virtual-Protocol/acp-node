import { Address, LocalAccountSigner, SmartAccountSigner } from "@aa-sdk/core";
import { alchemy } from "@account-kit/infra";
import {
  ModularAccountV2Client,
  createModularAccountV2Client,
} from "@account-kit/smart-contracts";
import { AcpContractConfig, baseAcpConfig } from "./configs";
import ACP_ABI from "./acpAbi";
import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  fromHex,
  http,
  PublicClient,
} from "viem";
import { publicActionsL2 } from "viem/op-stack";

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

  private _sessionKeyClient: ModularAccountV2Client | undefined;
  private chain;
  private contractAddress: Address;
  private virtualsTokenAddress: Address;
  private customRpcClient: PublicClient;

  constructor(
    private walletPrivateKey: Address,
    private sessionEntityKeyId: number,
    private agentWalletAddress: Address,
    public config: AcpContractConfig = baseAcpConfig,
    public customRpcUrl?: string
  ) {
    this.chain = config.chain;
    this.contractAddress = config.contractAddress;
    this.virtualsTokenAddress = config.virtualsTokenAddress;
    this.customRpcUrl = customRpcUrl;

    this.customRpcClient = createPublicClient({
      chain: this.chain,
      transport: this.customRpcUrl ? http(this.customRpcUrl) : http(),
    }).extend(publicActionsL2());
  }

  static async build(
    walletPrivateKey: Address,
    sessionEntityKeyId: number,
    agentWalletAddress: Address,
    customRpcUrl?: string,
    config: AcpContractConfig = baseAcpConfig
  ) {
    const acpContractClient = new AcpContractClient(
      walletPrivateKey,
      sessionEntityKeyId,
      agentWalletAddress,
      config,
      customRpcUrl
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

  get sessionKeyClient() {
    if (!this._sessionKeyClient) {
      throw new Error("Session key client not initialized");
    }

    return this._sessionKeyClient;
  }

  get walletAddress() {
    return this.sessionKeyClient.account.address as Address;
  }

  private async calculateGasFees() {
    const { maxFeePerGas, maxPriorityFeePerGas } =
      await this.customRpcClient.estimateFeesPerGas();

    let finalMaxFeePerGas = maxFeePerGas;
    let priorityFeeMultiplier = Number(this.config.priorityFeeMultiplier) || 2;

    const overrideMaxFeePerGas = this.config.maxFeePerGas || maxFeePerGas;

    const overrideMaxPriorityFeePerGas =
      this.config.maxPriorityFeePerGas || maxPriorityFeePerGas;

    finalMaxFeePerGas =
      BigInt(overrideMaxFeePerGas) +
      BigInt(overrideMaxPriorityFeePerGas) *
        BigInt(Math.max(0, priorityFeeMultiplier - 1));

    return finalMaxFeePerGas;
  }

  private async handleSendUserOperation(
    data: `0x${string}`,
    contractAddress: Address = this.contractAddress
  ) {
    const payload = {
      uo: {
        target: contractAddress,
        data: data,
      },
      overrides: {},
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
        console.debug("Failed to send user operation", error);

        retries -= 1;
        if (retries === 0) {
          finalError = error;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 2000 * retries));
      }
    }

    throw new Error(`Failed to send user operation ${finalError}`);
  }

  private async getJobId(hash: Address) {
    const result = await this.sessionKeyClient.getUserOperationReceipt(hash);

    if (!result) {
      throw new Error("Failed to get user operation receipt");
    }

    const contractLogs = result.logs.find(
      (log: any) =>
        log.address.toLowerCase() === this.contractAddress.toLowerCase()
    ) as any;

    if (!contractLogs) {
      throw new Error("Failed to get contract logs");
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
      console.error(`Failed to create job ${error}`);
      throw new Error("Failed to create job");
    }
  }

  async approveAllowance(priceInWei: bigint) {
    try {
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [this.contractAddress, priceInWei],
      });

      return await this.handleSendUserOperation(
        data,
        this.virtualsTokenAddress
      );
    } catch (error) {
      console.error(`Failed to approve allowance ${error}`);
      throw new Error("Failed to approve allowance");
    }
  }

  async createPayableMemo(
    jobId: number,
    content: string,
    amount: bigint,
    recipient: Address,
    feeAmount: bigint,
    feeType: FeeType,
    nextPhase: AcpJobPhases,
    type: MemoType.PAYABLE_REQUEST | MemoType.PAYABLE_TRANSFER_ESCROW,
    expiredAt: Date,
    token: Address = this.config.virtualsTokenAddress
  ) {
    let retries = 3;
    while (retries > 0) {
      try {
        const data = encodeFunctionData({
          abi: ACP_ABI,
          functionName: "createPayableMemo",
          args: [
            jobId,
            content,
            token,
            amount,
            recipient,
            feeAmount,
            feeType,
            type,
            nextPhase,
            Math.floor(expiredAt.getTime() / 1000),
          ],
        });

        const { hash } = await this.sessionKeyClient.sendUserOperation({
          uo: {
            target: this.contractAddress,
            data: data,
          },
        });

        await this.sessionKeyClient.waitForUserOperationTransaction({
          hash,
        });

        return hash;
      } catch (error) {
        console.error(
          `failed to create payable memo ${jobId} ${content} ${error}`
        );
        retries -= 1;
        await new Promise((resolve) => setTimeout(resolve, 2000 * retries));
      }
    }

    throw new Error("Failed to create payable memo");
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
      console.error(`Failed to create memo ${jobId} ${content} ${error}`);
      throw new Error("Failed to create memo");
    }
  }

  async getMemoId(hash: Address) {
    const result = await this.sessionKeyClient.getUserOperationReceipt(hash);

    if (!result) {
      throw new Error("Failed to get user operation receipt");
    }

    const contractLogs = result.logs.find(
      (log: any) =>
        log.address.toLowerCase() === this.contractAddress.toLowerCase()
    ) as any;

    if (!contractLogs) {
      throw new Error("Failed to get contract logs");
    }

    const decoded = decodeEventLog({
      abi: ACP_ABI,
      data: contractLogs.data,
      topics: contractLogs.topics,
    });

    if (!decoded.args) {
      throw new Error("Failed to decode event logs");
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
      console.error(`Failed to sign memo ${error}`);
      throw new Error("Failed to sign memo");
    }
  }

  async setBudget(jobId: number, budget: bigint) {
    try {
      const data = encodeFunctionData({
        abi: ACP_ABI,
        functionName: "setBudget",
        args: [jobId, budget],
      });

      return await this.handleSendUserOperation(data);
    } catch (error) {
      console.error(`Failed to set budget ${error}`);
      throw new Error("Failed to set budget");
    }
  }
}

export default AcpContractClient;

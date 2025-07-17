import { Address, LocalAccountSigner, SmartAccountSigner } from "@aa-sdk/core";
import { alchemy } from "@account-kit/infra";
import {
  ModularAccountV2Client,
  createModularAccountV2Client,
} from "@account-kit/smart-contracts";
import { AcpContractConfig, baseAcpConfig } from "./configs";
import ACP_ABI from "./acpAbi";
import { createPublicClient, encodeFunctionData, erc20Abi, fromHex, http, PublicClient } from "viem";
import { publicActionsL2 } from 'viem/op-stack';

export enum MemoType {
  MESSAGE,
  CONTEXT_URL,
  IMAGE_URL,
  VOICE_URL,
  OBJECT_URL,
  TXHASH,
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

class AcpContractClient {
  private _sessionKeyClient: ModularAccountV2Client | undefined;
  private _gasFees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | undefined;
  private chain;
  private contractAddress: Address;
  private virtualsTokenAddress: Address;
  private customRpcClient: PublicClient;

  constructor(
    private walletPrivateKey: Address,
    private sessionEntityKeyId: number,
    private agentWalletAddress: Address,
    public config: AcpContractConfig = baseAcpConfig,
    public customRpcUrl?: string,
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
    config: AcpContractConfig = baseAcpConfig,
  ) {
    const acpContractClient = new AcpContractClient(
      walletPrivateKey,
      sessionEntityKeyId,
      agentWalletAddress,
      config,
      customRpcUrl,
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
    const { maxFeePerGas, maxPriorityFeePerGas } = await this.customRpcClient.estimateFeesPerGas();

    let finalMaxPriorityFee = maxPriorityFeePerGas;
    let finalMaxFeePerGas = maxFeePerGas;
    let priorityFeeMultiplier = Number(this.config.priorityFeeMultiplier) || 2;

    const overrideMaxFeePerGas = this.config.maxFeePerGas || maxFeePerGas;

    const overrideMaxPriorityFeePerGas = this.config.maxPriorityFeePerGas || maxPriorityFeePerGas;

    finalMaxPriorityFee = BigInt(overrideMaxPriorityFeePerGas) * BigInt(priorityFeeMultiplier);

    finalMaxFeePerGas =
      BigInt(overrideMaxFeePerGas) +
      BigInt(overrideMaxPriorityFeePerGas) * BigInt(Math.max(0, priorityFeeMultiplier - 1));

    return finalMaxFeePerGas;
  };

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

      const gasFees = await this.calculateGasFees();

      const { hash } = await this.sessionKeyClient.sendUserOperation({
        uo: {
          target: this.contractAddress,
          data: data,
        },
        overrides: {
          maxFeePerGas: `0x${gasFees.toString(16)}`,
        },
      });

      await this.sessionKeyClient.waitForUserOperationTransaction({
        hash,
      });

      const jobId = await this.getJobId(hash);

      return { txHash: hash, jobId: jobId };
    } catch (error) {
      console.error(error);
      throw new Error("Failed to create job");
    }
  }

  async approveAllowance(priceInWei: bigint) {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [this.contractAddress, priceInWei],
    });

    const gasFees = await this.calculateGasFees();
    const { hash } = await this.sessionKeyClient.sendUserOperation({
      uo: {
        target: this.virtualsTokenAddress,
        data: data,
      },
      overrides: {
        maxFeePerGas: `0x${gasFees.toString(16)}`,
      },
    });

    await this.sessionKeyClient.waitForUserOperationTransaction({
      hash,
    });

    return hash;
  }

  async createMemo(
    jobId: number,
    content: string,
    type: MemoType,
    isSecured: boolean,
    nextPhase: AcpJobPhases
  ): Promise<Address> {
    let retries = 3;
    while (retries > 0) {
      try {
        const data = encodeFunctionData({
          abi: ACP_ABI,
          functionName: "createMemo",
          args: [jobId, content, type, isSecured, nextPhase],
        });

        const gasFees = await this.calculateGasFees();

        const { hash } = await this.sessionKeyClient.sendUserOperation({
          uo: {
            target: this.contractAddress,
            data: data,
          },
          overrides: {
            maxFeePerGas: `0x${gasFees.toString(16)}`,
          },
        });

        await this.sessionKeyClient.waitForUserOperationTransaction({
          hash,
        });

        return hash;
      } catch (error) {
        console.error(`failed to create memo ${jobId} ${content} ${error}`);
        retries -= 1;
        await new Promise((resolve) => setTimeout(resolve, 2000 * retries));
      }
    }

    throw new Error("Failed to create memo");
  }

  async signMemo(memoId: number, isApproved: boolean, reason?: string) {
    let retries = 3;
    while (retries > 0) {
      try {
        const data = encodeFunctionData({
          abi: ACP_ABI,
          functionName: "signMemo",
          args: [memoId, isApproved, reason],
        });

        const gasFees = await this.calculateGasFees();

        const { hash } = await this.sessionKeyClient.sendUserOperation({
          uo: {
            target: this.contractAddress,
            data: data,
          },
          overrides: {
            maxFeePerGas: `0x${gasFees.toString(16)}`,
          },
        });

        await this.sessionKeyClient.waitForUserOperationTransaction({
          hash,
        });

        return hash;
      } catch (error) {
        console.error(`failed to sign memo ${error}`);
        retries -= 1;
        await new Promise((resolve) => setTimeout(resolve, 2000 * retries));
      }
    }

    throw new Error("Failed to sign memo");
  }

  async setBudget(jobId: number, budget: bigint) {
    try {
      const data = encodeFunctionData({
        abi: ACP_ABI,
        functionName: "setBudget",
        args: [jobId, budget],
      });

      const gasFees = await this.calculateGasFees();

      const { hash } = await this.sessionKeyClient.sendUserOperation({
        uo: {
          target: this.contractAddress,
          data: data,
        },
        overrides: {
          maxFeePerGas: `0x${gasFees.toString(16)}`,
        },
      });

      await this.sessionKeyClient.waitForUserOperationTransaction({
        hash,
      });

      return hash;
    } catch (error) {
      console.error(error);
      throw new Error("Failed to set budget");
    }
  }
}

export default AcpContractClient;

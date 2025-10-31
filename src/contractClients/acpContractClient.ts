import { Address, LocalAccountSigner, SmartAccountSigner } from "@aa-sdk/core";
import { alchemy } from "@account-kit/infra";
import {
  ModularAccountV2Client,
  createModularAccountV2Client,
} from "@account-kit/smart-contracts";
import { decodeEventLog, encodeFunctionData, fromHex } from "viem";
import { AcpContractConfig, baseAcpConfig } from "../configs/acpConfigs";
import AcpError from "../acpError";
import BaseAcpContractClient, {
  AcpJobPhases,
  FeeType,
  MemoType,
  OperationPayload,
} from "./baseAcpContractClient";

class AcpContractClient extends BaseAcpContractClient {
  protected MAX_RETRIES = 3;
  protected PRIORITY_FEE_MULTIPLIER = 2;
  protected MAX_FEE_PER_GAS = 20000000;
  protected MAX_PRIORITY_FEE_PER_GAS = 21000000;

  private _sessionKeyClient: ModularAccountV2Client | undefined;

  constructor(
    agentWalletAddress: Address,
    config: AcpContractConfig = baseAcpConfig
  ) {
    super(agentWalletAddress, config);
  }

  static async build(
    walletPrivateKey: Address,
    sessionEntityKeyId: number,
    agentWalletAddress: Address,
    config: AcpContractConfig = baseAcpConfig
  ) {
    const acpContractClient = new AcpContractClient(agentWalletAddress, config);
    await acpContractClient.init(walletPrivateKey, sessionEntityKeyId);
    return acpContractClient;
  }

  async init(privateKey: Address, sessionEntityKeyId: number) {
    const sessionKeySigner: SmartAccountSigner =
      LocalAccountSigner.privateKeyToAccountSigner(privateKey);

    this._sessionKeyClient = await createModularAccountV2Client({
      chain: this.chain,
      transport: alchemy({
        rpcUrl: this.config.alchemyRpcUrl,
      }),
      signer: sessionKeySigner,
      policyId: "186aaa4a-5f57-4156-83fb-e456365a8820",
      accountAddress: this.agentWalletAddress,
      signerEntity: {
        entityId: sessionEntityKeyId,
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

  private async calculateGasFees() {
    const finalMaxFeePerGas =
      BigInt(this.MAX_FEE_PER_GAS) +
      BigInt(this.MAX_PRIORITY_FEE_PER_GAS) *
        BigInt(Math.max(0, this.PRIORITY_FEE_MULTIPLIER - 1));

    return finalMaxFeePerGas;
  }

  async handleOperation(operations: OperationPayload[]) {
    const payload: any = {
      uo: operations.map((op) => ({
        target: op.contractAddress,
        data: op.data,
        value: op.value,
      })),
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

  async getJobId(
    hash: Address,
    clientAddress: Address,
    providerAddress: Address
  ) {
    const result = await this.sessionKeyClient.getUserOperationReceipt(hash);

    if (!result) {
      throw new AcpError("Failed to get user operation receipt");
    }

    const contractLogs = result.logs
      .filter((log: any) => {
        return log.address.toLowerCase() === this.contractAddress.toLowerCase();
      })
      .map(
        (log: any) =>
          decodeEventLog({
            abi: this.abi,
            data: log.data,
            topics: log.topics,
          }) as {
            eventName: string;
            args: any;
          }
      );

    const createdJobEvent = contractLogs.find(
      (log) =>
        log.eventName === "JobCreated" &&
        log.args.client.toLowerCase() === clientAddress.toLowerCase() &&
        log.args.provider.toLowerCase() === providerAddress.toLowerCase()
    );

    if (!createdJobEvent) {
      throw new AcpError("Failed to find created job event");
    }

    return Number(createdJobEvent.args.jobId);
  }

  createJob(
    providerAddress: Address,
    evaluatorAddress: Address,
    expireAt: Date,
    paymentTokenAddress: Address,
    budgetBaseUnit: bigint,
    metadata: string
  ): OperationPayload {
    try {
      const data = encodeFunctionData({
        abi: this.abi,
        functionName: "createJob",
        args: [
          providerAddress,
          evaluatorAddress,
          Math.floor(expireAt.getTime() / 1000),
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

  setBudgetWithPaymentToken(
    jobId: number,
    budgetBaseUnit: bigint,
    paymentTokenAddress: Address = this.config.baseFare.contractAddress
  ): OperationPayload {
    try {
      const data = encodeFunctionData({
        abi: this.abi,
        functionName: "setBudgetWithPaymentToken",
        args: [jobId, budgetBaseUnit, paymentTokenAddress],
      });

      const payload: OperationPayload = {
        data: data,
        contractAddress: this.contractAddress,
      };

      return payload;
    } catch (error) {
      throw new AcpError("Failed to set budget", error);
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
    type: MemoType.PAYABLE_REQUEST | MemoType.PAYABLE_TRANSFER_ESCROW,
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
          nextPhase,
          Math.floor(expiredAt.getTime() / 1000),
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

  createJobWithAccount(
    accountId: number,
    evaluatorAddress: Address,
    budgetBaseUnit: bigint,
    paymentTokenAddress: Address,
    expiredAt: Date
  ): OperationPayload {
    throw new AcpError("Not Supported");
  }

  updateAccountMetadata(accountId: number, metadata: string): OperationPayload {
    throw new AcpError("Not Supported");
  }
}

export default AcpContractClient;

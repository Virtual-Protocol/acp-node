import { Address, LocalAccountSigner, SmartAccountSigner } from "@aa-sdk/core";
import { alchemy } from "@account-kit/infra";
import {
  ModularAccountV2Client,
  createModularAccountV2Client,
} from "@account-kit/smart-contracts";
import { decodeEventLog, encodeFunctionData } from "viem";
import { AcpContractConfig, baseAcpConfig } from "../configs/acpConfigs";
import AcpError from "../acpError";
import BaseAcpContractClient, {
  AcpJobPhases,
  FeeType,
  MemoType,
  OperationPayload,
} from "./baseAcpContractClient";
import {
  OffChainJob,
  X402PayableRequest,
  X402PayableRequirements,
  X402Payment,
  X402PaymentResponse,
} from "../interfaces";
import { AcpX402 } from "../acpX402";

class AcpContractClient extends BaseAcpContractClient {
  protected PRIORITY_FEE_MULTIPLIER = 2;
  protected MAX_FEE_PER_GAS = 20000000;
  protected MAX_PRIORITY_FEE_PER_GAS = 21000000;

  private _sessionKeyClient: ModularAccountV2Client | undefined;
  private _acpX402: AcpX402 | undefined;

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

    this._acpX402 = new AcpX402(
      this.config,
      this.sessionKeyClient,
      this.publicClient
    );

    const account = this.sessionKeyClient.account;
    const sessionSignerAddress: Address = await account
      .getSigner()
      .getAddress();

    if (!(await account.isAccountDeployed())) {
      throw new AcpError(
        `ACP Contract Client validation failed: agent account ${this.agentWalletAddress} is not deployed on-chain`
      );
    }

    await this.validateSessionKeyOnChain(
      sessionSignerAddress,
      sessionEntityKeyId
    );

    console.log("Connected to ACP with v1 Contract Client (Legacy):", {
      agentWalletAddress: this.agentWalletAddress,
      whitelistedWalletAddress: sessionSignerAddress,
      entityId: sessionEntityKeyId,
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

  get acpX402() {
    if (!this._acpX402) {
      throw new AcpError("ACP X402 not initialized");
    }

    return this._acpX402;
  }

  private async calculateGasFees() {
    const finalMaxFeePerGas =
      BigInt(this.MAX_FEE_PER_GAS) +
      BigInt(this.MAX_PRIORITY_FEE_PER_GAS) *
        BigInt(Math.max(0, this.PRIORITY_FEE_MULTIPLIER - 1));

    return finalMaxFeePerGas;
  }

  async handleOperation(
    operations: OperationPayload[]
  ): Promise<{ userOpHash: Address; txnHash: Address }> {
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

    let retries = this.config.maxRetries;
    let finalError: unknown;

    while (retries > 0) {
      try {
        if (this.config.maxRetries > retries) {
          const gasFees = await this.calculateGasFees();

          payload["overrides"] = {
            maxFeePerGas: `0x${gasFees.toString(16)}`,
          };
        }

        const { hash } = await this.sessionKeyClient.sendUserOperation(payload);

        const txnHash =
          await this.sessionKeyClient.waitForUserOperationTransaction({
            hash,
          });

        return { userOpHash: hash, txnHash };
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
    createJobUserOpHash: Address,
    clientAddress: Address,
    providerAddress: Address
  ) {
    const result = await this.sessionKeyClient.getUserOperationReceipt(
      createJobUserOpHash
    );

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
    metadata: string,
    isX402Job?: boolean
  ): OperationPayload {
    try {
      const data = encodeFunctionData({
        abi: this.abi,
        functionName: isX402Job ? "createJobWithX402" : "createJob",
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
    expiredAt: Date,
    isX402Job?: boolean
  ): OperationPayload {
    throw new AcpError("Not Supported");
  }

  updateAccountMetadata(accountId: number, metadata: string): OperationPayload {
    throw new AcpError("Not Supported");
  }

  async updateJobX402Nonce(jobId: number, nonce: string): Promise<OffChainJob> {
    return await this.acpX402.updateJobNonce(jobId, nonce);
  }

  async generateX402Payment(
    payableRequest: X402PayableRequest,
    requirements: X402PayableRequirements
  ): Promise<X402Payment> {
    return await this.acpX402.generatePayment(payableRequest, requirements);
  }

  async performX402Request(
    url: string,
    version: string,
    budget?: string,
    signature?: string
  ): Promise<X402PaymentResponse> {
    return await this.acpX402.performRequest(url, version, budget, signature);
  }

  async getAssetManager(): Promise<Address> {
    throw new Error("Asset Manager not supported");
  }

  getAcpVersion(): string {
    return "1";
  }
}

export default AcpContractClient;

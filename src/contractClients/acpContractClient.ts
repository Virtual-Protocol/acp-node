import { Address, LocalAccountSigner, SmartAccountSigner } from "@aa-sdk/core";
import { alchemy } from "@account-kit/infra";
import {
  ModularAccountV2Client,
  createModularAccountV2Client,
} from "@account-kit/smart-contracts";
import { decodeEventLog, encodeFunctionData, erc20Abi } from "viem";
import { AcpContractConfig, baseAcpConfig } from "../configs/acpConfigs";
import AcpError from "../acpError";
import BaseAcpContractClient, {
  AcpJobPhases,
  FeeType,
  MemoType,
  OperationPayload,
} from "./baseAcpContractClient";
import {
  IAcpJobX402PaymentDetails,
  X402PayableRequest,
  X402PayableRequirements,
  X402Payment,
} from "../interfaces";
import { randomBytes } from "crypto";
import FIAT_TOKEN_V2_ABI from "../abis/fiatTokenV2Abi";
import { safeBase64Encode } from "../utils";
import { X402AuthorizationTypes } from "../constants";

class AcpContractClient extends BaseAcpContractClient {
  protected MAX_RETRIES = 10; // temp fix, while alchemy taking alook into it
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

  createJobWithX402(
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
        functionName: "createJobWithX402",
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

  async updateJobX402Nonce(jobId: number, nonce: string) {
    try {
      const apiUrl = `${this.config.acpUrl}/api/jobs/${jobId}/x402-nonce`;
      const message = `${jobId}-${nonce}`;

      const signature = await this.sessionKeyClient.signMessage({
        account: this.sessionKeyClient.account,
        message,
      });

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "x-signature": signature,
          "x-nonce": nonce,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: {
            nonce,
          },
        }),
      });

      if (!response.ok) {
        throw new AcpError(
          "Failed to update job X402 nonce",
          response.statusText
        );
      }

      return response.json();
    } catch (error) {
      console.error(error);
      throw new AcpError("Failed to update job X402 nonce", error);
    }
  }

  async generateX402Payment(
    payableRequest: X402PayableRequest,
    requirements: X402PayableRequirements
  ): Promise<X402Payment> {
    try {
      const usdcContract = this.config.baseFare.contractAddress;

      const timeNow = Math.floor(Date.now() / 1000);
      const validAfter = timeNow.toString();
      const validBefore = (
        timeNow + requirements.accepts[0].maxTimeoutSeconds
      ).toString();

      const [tokenName, tokenVersion] = await this.publicClient.multicall({
        contracts: [
          {
            address: usdcContract,
            abi: erc20Abi,
            functionName: "name",
          },
          {
            address: usdcContract,
            abi: FIAT_TOKEN_V2_ABI,
            functionName: "version",
          },
        ],
      });

      const nonce = `0x${randomBytes(32).toString("hex")}`;

      const message = {
        from: this.agentWalletAddress,
        to: payableRequest.to,
        value: payableRequest.value,
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      };

      const typedData = {
        types: {
          TransferWithAuthorization: X402AuthorizationTypes,
        },
        domain: {
          name: tokenName.result as string,
          version: tokenVersion.result as string,
          chainId: this.config.chain.id,
          verifyingContract: usdcContract,
        },
        primaryType: "TransferWithAuthorization",
        message,
      };

      const signature = await this.sessionKeyClient.signTypedData({
        typedData: typedData as any,
      });

      const payload = {
        x402Version: requirements.x402Version,
        scheme: requirements.accepts[0].scheme,
        network: requirements.accepts[0].network,
        payload: {
          signature,
          authorization: message,
        },
      };

      const encodedPayment = safeBase64Encode(JSON.stringify(payload));

      return {
        encodedPayment,
        nonce,
      };
    } catch (error) {
      throw new AcpError("Failed to generate X402 payment", error);
    }
  }

  async performX402Request(url: string, budget?: string, signature?: string) {
    const baseUrl = this.config.x402Config?.url;
    if (!baseUrl) throw new AcpError("X402 URL not configured");

    try {
      const headers: Record<string, string> = {};
      if (signature) headers["x-payment"] = signature;
      if (budget) headers["x-budget"] = budget.toString();

      const res = await fetch(`${baseUrl}${url}`, { method: "GET", headers });

      return {
        isPaymentRequired: res.status === 402,
        data: await res.json(),
      };
    } catch (error) {
      throw new AcpError("Failed to perform X402 request", error);
    }
  }
}

export default AcpContractClient;

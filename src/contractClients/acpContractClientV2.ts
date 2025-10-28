import { Address, LocalAccountSigner, SmartAccountSigner } from "@aa-sdk/core";
import { alchemy } from "@account-kit/infra";
import {
  ModularAccountV2Client,
  createModularAccountV2Client,
} from "@account-kit/smart-contracts";
import { createPublicClient, decodeEventLog, fromHex, http } from "viem";
import { AcpContractConfig, baseAcpConfigV2 } from "../configs/acpConfigs";
import AcpError from "../acpError";
import BaseAcpContractClient, {
  OperationPayload,
} from "./baseAcpContractClient";
import JOB_MANAGER_ABI from "../abis/jobManagerAbi";
import {
  X402PayableRequest,
  X402PayableRequirements,
  X402Payment,
} from "../interfaces";

class AcpContractClientV2 extends BaseAcpContractClient {
  private MAX_RETRIES = 3;
  private PRIORITY_FEE_MULTIPLIER = 2;
  private MAX_FEE_PER_GAS = 20000000;
  private MAX_PRIORITY_FEE_PER_GAS = 21000000;

  private _sessionKeyClient: ModularAccountV2Client | undefined;

  constructor(
    private jobManagerAddress: Address,
    private memoManagerAddress: Address,
    private accountManagerAddress: Address,
    agentWalletAddress: Address,
    config: AcpContractConfig = baseAcpConfigV2
  ) {
    super(agentWalletAddress, config);
  }

  static async build(
    walletPrivateKey: Address,
    sessionEntityKeyId: number,
    agentWalletAddress: Address,
    config: AcpContractConfig = baseAcpConfigV2
  ) {
    const publicClient = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcEndpoint),
    });

    const [jobManagerAddress, memoManagerAddress, accountManagerAddress] =
      await publicClient.multicall({
        contracts: [
          {
            address: config.contractAddress,
            abi: config.abi,
            functionName: "jobManager",
          },
          {
            address: config.contractAddress,
            abi: config.abi,
            functionName: "memoManager",
          },
          {
            address: config.contractAddress,
            abi: config.abi,
            functionName: "accountManager",
          },
        ],
      });

    if (!jobManagerAddress || !memoManagerAddress || !accountManagerAddress) {
      throw new AcpError(
        "Failed to get job manager, memo manager, or account manager address"
      );
    }

    const acpContractClient = new AcpContractClientV2(
      jobManagerAddress.result as Address,
      memoManagerAddress.result as Address,
      accountManagerAddress.result as Address,
      agentWalletAddress,
      config
    );

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

  async handleOperation(operations: OperationPayload[]): Promise<Address> {
    const payload: any = {
      uo: operations.map((operation) => ({
        target: operation.contractAddress,
        data: operation.data,
        value: operation.value,
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
          tag: "pending",
          retries: {
            intervalMs: 200,
            multiplier: 1.1,
            maxRetries: 10,
          },
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
    const result = await this.sessionKeyClient.getUserOperationReceipt(
      hash,
      "pending"
    );

    if (!result) {
      throw new AcpError("Failed to get user operation receipt");
    }

    const contractLogs = result.logs
      .filter((log: any) => {
        return (
          log.address.toLowerCase() === this.jobManagerAddress.toLowerCase()
        );
      })
      .map(
        (log: any) =>
          decodeEventLog({
            abi: JOB_MANAGER_ABI,
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

  async updateJobX402Nonce(jobId: number, nonce: string): Promise<string> {
    throw new Error("Not implemented");
  }

  async generateX402Payment(
    payableRequest: X402PayableRequest,
    requirements: X402PayableRequirements
  ): Promise<X402Payment> {
    throw new Error("Not implemented");
  }
}

export default AcpContractClientV2;

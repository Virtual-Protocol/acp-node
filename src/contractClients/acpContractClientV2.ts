import { Address, LocalAccountSigner, SmartAccountSigner } from "@aa-sdk/core";
import { alchemy, defineAlchemyChain } from "@account-kit/infra";
import {
  createModularAccountV2,
  createModularAccountV2Client,
  ModularAccountV2Client,
} from "@account-kit/smart-contracts";
import {
  createPublicClient,
  decodeEventLog,
  Hex,
  http,
  SignTypedDataParameters,
  zeroAddress,
} from "viem";
import { AcpContractConfig, baseAcpConfigV2 } from "../configs/acpConfigs";
import AcpError from "../acpError";
import BaseAcpContractClient, {
  OperationPayload,
} from "./baseAcpContractClient";
import JOB_MANAGER_ABI from "../abis/jobManagerAbi";
import {
  IAcpJobX402PaymentDetails,
  OffChainJob,
  X402PayableRequest,
  X402PayableRequirements,
  X402Payment,
  X402PaymentResponse,
  CheckTransactionConfig,
} from "../interfaces";
import { AcpX402 } from "../acpX402";
import { base, baseSepolia } from "viem/chains";
import MEMO_MANAGER_ABI from "../abis/memoManagerAbi";

class AcpContractClientV2 extends BaseAcpContractClient {
  private PRIORITY_FEE_MULTIPLIER = 2;
  private MAX_FEE_PER_GAS = 20000000;
  private MAX_PRIORITY_FEE_PER_GAS = 21000000;
  private GAS_FEE_MULTIPLIER = 0.5;
  private RETRY_CONFIG = {
    intervalMs: 200,
    multiplier: 1.1,
    maxRetries: 10,
  };

  private _sessionKeyClient: ModularAccountV2Client | undefined;
  private _sessionKeyClients: Record<number, ModularAccountV2Client> = {};
  private _acpX402: AcpX402 | undefined;

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
    const publicClients: Record<
      number,
      ReturnType<typeof createPublicClient>
    > = {};
    for (const chain of config.chains) {
      publicClients[chain.id] = createPublicClient({
        chain: chain,
        transport: http(`${config.alchemyRpcUrl}?chainId=${chain.id}`),
      });
    }

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

    acpContractClient.publicClients = publicClients;

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

    // initialize all session key clients for all chains in the config
    for (const chain of this.config.chains) {
      this._sessionKeyClients[chain.id] = await createModularAccountV2Client({
        chain: chain,
        transport: alchemy({
          rpcUrl: `${this.config.alchemyRpcUrl}?chainId=${chain.id}`,
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

    this.RETRY_CONFIG = this.config.retryConfig || this.RETRY_CONFIG;

    console.log("Connected to ACP:", {
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

  private async calculateGasFees(chainId?: number) {
    if (chainId) {
      const { maxFeePerGas } = await this.publicClients[
        chainId
      ].estimateFeesPerGas();

      const increasedMaxFeePerGas =
        BigInt(maxFeePerGas) +
        (BigInt(maxFeePerGas) * BigInt(this.GAS_FEE_MULTIPLIER * 100)) /
          BigInt(100);

      return increasedMaxFeePerGas;
    }

    const finalMaxFeePerGas =
      BigInt(this.MAX_FEE_PER_GAS) +
      BigInt(this.MAX_PRIORITY_FEE_PER_GAS) *
        BigInt(Math.max(0, this.PRIORITY_FEE_MULTIPLIER - 1));

    return finalMaxFeePerGas;
  }

  async handleOperation(
    operations: OperationPayload[],
    chainId?: number
  ): Promise<{ userOpHash: Address; txnHash: Address }> {
    const sessionKeyClient = chainId
      ? this._sessionKeyClients[chainId]
      : this.sessionKeyClient;

    if (!sessionKeyClient) {
      throw new AcpError("Session key client not initialized");
    }

    const basePayload: any = {
      uo: operations.map((operation) => ({
        target: operation.contractAddress,
        data: operation.data,
        value: operation.value,
      })),
    };

    let iteration = 0;
    let finalError: unknown;

    while (iteration < this.config.maxRetries) {
      try {
        const currentMultiplier = 1 + 0.1 * (iteration + 1);

        const payload: any = {
          ...basePayload,
          overrides: {
            nonceKey: this.getRandomNonce(),
            maxFeePerGas: {
              multiplier: currentMultiplier,
            },
            maxPriorityFeePerGas: {
              multiplier: currentMultiplier,
            },
          },
        };

        const { hash } = await sessionKeyClient.sendUserOperation(payload);

        const checkTransactionConfig: CheckTransactionConfig = {
          hash,
          retries: this.RETRY_CONFIG,
        };

        // Only base / base sepolia supports preconfirmed transactions
        if (!chainId || chainId === baseSepolia.id || chainId === base.id) {
          checkTransactionConfig["tag"] = "pending";
        }

        const txnHash = await sessionKeyClient.waitForUserOperationTransaction(
          checkTransactionConfig
        );

        return { userOpHash: hash, txnHash };
      } catch (error) {
        iteration++;

        if (iteration === this.config.maxRetries) {
          finalError = error;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 2000 * iteration));
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
      createJobUserOpHash,
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

  async getX402PaymentDetails(
    jobId: number
  ): Promise<IAcpJobX402PaymentDetails> {
    try {
      const result = (await this.publicClient.readContract({
        address: this.jobManagerAddress,
        abi: JOB_MANAGER_ABI,
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

  async getAssetManager(): Promise<Address> {
    return (await this.publicClient.readContract({
      address: this.memoManagerAddress,
      abi: MEMO_MANAGER_ABI,
      functionName: "assetManager",
    })) as Address;
  }

  getAcpVersion(): string {
    return "2";
  }

  async signTypedData(typedData: SignTypedDataParameters): Promise<Hex> {
    return await this.sessionKeyClient.signTypedData({ typedData });
  }
}

export default AcpContractClientV2;

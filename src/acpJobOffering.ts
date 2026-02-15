import { Address, zeroAddress } from "viem";
import AcpClient from "./acpClient";
import Ajv from "ajv";
import { FareAmount } from "./acpFare";
import AcpError from "./acpError";
import BaseAcpContractClient, {
  AcpJobPhases,
  MemoType,
  OperationPayload,
} from "./contractClients/baseAcpContractClient";
import {
  baseAcpConfig,
  baseAcpX402Config,
  baseSepoliaAcpConfig,
  baseSepoliaAcpX402Config,
} from "./configs/acpConfigs";
import { USDC_TOKEN_ADDRESS } from "./constants";
import { AcpAccount } from "./acpAccount";
import { IAcpAccount, ISubscriptionCheckResponse } from "./interfaces";

export enum PriceType {
  FIXED = "fixed",
  PERCENTAGE = "percentage",
  SUBSCRIPTION = "subscription",
}
class AcpJobOffering {
  private ajv: Ajv;

  constructor(
    private readonly acpClient: AcpClient,
    private readonly acpContractClient: BaseAcpContractClient,
    public providerAddress: Address,
    public name: string,
    public price: number,
    public priceType: PriceType = PriceType.FIXED,
    public requirement?: Object | string,
    public subscriptionTiers: string[] = [],
  ) {
    this.ajv = new Ajv({ allErrors: true });
  }

  async initiateJob(
    serviceRequirement: Object | string,
    evaluatorAddress?: Address,
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 60 * 24), // default: 1 day
    preferredSubscriptionTier?: string,
  ) {
    this.validateRequest(serviceRequirement);

    const subscriptionRequired = this.isSubscriptionRequired(
      preferredSubscriptionTier,
    );
    this.validateSubscriptionTier(preferredSubscriptionTier);

    const effectivePrice = subscriptionRequired ? 0 : this.price;
    const effectivePriceType = subscriptionRequired
      ? PriceType.SUBSCRIPTION
      : this.priceType === PriceType.SUBSCRIPTION
        ? PriceType.FIXED
        : this.priceType;

    const fareAmount = new FareAmount(
      effectivePriceType === PriceType.FIXED ? effectivePrice : 0,
      this.acpContractClient.config.baseFare,
    );

    const account = await this.resolveAccount(
      subscriptionRequired,
      preferredSubscriptionTier,
    );

    const jobId = await this.createJob(
      account,
      evaluatorAddress,
      expiredAt,
      fareAmount,
      subscriptionRequired,
      preferredSubscriptionTier ?? "",
    );

    await this.sendInitialMemo(jobId, fareAmount, subscriptionRequired, {
      name: this.name,
      requirement: serviceRequirement,
      priceValue: effectivePrice,
      priceType: effectivePriceType,
    });

    return jobId;
  }

  private validateRequest(serviceRequirement: Object | string) {
    if (this.providerAddress === this.acpClient.walletAddress) {
      throw new AcpError(
        "Provider address cannot be the same as the client address",
      );
    }

    if (this.requirement && typeof this.requirement === "object") {
      const validator = this.ajv.compile(this.requirement);
      if (!validator(serviceRequirement)) {
        throw new AcpError(this.ajv.errorsText(validator.errors));
      }
    }
  }

  private isSubscriptionRequired(preferredSubscriptionTier?: string): boolean {
    const hasSubscriptionTiers = this.subscriptionTiers.length > 0;
    return (
      preferredSubscriptionTier != null ||
      (this.priceType === PriceType.SUBSCRIPTION && hasSubscriptionTiers)
    );
  }

  private validateSubscriptionTier(preferredSubscriptionTier?: string) {
    if (!preferredSubscriptionTier) return;

    if (this.subscriptionTiers.length === 0) {
      throw new AcpError(
        `Offering "${this.name}" does not support subscription tiers`,
      );
    }
    if (!this.subscriptionTiers.includes(preferredSubscriptionTier)) {
      throw new AcpError(
        `Preferred subscription tier "${preferredSubscriptionTier}" is not offered. Available: ${this.subscriptionTiers.join(", ")}`,
      );
    }
  }

  /**
   * Resolve the account to use for the job.
   *
   * For non-subscription jobs: returns the existing account if found.
   * For subscription jobs, priority:
   *   1. Valid account matching preferred tier
   *   2. Any valid (non-expired) account
   *   3. Expired/unactivated account (expiry = 0) to reuse
   *   4. null — createJob will create a new one
   */
  private async resolveAccount(
    subscriptionRequired: boolean,
    preferredSubscriptionTier?: string,
  ): Promise<AcpAccount | null> {
    const raw = await this.acpClient.getByClientAndProvider(
      this.acpContractClient.walletAddress,
      this.providerAddress,
      this.acpContractClient,
      subscriptionRequired ? this.name : undefined,
    );

    if (!subscriptionRequired) {
      if (!(raw instanceof AcpAccount)) return null;
      // Skip subscription accounts — they can't be used for non-subscription jobs
      const meta = raw.metadata;
      if (meta && typeof meta === "object" && meta.name) return null;
      return raw;
    }

    const subscriptionCheck =
      raw && typeof raw === "object" && "accounts" in raw
        ? (raw as ISubscriptionCheckResponse)
        : null;

    if (!subscriptionCheck) return null;

    const now = Math.floor(Date.now() / 1000);
    const allAccounts = subscriptionCheck.accounts ?? [];

    const matchedAccount =
      this.findPreferredAccount(allAccounts, preferredSubscriptionTier, now) ??
      allAccounts.find((a) => a.expiry != null && a.expiry > now) ??
      allAccounts.find((a) => a.expiry == null || a.expiry === 0);

    if (!matchedAccount) return null;

    return new AcpAccount(
      this.acpContractClient,
      matchedAccount.id,
      matchedAccount.clientAddress ?? this.acpContractClient.walletAddress,
      matchedAccount.providerAddress ?? this.providerAddress,
      matchedAccount.metadata,
      matchedAccount.expiry,
    );
  }

  private findPreferredAccount(
    accounts: IAcpAccount[],
    preferredTier: string | undefined,
    now: number,
  ): IAcpAccount | undefined {
    if (!preferredTier) return undefined;

    return accounts.find((a) => {
      if (a.expiry == null || a.expiry <= now) return false;
      const meta =
        typeof a.metadata === "string"
          ? (() => {
              try {
                return JSON.parse(a.metadata);
              } catch {
                return {};
              }
            })()
          : (a.metadata ?? {});
      return meta?.name === preferredTier;
    });
  }

  private async createJob(
    account: AcpAccount | null,
    evaluatorAddress: Address | undefined,
    expiredAt: Date,
    fareAmount: FareAmount,
    subscriptionRequired: boolean,
    subscriptionTier: string,
  ): Promise<number> {
    const isV1 = [
      baseSepoliaAcpConfig.contractAddress,
      baseSepoliaAcpX402Config.contractAddress,
      baseAcpConfig.contractAddress,
      baseAcpX402Config.contractAddress,
    ].includes(this.acpContractClient.config.contractAddress);

    const chainId = this.acpContractClient.config.chain
      .id as keyof typeof USDC_TOKEN_ADDRESS;
    const isUsdcPaymentToken =
      USDC_TOKEN_ADDRESS[chainId].toLowerCase() ===
      fareAmount.fare.contractAddress.toLowerCase();
    const isX402Job =
      this.acpContractClient.config.x402Config && isUsdcPaymentToken;

    const budget = subscriptionRequired ? 0n : fareAmount.amount;
    const subscriptionMetadata = subscriptionRequired
      ? JSON.stringify({ name: subscriptionTier })
      : "";

    const operation =
      isV1 || !account
        ? this.acpContractClient.createJob(
            this.providerAddress,
            evaluatorAddress || this.acpContractClient.walletAddress,
            expiredAt,
            fareAmount.fare.contractAddress,
            budget,
            subscriptionMetadata,
            isX402Job,
          )
        : this.acpContractClient.createJobWithAccount(
            account.id,
            evaluatorAddress || zeroAddress,
            budget,
            fareAmount.fare.contractAddress,
            expiredAt,
            isX402Job,
          );

    const { userOpHash, txnHash } = await this.acpContractClient.handleOperation([
      operation,
    ]);

    return this.acpContractClient.getJobId(
      userOpHash,
      this.acpContractClient.walletAddress,
      this.providerAddress,
    );
  }

  private async sendInitialMemo(
    jobId: number,
    fareAmount: FareAmount,
    subscriptionRequired: boolean,
    serviceRequirement: Record<string, any>,
  ) {
    const payloads: OperationPayload[] = [];

    if (!subscriptionRequired) {
      const setBudgetPayload = this.acpContractClient.setBudgetWithPaymentToken(
        jobId,
        fareAmount.amount,
        fareAmount.fare.contractAddress,
      );
      if (setBudgetPayload) {
        payloads.push(setBudgetPayload);
      }
    }

    payloads.push(
      this.acpContractClient.createMemo(
        jobId,
        JSON.stringify(serviceRequirement),
        MemoType.MESSAGE,
        true,
        AcpJobPhases.NEGOTIATION,
      ),
    );

    await this.acpContractClient.handleOperation(payloads);
  }
}

export default AcpJobOffering;

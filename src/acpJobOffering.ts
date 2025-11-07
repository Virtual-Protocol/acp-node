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

export enum PriceType {
  FIXED = "fixed",
  PERCENTAGE = "percentage",
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
    public requirement?: Object | string
  ) {
    this.ajv = new Ajv({ allErrors: true });
  }

  async initiateJob(
    serviceRequirement: Object | string,
    evaluatorAddress?: Address,
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 60 * 24) // default: 1 day
  ) {
    if (this.requirement && typeof this.requirement === "object") {
      const validator = this.ajv.compile(this.requirement);
      const valid = validator(serviceRequirement);

      if (!valid) {
        throw new AcpError(this.ajv.errorsText(validator.errors));
      }
    }

    const finalServiceRequirement: Record<string, any> = {
      name: this.name,
      requirement: serviceRequirement,
      priceValue: this.price,
      priceType: this.priceType,
    };

    const fareAmount = new FareAmount(
      this.priceType === PriceType.FIXED ? this.price : 0,
      this.acpContractClient.config.baseFare
    );

    const account = await this.acpClient.getByClientAndProvider(
      this.acpContractClient.walletAddress,
      this.providerAddress,
      this.acpContractClient
    );

    const isV1 = [
      baseSepoliaAcpConfig.contractAddress,
      baseSepoliaAcpX402Config.contractAddress,
      baseAcpConfig.contractAddress,
      baseAcpX402Config.contractAddress,
    ].includes(this.acpContractClient.config.contractAddress);

    let createJobPayload: OperationPayload;

    const chainId = this.acpContractClient.config.chain
      .id as keyof typeof USDC_TOKEN_ADDRESS;

    const isUsdcPaymentToken =
      USDC_TOKEN_ADDRESS[chainId].toLowerCase() ===
      fareAmount.fare.contractAddress.toLowerCase();

    const isX402Job =
      this.acpContractClient.config.x402Config && isUsdcPaymentToken;

    if (isV1 || !account) {
      createJobPayload = this.acpContractClient.createJob(
        this.providerAddress,
        evaluatorAddress || this.acpContractClient.walletAddress,
        expiredAt,
        fareAmount.fare.contractAddress,
        fareAmount.amount,
        "",
        isX402Job
      );
    } else {
      createJobPayload = this.acpContractClient.createJobWithAccount(
        account.id,
        evaluatorAddress || zeroAddress,
        fareAmount.amount,
        fareAmount.fare.contractAddress,
        expiredAt,
        isX402Job
      );
    }

    const createJobTxnHash = await this.acpContractClient.handleOperation([
      createJobPayload,
    ]);

    const jobId = await this.acpContractClient.getJobId(
      createJobTxnHash,
      this.acpContractClient.walletAddress,
      this.providerAddress
    );

    const payloads: OperationPayload[] = [];

    const setBudgetWithPaymentTokenPayload =
      this.acpContractClient.setBudgetWithPaymentToken(
        jobId,
        fareAmount.amount,
        fareAmount.fare.contractAddress
      );

    if (setBudgetWithPaymentTokenPayload) {
      payloads.push(setBudgetWithPaymentTokenPayload);
    }

    payloads.push(
      this.acpContractClient.createMemo(
        jobId,
        JSON.stringify(finalServiceRequirement),
        MemoType.MESSAGE,
        true,
        AcpJobPhases.NEGOTIATION
      )
    );

    await this.acpContractClient.handleOperation(payloads);

    return jobId;
  }
}

export default AcpJobOffering;

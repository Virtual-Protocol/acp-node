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
  baseSepoliaAcpConfig,
  baseSepoliaAcpX402Config,
} from "./configs/acpConfigs";
import { USDC_TOKEN_ADDRESS } from "./constants";

class AcpJobOffering {
  private ajv: Ajv;

  constructor(
    private readonly acpClient: AcpClient,
    private readonly acpContractClient: BaseAcpContractClient,
    public providerAddress: Address,
    public name: string,
    public price: number,
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
    };

    const fareAmount = new FareAmount(
      this.price,
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
    ].includes(this.acpContractClient.config.contractAddress);

    let createJobPayload: OperationPayload;

    const chainId = this.acpContractClient.config.chain
      .id as keyof typeof USDC_TOKEN_ADDRESS;

    const isUsdcPaymentToken =
      USDC_TOKEN_ADDRESS[chainId].toLowerCase() ===
      fareAmount.fare.contractAddress.toLowerCase();

    if (isV1 || !account) {
      if (this.acpContractClient.config.x402Config && isUsdcPaymentToken) {
        createJobPayload = this.acpContractClient.createJobWithX402(
          this.providerAddress,
          evaluatorAddress || this.acpContractClient.walletAddress,
          expiredAt,
          fareAmount.fare.contractAddress,
          fareAmount.amount,
          ""
        );
      } else {
        createJobPayload = this.acpContractClient.createJob(
          this.providerAddress,
          evaluatorAddress || this.acpContractClient.walletAddress,
          expiredAt,
          fareAmount.fare.contractAddress,
          fareAmount.amount,
          ""
        );
      }
    } else {
      createJobPayload = this.acpContractClient.createJobWithAccount(
        account.id,
        this.providerAddress,
        evaluatorAddress || zeroAddress,
        fareAmount.amount,
        fareAmount.fare.contractAddress,
        expiredAt
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

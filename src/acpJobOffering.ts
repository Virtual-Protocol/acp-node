import { Address, zeroAddress } from "viem";
import AcpClient from "./acpClient";
import Ajv from "ajv";
import { FareAmount } from "./acpFare";
import AcpError from "./acpError";
import BaseAcpContractClient, {
  AcpJobPhases,
  MemoType,
} from "./contractClients/baseAcpContractClient";
import { baseAcpConfig, baseSepoliaAcpConfig } from "./configs/acpConfigs";

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
    }

    const fareAmount = new FareAmount(
      this.price,
      this.acpContractClient.config.baseFare
    );

    const account = await this.acpClient.getByClientAndProvider(
      this.acpContractClient.walletAddress,
      this.providerAddress,
      this.acpContractClient
    );

    const { jobId, txHash } =
      [
        baseSepoliaAcpConfig.contractAddress,
        baseAcpConfig.contractAddress,
      ].includes(this.acpContractClient.config.contractAddress) || !account
        ? await this.acpContractClient.createJob(
            this.providerAddress,
            evaluatorAddress || this.acpContractClient.walletAddress,
            expiredAt,
            fareAmount.fare.contractAddress,
            fareAmount.amount,
            ""
          )
        : await this.acpContractClient.createJobWithAccount(
            account.id,
            evaluatorAddress || zeroAddress,
            fareAmount.amount,
            fareAmount.fare.contractAddress,
            expiredAt
          );

    await this.acpContractClient.createMemo(
      jobId,
      JSON.stringify(finalServiceRequirement),
      MemoType.MESSAGE,
      true,
      AcpJobPhases.NEGOTIATION
    );

    return jobId;
  }
}

export default AcpJobOffering;

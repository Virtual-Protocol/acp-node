import { Address } from "viem";
import AcpClient from "./acpClient";
import Ajv from "ajv";
import { FareAmount } from "./acpFare";
import AcpError from "./acpError";

class AcpJobOffering {
  private ajv: Ajv;

  constructor(
    private readonly acpClient: AcpClient,
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

    let finalServiceRequirement: Record<string, any> = {
      jobName: this.name,
    };

    if (typeof serviceRequirement === "string") {
      finalServiceRequirement = {
        ...finalServiceRequirement,
        requirement: serviceRequirement,
      };
    } else {
      finalServiceRequirement = {
        ...finalServiceRequirement,
        requirement: serviceRequirement,
      };
    }

    return await this.acpClient.initiateJob(
      this.providerAddress,
      finalServiceRequirement,
      new FareAmount(
        this.price,
        this.acpClient.acpContractClient.config.baseFare
      ),
      evaluatorAddress,
      expiredAt
    );
  }
}

export default AcpJobOffering;

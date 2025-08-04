import { Address } from "viem";
import AcpClient from "./acpClient";
import Ajv from "ajv";

class AcpJobOffering {
  private ajv: Ajv;

  constructor(
    private readonly acpClient: AcpClient,
    public providerAddress: Address,
    public name: string,
    public price: number,
    public requirementSchema?: Object
  ) {
    this.ajv = new Ajv({ allErrors: true });
  }

  async initiateJob(
    serviceRequirement: Object | string,
    evaluatorAddress?: Address,
    expiredAt: Date = new Date(Date.now() + 1000 * 60 * 60 * 24) // default: 1 day
  ) {
    if (this.requirementSchema) {
      const validator = this.ajv.compile(this.requirementSchema);
      const valid = validator(serviceRequirement);

      if (!valid) {
        throw new Error(this.ajv.errorsText(validator.errors));
      }
    }

    let finalServiceRequirement: Record<string, any> = {
      serviceName: this.name,
    };

    if (typeof serviceRequirement === "string") {
      finalServiceRequirement = {
        ...finalServiceRequirement,
        message: serviceRequirement,
      };
    } else {
      finalServiceRequirement = {
        ...finalServiceRequirement,
        serviceRequirement: serviceRequirement,
      };
    }

    return await this.acpClient.initiateJob(
      this.providerAddress,
      finalServiceRequirement,
      this.price,
      evaluatorAddress,
      expiredAt
    );
  }
}

export default AcpJobOffering;

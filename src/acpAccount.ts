import { Address } from "viem";
import BaseAcpContractClient from "./contractClients/baseAcpContractClient";

export class AcpAccount {
  constructor(
    public contractClient: BaseAcpContractClient,
    public id: number,
    public clientAddress: Address,
    public providerAddress: Address,
    public metadata: Record<string, any>
  ) {}

  async updateMetadata(metadata: Record<string, any>) {
    const hash = await this.contractClient.updateAccountMetadata(
      this.id,
      JSON.stringify(metadata)
    );

    return hash;
  }
}

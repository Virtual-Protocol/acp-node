import { Address } from "viem";
import BaseAcpContractClient from "./contractClients/baseAcpContractClient";

export class AcpAccount {
  constructor(
    public contractClient: BaseAcpContractClient,
    public id: number,
    public clientAddress: Address,
    public providerAddress: Address,
    public metadata: Record<string, any>,
    public expiry?: number
  ) {}

  isSubscriptionValid(): boolean {
    if (!this.expiry || this.expiry === 0) {
      return false;
    }
    return this.expiry > Math.floor(Date.now() / 1000);
  }

  async updateMetadata(metadata: Record<string, any>) {
    const hash = await this.contractClient.updateAccountMetadata(
      this.id,
      JSON.stringify(metadata)
    );

    return hash;
  }
}

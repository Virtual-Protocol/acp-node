import { Address } from "viem";
import AcpJobOffering from "./acpJobOffering";

export type AcpAgentArgs = {
  id: string | number;
  name: string;
  contractAddress: Address;
  walletAddress: Address;
  jobOfferings: AcpJobOffering[];
  description?: string;
  twitterHandle?: string;
  metrics?: unknown;
  resources?: unknown;
};

export class AcpAgent {
  public readonly id: string;
  public readonly name: string;
  public readonly contractAddress: Address;
  public readonly walletAddress: Address;
  public readonly jobOfferings: readonly AcpJobOffering[];

  public readonly description?: string;
  public readonly twitterHandle?: string;
  public readonly metrics?: unknown;
  public readonly resources?: unknown;

  constructor(args: AcpAgentArgs) {
    this.id = String(args.id);

    this.name = args.name;
    this.contractAddress = args.contractAddress;
    this.walletAddress = args.walletAddress;

    this.jobOfferings = Object.freeze([...args.jobOfferings]);

    this.description = args.description;
    this.twitterHandle = args.twitterHandle;
    this.metrics = args.metrics;
    this.resources = args.resources;
  }
}

export default AcpAgent;

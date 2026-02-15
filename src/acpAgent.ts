import { Address } from "viem";
import AcpJobOffering from "./acpJobOffering";
import { ISubscriptionTier } from "./interfaces";

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
  subscriptions?: ISubscriptionTier[];
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
  public readonly subscriptions: readonly ISubscriptionTier[];

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
    this.subscriptions = Object.freeze([...(args.subscriptions ?? [])]);
  }
}

export default AcpAgent;

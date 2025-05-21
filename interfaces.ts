import { Address } from "viem";

export type AcpAgent = {
  id: number;
  documentId: string;
  name: string;
  description: string;
  walletAddress: Address;
  isVirtualAgent: boolean;
  profilePic: string;
  category: string;
  tokenAddress: string | null;
  ownerAddress: string;
  cluster: string | null;
  twitterHandle: string;
  offerings: {
    name: string;
    price: number;
    requirementSchema?: Object;
    deliverableSchema?: Object;
  }[];
  symbol: string | null;
  virtualAgentId: string | null;
};

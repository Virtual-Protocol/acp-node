import { Address } from "@aa-sdk/core";
import { baseSepolia, base } from "@account-kit/infra";

type AcpContractConfig = {
  chain: typeof baseSepolia | typeof base;
  contractAddress: Address;
  virtualsTokenAddress: Address;
  acpUrl: string;
  alchemyRpcUrl: string;
};

const baseSepoliaAcpConfig: AcpContractConfig = {
  chain: baseSepolia,
  contractAddress: "0x2422c1c43451Eb69Ff49dfD39c4Dc8C5230fA1e6",
  virtualsTokenAddress: "0xbfAB80ccc15DF6fb7185f9498d6039317331846a",
  alchemyRpcUrl: "https://alchemy-proxy.virtuals.io/api/proxy/rpc",
  acpUrl: "https://acpx-staging.virtuals.io",
};

const baseAcpConfig: AcpContractConfig = {
  chain: base,
  contractAddress: "0x2422c1c43451Eb69Ff49dfD39c4Dc8C5230fA1e6",
  virtualsTokenAddress: "0xbfAB80ccc15DF6fb7185f9498d6039317331846a",
  alchemyRpcUrl: "https://alchemy-proxy-prod.virtuals.io/api/proxy/rpc",
  acpUrl: "https://acpx.virtuals.io",
};

export { AcpContractConfig, baseSepoliaAcpConfig };

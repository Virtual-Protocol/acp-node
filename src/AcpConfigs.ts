import { Address } from "@aa-sdk/core";
import { baseSepolia, base } from "@account-kit/infra";
import { Fare } from "./acpFare";

class AcpContractConfig {
  constructor(
    public chain: typeof baseSepolia | typeof base,
    public contractAddress: Address,
    public baseFare: Fare,
    public alchemyRpcUrl: string,
    public acpUrl: string,
    public rpcEndpoint?: string
  ) {}
}

const baseSepoliaAcpConfig = new AcpContractConfig(
  baseSepolia,
  "0x8Db6B1c839Fc8f6bd35777E194677B67b4D51928",
  new Fare("0x036CbD53842c5426634e7929541eC2318f3dCF7e", 6),
  "https://alchemy-proxy.virtuals.io/api/proxy/rpc",
  "https://acpx.virtuals.gg"
);

const baseAcpConfig = new AcpContractConfig(
  base,
  "0x6a1FE26D54ab0d3E1e3168f2e0c0cDa5cC0A0A4A",
  new Fare("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6),
  "https://alchemy-proxy-prod.virtuals.io/api/proxy/rpc",
  "https://acpx.virtuals.io"
);

export { AcpContractConfig, baseSepoliaAcpConfig, baseAcpConfig };

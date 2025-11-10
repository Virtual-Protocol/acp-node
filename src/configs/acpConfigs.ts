import { Address } from "@aa-sdk/core";
import { baseSepolia, base } from "@account-kit/infra";
import { Fare } from "../acpFare";
import ACP_ABI from "../abis/acpAbi";
import ACP_V2_ABI from "../abis/acpAbiV2";
import { X402Config } from "../interfaces";

class AcpContractConfig {
  constructor(
    public chain: typeof baseSepolia | typeof base,
    public contractAddress: Address,
    public baseFare: Fare,
    public alchemyRpcUrl: string,
    public acpUrl: string,
    public abi: typeof ACP_ABI | typeof ACP_V2_ABI,
    public rpcEndpoint?: string,
    public x402Config?: X402Config
  ) {}
}

const baseSepoliaAcpConfig = new AcpContractConfig(
  baseSepolia,
  "0x8Db6B1c839Fc8f6bd35777E194677B67b4D51928",
  new Fare("0x036CbD53842c5426634e7929541eC2318f3dCF7e", 6),
  "https://alchemy-proxy.virtuals.io/api/proxy/rpc",
  "https://acpx.virtuals.gg",
  ACP_ABI
);

const baseSepoliaAcpX402Config = new AcpContractConfig(
  baseSepolia,
  "0x8Db6B1c839Fc8f6bd35777E194677B67b4D51928",
  new Fare("0x036CbD53842c5426634e7929541eC2318f3dCF7e", 6),
  "https://alchemy-proxy.virtuals.io/api/proxy/rpc",
  "https://acpx.virtuals.gg",
  ACP_ABI,
  undefined,
  {
    url: "https://dev-acp-x402.virtuals.io",
  }
);

const baseSepoliaAcpConfigV2 = new AcpContractConfig(
  baseSepolia,
  "0xdf54E6Ed6cD1d0632d973ADECf96597b7e87893c",
  new Fare("0x036CbD53842c5426634e7929541eC2318f3dCF7e", 6),
  "https://alchemy-proxy.virtuals.io/api/proxy/rpc",
  "https://acpx.virtuals.gg",
  ACP_V2_ABI
);

const baseSepoliaAcpX402ConfigV2 = new AcpContractConfig(
  baseSepolia,
  "0xdf54E6Ed6cD1d0632d973ADECf96597b7e87893c",
  new Fare("0x036CbD53842c5426634e7929541eC2318f3dCF7e", 6),
  "https://alchemy-proxy.virtuals.io/api/proxy/rpc",
  "https://acpx.virtuals.gg",
  ACP_V2_ABI,
  undefined,
  {
    url: "https://dev-acp-x402.virtuals.io",
  }
);

const baseAcpConfig = new AcpContractConfig(
  base,
  "0x6a1FE26D54ab0d3E1e3168f2e0c0cDa5cC0A0A4A",
  new Fare("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6),
  "https://alchemy-proxy-prod.virtuals.io/api/proxy/rpc",
  "https://acpx.virtuals.io",
  ACP_ABI
);

const baseAcpX402Config = new AcpContractConfig(
  base,
  "0x6a1FE26D54ab0d3E1e3168f2e0c0cDa5cC0A0A4A",
  new Fare("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6),
  "https://alchemy-proxy-prod.virtuals.io/api/proxy/rpc",
  "https://acpx.virtuals.io",
  ACP_ABI,
  undefined,
  {
    url: "https://acp-x402.virtuals.io",
  }
);

const baseAcpConfigV2 = new AcpContractConfig(
  base,
  "0xa6C9BA866992cfD7fd6460ba912bfa405adA9df0",
  new Fare("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6),
  "https://alchemy-proxy-prod.virtuals.io/api/proxy/rpc",
  "https://acpx.virtuals.io",
  ACP_V2_ABI
);

const baseAcpX402ConfigV2 = new AcpContractConfig(
  base,
  "0xa6C9BA866992cfD7fd6460ba912bfa405adA9df0",
  new Fare("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6),
  "https://alchemy-proxy-prod.virtuals.io/api/proxy/rpc",
  "https://acpx.virtuals.io",
  ACP_V2_ABI,
  undefined,
  {
    url: "https://acp-x402.virtuals.io",
  }
);

export {
  AcpContractConfig,
  baseSepoliaAcpConfigV2,
  baseSepoliaAcpX402ConfigV2,
  baseSepoliaAcpConfig,
  baseSepoliaAcpX402Config,
  baseAcpConfig,
  baseAcpX402Config,
  baseAcpConfigV2,
  baseAcpX402ConfigV2,
};

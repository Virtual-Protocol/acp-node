import { Address } from "@aa-sdk/core";
import { baseSepolia, base } from "@account-kit/infra";
import { Fare } from "../acpFare";
import ACP_ABI from "../aibs/acpAbi";
import ACP_V2_ABI from "../aibs/acpAbiV2";

class AcpContractConfig {
  constructor(
    public chain: typeof baseSepolia | typeof base,
    public contractAddress: Address,
    public baseFare: Fare,
    public alchemyRpcUrl: string,
    public acpUrl: string,
    public abi: typeof ACP_ABI | typeof ACP_V2_ABI,
    public rpcEndpoint?: string
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

const baseSepoliaAcpConfigV2 = new AcpContractConfig(
  baseSepolia,
  "0xd56F89058F88A97a997cf029793F02f84860c5a1",
  new Fare("0x036CbD53842c5426634e7929541eC2318f3dCF7e", 6),
  "https://alchemy-proxy.virtuals.io/api/proxy/rpc",
  "https://acpx.virtuals.gg",
  ACP_V2_ABI
);

const baseAcpConfig = new AcpContractConfig(
  base,
  "0x6a1FE26D54ab0d3E1e3168f2e0c0cDa5cC0A0A4A",
  new Fare("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6),
  "https://alchemy-proxy-prod.virtuals.io/api/proxy/rpc",
  "https://acpx.virtuals.io",
  ACP_ABI
);

export {
  AcpContractConfig,
  baseSepoliaAcpConfigV2,
  baseSepoliaAcpConfig,
  baseAcpConfig,
};

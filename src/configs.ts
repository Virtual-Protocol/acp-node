import { Address } from "@aa-sdk/core";
import { baseSepolia, base } from "@account-kit/infra";

type AcpContractConfig = {
  chain: typeof baseSepolia | typeof base;
  contractAddress: Address;
  paymentTokenAddress: Address;
  paymentTokenDecimals: number;
  acpUrl: string;
  alchemyRpcUrl: string;
  priorityFeeMultiplier: number;
  maxFeePerGas: number;
  maxPriorityFeePerGas: number;
};

const baseSepoliaAcpConfig: AcpContractConfig = {
  chain: baseSepolia,
  contractAddress: "0x8Db6B1c839Fc8f6bd35777E194677B67b4D51928",
  paymentTokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  paymentTokenDecimals: 6,
  alchemyRpcUrl: "https://alchemy-proxy.virtuals.io/api/proxy/rpc",
  acpUrl: "https://acpx.virtuals.gg",
  priorityFeeMultiplier: 2,
  maxFeePerGas: 20000000,
  maxPriorityFeePerGas: 21000000,
};

const baseAcpConfig: AcpContractConfig = {
  chain: base,
  contractAddress: "0x6a1FE26D54ab0d3E1e3168f2e0c0cDa5cC0A0A4A",
  paymentTokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  paymentTokenDecimals: 6,
  alchemyRpcUrl: "https://alchemy-proxy-prod.virtuals.io/api/proxy/rpc",
  acpUrl: "https://acpx.virtuals.io",
  priorityFeeMultiplier: 2,
  maxFeePerGas: 20000000,
  maxPriorityFeePerGas: 21000000,
};

export { AcpContractConfig, baseSepoliaAcpConfig, baseAcpConfig };

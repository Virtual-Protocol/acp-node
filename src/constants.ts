import { Address } from "viem";
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  mainnet,
  polygon,
  polygonAmoy,
  sepolia,
} from "viem/chains";

export const USDC_TOKEN_ADDRESS = {
  [baseSepolia.id]: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
  [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
};

export const X402AuthorizationTypes = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
];

export const HTTP_STATUS_CODES = {
  OK: 200,
  PAYMENT_REQUIRED: 402,
};

export const SINGLE_SIGNER_VALIDATION_MODULE_ADDRESS: Address =
  "0x00000000000099DE0BF6fA90dEB851E2A2df7d83";

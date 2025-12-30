import { Address, encodeAbiParameters } from "viem";
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

export function tryParseJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    return null;
  }
}

export function preparePayload(payload: string | object) {
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

export function safeBase64Encode(data: string): string {
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.btoa === "function"
  ) {
    return globalThis.btoa(data);
  }
  return Buffer.from(data).toString("base64");
}

export function getDestinationEndpointId(chainId: number): number {
  switch (chainId) {
    case baseSepolia.id:
      return 40245;
    case sepolia.id:
      return 40161;
    case polygonAmoy.id:
      return 40267;
    case arbitrumSepolia.id:
      return 40231;
    case bscTestnet.id:
      return 40102;
    case base.id:
      return 30184;
    case mainnet.id:
      return 30101;
    case polygon.id:
      return 30109;
    case arbitrum.id:
      return 30110;
    case bsc.id:
      return 30102;
  }

  throw new Error(`Unsupported chain ID: ${chainId}`);
}

export function encodeTransferEventMetadata(
  tokenAddress: Address,
  amount: bigint,
  recipient: Address,
  chainId: number
): string {
  return encodeAbiParameters(
    [
      { type: "address", name: "token" },
      { type: "uint256", name: "amount" },
      { type: "address", name: "recipient" },
      { type: "uint32", name: "dstEid" },
      { type: "bytes", name: "lzOptions" },
    ],
    [tokenAddress, amount, recipient, getDestinationEndpointId(chainId), "0x"]
  );
}

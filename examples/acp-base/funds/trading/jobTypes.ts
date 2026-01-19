import { Address } from "viem";

export type SwapTokenDemoPayload = {
  fromSymbol: string;
  fromContractAddress: Address;
  amount: number;
  toSymbol: string;
  toContractAddress: Address;
}

export type TpSlConfig = {
  percentage?: number;
  price?: number;
}

export type OpenPositionDemoPayload = {
  symbol: string;
  amount: number;
  tp: TpSlConfig;
  sl: TpSlConfig;
  direction: "long" | "short"
}

export type ClosePositionDemoPayload = {
  symbol: string
}

export type FundsJobDemoPayload =
  | SwapTokenDemoPayload
  | OpenPositionDemoPayload
  | ClosePositionDemoPayload;

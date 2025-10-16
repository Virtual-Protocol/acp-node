import { Address } from "viem";

export type V2DemoSwapTokenPayload = {
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

export type V2DemoOpenPositionPayload = {
    symbol: string;
    amount: number;
    tp: TpSlConfig;
    sl: TpSlConfig;
    direction: "long" | "short"
}

export type V2DemoClosePositionPayload = {
    symbol: string
}

export type FundsV2DemoJobPayload =
    | V2DemoSwapTokenPayload
    | V2DemoOpenPositionPayload
    | V2DemoClosePositionPayload;

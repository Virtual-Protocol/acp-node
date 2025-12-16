export type CreateMarketPayload = {
  question: string;
  outcomes: string[];
  endTime: string;
  liquidity: number;
};

export type PlaceBetPayload = {
  marketId: string;
  outcome: string;
  token: string;
  amount: number;
};

export type CloseBetPayload = {
  marketId: string;
};

export type PredictionMarketDemoJobPayload =
  | CreateMarketPayload
  | PlaceBetPayload
  | CloseBetPayload;

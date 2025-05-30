import dotenv from "dotenv";
import { Address } from "viem";

dotenv.config({ path: __dirname + "/.env" });

function getEnvVar<T extends string = string>(key: string, required = true): T {
  const value = process.env[key];
  if (required && (value === undefined || value === "")) {
    throw new Error(`${key} is not defined or is empty in the .env file`);
  }
  return value as T;
}

export const BUYER_WALLET_PRIVATE_KEY = getEnvVar<Address>(
  "BUYER_WALLET_PRIVATE_KEY"
);

export const BUYER_AGENT_WALLET_ADDRESS = getEnvVar<Address>(
  "BUYER_AGENT_WALLET_ADDRESS"
);

export const BUYER_ENTITY_ID = parseInt(getEnvVar("BUYER_ENTITY_ID"));

export const BUYER_GAME_TWITTER_BEARER_TOKEN = getEnvVar<string>(
  "BUYER_GAME_TWITTER_BEARER_TOKEN"
);

export const SELLER_WALLET_PRIVATE_KEY = getEnvVar<Address>(
  "SELLER_WALLET_PRIVATE_KEY"
);

export const SELLER_AGENT_WALLET_ADDRESS = getEnvVar<Address>(
  "SELLER_AGENT_WALLET_ADDRESS"
);

export const SELLER_ENTITY_ID = parseInt(getEnvVar("SELLER_ENTITY_ID"));

export const SELLER_GAME_TWITTER_BEARER_TOKEN = getEnvVar<string>(
  "SELLER_GAME_TWITTER_BEARER_TOKEN"
);

export const EVALUATOR_WALLET_PRIVATE_KEY = getEnvVar<Address>(
  "EVALUATOR_WALLET_PRIVATE_KEY"
);

export const EVALUATOR_AGENT_WALLET_ADDRESS = getEnvVar<Address>(
  "EVALUATOR_AGENT_WALLET_ADDRESS"
);

export const EVALUATOR_ENTITY_ID = parseInt(getEnvVar("EVALUATOR_ENTITY_ID"));

export const EVALUATOR_GAME_TWITTER_BEARER_TOKEN = getEnvVar<string>(
  "EVALUATOR_GAME_TWITTER_BEARER_TOKEN"
);

if (isNaN(BUYER_ENTITY_ID)) {
  throw new Error("BUYER_ENTITY_ID must be a valid number in the .env file");
}

if (isNaN(SELLER_ENTITY_ID)) {
  throw new Error("SELLER_ENTITY_ID must be a valid number in the .env file");
}

if (isNaN(EVALUATOR_ENTITY_ID)) {
  throw new Error(
    "EVALUATOR_ENTITY_ID must be a valid number in the .env file"
  );
}

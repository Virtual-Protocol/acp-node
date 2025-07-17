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

export const WHITELISTED_WALLET_PRIVATE_KEY = getEnvVar<Address>(
    "WHITELISTED_WALLET_PRIVATE_KEY"
);

export const BUYER_AGENT_WALLET_ADDRESS = getEnvVar<Address>(
    "BUYER_AGENT_WALLET_ADDRESS"
);

export const BUYER_ENTITY_ID = parseInt(getEnvVar("BUYER_ENTITY_ID"));

export const SELLER_AGENT_WALLET_ADDRESS = getEnvVar<Address>(
    "SELLER_AGENT_WALLET_ADDRESS"
);

export const SELLER_ENTITY_ID = parseInt(getEnvVar("SELLER_ENTITY_ID"));

const entities = {
    BUYER_ENTITY_ID,
    SELLER_ENTITY_ID,
};

for (const [key, value] of Object.entries(entities)) {
    if (isNaN(value)) throw new Error(`${key} must be a valid number`);
}

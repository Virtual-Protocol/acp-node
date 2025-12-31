import dotenv from "dotenv";
import { Address } from "viem";

dotenv.config({path: __dirname + "/.env"});

// Debug function to print environment variables (with sensitive data masked)
function debugEnvVars() {
  console.log("\n=== Environment Variables Debug ===");
  console.log("Raw process.env values (from .env file):\n");
  
  const envKeys = [
    "WHITELISTED_WALLET_PRIVATE_KEY",
    "BUYER_AGENT_WALLET_ADDRESS",
    "BUYER_ENTITY_ID",
    "SELLER_AGENT_WALLET_ADDRESS",
    "SELLER_ENTITY_ID",
    "EVALUATOR_AGENT_WALLET_ADDRESS",
    "EVALUATOR_ENTITY_ID",
    "GEMINI_API_KEY",
    "PENDING_AGENT_NAME",
    "PENDING_AGENT_WALLET_ADDRESS",
  ];
  
  envKeys.forEach(key => {
    const value = process.env[key];
    if (value !== undefined) {
      // Mask sensitive values (private keys, API keys)
      if (key.includes("PRIVATE_KEY") || key.includes("API_KEY")) {
        const masked = value.length > 10 
          ? `${value.substring(0, 6)}...${value.substring(value.length - 4)} (length: ${value.length})`
          : "***MASKED***";
        console.log(`  ${key}: ${masked}`);
        
        // Show first and last few chars for private key debugging
        if (key === "WHITELISTED_WALLET_PRIVATE_KEY") {
          console.log(`    First 10 chars: "${value.substring(0, 10)}"`);
          console.log(`    Last 10 chars: "${value.substring(value.length - 10)}"`);
          console.log(`    Full length: ${value.length} (expected: 66)`);
          console.log(`    Starts with 0x: ${value.startsWith("0x")}`);
          console.log(`    Has quotes: ${(value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))}`);
          console.log(`    Trimmed length: ${value.trim().length}`);
        }
      } else {
        console.log(`  ${key}: ${value}`);
      }
    } else {
      console.log(`  ${key}: <undefined>`);
    }
  });
  
  console.log("\n=== End Debug ===\n");
}

// Call debug function on module load (only in non-production)
if (process.env.NODE_ENV !== 'production') {
  debugEnvVars();
}

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

export const EVALUATOR_AGENT_WALLET_ADDRESS = getEnvVar<Address>(
  "EVALUATOR_AGENT_WALLET_ADDRESS"
);

export const EVALUATOR_ENTITY_ID = parseInt(getEnvVar("EVALUATOR_ENTITY_ID"));

// LLM Configuration (optional - for evaluation)
// Option 1: Direct Gemini API Key (simpler)
export const GEMINI_API_KEY = getEnvVar("GEMINI_API_KEY", false);

// Option 2: Vertex AI with Service Account (for GCP projects)
export const GEMINI_PROJECT_ID = getEnvVar("GEMINI_PROJECT_ID", false);
export const GEMINI_LOCATION = getEnvVar("GEMINI_LOCATION", false);
export const CONFIG_GEMINI_SERVICE_ACCOUNT = getEnvVar(
  "CONFIG_GEMINI_SERVICE_ACCOUNT",
  false
);

const entities = {
  BUYER_ENTITY_ID,
  SELLER_ENTITY_ID,
  EVALUATOR_ENTITY_ID,
};

for (const [key, value] of Object.entries(entities)) {
  if (isNaN(value)) throw new Error(`${key} must be a valid number`);
}
import {
  WHITELISTED_WALLET_PRIVATE_KEY,
  BUYER_ENTITY_ID,
  BUYER_AGENT_WALLET_ADDRESS,
  SELLER_ENTITY_ID,
  SELLER_AGENT_WALLET_ADDRESS,
} from "./env";

describe("Environment Variables Debug", () => {
  it("should load all required environment variables", () => {
    console.log("=== ENV VARS DEBUG ===");
    console.log("WHITELISTED_WALLET_PRIVATE_KEY:", WHITELISTED_WALLET_PRIVATE_KEY ? "✓ SET" : "✗ MISSING");
    console.log("BUYER_ENTITY_ID:", BUYER_ENTITY_ID);
    console.log("BUYER_AGENT_WALLET_ADDRESS:", BUYER_AGENT_WALLET_ADDRESS ? "✓ SET" : "✗ MISSING");
    console.log("SELLER_ENTITY_ID:", SELLER_ENTITY_ID);
    console.log("SELLER_AGENT_WALLET_ADDRESS:", SELLER_AGENT_WALLET_ADDRESS ? "✓ SET" : "✗ MISSING");
    console.log("======================");

    expect(WHITELISTED_WALLET_PRIVATE_KEY).toBeDefined();
    expect(BUYER_ENTITY_ID).toBeDefined();
    expect(BUYER_AGENT_WALLET_ADDRESS).toBeDefined();
    expect(SELLER_ENTITY_ID).toBeDefined();
    expect(SELLER_AGENT_WALLET_ADDRESS).toBeDefined();
  });
});

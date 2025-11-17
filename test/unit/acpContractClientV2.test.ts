import type { Address } from "viem";
import AcpClient from "../../src/acpClient";
import AcpContractClientV2 from "../../src/contractClients/acpContractClientV2";
import {
  MOCK_WHITELISTED_WALLET_ADDRESS,
  MOCK_SELLER_ENTITY_ID,
  MOCK_SELLER_AGENT_WALLET_ADDRESS,
  createContractClientV2,
} from "../utils/helper";

describe("AcpContractClientV2 Unit Tests", () => {
  let acpClient: AcpClient;
  let contractClient: AcpContractClientV2;

  describe("AcpClient Instance Creation", () => {
    it("should create ACP client with valid credentials", async () => {
      contractClient = await AcpContractClientV2.build(
        MOCK_WHITELISTED_WALLET_ADDRESS as Address,
        parseInt(MOCK_SELLER_ENTITY_ID),
        MOCK_SELLER_AGENT_WALLET_ADDRESS as Address,
      );

      acpClient = new AcpClient({
        acpContractClient: contractClient,
      });

      expect(acpClient).toBeDefined();
      expect(acpClient).toBeInstanceOf(AcpClient);
    });
  });

  describe("Parameter Validation", () => {
    it("should reject empty private key", async () => {
      await expect(
        AcpContractClientV2.build(
          "" as Address,
          parseInt(process.env.SELLER_ENTITY_ID!),
          process.env.SELLER_AGENT_WALLET_ADDRESS! as Address,
        ),
      ).rejects.toThrow();
    });

    // ISSUE: The build() function should throw an error when the value is < 0 || NaN
    it.skip("should reject NaN entity ID", async () => {
      await expect(
        AcpContractClientV2.build(
          process.env.WHITELISTED_WALLET_PRIVATE_KEY! as Address,
          parseInt(""),
          process.env.SELLER_AGENT_WALLET_ADDRESS! as Address,
        ),
      ).rejects.toThrow();
    });

    //  ISSUE: It should throw an error for empty agent wallet address
    it.skip("should reject empty wallet address", async () => {
      await expect(
        AcpContractClientV2.build(
          process.env.WHITELISTED_WALLET_PRIVATE_KEY! as Address,
          parseInt(process.env.SELLER_ENTITY_ID!),
          "" as Address,
        ),
      ).rejects.toThrow();
    });
  });

  describe("Configuration Constants", () => {
    beforeAll(async () => {
      if (!contractClient) {
        contractClient = await createContractClientV2();
      }
    });

    it("should have MAX_RETRIES set to 3", () => {
      expect(contractClient[`MAX_RETRIES`]).toBe(3);
    });

    it("should have PRIORITY_FEE_MULTIPLIER set to 2", () => {
      expect(contractClient[`PRIORITY_FEE_MULTIPLIER`]).toBe(2);
    });

    it("should have MAX_FEE_PER_GAS set to 20000000", () => {
      expect(contractClient[`MAX_FEE_PER_GAS`]).toBe(20000000);
    });

    it("should have MAX_PRIORITY_FEE_PER_GAS set to 21000000", () => {
      expect(contractClient[`MAX_PRIORITY_FEE_PER_GAS`]).toBe(21000000);
    });
  });

  describe("Random Nonce Generation", () => {
    beforeAll(async () => {
      if (!contractClient) {
        contractClient = await createContractClientV2();
      }
    });

    it("should generate nonce as BigInt", () => {
      const nonce = contractClient[`getRandomNonce`]();
      expect(typeof nonce).toBe("bigint");
    });

    it("should generate unique nonces on multiple calls", () => {
      const nonces = new Set();

      for (let i = 0; i < 10; i++) {
        const nonce = contractClient[`getRandomNonce`]();
        expect(typeof nonce).toBe("bigint");

        nonces.add(nonce.toString());
      }

      expect(nonces.size).toBe(10);
    });

    it("should generate nonce with default 152 bits", () => {
      const nonce = contractClient[`getRandomNonce`]();
      const nonceHex = nonce.toString(16);

      // 152 bits = 19 bytes = ~38 hex chars (may vary slightly due to leading zeros)
      expect(nonceHex.length).toBeGreaterThan(30);
      expect(nonceHex.length).toBeLessThanOrEqual(40);
    });

    it("should generate nonce with custom bit length", () => {
      const nonce64 = contractClient[`getRandomNonce`](64);
      const nonce128 = contractClient[`getRandomNonce`](128);

      expect(typeof nonce64).toBe("bigint");
      expect(typeof nonce128).toBe("bigint");

      expect(nonce64).toBeGreaterThan(BigInt(0));
      expect(nonce128).toBeGreaterThan(BigInt(0));
    });
  });

  describe("Gas Fee Calculation", () => {
    beforeAll(async () => {
      if (!contractClient) {
        contractClient = await createContractClientV2();
      }
    });

    it("should calculate gas fees correctly with default multiplier (2)", async () => {
      const computedGasFee = await (contractClient as any).calculateGasFees();
      const verifyGasFee =
        BigInt((contractClient as any).MAX_FEE_PER_GAS) +
        BigInt((contractClient as any).MAX_PRIORITY_FEE_PER_GAS) *
          BigInt(Math.max(0, contractClient[`PRIORITY_FEE_MULTIPLIER`] - 1));

      expect(computedGasFee).toBe(verifyGasFee);
    });
  });

  describe("Session Key Client Getter", () => {
    beforeAll(async () => {
      if (!contractClient) {
        contractClient = await AcpContractClientV2.build(
          process.env.WHITELISTED_WALLET_PRIVATE_KEY! as Address,
          parseInt(process.env.SELLER_ENTITY_ID!),
          process.env.SELLER_AGENT_WALLET_ADDRESS! as Address,
        );
      }
    });

    it("should return session key client after initialization", () => {
      // Access the getter
      const sessionKeyClient = (contractClient as any).sessionKeyClient;

      // Should be defined
      expect(sessionKeyClient).toBeDefined();

      // Should have the expected methods
      expect(sessionKeyClient.sendUserOperation).toBeDefined();
      expect(sessionKeyClient.account).toBeDefined();
    });

    it("should throw error when accessed before initialization", () => {
      // Create a brand new instance without calling build() or init()
      // We can't use 'new AcpContractClientV2()' directly because the constructor is private
      // So we create an empty object with the prototype
      const uninitializedClient = Object.create(AcpContractClientV2.prototype);

      // Accessing the getter should throw an error
      expect(() => {
        uninitializedClient.sessionKeyClient;
      }).toThrow("Session key client not initialized");
    });
  });

  describe("Contract Addresses Verification", () => {
    beforeAll(async () => {
      if (!contractClient) {
        contractClient = await AcpContractClientV2.build(
          process.env.WHITELISTED_WALLET_PRIVATE_KEY! as Address,
          parseInt(process.env.SELLER_ENTITY_ID!),
          process.env.SELLER_AGENT_WALLET_ADDRESS! as Address,
        );
      }
    });

    it("should have jobManagerAddress set", () => {
      const jobManagerAddress = (contractClient as any).jobManagerAddress;

      expect(jobManagerAddress).toBeDefined();
      expect(typeof jobManagerAddress).toBe("string");

      // Should be a valid EVM address (0x + 40 hex chars)
      expect(jobManagerAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it("should have memoManagerAddress set", () => {
      const memoManagerAddress = (contractClient as any).memoManagerAddress;

      expect(memoManagerAddress).toBeDefined();
      expect(typeof memoManagerAddress).toBe("string");
      expect(memoManagerAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it("should have accountManagerAddress set", () => {
      const accountManagerAddress = (contractClient as any)
        .accountManagerAddress;

      expect(accountManagerAddress).toBeDefined();
      expect(typeof accountManagerAddress).toBe("string");
      expect(accountManagerAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });
  });
});

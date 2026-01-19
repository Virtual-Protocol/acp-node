import { Address } from "viem";
import AcpContractClientV2 from "../../src/contractClients/acpContractClientV2";
import { AcpX402 } from "../../src/acpX402";
import {
  WHITELISTED_WALLET_PRIVATE_KEY,
  SELLER_ENTITY_ID,
  SELLER_AGENT_WALLET_ADDRESS,
} from "../env";
import {
  X402PayableRequest,
  X402PayableRequirements,
} from "../../src/interfaces";

describe("AcpX402 Integration Testing", () => {
  jest.setTimeout(60000); // 60 seconds for network operations

  let contractClient: AcpContractClientV2;
  let acpX402: AcpX402;

  beforeAll(async () => {
    // Add delay to avoid rate limiting from previous test suite
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Build and initialize the contract client with real credentials
    contractClient = await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY as Address,
      SELLER_ENTITY_ID,
      SELLER_AGENT_WALLET_ADDRESS as Address,
    );

    await contractClient.init(
      WHITELISTED_WALLET_PRIVATE_KEY as Address,
      SELLER_ENTITY_ID,
    );

    acpX402 = contractClient.acpX402;
  });

  afterAll(() => {
    contractClient = null as any;
    acpX402 = null as any;
  });

  describe("generatePayment", () => {
    it("should generate valid payment with real token metadata from blockchain", async () => {
      const mockPayableRequest: X402PayableRequest = {
        to: "0x9876543210987654321098765432109876543210" as Address,
        value: 1000000, // 1 USDC (6 decimals)
        maxTimeoutSeconds: 3600,
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address, // USDC on Base Sepolia
      };

      const mockRequirements: X402PayableRequirements = {
        x402Version: 1,
        error: "",
        accepts: [
          {
            scheme: "eip712",
            network: "base-sepolia",
            maxAmountRequired: "1000000",
            resource: "/api/test",
            description: "Test payment",
            mimeType: "application/json",
            payTo: "0x9876543210987654321098765432109876543210" as Address,
            maxTimeoutSeconds: 3600,
            asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
            extra: {
              name: "USD Coin",
              version: "2",
            },
            outputSchema: {},
          },
        ],
      };

      const result = await acpX402.generatePayment(
        mockPayableRequest,
        mockRequirements,
      );

      // Verify payment structure
      expect(result).toHaveProperty("encodedPayment");
      expect(result).toHaveProperty("signature");
      expect(result).toHaveProperty("message");

      // Verify signature format
      expect(result.signature).toMatch(/^0x[a-fA-F0-9]+$/);

      // Verify message structure
      expect(result.message).toHaveProperty("from");
      expect(result.message).toHaveProperty("to");
      expect(result.message).toHaveProperty("value");
      expect(result.message).toHaveProperty("validAfter");
      expect(result.message).toHaveProperty("validBefore");
      expect(result.message).toHaveProperty("nonce");

      // Verify message content
      expect(result.message.to).toBe(mockPayableRequest.to);
      expect(result.message.value).toBe(mockPayableRequest.value.toString());
      expect(result.message.nonce).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Verify encoded payment is valid base64
      expect(result.encodedPayment).toMatch(/^[A-Za-z0-9+/=]+$/);

      // Verify we can decode the payment
      const decodedPayment = JSON.parse(
        Buffer.from(result.encodedPayment, "base64").toString(),
      );
      expect(decodedPayment).toHaveProperty("x402Version");
      expect(decodedPayment).toHaveProperty("scheme");
      expect(decodedPayment).toHaveProperty("network");
      expect(decodedPayment).toHaveProperty("payload");
      expect(decodedPayment.payload).toHaveProperty("signature");
      expect(decodedPayment.payload).toHaveProperty("authorization");

      // Verify the signature in payload matches
      expect(decodedPayment.payload.signature).toBe(result.signature);
    });

    it("should fetch real token name and version from USDC contract", async () => {
      const mockPayableRequest: X402PayableRequest = {
        to: "0x9876543210987654321098765432109876543210" as Address,
        value: 500000,
        maxTimeoutSeconds: 3600,
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
      };

      const mockRequirements: X402PayableRequirements = {
        x402Version: 1,
        error: "",
        accepts: [
          {
            scheme: "eip712",
            network: "base-sepolia",
            maxAmountRequired: "1000000",
            resource: "/api/test",
            description: "Test payment",
            mimeType: "application/json",
            payTo: "0x9876543210987654321098765432109876543210" as Address,
            maxTimeoutSeconds: 3600,
            asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
            extra: {
              name: "USD Coin",
              version: "2",
            },
            outputSchema: {},
          },
        ],
      };

      // This will make a real multicall to the blockchain
      const result = await acpX402.generatePayment(
        mockPayableRequest,
        mockRequirements,
      );

      // Verify the payment was generated successfully
      expect(result.signature).toBeTruthy();
      expect(result.encodedPayment).toBeTruthy();

      // The fact that no error was thrown means multicall succeeded
      // and we got valid token metadata from the blockchain
    });

    it("should generate unique nonces for each payment", async () => {
      const mockPayableRequest: X402PayableRequest = {
        to: "0x9876543210987654321098765432109876543210" as Address,
        value: 100000,
        maxTimeoutSeconds: 3600,
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
      };

      const mockRequirements: X402PayableRequirements = {
        x402Version: 1,
        error: "",
        accepts: [
          {
            scheme: "eip712",
            network: "base-sepolia",
            maxAmountRequired: "1000000",
            resource: "/api/test",
            description: "Test payment",
            mimeType: "application/json",
            payTo: "0x9876543210987654321098765432109876543210" as Address,
            maxTimeoutSeconds: 3600,
            asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
            extra: {
              name: "USD Coin",
              version: "2",
            },
            outputSchema: {},
          },
        ],
      };

      // Generate two payments
      const payment1 = await acpX402.generatePayment(
        mockPayableRequest,
        mockRequirements,
      );
      const payment2 = await acpX402.generatePayment(
        mockPayableRequest,
        mockRequirements,
      );

      // Nonces should be different
      expect(payment1.message.nonce).not.toBe(payment2.message.nonce);

      // Signatures should be different (because nonces are different)
      expect(payment1.signature).not.toBe(payment2.signature);

      // Encoded payments should be different
      expect(payment1.encodedPayment).not.toBe(payment2.encodedPayment);
    });
  });

  describe("signUpdateJobNonceMessage", () => {
    it("should sign message with real session key client", async () => {
      const jobId = 12345;
      const nonce = "test-integration-nonce";

      const signature = await acpX402.signUpdateJobNonceMessage(jobId, nonce);

      // Verify signature format
      expect(signature).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(signature.length).toBeGreaterThan(10);
    });
  });

  describe("performRequest", () => {
    it("should throw error when x402 url is not configured", async () => {
      // This test verifies the config validation works in real environment
      const configWithoutX402 = {
        ...contractClient["config"],
        x402Config: undefined,
      };

      const acpX402WithoutUrl = new AcpX402(
        configWithoutX402,
        contractClient["sessionKeyClient"],
        contractClient["publicClient"],
      );

      await expect(
        acpX402WithoutUrl.performRequest("/test", "v1"),
      ).rejects.toThrow("X402 URL not configured");
    });

    // Note: Testing actual X402 requests would require a live X402 server
    // and potentially incur real costs. These tests are commented out but
    // can be enabled for manual testing against a test server.

    /*
    it("should handle 402 payment required response from real server", async () => {
      // This would require a real X402 endpoint that returns 402
      const result = await acpX402.performRequest(
        "/api/test-endpoint",
        "v1"
      );

      if (result.isPaymentRequired) {
        expect(result.data).toHaveProperty("x402Version");
        expect(result.data).toHaveProperty("accepts");
      }
    });

    it("should perform successful request with payment", async () => {
      // Step 1: Make initial request to get payment requirements
      const initialResult = await acpX402.performRequest(
        "/api/test-endpoint",
        "v1"
      );

      if (initialResult.isPaymentRequired) {
        // Step 2: Generate payment
        const payableRequest: X402PayableRequest = {
          to: initialResult.data.accepts[0].payTo,
          value: parseInt(initialResult.data.accepts[0].maxAmountRequired),
          maxTimeoutSeconds: initialResult.data.accepts[0].maxTimeoutSeconds,
          asset: initialResult.data.accepts[0].asset,
        };

        const payment = await acpX402.generatePayment(
          payableRequest,
          initialResult.data
        );

        // Step 3: Retry request with payment
        const finalResult = await acpX402.performRequest(
          "/api/test-endpoint",
          "v1",
          payableRequest.value.toString(),
          payment.encodedPayment
        );

        expect(finalResult.isPaymentRequired).toBe(false);
        expect(finalResult.data).toBeDefined();
      }
    });
    */
  });

  describe("updateJobNonce", () => {
    // Note: This test requires a valid job ID which would need to be created
    // first through the normal job flow. Commenting out but keeping as reference.

    /*
    it("should update job nonce via real API", async () => {
      // This would require creating a real job first
      const jobId = 12345; // Replace with actual job ID
      const newNonce = `nonce-${Date.now()}`;

      const result = await acpX402.updateJobNonce(jobId, newNonce);

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("x402Nonce");
      expect(result.x402Nonce).toBe(newNonce);
    });
    */

    it("should format and sign nonce update message correctly", async () => {
      // Even without updating a real job, we can verify the signing works
      const jobId = 99999;
      const nonce = `test-nonce-${Date.now()}`;

      const signature = await acpX402.signUpdateJobNonceMessage(jobId, nonce);

      // Verify signature was generated
      expect(signature).toMatch(/^0x[a-fA-F0-9]+$/);
    });
  });
});

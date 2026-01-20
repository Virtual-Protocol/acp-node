// Mock crypto module before imports
jest.mock("crypto", () => ({
  randomBytes: jest.fn(),
}));

// Mock fetch globally
global.fetch = jest.fn();

import { Address } from "viem";
import { AcpX402 } from "../../src/acpX402";
import AcpError from "../../src/acpError";
import { baseSepoliaAcpX402ConfigV2 } from "../../src/configs/acpConfigs";
import {
  X402PayableRequest,
  X402PayableRequirements,
} from "../../src/interfaces";
import { randomBytes } from "crypto";

describe("AcpX402 Unit Testing", () => {
  let acpX402: AcpX402;
  let mockSessionKeyClient: any;
  let mockPublicClient: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSessionKeyClient = {
      account: {
        address: "0x1234567890123456789012345678901234567890" as Address,
        getSigner: jest.fn().mockReturnValue({
          signMessage: jest.fn(),
        }),
      },
      signTypedData: jest.fn(),
    };

    mockPublicClient = {
      multicall: jest.fn(),
    };

    acpX402 = new AcpX402(
      baseSepoliaAcpX402ConfigV2,
      mockSessionKeyClient,
      mockPublicClient,
    );
  });

  describe("Constructor", () => {
    it("should initialize with valid parameters", () => {
      expect(acpX402).toBeInstanceOf(AcpX402);
      expect(acpX402["config"]).toBe(baseSepoliaAcpX402ConfigV2);
      expect(acpX402["sessionKeyClient"]).toBe(mockSessionKeyClient);
      expect(acpX402["publicClient"]).toBe(mockPublicClient);
    });
  });

  describe("signUpdateJobNonceMessage", () => {
    it("should format message correctly and return valid signature", async () => {
      const jobId = 123;
      const nonce = "test-nonce-123";
      const expectedSignature = "0xabcdef" as `0x${string}`;

      mockSessionKeyClient.account
        .getSigner()
        .signMessage.mockResolvedValue(expectedSignature);

      const signature = await acpX402.signUpdateJobNonceMessage(jobId, nonce);

      expect(mockSessionKeyClient.account.getSigner).toHaveBeenCalled();
      expect(
        mockSessionKeyClient.account.getSigner().signMessage,
      ).toHaveBeenCalledWith(`${jobId}-${nonce}`);
      expect(signature).toBe(expectedSignature);
    });

    it("should throw error when signing fails", async () => {
      const jobId = 123;
      const nonce = "test-nonce-123";
      const mockError = new Error("Signing failed");

      mockSessionKeyClient.account
        .getSigner()
        .signMessage.mockRejectedValue(mockError);

      await expect(
        acpX402.signUpdateJobNonceMessage(jobId, nonce),
      ).rejects.toThrow(mockError);
    });
  });

  describe("updateJobNonce", () => {
    it("should update job nonce successfully with correct headers and body", async () => {
      const jobId = 456;
      const nonce = "new-nonce-456";
      const signature = "0x123456" as `0x${string}`;
      const mockResponse = {
        id: jobId,
        x402Nonce: nonce,
      };

      mockSessionKeyClient.account
        .getSigner()
        .signMessage.mockResolvedValue(signature);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponse),
      });

      const result = await acpX402.updateJobNonce(jobId, nonce);

      expect(global.fetch).toHaveBeenCalledWith(
        `${baseSepoliaAcpX402ConfigV2.acpUrl}/api/jobs/${jobId}/x402-nonce`,
        {
          method: "POST",
          headers: {
            "x-signature": signature,
            "x-nonce": nonce,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            data: {
              nonce,
            },
          }),
        },
      );
      expect(result).toEqual(mockResponse);
    });

    it("should throw AcpError when response is not ok", async () => {
      const jobId = 456;
      const nonce = "new-nonce-456";
      const signature = "0x123456" as `0x${string}`;

      mockSessionKeyClient.account
        .getSigner()
        .signMessage.mockResolvedValue(signature);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        statusText: "Bad Request",
      });

      await expect(acpX402.updateJobNonce(jobId, nonce)).rejects.toThrow(
        AcpError,
      );
      await expect(acpX402.updateJobNonce(jobId, nonce)).rejects.toThrow(
        "Failed to update job X402 nonce",
      );
    });

    it("should throw AcpError when fetch fails", async () => {
      const jobId = 456;
      const nonce = "new-nonce-456";
      const mockError = new Error("Network error");

      mockSessionKeyClient.account
        .getSigner()
        .signMessage.mockResolvedValue("0x123456");

      (global.fetch as jest.Mock).mockRejectedValue(mockError);

      await expect(acpX402.updateJobNonce(jobId, nonce)).rejects.toThrow(
        AcpError,
      );
      await expect(acpX402.updateJobNonce(jobId, nonce)).rejects.toThrow(
        "Failed to update job X402 nonce",
      );
    });
  });

  describe("generatePayment", () => {
    const mockPayableRequest: X402PayableRequest = {
      to: "0x9876543210987654321098765432109876543210" as Address,
      value: 1000000,
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

    beforeEach(() => {
      // Mock randomBytes to return predictable values
      (randomBytes as jest.Mock).mockReturnValue(
        Buffer.from("a".repeat(64), "hex"),
      );
    });

    it("should generate payment successfully with correct structure", async () => {
      const mockSignature = "0xsignature123" as `0x${string}`;

      mockPublicClient.multicall.mockResolvedValue([
        { result: "USD Coin" },
        { result: "2" },
      ]);

      mockSessionKeyClient.signTypedData.mockResolvedValue(mockSignature);

      const result = await acpX402.generatePayment(
        mockPayableRequest,
        mockRequirements,
      );

      expect(result).toHaveProperty("encodedPayment");
      expect(result).toHaveProperty("signature");
      expect(result).toHaveProperty("message");
      expect(result.signature).toBe(mockSignature);
      expect(result.message.from).toBe(mockSessionKeyClient.account.address);
      expect(result.message.to).toBe(mockPayableRequest.to);
      expect(result.message.value).toBe(mockPayableRequest.value.toString());
    });

    it("should call multicall to fetch token name and version", async () => {
      const mockSignature = "0xsignature123" as `0x${string}`;

      mockPublicClient.multicall.mockResolvedValue([
        { result: "USD Coin" },
        { result: "2" },
      ]);

      mockSessionKeyClient.signTypedData.mockResolvedValue(mockSignature);

      await acpX402.generatePayment(mockPayableRequest, mockRequirements);

      expect(mockPublicClient.multicall).toHaveBeenCalledWith({
        contracts: [
          {
            address: baseSepoliaAcpX402ConfigV2.baseFare.contractAddress,
            abi: expect.any(Array),
            functionName: "name",
          },
          {
            address: baseSepoliaAcpX402ConfigV2.baseFare.contractAddress,
            abi: expect.any(Array),
            functionName: "version",
          },
        ],
      });
    });

    it("should generate valid EIP-712 signature", async () => {
      const mockSignature = "0xsignature123" as `0x${string}`;

      mockPublicClient.multicall.mockResolvedValue([
        { result: "USD Coin" },
        { result: "2" },
      ]);

      mockSessionKeyClient.signTypedData.mockResolvedValue(mockSignature);

      await acpX402.generatePayment(mockPayableRequest, mockRequirements);

      expect(mockSessionKeyClient.signTypedData).toHaveBeenCalledWith({
        typedData: expect.objectContaining({
          types: expect.objectContaining({
            TransferWithAuthorization: expect.any(Array),
          }),
          domain: expect.objectContaining({
            name: "USD Coin",
            version: "2",
            chainId: baseSepoliaAcpX402ConfigV2.chain.id,
            verifyingContract:
              baseSepoliaAcpX402ConfigV2.baseFare.contractAddress,
          }),
          primaryType: "TransferWithAuthorization",
          message: expect.objectContaining({
            from: mockSessionKeyClient.account.address,
            to: mockPayableRequest.to,
            value: mockPayableRequest.value.toString(),
          }),
        }),
      });
    });

    it("should encode payment as base64", async () => {
      const mockSignature = "0xsignature123" as `0x${string}`;

      mockPublicClient.multicall.mockResolvedValue([
        { result: "USD Coin" },
        { result: "2" },
      ]);

      mockSessionKeyClient.signTypedData.mockResolvedValue(mockSignature);

      const result = await acpX402.generatePayment(
        mockPayableRequest,
        mockRequirements,
      );

      // Verify it's a valid base64 string
      expect(result.encodedPayment).toMatch(/^[A-Za-z0-9+/=]+$/);

      // Verify we can decode it back
      const decoded = JSON.parse(
        Buffer.from(result.encodedPayment, "base64").toString(),
      );
      expect(decoded).toHaveProperty("x402Version");
      expect(decoded).toHaveProperty("scheme");
      expect(decoded).toHaveProperty("network");
      expect(decoded).toHaveProperty("payload");
    });

    it("should throw AcpError when multicall fails", async () => {
      const mockError = new Error("Multicall failed");

      mockPublicClient.multicall.mockRejectedValue(mockError);

      await expect(
        acpX402.generatePayment(mockPayableRequest, mockRequirements),
      ).rejects.toThrow(AcpError);
      await expect(
        acpX402.generatePayment(mockPayableRequest, mockRequirements),
      ).rejects.toThrow("Failed to generate X402 payment");
    });

    it("should throw AcpError when signing fails", async () => {
      const mockError = new Error("Signing failed");

      mockPublicClient.multicall.mockResolvedValue([
        { result: "USD Coin" },
        { result: "2" },
      ]);

      mockSessionKeyClient.signTypedData.mockRejectedValue(mockError);

      await expect(
        acpX402.generatePayment(mockPayableRequest, mockRequirements),
      ).rejects.toThrow(AcpError);
      await expect(
        acpX402.generatePayment(mockPayableRequest, mockRequirements),
      ).rejects.toThrow("Failed to generate X402 payment");
    });
  });

  describe("performRequest", () => {
    const testUrl = "/api/test";
    const testVersion = "v1";
    const testBudget = "1000000";
    const testSignature = "payment-signature-123";

    it("should throw AcpError when x402 url is not configured", async () => {
      // Create instance without x402Config
      const configWithoutX402 = {
        ...baseSepoliaAcpX402ConfigV2,
        x402Config: undefined,
      };
      const acpX402WithoutUrl = new AcpX402(
        configWithoutX402,
        mockSessionKeyClient,
        mockPublicClient,
      );

      await expect(
        acpX402WithoutUrl.performRequest(testUrl, testVersion),
      ).rejects.toThrow(AcpError);
      await expect(
        acpX402WithoutUrl.performRequest(testUrl, testVersion),
      ).rejects.toThrow("X402 URL not configured");
    });

    it("should perform request successfully with all headers", async () => {
      const mockData = { result: "success" };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockData),
      });

      const result = await acpX402.performRequest(
        testUrl,
        testVersion,
        testBudget,
        testSignature,
      );

      expect(global.fetch).toHaveBeenCalledWith(
        `${baseSepoliaAcpX402ConfigV2.x402Config!.url}${testUrl}`,
        {
          method: "GET",
          headers: {
            "x-payment": testSignature,
            "x-budget": testBudget,
            "x-acp-version": testVersion,
          },
        },
      );
      expect(result).toEqual({
        isPaymentRequired: false,
        data: mockData,
      });
    });

    it("should handle optional budget and signature parameters", async () => {
      const mockData = { result: "success" };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockData),
      });

      await acpX402.performRequest(testUrl, testVersion);

      expect(global.fetch).toHaveBeenCalledWith(
        `${baseSepoliaAcpX402ConfigV2.x402Config!.url}${testUrl}`,
        {
          method: "GET",
          headers: {
            "x-acp-version": testVersion,
          },
        },
      );
    });

    it("should return isPaymentRequired: true when status is 402", async () => {
      const mockData = {
        x402Version: 1,
        error: "Payment required",
        accepts: [],
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 402,
        json: jest.fn().mockResolvedValue(mockData),
      });

      const result = await acpX402.performRequest(testUrl, testVersion);

      expect(result).toEqual({
        isPaymentRequired: true,
        data: mockData,
      });
    });

    it("should return isPaymentRequired: false when response is ok", async () => {
      const mockData = { result: "success" };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockData),
      });

      const result = await acpX402.performRequest(testUrl, testVersion);

      expect(result.isPaymentRequired).toBe(false);
      expect(result.data).toEqual(mockData);
    });

    it("should throw AcpError when response status is invalid (not ok AND not 402)", async () => {
      const mockData = { error: "Server error" };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue(mockData),
      });

      await expect(
        acpX402.performRequest(testUrl, testVersion),
      ).rejects.toThrow(AcpError);
      await expect(
        acpX402.performRequest(testUrl, testVersion),
      ).rejects.toThrow("Invalid response status code for X402 request");
    });
  });
});

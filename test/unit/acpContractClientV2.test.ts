jest.mock("viem", () => ({
  ...jest.requireActual("viem"),
  decodeEventLog: jest.fn(),
}));

import { Address } from "viem";
import AcpContractClientV2 from "../../src/contractClients/acpContractClientV2";
import { baseAcpConfigV2 } from "../../src/configs/acpConfigs";
import AcpError from "../../src/acpError";
import { OperationPayload } from "../../src/contractClients/baseAcpContractClient";

describe("AcpContractClient V2 Unit Testing", () => {
  let contractClient: AcpContractClientV2;

  beforeEach(() => {
    contractClient = new AcpContractClientV2(
      "0x1111111111111111111111111111111111111111" as Address,
      "0x2222222222222222222222222222222222222222" as Address,
      "0x3333333333333333333333333333333333333333" as Address,
      "0x4444444444444444444444444444444444444444" as Address,
      baseAcpConfigV2
    );
  });
  describe("Random Nonce Generation", () => {
    it("should return a BigInt", () => {
      const nonce = contractClient.getRandomNonce(152);

      expect(typeof nonce).toBe("bigint");
    });

    it("should generate unique nonces", () => {
      const firstNonce = contractClient.getRandomNonce(152);
      const secondNonce = contractClient.getRandomNonce(152);

      expect(firstNonce).not.toBe(secondNonce);
    });

    it("should use 152 as default bit size", () => {
      const nonce = contractClient.getRandomNonce();

      expect(nonce).toBeLessThan(2n ** 152n);
      expect(nonce).toBeGreaterThanOrEqual(0n);
    });

    it("should handle custom bit sizes", () => {
      const nonce = contractClient.getRandomNonce(8); // 8 bits = 1 byte

      expect(typeof nonce).toBe("bigint");
      expect(nonce).toBeLessThan(2n ** 8n); // Less than 256
      expect(nonce).toBeGreaterThanOrEqual(0n);
    });
  });

  describe("Gas Fee Calculation", () => {
    it("should calculate gas fees correctly", async () => {
      const calculatedGasFee = await contractClient["calculateGasFees"]();

      // Expected calculation: 20000000 + (2100000 * max(0, 2-1))
      expect(calculatedGasFee).toBe(41000000n);
    });

    it("should return BigInt", async () => {
      const calculatedGasFee = await contractClient[`calculateGasFees`]();

      expect(typeof calculatedGasFee).toBe("bigint");
    });
  });

  describe("getJobId", () => {
    it("should return job ID from transaction receipt", async () => {
      const mockJobUserOpHash = "0xabc123" as Address;
      const mockClientAddress = "0xclient" as Address;
      const mockProviderAddress = "0xprovider" as Address;
      const mockReturnedJobId = 42;

      const mockReceipt = {
        logs: [
          {
            address: contractClient["jobManagerAddress"],
            data: "0xdata",
            topics: ["0xtopic"],
          },
          {
            address: "0xOtherContractAddress",
            data: "0x...",
            topics: ["0x..."],
          },
        ],
      };

      const mockGetUserOperationReceipt = jest
        .fn()
        .mockResolvedValue(mockReceipt);

      contractClient["_sessionKeyClient"] = {
        getUserOperationReceipt: mockGetUserOperationReceipt,
      } as any;

      // Mock decodeEventLog from viem
      const { decodeEventLog } = require("viem");
      (decodeEventLog as jest.Mock).mockReturnValue({
        eventName: "JobCreated",
        args: {
          jobId: mockReturnedJobId,
          client: mockClientAddress,
          provider: mockProviderAddress,
        },
      });

      const result = await contractClient.getJobId(
        mockJobUserOpHash,
        mockClientAddress,
        mockProviderAddress
      );

      expect(mockGetUserOperationReceipt).toHaveBeenCalledWith(
        mockJobUserOpHash,
        "pending"
      );

      expect(result).toBe(mockReturnedJobId);
    });
  });

  describe("Handling Operations", () => {
    it("should retry until MAX_RETRIES (default 3)", async () => {
      /**
       * Because of the retry logic in SDK having increased timings for retries
       * Fake timers is used to fast forward the operation
       */
      jest.useFakeTimers();

      const mockOperation: OperationPayload = {
        contractAddress:
          "0x1111111111111111111111111111111111111111" as Address,
        data: "0x1111111111111111111111111111111111111111",
        value: 0n,
      };

      const mockSendUserOperation = jest
        .fn()
        .mockRejectedValueOnce(new Error("Attempt 1 Failed"))
        .mockRejectedValueOnce(new Error("Attempt 2 Failed"))
        .mockRejectedValueOnce(new Error("Attempt 3 Failed"));

      contractClient["_sessionKeyClient"] = {
        sendUserOperation: mockSendUserOperation,
      } as any;

      // Start the operation and immediately set up the expectation
      const operationPromise = expect(
        contractClient.handleOperation([mockOperation])
      ).rejects.toThrow(AcpError);

      await jest.runAllTimersAsync();

      await operationPromise;
      expect(mockSendUserOperation).toHaveBeenCalledTimes(3);

      jest.useRealTimers();
    });

    it("should able to successfully handle operations", async () => {
      const mockOperation: OperationPayload = {
        contractAddress:
          "0x1111111111111111111111111111111111111111" as Address,
        data: "0x1111111111111111111111111111111111111111",
        value: 0n,
      };

      const mockHash = "0xabc123" as Address;
      const mockTxnHash = "0xdef456" as Address;

      const mockSendUserOperation = jest.fn().mockResolvedValueOnce({
        hash: mockHash,
      });

      const mockWaitForUserOperation = jest
        .fn()
        .mockResolvedValueOnce(mockTxnHash);

      contractClient["_sessionKeyClient"] = {
        sendUserOperation: mockSendUserOperation,
        waitForUserOperationTransaction: mockWaitForUserOperation,
      } as any;

      const response = await contractClient.handleOperation([mockOperation]);

      // Verify the response structure
      expect(response).toEqual({
        userOpHash: mockHash,
        txnHash: mockTxnHash,
      });

      expect(mockSendUserOperation).toHaveBeenCalledTimes(1);

      expect(mockWaitForUserOperation).toHaveBeenCalledWith({
        hash: mockHash,
        tag: "pending",
        retries: {
          intervalMs: 200,
          multiplier: 1.1,
          maxRetries: 10,
        },
      });
    });

    it("should able to increase maxFeePerGas multiplier during retries", async () => {
      jest.useFakeTimers();

      const mockOperation: OperationPayload = {
        contractAddress:
          "0x1111111111111111111111111111111111111111" as Address,
        data: "0x1111111111111111111111111111111111111111",
        value: 0n,
      };

      const mockHash = "0xabc123" as Address;
      const mockTxnHash = "0xdef456" as Address;

      // Fail once, then succeed
      const mockSendUserOperation = jest
        .fn()
        .mockRejectedValueOnce(new Error("Attempt 1 Failed"))
        .mockRejectedValueOnce(new Error("Attempt 2 Failed"))
        .mockResolvedValueOnce({ hash: mockHash });

      const mockWaitForUserOperation = jest
        .fn()
        .mockResolvedValueOnce(mockTxnHash);

      contractClient["_sessionKeyClient"] = {
        sendUserOperation: mockSendUserOperation,
        waitForUserOperationTransaction: mockWaitForUserOperation,
      } as any;

      const operationPromise = contractClient.handleOperation([mockOperation]);

      await jest.runAllTimersAsync();

      await operationPromise;

      expect(mockSendUserOperation).toHaveBeenCalledTimes(3);

      // Verify multipliers increase with each iteration
      // iteration 0: multiplier = 1 + 0.1 * (0 + 1) = 1.1
      // iteration 1: multiplier = 1 + 0.1 * (1 + 1) = 1.2
      // iteration 2: multiplier = 1 + 0.1 * (2 + 1) = 1.3
      expect(mockSendUserOperation).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          overrides: expect.objectContaining({
            maxFeePerGas: { multiplier: 1.1 },
            maxPriorityFeePerGas: { multiplier: 1.1 },
          }),
        })
      );

      expect(mockSendUserOperation).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          overrides: expect.objectContaining({
            maxFeePerGas: { multiplier: 1.2 },
            maxPriorityFeePerGas: { multiplier: 1.2 },
          }),
        })
      );

      expect(mockSendUserOperation).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          overrides: expect.objectContaining({
            maxFeePerGas: { multiplier: 1.3 },
            maxPriorityFeePerGas: { multiplier: 1.3 },
          }),
        })
      );

      jest.useRealTimers();
    });
  });

  describe("x402 Implementations", () => {
    it("should perform x402 request successfully", async () => {
      const mockUrl = "https://example.com";
      const mockVersion = "v2";
      const mockBudget = "100";
      const mockSignature = "greetings";
      const mockResponse = { status: "success" };

      const mockPerformRequest = jest.fn().mockResolvedValueOnce(mockResponse);

      contractClient[`_acpX402`] = {
        performRequest: mockPerformRequest,
      } as any;

      const results = await contractClient.performX402Request(
        mockUrl,
        mockVersion,
        mockBudget,
        mockSignature
      );

      expect(mockPerformRequest).toHaveBeenCalledWith(
        mockUrl,
        mockVersion,
        mockBudget,
        mockSignature
      );

      expect(results).toBe(mockResponse);
    });

    it("should generate x402 payment successfully", async () => {
      const mockX402PayableRequest = {} as any;
      const mockX402PayableRequirements = {} as any;
      const mockResponse = { status: "success " } as any;

      const mockGenerateX402Payment = jest
        .fn()
        .mockResolvedValueOnce(mockResponse);

      contractClient[`_acpX402`] = {
        generatePayment: mockGenerateX402Payment,
      } as any;

      const results = await contractClient.generateX402Payment(
        mockX402PayableRequest,
        mockX402PayableRequirements
      );

      expect(mockGenerateX402Payment).toHaveBeenCalledWith(
        mockX402PayableRequest,
        mockX402PayableRequirements
      );

      expect(results).toBe(mockResponse);
    });

    it("should get x402 payment details successfully", async () => {
      const mockJobId = 1;
      const mockContractResult = [true, false] as [boolean, boolean];

      const mockReadContract = jest
        .fn()
        .mockResolvedValueOnce(mockContractResult);
      contractClient[`publicClient`] = {
        readContract: mockReadContract,
      } as any;

      const result = await contractClient.getX402PaymentDetails(mockJobId);

      expect(mockReadContract).toHaveBeenCalledWith({
        address: contractClient[`jobManagerAddress`],
        abi: expect.any(Array),
        functionName: "x402PaymentDetails",
        args: [BigInt(mockJobId)],
      });

      expect(result).toEqual({
        isX402: true,
        isBudgetReceived: false,
      });
    });

    it("should throw AcpError when contract read fails", async () => {
      const mockJobId = 123;
      const mockError = new Error("Contract read failed");

      // Mock publicClient.readContract to throw
      const mockReadContract = jest.fn().mockRejectedValue(mockError);

      contractClient["publicClient"] = {
        readContract: mockReadContract,
      } as any;

      // Expect it to throw AcpError
      await expect(
        contractClient.getX402PaymentDetails(mockJobId)
      ).rejects.toThrow(AcpError);

      // Also verify the error message
      await expect(
        contractClient.getX402PaymentDetails(mockJobId)
      ).rejects.toThrow("Failed to get X402 payment details");
    });

    it("should update x402 job nonce successfully", async () => {
      const mockJobIdNumber = 1;
      const mockNonce = "pineappleonpizza";
      const mockResponse = { status: "success" } as any;

      const mockUpdateJobNonce = jest.fn().mockResolvedValueOnce(mockResponse);

      contractClient[`_acpX402`] = {
        updateJobNonce: mockUpdateJobNonce,
      } as any;

      const results = await contractClient.updateJobX402Nonce(
        mockJobIdNumber,
        mockNonce
      );

      expect(mockUpdateJobNonce).toHaveBeenCalledWith(
        mockJobIdNumber,
        mockNonce
      );
      expect(results).toBe(mockResponse);
    });
  });

  describe("Getters Methods", () => {
    describe("sessionKeyClient", () => {
      it("should return the client when initialized", () => {
        // Set up a mock client
        const mockClient = {
          sendUserOperation: jest.fn(),
          waitForUserOperationTransaction: jest.fn(),
        } as any;

        contractClient["_sessionKeyClient"] = mockClient;

        // Should return the mock client
        expect(contractClient.sessionKeyClient).toBe(mockClient);
      });

      it("should throw error when not initialized", () => {
        expect(() => {
          contractClient.sessionKeyClient;
        }).toThrow(AcpError);

        expect(() => {
          contractClient.sessionKeyClient;
        }).toThrow("Session key client not initialized");
      });
    });
    describe("acpX402", () => {
      it("should return an instance when initialized", () => {
        const mockAcpX402 = {
          updateJobNonce: jest.fn(),
          generatePayment: jest.fn(),
          performRequest: jest.fn(),
        } as any;

        contractClient["_acpX402"] = mockAcpX402;

        expect(contractClient.acpX402).toBeDefined();
        expect(contractClient.acpX402).toBe(mockAcpX402);
      });

      it("should throw error when not initialized", () => {
        expect(() => {
          contractClient.acpX402;
        }).toThrow(Error);

        expect(() => {
          contractClient.acpX402;
        }).toThrow("ACP X402 not initialized");
      });
    });
  });
});

jest.mock("../../src/configs/acpConfigs", () => ({
  baseSepoliaAcpConfig: {
    contractAddress: "0x8Db6B1c839Fc8f6bd35777E194677B67b4D51928",
  },
  baseSepoliaAcpX402Config: {
    contractAddress: "0xSepoliaX402",
  },
  baseAcpConfig: {
    contractAddress: "0xBaseAcp",
  },
  baseAcpX402Config: {
    contractAddress: "0xBaseX402",
  },
}));

import { Address } from "viem";
import { baseSepolia } from "viem/chains";
import AcpJobOffering, { PriceType } from "../../src/acpJobOffering";
import { BaseAcpContractClient } from "../../src";
import AcpClient from "../../src/acpClient";
import AcpError from "../../src/acpError";

describe("AcpJobOffering Unit Testing", () => {
  let mockAcpClient: AcpClient;
  let mockContractClient: jest.Mocked<BaseAcpContractClient>;

  beforeEach(() => {
    const mockFare = {
      contractAddress: "0xFareToken" as Address,
      decimals: 6,
      formatAmount: jest.fn((amount: number) => BigInt(amount * 1e6)),
    };

    mockContractClient = {
      contractAddress: "0x1234567890123456789012345678901234567890" as Address,
      walletAddress: "0x0987654321098765432109876543210987654321" as Address,
      config: {
        acpUrl: "https://test-acp-url.com",
        contractAddress:
          "0x1234567890123456789012345678901234567890" as Address,
        chain: baseSepolia,
        baseFare: mockFare,
      },
      handleOperation: jest.fn(),
      getJobId: jest.fn(),
      createJob: jest.fn(),
      createJobWithAccount: jest.fn(),
      setBudgetWithPaymentToken: jest.fn(),
      createMemo: jest.fn(),
    } as any;

    mockAcpClient = new AcpClient({
      acpContractClient: mockContractClient,
    });

    jest.spyOn(mockAcpClient, "getByClientAndProvider").mockResolvedValue(null);
  });

  describe("Constructor", () => {
    it("should create instance with all required parameters", () => {
      const offering = new AcpJobOffering(
        mockAcpClient,
        mockContractClient,
        "0xProvider" as Address,
        "MockJob",
        100,
        PriceType.FIXED,
      );

      expect(offering).toBeInstanceOf(AcpJobOffering);
      expect(offering.providerAddress).toBe("0xProvider");
      expect(offering.name).toBe("MockJob");
      expect(offering.price).toBe(100);
      expect(offering.priceType).toBe(PriceType.FIXED);
      expect(offering.requirement).toBe(undefined);
    });

    it("should use default priceType of FIXED", () => {
      const offering = new AcpJobOffering(
        mockAcpClient,
        mockContractClient,
        "0xProvider" as Address,
        "MockJob",
        100,
      );

      expect(offering).toBeInstanceOf(AcpJobOffering);
      expect(offering.priceType).toBe(PriceType.FIXED);
    });

    it("should accept custom priceType", () => {
      const offering = new AcpJobOffering(
        mockAcpClient,
        mockContractClient,
        "0xProvider" as Address,
        "MockJob",
        100,
        PriceType.PERCENTAGE,
      );

      expect(offering.priceType).toBe(PriceType.PERCENTAGE);
    });

    it("should accept requirement as string", () => {
      const offering = new AcpJobOffering(
        mockAcpClient,
        mockContractClient,
        "0xProvider" as Address,
        "MockJob",
        100,
        undefined,
        "custom requirement",
      );

      expect(offering).toBeInstanceOf(AcpJobOffering);
      expect(offering.requirement).toBe("custom requirement");
    });

    it("should accept requirement as JSON schema object", () => {
      const requirementObject = {
        type: "funds_transfer",
        details: "This is a mock funds transfer job",
      };

      const offering = new AcpJobOffering(
        mockAcpClient,
        mockContractClient,
        "0xProvider" as Address,
        "MockJob",
        100,
        undefined,
        requirementObject,
      );

      expect(offering).toBeInstanceOf(AcpJobOffering);
      expect(offering.requirement).toBe(requirementObject);
    });
  });

  describe("initiateJob", () => {
    it("should create job successfully", async () => {
      const mockUserOpHash = "0xmockUserOpHash";
      const mockJobId = 12345;
      const mockCreateJobPayload = { data: "createJobPayload" };
      const mockSetBudgetPayload = { data: "setBudgetPayload" };
      const mockMemoPayload = { data: "memoPayload" };

      mockContractClient.createJob.mockReturnValue(mockCreateJobPayload as any);
      mockContractClient.handleOperation.mockResolvedValue({
        userOpHash: mockUserOpHash,
      } as any);
      mockContractClient.getJobId.mockResolvedValue(mockJobId);
      mockContractClient.setBudgetWithPaymentToken.mockReturnValue(
        mockSetBudgetPayload as any,
      );
      mockContractClient.createMemo.mockReturnValue(mockMemoPayload as any);

      const offering = new AcpJobOffering(
        mockAcpClient,
        mockContractClient,
        "0xProvider" as Address,
        "Generate Image",
        100,
        undefined,
      );

      const result = await offering.initiateJob(
        "generate an image about Virtuals",
      );

      expect(result).toBe(mockJobId);
      expect(mockContractClient.createJob).toHaveBeenCalledTimes(1);
      expect(mockContractClient.handleOperation).toHaveBeenCalledTimes(2);
      expect(mockContractClient.handleOperation).toHaveBeenNthCalledWith(1, [
        mockCreateJobPayload,
      ]);
      expect(mockContractClient.handleOperation).toHaveBeenNthCalledWith(2, [
        mockSetBudgetPayload,
        mockMemoPayload,
      ]);
      expect(mockContractClient.getJobId).toHaveBeenCalledWith(
        mockUserOpHash,
        mockContractClient.walletAddress,
        "0xProvider",
      );
    });

    it("should validate against JSON schema when requirement is an object", async () => {
      const mockUserOpHash = "0xmockUserOpHash";
      const mockJobId = 12345;
      const mockCreateJobPayload = { data: "createJobPayload" };
      const mockSetBudgetPayload = { data: "setBudgetPayload" };
      const mockMemoPayload = { data: "memoPayload" };

      mockContractClient.createJob.mockReturnValue(mockCreateJobPayload as any);
      mockContractClient.handleOperation.mockResolvedValue({
        userOpHash: mockUserOpHash,
      } as any);
      mockContractClient.getJobId.mockResolvedValue(mockJobId);
      mockContractClient.setBudgetWithPaymentToken.mockReturnValue(
        mockSetBudgetPayload as any,
      );
      mockContractClient.createMemo.mockReturnValue(mockMemoPayload as any);

      const requirementSchema = {
        type: "object",
        properties: {
          prompt: { type: "string" },
          style: { type: "string" },
        },
        required: ["prompt"],
      };

      const offering = new AcpJobOffering(
        mockAcpClient,
        mockContractClient,
        "0xProvider" as Address,
        "Generate Image",
        100,
        PriceType.FIXED,
        requirementSchema,
      );

      const validServiceRequirement = {
        prompt: "generate an image about Virtuals",
        style: "anime",
      };

      const result = await offering.initiateJob(validServiceRequirement);

      expect(result).toBe(mockJobId);
      expect(mockContractClient.createJob).toHaveBeenCalledTimes(1);
    });

    it("should throw AcpError when schema validation fails", async () => {
      const requirementSchema = {
        type: "object",
        properties: {
          prompt: { type: "string" },
          count: { type: "number" },
        },
        required: ["prompt", "count"],
      };

      const offering = new AcpJobOffering(
        mockAcpClient,
        mockContractClient,
        "0xProvider" as Address,
        "Generate Image",
        100,
        PriceType.FIXED,
        requirementSchema,
      );

      // Invalid service requirement - missing required "count" field
      const invalidServiceRequirement = {
        prompt: "generate an image",
      };

      await expect(
        offering.initiateJob(invalidServiceRequirement),
      ).rejects.toThrow(AcpError);
    });

    it("should set fareAmount to 0 for percentage pricing", async () => {
      const mockUserOpHash = "0xmockUserOpHash";
      const mockJobId = 12345;
      const mockCreateJobPayload = { data: "createJobPayload" };
      const mockSetBudgetPayload = { data: "setBudgetPayload" };
      const mockMemoPayload = { data: "memoPayload" };

      mockContractClient.createJob.mockReturnValue(mockCreateJobPayload as any);
      mockContractClient.handleOperation.mockResolvedValue({
        userOpHash: mockUserOpHash,
      } as any);
      mockContractClient.getJobId.mockResolvedValue(mockJobId);
      mockContractClient.setBudgetWithPaymentToken.mockReturnValue(
        mockSetBudgetPayload as any,
      );
      mockContractClient.createMemo.mockReturnValue(mockMemoPayload as any);

      const offering = new AcpJobOffering(
        mockAcpClient,
        mockContractClient,
        "0xProvider" as Address,
        "Generate Image",
        100,
        PriceType.PERCENTAGE,
      );

      const result = await offering.initiateJob(
        "generate an image about Virtuals",
      );

      expect(result).toBe(mockJobId);
      expect(mockContractClient.createJob).toHaveBeenCalledTimes(1);

      const createJobCall = mockContractClient.createJob.mock.calls[0];
      const fareAmountParam = createJobCall[4];
      expect(fareAmountParam).toBe(BigInt(0));
    });

    it("should use custom evaluator address when provided", async () => {
      const mockUserOpHash = "0xmockUserOpHash";
      const mockJobId = 12345;
      const mockCreateJobPayload = { data: "createJobPayload" };
      const mockSetBudgetPayload = { data: "setBudgetPayload" };
      const mockMemoPayload = { data: "memoPayload" };
      const customEvaluator = "0xCustomEvaluator123456789" as Address;

      mockContractClient.createJob.mockReturnValue(mockCreateJobPayload as any);
      mockContractClient.handleOperation.mockResolvedValue({
        userOpHash: mockUserOpHash,
      } as any);
      mockContractClient.getJobId.mockResolvedValue(mockJobId);
      mockContractClient.setBudgetWithPaymentToken.mockReturnValue(
        mockSetBudgetPayload as any,
      );
      mockContractClient.createMemo.mockReturnValue(mockMemoPayload as any);

      const offering = new AcpJobOffering(
        mockAcpClient,
        mockContractClient,
        "0xProvider" as Address,
        "Generate Image",
        100,
      );

      const result = await offering.initiateJob(
        "generate an image about Virtuals",
        customEvaluator,
      );

      expect(result).toBe(mockJobId);
      expect(mockContractClient.createJob).toHaveBeenCalledTimes(1);

      const createJobCall = mockContractClient.createJob.mock.calls[0];
      const evaluatorParam = createJobCall[1];
      expect(evaluatorParam).toBe(customEvaluator);
    });

    it("should use createJobWithAccount for V2 contracts when account exists", async () => {
      const mockUserOpHash = "0xmockUserOpHash";
      const mockJobId = 12345;
      const mockCreateJobPayload = { data: "createJobWithAccountPayload" };
      const mockSetBudgetPayload = { data: "setBudgetPayload" };
      const mockMemoPayload = { data: "memoPayload" };
      const mockAccount = { id: BigInt(999) };

      // Mock getByClientAndProvider to return an account (V2 behavior)
      jest
        .spyOn(mockAcpClient, "getByClientAndProvider")
        .mockResolvedValue(mockAccount as any);

      mockContractClient.createJobWithAccount.mockReturnValue(
        mockCreateJobPayload as any,
      );
      mockContractClient.handleOperation.mockResolvedValue({
        userOpHash: mockUserOpHash,
      } as any);
      mockContractClient.getJobId.mockResolvedValue(mockJobId);
      mockContractClient.setBudgetWithPaymentToken.mockReturnValue(
        mockSetBudgetPayload as any,
      );
      mockContractClient.createMemo.mockReturnValue(mockMemoPayload as any);

      // Use a non-V1 contract address
      mockContractClient.config.contractAddress = "0xV2ContractAddress" as Address;

      const offering = new AcpJobOffering(
        mockAcpClient,
        mockContractClient,
        "0xProvider" as Address,
        "Generate Image",
        100,
      );

      const result = await offering.initiateJob(
        "generate an image about Virtuals",
      );

      expect(result).toBe(mockJobId);
      expect(mockContractClient.createJobWithAccount).toHaveBeenCalledTimes(1);
      expect(mockContractClient.createJob).not.toHaveBeenCalled();

      // Verify that createJobWithAccount was called with account.id (1st parameter)
      const createJobCall =
        mockContractClient.createJobWithAccount.mock.calls[0];
      const accountIdParam = createJobCall[0];
      expect(accountIdParam).toBe(mockAccount.id);
    });
  });
});

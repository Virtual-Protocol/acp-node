import { Address } from "viem";
import AcpJob from "../../src/acpJob";
import AcpMemo from "../../src/acpMemo";
import { Fare, FareBigInt } from "../../src/acpFare";
import AcpClient from "../../src/acpClient";
import AcpError from "../../src/acpError";
import { AcpMemoStatus } from "../../src/interfaces";
import BaseAcpContractClient, {
  AcpJobPhases,
  MemoType,
  FeeType,
} from "../../src/contractClients/baseAcpContractClient";

describe("AcpJob Unit Testing", () => {
  let mockAcpClient: jest.Mocked<AcpClient>;
  let mockContractClient: jest.Mocked<BaseAcpContractClient>;
  let acpJob: AcpJob;

  const mockMemo: Partial<AcpMemo> = {
    id: 1,
    type: MemoType.MESSAGE,
    content: JSON.stringify({
      name: "Test Job",
      requirement: "Test Requirement",
      priceType: 0,
      priceValue: 100,
    }),
    nextPhase: AcpJobPhases.NEGOTIATION,
    status: AcpMemoStatus.PENDING,
    senderAddress: "0xSender" as Address,
    sign: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockContractClient = {
      contractAddress: "0xContract" as Address,
      config: {
        baseFare: new Fare("0xBaseFare" as Address, 18),
        chain: { id: 8453 },
      },
      handleOperation: jest.fn().mockReturnValue({ hash: "0xHash" }),
      createMemo: jest.fn().mockReturnValue({ type: "CREATE_MEMO" }),
      createPayableMemo: jest
        .fn()
        .mockReturnValue({ type: "CREATE_PAYABLE_MEMO" }),
      approveAllowance: jest
        .fn()
        .mockReturnValue({ type: "APPROVE_ALLOWANCE" }),
      signMemo: jest.fn().mockReturnValue({ type: "SIGN_MEMO" }),
    } as any;
    mockAcpClient = {
      contractClientByAddress: jest.fn().mockReturnValue(mockContractClient),
      getAgent: jest.fn().mockResolvedValue({ id: 1, name: "Agent" }),
      getAccountByJobId: jest
        .fn()
        .mockResolvedValue({ id: 1, clientAddress: "0xClient" }),
    } as any;

    acpJob = new AcpJob(
      mockAcpClient,
      123,
      "0xClient" as Address,
      "0xProvider" as Address,
      "0xEvaluator" as Address,
      100,
      "0xToken" as Address,
      [mockMemo as AcpMemo],
      AcpJobPhases.REQUEST,
      { testContext: "data" },
      "0xContract" as Address,
      100,
    );
  });

  describe("Constructor", () => {
    it("should parse job details from NEGOTIATION memo content", () => {
      const memoWithJobDetails: Partial<AcpMemo> = {
        id: 1,
        type: MemoType.MESSAGE,
        content: JSON.stringify({
          name: "API Integration Task",
          requirement: "Build REST API",
          priceType: "percentage",
          priceValue: 15.5,
        }),
        nextPhase: AcpJobPhases.NEGOTIATION,
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xSender" as Address,
        sign: jest.fn(),
      };

      const job = new AcpJob(
        mockAcpClient,
        999,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [memoWithJobDetails as AcpMemo],
        AcpJobPhases.REQUEST,
        {},
        "0xContract" as Address,
      );

      expect(job.name).toBe("API Integration Task");
      expect(job.requirement).toBe("Build REST API");
      expect(job.priceType).toBe("percentage");
      expect(job.priceValue).toBe(15.5);
    });

    it("should handle legacy serviceName and serviceRequirement fields", () => {
      const legacyMemo: Partial<AcpMemo> = {
        id: 1,
        type: MemoType.MESSAGE,
        content: JSON.stringify({
          serviceName: "Legacy Service",
          serviceRequirement: { task: "Old format" },
        }),
        nextPhase: AcpJobPhases.NEGOTIATION,
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xSender" as Address,
        sign: jest.fn(),
      };

      const job = new AcpJob(
        mockAcpClient,
        888,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [legacyMemo as AcpMemo],
        AcpJobPhases.REQUEST,
        {},
        "0xContract" as Address,
      );

      expect(job.name).toBe("Legacy Service");
      expect(job.requirement).toEqual({ task: "Old format" });
    });

    it("should exit early if no NEGOTIATION memo exists", () => {
      const transactionMemo: Partial<AcpMemo> = {
        id: 2,
        type: MemoType.MESSAGE,
        content: "Some content",
        nextPhase: AcpJobPhases.TRANSACTION,
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xSender" as Address,
        sign: jest.fn(),
      };

      const job = new AcpJob(
        mockAcpClient,
        777,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [transactionMemo as AcpMemo],
        AcpJobPhases.TRANSACTION,
        {},
        "0xContract" as Address,
      );

      expect(job.name).toBeUndefined();
      expect(job.requirement).toBeUndefined();
      expect(job.priceType).toBe("fixed");
      expect(job.priceValue).toBe(0);
    });

    it("should exit early if memo content is invalid JSON", () => {
      const invalidJsonMemo: Partial<AcpMemo> = {
        id: 1,
        type: MemoType.MESSAGE,
        content: "not valid JSON", // Invalid JSON
        nextPhase: AcpJobPhases.NEGOTIATION,
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xSender" as Address,
        sign: jest.fn(),
      };

      const job = new AcpJob(
        mockAcpClient,
        666,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [invalidJsonMemo as AcpMemo],
        AcpJobPhases.REQUEST,
        {},
        "0xContract" as Address,
      );

      expect(job.name).toBeUndefined();
      expect(job.requirement).toBeUndefined();
      expect(job.priceType).toBe("fixed");
      expect(job.priceValue).toBe(0);
    });

    it("should use default priceType and priceValue when not in content", () => {
      const memoWithoutPricing: Partial<AcpMemo> = {
        id: 1,
        type: MemoType.MESSAGE,
        content: JSON.stringify({
          name: "Simple Task",
          requirement: "Do something",
        }),
        nextPhase: AcpJobPhases.NEGOTIATION,
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xSender" as Address,
        sign: jest.fn(),
      };

      const job = new AcpJob(
        mockAcpClient,
        555,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [memoWithoutPricing as AcpMemo],
        AcpJobPhases.REQUEST,
        {},
        "0xContract" as Address,
      );

      expect(job.name).toBe("Simple Task");
      expect(job.requirement).toBe("Do something");
      expect(job.priceType).toBe("fixed");
      expect(job.priceValue).toBe(0);
    });
  });

  describe("Getter Methods", () => {
    it("should return the contract address for contract client", () => {
      const result = acpJob.acpContractClient;

      expect(mockAcpClient.contractClientByAddress).toHaveBeenCalledWith(
        "0xContract",
      );
      expect(result).toBe(mockContractClient);
    });

    it("should return the config for contract client", () => {
      const result = acpJob.config;

      expect(result).toBe(mockContractClient.config);
      expect(result.baseFare).toBeInstanceOf(Fare);
    });

    it("should return the baseFare for contract client", () => {
      const result = acpJob.baseFare;

      expect(result).toBe(mockContractClient.config.baseFare);
      expect(result.contractAddress).toBe("0xBaseFare");
    });

    it("should get deliverable from COMPLETED memo", () => {
      const completedMemo = {
        ...mockMemo,
        content: "Here is the deliverable",
        nextPhase: AcpJobPhases.COMPLETED,
      };

      const jobWithDeliverable = new AcpJob(
        mockAcpClient,
        124,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [mockMemo as AcpMemo, completedMemo as AcpMemo],
        AcpJobPhases.EVALUATION,
        {},
        "0xContract" as Address,
      );

      expect(jobWithDeliverable.deliverable).toBe("Here is the deliverable");
    });

    it("should return undefined when no deliverable exists", () => {
      expect(acpJob.deliverable).toBeUndefined();
    });

    it("should get rejection reason from signed reason", () => {
      const rejectedMemo = {
        ...mockMemo,
        nextPhase: AcpJobPhases.NEGOTIATION,
        status: AcpMemoStatus.REJECTED,
        signedReason: "Too Expensive",
      };

      const rejectedJob = new AcpJob(
        mockAcpClient,
        125,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [rejectedMemo as AcpMemo],
        AcpJobPhases.NEGOTIATION,
        {},
        "0xContract" as Address,
      );

      expect(rejectedJob.rejectionReason).toBe("Too Expensive");
    });

    it("should return rejectedReason from REJECTED phase memo", () => {
      const rejectedMemo = {
        ...mockMemo,
        content: "Budget Constraints",
        nextPhase: AcpJobPhases.REJECTED,
      };

      const rejectedJob = new AcpJob(
        mockAcpClient,
        126,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [rejectedMemo as AcpMemo],
        AcpJobPhases.REJECTED,
        {},
        "0xContract" as Address,
      );

      expect(rejectedJob.rejectionReason).toBe("Budget Constraints");
    });

    it("should get provider agent address", async () => {
      const result = await acpJob.providerAgent;

      expect(mockAcpClient.getAgent).toHaveBeenCalledWith("0xProvider");
      expect(result).toEqual({ id: 1, name: "Agent" });
    });

    it("should get client agent address", async () => {
      const result = await acpJob.clientAgent;

      expect(mockAcpClient.getAgent).toHaveBeenCalledWith("0xClient");
      expect(result).toEqual({ id: 1, name: "Agent" });
    });

    it("should get evaluator agent address", async () => {
      const result = await acpJob.evaluatorAgent;

      expect(mockAcpClient.getAgent).toHaveBeenCalledWith("0xEvaluator");
      expect(result).toEqual({ id: 1, name: "Agent" });
    });

    it("should return account from acpClient", async () => {
      const result = await acpJob.account;

      expect(mockAcpClient.getAccountByJobId).toHaveBeenCalledWith(
        123,
        mockContractClient,
      );
      expect(result).toEqual({ id: 1, clientAddress: "0xClient" });
    });

    it("should return latest memo", () => {
      const result = acpJob.latestMemo;

      expect(result).toBe(mockMemo);
      expect(result?.id).toBe(1);
    });
  });

  describe("createRequirement", () => {
    it("should create a MESSAGE memo and call handleOperation()", async () => {
      const content = "These are the requirements";
      const mockCreateMockResult = { type: "CREATE_MEMO", data: "mock" };

      (mockContractClient.createMemo as jest.Mock).mockReturnValue(
        mockCreateMockResult,
      );

      const result = await acpJob.createRequirement(content);

      expect(mockContractClient.createMemo).toHaveBeenCalledWith(
        123,
        content,
        MemoType.MESSAGE,
        true,
        AcpJobPhases.TRANSACTION,
      );
      expect(mockContractClient.handleOperation).toHaveBeenCalledWith([
        mockCreateMockResult,
      ]);
      expect(result).toEqual({ hash: "0xHash" });
    });
  });

  describe("createPayableRequirement", () => {
    let mockFareAmount: any;

    beforeEach(() => {
      mockFareAmount = {
        amount: BigInt(1000000000000000000n),
        fare: new Fare("0xTokenAddress" as Address, 18),
      };
    });

    it("should create payable memo WITHOUT allowance for PAYABLE_REQUEST", async () => {
      const content = "Payment Request";
      const recipient = "0xRecipient" as Address;
      const expiredAt = new Date(Date.now() + 1000 * 60 * 10);

      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      await acpJob.createPayableRequirement(
        content,
        MemoType.PAYABLE_REQUEST,
        mockFareAmount,
        recipient,
        expiredAt,
      );

      expect(mockContractClient.approveAllowance).not.toHaveBeenCalled();
      expect(mockContractClient.createPayableMemo).toHaveBeenCalledWith(
        123,
        content,
        mockFareAmount.amount,
        recipient,
        BigInt(0),
        0,
        AcpJobPhases.TRANSACTION,
        MemoType.PAYABLE_REQUEST,
        expiredAt,
        mockFareAmount.fare.contractAddress,
      );

      expect(mockContractClient.handleOperation).toHaveBeenCalledWith([
        mockPayableResult,
      ]);
    });

    it("should create payable memo WITH allowance for PAYABLE_TRANSFER_ESCROW", async () => {
      const content = "Escrow Transfer";
      const recipient = "0xRecipient" as Address;
      const expiredAt = new Date(Date.now() + 1000 * 60 * 10);

      const mockApprovedResult = { type: "APPROVE_ALLOWANCE" };
      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };

      (mockContractClient.approveAllowance as jest.Mock).mockReturnValue(
        mockApprovedResult,
      );
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      await acpJob.createPayableRequirement(
        content,
        MemoType.PAYABLE_TRANSFER_ESCROW,
        mockFareAmount,
        recipient,
        expiredAt,
      );

      expect(mockContractClient.approveAllowance).toHaveBeenCalledWith(
        mockFareAmount.amount,
        mockFareAmount.fare.contractAddress,
      );

      expect(mockContractClient.createPayableMemo).toHaveBeenCalled();

      expect(mockContractClient.handleOperation).toHaveBeenCalledWith([
        mockApprovedResult,
        mockPayableResult,
      ]);
    });

    it("should use percentage fee when priceType is percentage", async () => {
      const percentageMemo = {
        ...mockMemo,
        content: JSON.stringify({
          name: "Percentage Pricing Job",
          requriement: "This is the requirement",
          priceType: "percentage",
          priceValue: 5,
        }),
      };

      const percentageJob = new AcpJob(
        mockAcpClient,
        200,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [percentageMemo as AcpMemo],
        AcpJobPhases.REQUEST,
        {},
        "0xContract" as Address,
        100,
      );

      const content = "Percentage Payment";
      const recipient = "0xRecipient" as Address;

      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      await percentageJob.createPayableRequirement(
        content,
        MemoType.PAYABLE_REQUEST,
        mockFareAmount,
        recipient,
      );

      expect(mockContractClient.createPayableMemo).toHaveBeenCalledWith(
        200,
        content,
        mockFareAmount.amount,
        recipient,
        BigInt(50000),
        FeeType.PERCENTAGE_FEE,
        AcpJobPhases.TRANSACTION,
        MemoType.PAYABLE_REQUEST,
        expect.any(Date),
        mockFareAmount.fare.contractAddress,
      );
    });

    it("should use NO_FEE when priceType is FIXED", async () => {
      const content = "Fixed Price Payment";
      const recipient = "0xRecipient" as Address;

      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      await acpJob.createPayableRequirement(
        content,
        MemoType.PAYABLE_REQUEST,
        mockFareAmount,
        recipient,
      );

      expect(mockContractClient.createPayableMemo).toHaveBeenCalledWith(
        123,
        content,
        mockFareAmount.amount,
        recipient,
        BigInt(0),
        0,
        AcpJobPhases.TRANSACTION,
        MemoType.PAYABLE_REQUEST,
        expect.any(Date),
        mockFareAmount.fare.contractAddress,
      );
    });

    it("should use default expiredAt of 5 minutes when not specified", async () => {
      const beforeCall = Date.now();
      const content = "Payment With Default Expiry";
      const recipient = "0xRecipient" as Address;

      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      await acpJob.createPayableRequirement(
        content,
        MemoType.PAYABLE_REQUEST,
        mockFareAmount,
        recipient,
      );

      const callArgs = (mockContractClient.createPayableMemo as jest.Mock).mock
        .calls[0];
      const expiredAt = callArgs[8] as Date;

      const fiveMinutesFromNow = beforeCall + 1000 * 60 * 5;
      const timeDiff = Math.abs(expiredAt.getTime() - fiveMinutesFromNow);

      expect(timeDiff).toBeLessThan(1000);
    });
  });

  describe("evaluate", () => {
    it("should sign memo with true when accepting", async () => {
      const completedMemo = {
        ...mockMemo,
        id: 2,
        nextPhase: AcpJobPhases.COMPLETED,
        sign: jest.fn().mockResolvedValue({ hash: "0xEvalHash " }),
      } as any;

      const jobWithCompletedMemo = new AcpJob(
        mockAcpClient,
        130,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [mockMemo as AcpMemo, completedMemo as AcpMemo],
        AcpJobPhases.EVALUATION,
        {},
        "0xContract" as Address,
      );

      const reason = "Accepted";
      await jobWithCompletedMemo.evaluate(true, reason);

      expect(completedMemo.sign).toHaveBeenCalledWith(true, reason);
    });

    it("should sign false when rejecting", async () => {
      const completedMemo = {
        ...mockMemo,
        id: 2,
        nextPhase: AcpJobPhases.COMPLETED,
        sign: jest.fn().mockResolvedValue({ hash: "0xEvalHash" }),
      } as any;

      const jobWithCompletedMemo = new AcpJob(
        mockAcpClient,
        131,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [mockMemo as AcpMemo, completedMemo as AcpMemo],
        AcpJobPhases.EVALUATION,
        {},
        "0xContract" as Address,
      );

      const reason = "Irrelevant";
      await jobWithCompletedMemo.evaluate(false, reason);

      expect(completedMemo.sign).toHaveBeenCalledWith(false, reason);
    });

    it("should throw AcpError when latest memo nextPhase is not COMPLETED", async () => {
      await expect(acpJob.evaluate(true, "Good Deliverable")).rejects.toThrow(
        "No evaluation memo found",
      );
    });
  });

  describe("respond", () => {
    it("should accept and create requirement when accept is true", async () => {
      const reason = "Related job";
      const mockCreateMemoResult = { type: "CREATE_MEMO" };

      (mockMemo.sign as jest.Mock).mockResolvedValue({ hash: "0xSignHash " });
      (mockContractClient.createMemo as jest.Mock).mockReturnValue(
        mockCreateMemoResult,
      );

      const result = await acpJob.respond(true, reason);

      expect(mockMemo.sign).toHaveBeenCalledWith(
        true,
        `Job 123 accepted. ${reason}`,
      );

      expect(mockContractClient.createMemo).toHaveBeenCalledWith(
        123,
        reason,
        MemoType.MESSAGE,
        true,
        AcpJobPhases.TRANSACTION,
      );

      expect(result).toEqual({ hash: "0xHash" });
    });

    it("should reject when accept is false", async () => {
      const reason = "Job is not related";

      (mockMemo.sign as jest.Mock).mockResolvedValue({ hash: "0xRejectHash" });

      const result = await acpJob.respond(false, reason);

      expect(mockMemo.sign).toHaveBeenCalledWith(
        false,
        `Job 123 rejected. ${reason}`,
      );
      expect(result).toEqual({ hash: "0xRejectHash" });
    });

    it("should use default message when accept is true and no reason was provided", async () => {
      const mockCreateMemoResult = { type: "CREATE_MEMO" };

      (mockMemo.sign as jest.Mock).mockResolvedValue({ hash: "0xSignHash" });
      (mockContractClient.createMemo as jest.Mock).mockReturnValue(
        mockCreateMemoResult,
      );

      await acpJob.respond(true);

      expect(mockMemo.sign).toHaveBeenCalledWith(
        true,
        "Job 123 accepted. Job 123 accepted.",
      );

      expect(mockContractClient.createMemo).toHaveBeenCalledWith(
        123,
        "Job 123 accepted.",
        MemoType.MESSAGE,
        true,
        AcpJobPhases.TRANSACTION,
      );
    });

    it("should use default message when accept is false and no reason was provided", async () => {
      (mockMemo.sign as jest.Mock).mockResolvedValue({ hash: "0xRejectHash" });

      await acpJob.respond(false);

      expect(mockMemo.sign).toHaveBeenCalledWith(
        false,
        "Job 123 rejected. Job 123 rejected.",
      );
    });
  });

  describe("accept", () => {
    it("should sign memo with true when nextPhase is NEGOTIATION", async () => {
      const reason = "Looks good to me";
      (mockMemo.sign as jest.Mock).mockResolvedValue({ hash: "0xAcceptHash" });

      const result = await acpJob.accept(reason);

      expect(mockMemo.sign).toHaveBeenCalledWith(
        true,
        `Job 123 accepted. ${reason}`,
      );
      expect(result).toEqual({ hash: "0xAcceptHash" });
    });

    it("should sign memo without reason when reason is not provided", async () => {
      (mockMemo.sign as jest.Mock).mockResolvedValue({ hash: "0xAcceptHash" });

      await acpJob.accept();

      expect(mockMemo.sign).toHaveBeenCalledWith(true, "Job 123 accepted. ");
    });

    it("should throw AcpError when latest memo nextPhase is not NEGOTIATION", async () => {
      const txMemo = {
        ...mockMemo,
        nextPhase: AcpJobPhases.TRANSACTION,
      };

      const jobWithTxPhase = new AcpJob(
        mockAcpClient,
        140,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [txMemo as AcpMemo],
        AcpJobPhases.TRANSACTION,
        {},
        "0xContract" as Address,
      );

      await expect(jobWithTxPhase.accept()).rejects.toThrow(
        "No request memo found",
      );
    });
  });

  describe("reject", () => {
    it("should sign memo with false when phase is REQUEST", async () => {
      const reason = "Out of bounds";

      (mockMemo.sign as jest.Mock).mockResolvedValue({ hash: "0xRejectHash" });

      const result = await acpJob.reject(reason);

      expect(mockMemo.sign).toHaveBeenCalledWith(
        false,
        `Job 123 rejected. ${reason}`,
      );
      expect(result).toEqual({ hash: "0xRejectHash" });
    });

    it("should sign memo without reason when reason is not provided", async () => {
      (mockMemo.sign as jest.Mock).mockResolvedValue({ hash: "0xRejectHash " });

      await acpJob.reject();

      expect(mockMemo.sign).toHaveBeenCalledWith(false, "Job 123 rejected. ");
    });

    it("should throw AcpError when phase is REQUEST but latest memo nextPhase is not NEGOTIATION", async () => {
      const txMemo = {
        ...mockMemo,
        id: 141,
        nextPhase: AcpJobPhases.TRANSACTION,
      };

      const jobWithWrongPhase = new AcpJob(
        mockAcpClient,
        141,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [txMemo as AcpMemo],
        AcpJobPhases.REQUEST,
        {},
        "0xContract" as Address,
      );

      await expect(jobWithWrongPhase.reject("reason")).rejects.toThrow(
        "No request memo found",
      );
    });

    it("should create REJECTED memo when phase is not REQUEST", async () => {
      const jobInTransaction = new AcpJob(
        mockAcpClient,
        142,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [mockMemo as AcpMemo],
        AcpJobPhases.TRANSACTION,
        {},
        "0xContract" as Address,
      );

      const reason = "The job cannot be completed";
      const mockCreateMemoResult = { type: "CREATE_MEMO_REJECTED " };
      (mockContractClient.createMemo as jest.Mock).mockReturnValue(
        mockCreateMemoResult,
      );

      const result = await jobInTransaction.reject(reason);

      expect(mockContractClient.createMemo).toHaveBeenCalledWith(
        142,
        `Job 142 rejected. ${reason}`,
        MemoType.MESSAGE,
        true,
        AcpJobPhases.REJECTED,
      );

      expect(mockContractClient.handleOperation).toHaveBeenCalledWith([
        mockCreateMemoResult,
      ]);
      expect(result).toEqual({ hash: "0xHash" });
    });

    it("should create REJECTED memo without reason when phase is not REQUEST", async () => {
      const jobInTransaction = new AcpJob(
        mockAcpClient,
        143,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [mockMemo as AcpMemo],
        AcpJobPhases.TRANSACTION,
        {},
        "0xContract" as Address,
      );

      const mockCreateMemoResult = { type: "CREATE_MEMO_REJECTED" };
      (mockContractClient.createMemo as jest.Mock).mockReturnValue(
        mockCreateMemoResult,
      );

      await jobInTransaction.reject();

      expect(mockContractClient.createMemo).toHaveBeenCalledWith(
        143,
        "Job 143 rejected. ",
        MemoType.MESSAGE,
        true,
        AcpJobPhases.REJECTED,
      );
    });
  });

  describe("rejectPayable", () => {
    let mockFareAmount: any;

    beforeEach(() => {
      mockFareAmount = {
        amount: BigInt(500000000000000000n),
        fare: new Fare("0xTokenAddress" as Address, 18),
      };
    });

    it("should approve allowance and create payable REJECTED memo with reason", async () => {
      const reason = "Cannot fulfill this request";
      const expiredAt = new Date(Date.now() + 1000 * 60 * 10);

      const mockApproveResult = { type: "APPROVE_ALLOWANCE" };
      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };

      (mockContractClient.approveAllowance as jest.Mock).mockReturnValue(
        mockApproveResult,
      );
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      const result = await acpJob.rejectPayable(
        reason,
        mockFareAmount,
        expiredAt,
      );

      expect(mockContractClient.approveAllowance).toHaveBeenCalledWith(
        mockFareAmount.amount,
        mockFareAmount.fare.contractAddress,
      );

      expect(mockContractClient.createPayableMemo).toHaveBeenCalledWith(
        123,
        `Job 123 rejected. ${reason}`,
        mockFareAmount.amount,
        "0xClient",
        BigInt(0),
        FeeType.NO_FEE,
        AcpJobPhases.REJECTED,
        MemoType.PAYABLE_TRANSFER,
        expiredAt,
        mockFareAmount.fare.contractAddress,
      );

      expect(mockContractClient.handleOperation).toHaveBeenCalledWith([
        mockApproveResult,
        mockPayableResult,
      ]);

      expect(result).toEqual({ hash: "0xHash" });
    });

    it("should use empty string as reason when not provided", async () => {
      const expiredAt = new Date(Date.now() + 1000 * 60 * 10);

      const mockApproveResult = { type: "APPROVE_ALLOWANCE" };
      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };

      (mockContractClient.approveAllowance as jest.Mock).mockReturnValue(
        mockApproveResult,
      );
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      await acpJob.rejectPayable("", mockFareAmount, expiredAt);

      expect(mockContractClient.createPayableMemo).toHaveBeenCalledWith(
        123,
        "Job 123 rejected. ",
        mockFareAmount.amount,
        "0xClient",
        BigInt(0),
        FeeType.NO_FEE,
        AcpJobPhases.REJECTED,
        MemoType.PAYABLE_TRANSFER,
        expiredAt,
        mockFareAmount.fare.contractAddress,
      );
    });

    it("should use default expiredAt of 5 minutes when not provided", async () => {
      const beforeCall = Date.now();
      const reason = "Job rejected";

      const mockApproveResult = { type: "APPROVE_ALLOWANCE" };
      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };

      (mockContractClient.approveAllowance as jest.Mock).mockReturnValue(
        mockApproveResult,
      );
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      await acpJob.rejectPayable(reason, mockFareAmount);

      const callArgs = (mockContractClient.createPayableMemo as jest.Mock).mock
        .calls[0];
      const expiredAt = callArgs[8] as Date;

      const fiveMinutesFromNow = beforeCall + 1000 * 60 * 5;
      const timeDiff = Math.abs(expiredAt.getTime() - fiveMinutesFromNow);
      expect(timeDiff).toBeLessThan(1000);
    });

    it("should always use NO_FEE regardless of job pricing type", async () => {
      const percentageMemo: Partial<AcpMemo> = {
        id: 1,
        type: MemoType.MESSAGE,
        content: JSON.stringify({
          priceType: "percentage",
          priceValue: 10,
        }),
        nextPhase: AcpJobPhases.NEGOTIATION,
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xSender" as Address,
        sign: jest.fn(),
      };

      const percentageJob = new AcpJob(
        mockAcpClient,
        150,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [percentageMemo as AcpMemo],
        AcpJobPhases.REQUEST,
        {},
        "0xContract" as Address,
      );

      const mockApproveResult = { type: "APPROVE_ALLOWANCE" };
      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };

      (mockContractClient.approveAllowance as jest.Mock).mockReturnValue(
        mockApproveResult,
      );
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      await percentageJob.rejectPayable("Rejected", mockFareAmount);

      expect(mockContractClient.createPayableMemo).toHaveBeenCalledWith(
        150,
        "Job 150 rejected. Rejected",
        mockFareAmount.amount,
        "0xClient",
        BigInt(0),
        FeeType.NO_FEE,
        AcpJobPhases.REJECTED,
        MemoType.PAYABLE_TRANSFER,
        expect.any(Date),
        mockFareAmount.fare.contractAddress,
      );
    });
  });
  describe("deliver", () => {
    it("should create COMPLETED memo if phase is EVALUATION", async () => {
      const evalMemo = {
        id: 1,
        type: MemoType.MESSAGE,
        content: "Tx Memo",
        nextPhase: AcpJobPhases.EVALUATION,
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xSender" as Address,
        sign: jest.fn(),
      } as any;

      const jobInEvaluation = new AcpJob(
        mockAcpClient,
        160,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [evalMemo as AcpMemo],
        AcpJobPhases.TRANSACTION,
        {},
        "0xContract" as Address,
      );

      const deliverable = { result: "Job Completed Successfully" };
      const mockCreateMemoResult = { type: "CREATE_MEMO" };

      (mockContractClient.createMemo as jest.Mock).mockReturnValue(
        mockCreateMemoResult,
      );

      const result = await jobInEvaluation.deliver(deliverable);

      expect(mockContractClient.createMemo).toHaveBeenCalledWith(
        160,
        JSON.stringify(deliverable),
        MemoType.MESSAGE,
        true,
        AcpJobPhases.COMPLETED,
      );

      expect(mockContractClient.handleOperation).toHaveBeenCalledWith([
        mockCreateMemoResult,
      ]);

      expect(result).toEqual({ hash: "0xHash" });
    });

    it("should successfully deliver regardless of memo nextPhase", async () => {
      const deliverable = { result: "Done" };

      const result = await acpJob.deliver(deliverable);

      expect(mockContractClient.createMemo).toHaveBeenCalledWith(
        123,
        JSON.stringify(deliverable),
        MemoType.MESSAGE,
        true,
        AcpJobPhases.COMPLETED,
      );
      expect(result).toEqual({ hash: "0xHash" });
    });
  });

  describe("deliverPayable", () => {
    let mockFareAmount: any;

    beforeEach(() => {
      mockFareAmount = {
        amount: BigInt(2000000000000000000n),
        fare: new Fare("0xTokenAddress" as Address, 18, 8453),
      };
    });

    it("should approve allowance and create payable COMPLETED memo", async () => {
      const evalMemo = {
        id: 1,
        type: MemoType.MESSAGE,
        content: "Transaction Memo",
        nextPhase: AcpJobPhases.EVALUATION,
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xSender" as Address,
        sign: jest.fn(),
      } as any;

      const jobInEvaluation = new AcpJob(
        mockAcpClient,
        170,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [evalMemo as AcpMemo],
        AcpJobPhases.TRANSACTION,
        {},
        "0xContract" as Address,
      );

      const deliverable = { output: "Final Deliverable" };
      const expiredAt = new Date(Date.now() + 1000 * 60 * 5);

      const mockApprovedResult = { type: "APPROVE_ALLOWANCE" };
      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };

      (mockContractClient.approveAllowance as jest.Mock).mockReturnValue(
        mockApprovedResult,
      );
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      const result = await jobInEvaluation.deliverPayable(
        deliverable,
        mockFareAmount,
        false,
        expiredAt,
      );

      expect(mockContractClient.approveAllowance).toHaveBeenCalledWith(
        mockFareAmount.amount,
        mockFareAmount.fare.contractAddress,
      );

      expect(mockContractClient.createPayableMemo).toHaveBeenCalledWith(
        170,
        JSON.stringify(deliverable),
        mockFareAmount.amount,
        "0xClient",
        BigInt(0), // NO_FEE for fixed pricing
        FeeType.NO_FEE,
        AcpJobPhases.COMPLETED,
        MemoType.PAYABLE_TRANSFER,
        expiredAt,
        mockFareAmount.fare.contractAddress,
      );

      expect(mockContractClient.handleOperation).toHaveBeenCalledWith([
        mockApprovedResult,
        mockPayableResult,
      ]);

      expect(result).toEqual({ hash: "0xHash" });
    });

    it("should successfully deliverPayable regardless of memo nextPhase", async () => {
      const deliverable = { result: "Done" };
      const expiredAt = new Date(Date.now() + 1000 * 60 * 5);

      const mockApprovedResult = { type: "APPROVE_ALLOWANCE" };
      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };

      (mockContractClient.approveAllowance as jest.Mock).mockReturnValue(
        mockApprovedResult,
      );
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      const result = await acpJob.deliverPayable(
        deliverable,
        mockFareAmount,
        false,
        expiredAt,
      );

      expect(mockContractClient.approveAllowance).toHaveBeenCalled();
      expect(mockContractClient.createPayableMemo).toHaveBeenCalled();
      expect(result).toEqual({ hash: "0xHash" });
    });

    it("should use percentage fee when priceType is PERCENTAGE and skipFee is false", async () => {
      const negotiationMemo: Partial<AcpMemo> = {
        id: 1,
        type: MemoType.MESSAGE,
        content: JSON.stringify({
          priceType: "percentage",
          priceValue: 7.5,
        }),
        nextPhase: AcpJobPhases.NEGOTIATION,
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xSender" as Address,
        sign: jest.fn(),
      };

      const evalMemo: Partial<AcpMemo> = {
        id: 2,
        type: MemoType.MESSAGE,
        content: "Transaction complete",
        nextPhase: AcpJobPhases.EVALUATION,
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xSender" as Address,
        sign: jest.fn(),
      };

      const percentageJob = new AcpJob(
        mockAcpClient,
        180,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [negotiationMemo as AcpMemo, evalMemo as AcpMemo],
        AcpJobPhases.TRANSACTION,
        {},
        "0xContract" as Address,
      );

      const deliverable = { data: "result" };
      const mockApproveResult = { type: "APPROVE_ALLOWANCE" };
      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };

      (mockContractClient.approveAllowance as jest.Mock).mockReturnValue(
        mockApproveResult,
      );
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      await percentageJob.deliverPayable(deliverable, mockFareAmount, false);

      expect(mockContractClient.createPayableMemo).toHaveBeenCalledWith(
        180,
        JSON.stringify(deliverable),
        mockFareAmount.amount,
        "0xClient",
        BigInt(75000),
        FeeType.PERCENTAGE_FEE,
        AcpJobPhases.COMPLETED,
        MemoType.PAYABLE_TRANSFER,
        expect.any(Date),
        mockFareAmount.fare.contractAddress,
      );
    });

    it("should use NO_FEE when skipFee is true even for percentage pricing", async () => {
      const percentageMemo: Partial<AcpMemo> = {
        id: 1,
        type: MemoType.MESSAGE,
        content: JSON.stringify({
          priceType: "percentage",
          priceValue: 10,
        }),
        nextPhase: AcpJobPhases.EVALUATION,
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xSender" as Address,
        sign: jest.fn(),
      };

      const percentageJob = new AcpJob(
        mockAcpClient,
        190,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [percentageMemo as AcpMemo],
        AcpJobPhases.TRANSACTION,
        {},
        "0xContract" as Address,
      );

      const deliverable = { output: "work" };
      const mockApproveResult = { type: "APPROVE_ALLOWANCE" };
      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };

      (mockContractClient.approveAllowance as jest.Mock).mockReturnValue(
        mockApproveResult,
      );
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      await percentageJob.deliverPayable(deliverable, mockFareAmount, true);

      expect(mockContractClient.createPayableMemo).toHaveBeenCalledWith(
        190,
        JSON.stringify(deliverable),
        mockFareAmount.amount,
        "0xClient",
        BigInt(0),
        FeeType.NO_FEE,
        AcpJobPhases.COMPLETED,
        MemoType.PAYABLE_TRANSFER,
        expect.any(Date),
        mockFareAmount.fare.contractAddress,
      );
    });

    it("should use default expiredAt of 5 minutes when not provided", async () => {
      const evaluationMemo: Partial<AcpMemo> = {
        id: 1,
        type: MemoType.MESSAGE,
        content: "memo",
        nextPhase: AcpJobPhases.EVALUATION,
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xSender" as Address,
        sign: jest.fn(),
      };

      const jobInEvaluation = new AcpJob(
        mockAcpClient,
        200,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [evaluationMemo as AcpMemo],
        AcpJobPhases.TRANSACTION,
        {},
        "0xContract" as Address,
      );

      const beforeCall = Date.now();
      const deliverable = { final: "output" };

      const mockApproveResult = { type: "APPROVE_ALLOWANCE" };
      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };

      (mockContractClient.approveAllowance as jest.Mock).mockReturnValue(
        mockApproveResult,
      );
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      await jobInEvaluation.deliverPayable(deliverable, mockFareAmount);

      const callArgs = (mockContractClient.createPayableMemo as jest.Mock).mock
        .calls[0];
      const expiredAt = callArgs[8] as Date;

      const fiveMinutesFromNow = beforeCall + 1000 * 60 * 5;
      const timeDiff = Math.abs(expiredAt.getTime() - fiveMinutesFromNow);

      expect(timeDiff).toBeLessThan(1000);
    });

    it("should use local payable when fare chainId is undefined", async () => {
      const fareAmountWithoutChainId = new FareBigInt(
        BigInt(2000000000000000000),
        new Fare("0xTokenAddress" as Address, 18),
      );

      const deliverable = { result: "Done" };
      const expiredAt = new Date(Date.now() + 1000 * 60 * 5);

      const mockApprovedResult = { type: "APPROVE_ALLOWANCE" };
      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };

      (mockContractClient.approveAllowance as jest.Mock).mockReturnValue(
        mockApprovedResult,
      );
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      const result = await acpJob.deliverPayable(
        deliverable,
        fareAmountWithoutChainId,
        false,
        expiredAt,
      );

      expect(mockContractClient.approveAllowance).toHaveBeenCalledWith(
        fareAmountWithoutChainId.amount,
        fareAmountWithoutChainId.fare.contractAddress,
      );
      expect(mockContractClient.createPayableMemo).toHaveBeenCalledWith(
        123,
        JSON.stringify(deliverable),
        fareAmountWithoutChainId.amount,
        "0xClient",
        BigInt(0),
        FeeType.NO_FEE,
        AcpJobPhases.COMPLETED,
        MemoType.PAYABLE_TRANSFER,
        expiredAt,
        fareAmountWithoutChainId.fare.contractAddress,
      );
      expect(mockContractClient.handleOperation).toHaveBeenCalledWith([
        mockApprovedResult,
        mockPayableResult,
      ]);
      expect(result).toEqual({ hash: "0xHash" });
    });

    it("should route to cross-chain payable when chainId differs from contract chain", async () => {
      const crossChainFareAmount = new FareBigInt(
        BigInt(2000000000000000000),
        new Fare("0xTokenAddress" as Address, 18, 42161),
      );

      const deliverable = { result: "Cross chain delivery" };

      mockContractClient.getAssetManager = jest
        .fn()
        .mockResolvedValue("0xAssetManager" as Address);
      mockContractClient.getERC20Balance = jest
        .fn()
        .mockResolvedValue(BigInt(5000000000000000000));
      mockContractClient.getERC20Allowance = jest
        .fn()
        .mockResolvedValue(BigInt(0));
      mockContractClient.getERC20Symbol = jest.fn().mockResolvedValue("USDC");
      mockContractClient.agentWalletAddress = "0xAgentWallet" as Address;
      mockContractClient.createCrossChainPayableMemo = jest
        .fn()
        .mockReturnValue({ type: "CROSS_CHAIN_PAYABLE" });

      await acpJob.deliverPayable(deliverable, crossChainFareAmount);

      expect(mockContractClient.getAssetManager).toHaveBeenCalled();
      expect(mockContractClient.getERC20Balance).toHaveBeenCalledWith(
        42161,
        "0xTokenAddress",
        "0xAgentWallet",
      );
    });
  });

  describe("createNotification", () => {
    it("should create NOTIFICATION memo with COMPLETED phase", async () => {
      const content = "Job status completed";
      const mockCreateMemoResult = { type: "CREATE_NOTIFICATION" };

      (mockContractClient.createMemo as jest.Mock).mockReturnValue(
        mockCreateMemoResult,
      );

      const result = await acpJob.createNotification(content);

      expect(mockContractClient.createMemo).toHaveBeenCalledWith(
        123,
        content,
        MemoType.NOTIFICATION,
        true,
        AcpJobPhases.COMPLETED,
      );

      expect(mockContractClient.handleOperation).toHaveBeenCalledWith([
        mockCreateMemoResult,
      ]);

      expect(result).toEqual({ hash: "0xHash" });
    });
  });

  describe("createPayableNotification", () => {
    let mockFareAmount: any;

    beforeEach(() => {
      mockFareAmount = {
        amount: BigInt(1500000000000000000n), // 1.5 tokens
        fare: new Fare("0xTokenAddress" as Address, 18),
      };
    });

    it("should approve allowance and create payable NOTIFICATION memo", async () => {
      const content = "Payment Notification";
      const expiredAt = new Date(Date.now() + 1000 * 60 * 10);

      const mockApproveResult = { type: "APPROVE_ALLOWANCE" };
      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };

      (mockContractClient.approveAllowance as jest.Mock).mockReturnValue(
        mockApproveResult,
      );
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      const result = await acpJob.createPayableNotification(
        content,
        mockFareAmount,
        false,
        expiredAt,
      );

      expect(mockContractClient.approveAllowance).toHaveBeenCalledWith(
        mockFareAmount.amount,
        mockFareAmount.fare.contractAddress,
      );
      expect(mockContractClient.createPayableMemo).toHaveBeenCalledWith(
        123,
        content,
        mockFareAmount.amount,
        "0xClient",
        BigInt(0),
        FeeType.NO_FEE,
        AcpJobPhases.COMPLETED,
        MemoType.PAYABLE_NOTIFICATION,
        expiredAt,
        mockFareAmount.fare.contractAddress,
      );
      expect(mockContractClient.handleOperation).toHaveBeenCalledWith([
        mockApproveResult,
        mockPayableResult,
      ]);
      expect(result).toEqual({ hash: "0xHash" });
    });

    it("should use percentage fee when priceType is PERCENTAGE and skipFee is false", async () => {
      const negotiationMemo: Partial<AcpMemo> = {
        id: 1,
        type: MemoType.MESSAGE,
        content: JSON.stringify({
          priceType: "percentage",
          priceValue: 5,
        }),
        nextPhase: AcpJobPhases.NEGOTIATION,
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xSender" as Address,
        sign: jest.fn(),
      };

      const percentageJob = new AcpJob(
        mockAcpClient,
        210,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [negotiationMemo as AcpMemo],
        AcpJobPhases.TRANSACTION,
        {},
        "0xContract" as Address,
      );

      const content = "Percentage Notification";
      const mockApproveResult = { type: "APPROVE_ALLOWANCE" };
      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };

      (mockContractClient.approveAllowance as jest.Mock).mockReturnValue(
        mockApproveResult,
      );
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      await percentageJob.createPayableNotification(
        content,
        mockFareAmount,
        false,
      );

      expect(mockContractClient.createPayableMemo).toHaveBeenCalledWith(
        210,
        content,
        mockFareAmount.amount,
        "0xClient",
        BigInt(50000),
        FeeType.PERCENTAGE_FEE,
        AcpJobPhases.COMPLETED,
        MemoType.PAYABLE_NOTIFICATION,
        expect.any(Date),
        mockFareAmount.fare.contractAddress,
      );
    });

    it("should use NO_FEE when skipfee is true, even for percentage pricing", async () => {
      const negotiationMemo: Partial<AcpMemo> = {
        id: 1,
        type: MemoType.MESSAGE,
        content: JSON.stringify({
          priceType: "percentage",
          priceValue: 10,
        }),
        nextPhase: AcpJobPhases.NEGOTIATION,
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xSender" as Address,
        sign: jest.fn(),
      };

      const percentageJob = new AcpJob(
        mockAcpClient,
        220,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        100,
        "0xToken" as Address,
        [negotiationMemo as AcpMemo],
        AcpJobPhases.TRANSACTION,
        {},
        "0xContract" as Address,
      );

      const content = "Notification with skipFee";
      const mockApproveResult = { type: "APPROVE_ALLOWANCE" };
      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };

      (mockContractClient.approveAllowance as jest.Mock).mockReturnValue(
        mockApproveResult,
      );
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      await percentageJob.createPayableNotification(
        content,
        mockFareAmount,
        true,
      );

      expect(mockContractClient.createPayableMemo).toHaveBeenCalledWith(
        220,
        content,
        mockFareAmount.amount,
        "0xClient",
        BigInt(0),
        FeeType.NO_FEE,
        AcpJobPhases.COMPLETED,
        MemoType.PAYABLE_NOTIFICATION,
        expect.any(Date),
        mockFareAmount.fare.contractAddress,
      );
    });

    it("should use default expiredAt of 5 minutes when not provided", async () => {
      const beforeCall = Date.now();
      const content = "Notification";

      const mockApproveResult = { type: "APPROVE_ALLOWANCE" };
      const mockPayableResult = { type: "CREATE_PAYABLE_MEMO" };

      (mockContractClient.approveAllowance as jest.Mock).mockReturnValue(
        mockApproveResult,
      );
      (mockContractClient.createPayableMemo as jest.Mock).mockReturnValue(
        mockPayableResult,
      );

      await acpJob.createPayableNotification(content, mockFareAmount);

      const callArgs = (mockContractClient.createPayableMemo as jest.Mock).mock
        .calls[0];
      const expiredAt = callArgs[8] as Date;

      const fiveMinutesFromNow = beforeCall + 1000 * 60 * 5;
      const timeDiff = Math.abs(expiredAt.getTime() - fiveMinutesFromNow);

      expect(timeDiff).toBeLessThan(1000);
    });
  });

  describe("payAndAcceptRequirement", () => {
    it("should throw AcpError when memo is not found", async () => {
      // Arrange: Create job with NO TRANSACTION phase memo
      const requestMemo: Partial<AcpMemo> = {
        id: 1,
        type: MemoType.MESSAGE,
        content: JSON.stringify({ name: "Test Job" }),
        nextPhase: AcpJobPhases.NEGOTIATION, // Wrong phase - should be TRANSACTION
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xSender" as Address,
        sign: jest.fn(),
      };

      acpJob = new AcpJob(
        mockAcpClient,
        123,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        1,
        "0xToken" as Address,
        [requestMemo as AcpMemo], // Only has NEGOTIATION memo, no TRANSACTION memo
        AcpJobPhases.REQUEST,
        {},
        "0xContract" as Address,
        1,
      );

      await expect(
        acpJob.payAndAcceptRequirement("Payment made"),
      ).rejects.toThrow("No notification memo found");
      await expect(
        acpJob.payAndAcceptRequirement("Payment made"),
      ).rejects.toThrow(AcpError);
    });

    describe("X402 Payment Flow", () => {
      it("should handle X402 payment when payment not required (early return)", async () => {
        const transactionMemo: Partial<AcpMemo> = {
          id: 2,
          type: MemoType.MESSAGE,
          content: "Requirements added",
          nextPhase: AcpJobPhases.TRANSACTION,
          status: AcpMemoStatus.PENDING,
          senderAddress: "0xProvider" as Address,
          sign: jest.fn(),
        };

        acpJob = new AcpJob(
          mockAcpClient,
          200,
          "0xClient" as Address,
          "0xProvider" as Address,
          "0xEvaluator" as Address,
          1,
          "0xBaseFare" as Address,
          [transactionMemo as AcpMemo],
          AcpJobPhases.TRANSACTION,
          {},
          "0xContract" as Address,
          1,
        );

        mockContractClient.getX402PaymentDetails = jest
          .fn()
          .mockResolvedValue({ isX402: true });
        mockContractClient.performX402Request = jest.fn().mockResolvedValue({
          isPaymentRequired: false, // Line 473-475: Early return
        });
        mockContractClient.getAcpVersion = jest.fn().mockReturnValue("v1");

        const result = await acpJob.payAndAcceptRequirement("Payment done");

        expect(mockContractClient.getX402PaymentDetails).toHaveBeenCalledWith(
          200,
        );
        expect(mockContractClient.performX402Request).toHaveBeenCalledWith(
          "/acp-budget",
          "v1",
          "1",
        );
        expect(result).toEqual({ hash: "0xHash" });
      });

      it("should throw error when X402 payment has no accepts (line 477-479)", async () => {
        const transactionMemo: Partial<AcpMemo> = {
          id: 2,
          type: MemoType.MESSAGE,
          content: "Requirements added",
          nextPhase: AcpJobPhases.TRANSACTION,
          status: AcpMemoStatus.PENDING,
          senderAddress: "0xProvider" as Address,
          sign: jest.fn(),
        };

        acpJob = new AcpJob(
          mockAcpClient,
          201,
          "0xClient" as Address,
          "0xProvider" as Address,
          "0xEvaluator" as Address,
          1,
          "0xBaseFare" as Address,
          [transactionMemo as AcpMemo],
          AcpJobPhases.TRANSACTION,
          {},
          "0xContract" as Address,
          1,
        );

        mockContractClient.getX402PaymentDetails = jest
          .fn()
          .mockResolvedValue({ isX402: true });
        mockContractClient.performX402Request = jest.fn().mockResolvedValue({
          isPaymentRequired: true,
          data: {
            accepts: [],
          },
        });
        mockContractClient.getAcpVersion = jest.fn().mockReturnValue("v1");

        await expect(
          acpJob.payAndAcceptRequirement("Payment done"),
        ).rejects.toThrow("No X402 payment requirements found");
        await expect(
          acpJob.payAndAcceptRequirement("Payment done"),
        ).rejects.toThrow(AcpError);
      });

      it("should complete X402 with transfer authorization (line 503-516)", async () => {
        const transactionMemo: Partial<AcpMemo> = {
          id: 2,
          type: MemoType.MESSAGE,
          content: "Requirements added",
          nextPhase: AcpJobPhases.TRANSACTION,
          status: AcpMemoStatus.PENDING,
          senderAddress: "0xProvider" as Address,
          sign: jest.fn(),
        };

        acpJob = new AcpJob(
          mockAcpClient,
          202,
          "0xClient" as Address,
          "0xProvider" as Address,
          "0xEvaluator" as Address,
          1,
          "0xBaseFare" as Address,
          [transactionMemo as AcpMemo],
          AcpJobPhases.TRANSACTION,
          {},
          "0xContract" as Address,
          1,
        );

        mockContractClient.getX402PaymentDetails = jest
          .fn()
          .mockResolvedValueOnce({ isX402: true })
          .mockResolvedValueOnce({ isBudgetReceived: true });

        mockContractClient.performX402Request = jest
          .fn()
          .mockResolvedValueOnce({
            isPaymentRequired: true,
            data: {
              accepts: [
                {
                  payTo: "0xPayTo" as Address,
                  maxAmountRequired: "1000000",
                  maxTimeoutSeconds: 3600,
                  asset: "0xAsset" as Address,
                },
              ],
            },
          })
          .mockResolvedValueOnce({
            isPaymentRequired: true,
          });

        mockContractClient.generateX402Payment = jest.fn().mockResolvedValue({
          encodedPayment: "0xEncodedPayment",
          signature: "0xSignature",
          message: {
            from: "0xFrom" as Address,
            to: "0xTo" as Address,
            value: "1000000",
            validAfter: "0",
            validBefore: "999999999",
            nonce: "0xNonce",
          },
        });

        mockContractClient.updateJobX402Nonce = jest
          .fn()
          .mockResolvedValue(undefined);
        mockContractClient.submitTransferWithAuthorization = jest
          .fn()
          .mockResolvedValue([{ type: "TRANSFER_AUTH" }]);
        mockContractClient.getAcpVersion = jest.fn().mockReturnValue("v1");

        const result = await acpJob.payAndAcceptRequirement("Payment done");

        expect(mockContractClient.generateX402Payment).toHaveBeenCalledWith(
          {
            to: "0xPayTo",
            value: 1000000,
            maxTimeoutSeconds: 3600,
            asset: "0xAsset",
          },
          expect.objectContaining({
            accepts: expect.any(Array),
          }),
        );
        expect(mockContractClient.updateJobX402Nonce).toHaveBeenCalledWith(
          202,
          "0xNonce",
        );
        expect(
          mockContractClient.submitTransferWithAuthorization,
        ).toHaveBeenCalledWith(
          "0xFrom",
          "0xTo",
          1000000n,
          0n,
          999999999n,
          "0xNonce",
          "0xSignature",
        );
        expect(mockContractClient.handleOperation).toHaveBeenCalledWith([
          { type: "TRANSFER_AUTH" },
        ]);

        expect(result).toEqual({ hash: "0xHash" });
      });

      it("should complete X402 without transfer authorization", async () => {
        const transactionMemo: Partial<AcpMemo> = {
          id: 2,
          type: MemoType.MESSAGE,
          content: "Requirements added",
          nextPhase: AcpJobPhases.TRANSACTION,
          status: AcpMemoStatus.PENDING,
          senderAddress: "0xProvider" as Address,
          sign: jest.fn(),
        };

        acpJob = new AcpJob(
          mockAcpClient,
          203,
          "0xClient" as Address,
          "0xProvider" as Address,
          "0xEvaluator" as Address,
          1,
          "0xBaseFare" as Address,
          [transactionMemo as AcpMemo],
          AcpJobPhases.TRANSACTION,
          {},
          "0xContract" as Address,
          1,
        );

        mockContractClient.getX402PaymentDetails = jest
          .fn()
          .mockResolvedValueOnce({ isX402: true })
          .mockResolvedValueOnce({ isBudgetReceived: true });

        mockContractClient.performX402Request = jest
          .fn()
          .mockResolvedValueOnce({
            isPaymentRequired: true,
            data: {
              accepts: [
                {
                  payTo: "0xPayTo" as Address,
                  maxAmountRequired: "1000000",
                  maxTimeoutSeconds: 3600,
                  asset: "0xAsset" as Address,
                },
              ],
            },
          })
          .mockResolvedValueOnce({
            isPaymentRequired: false,
          });

        mockContractClient.generateX402Payment = jest.fn().mockResolvedValue({
          encodedPayment: "0xEncodedPayment",
          signature: "0xSignature",
          message: { nonce: "0xNonce" },
        });

        mockContractClient.updateJobX402Nonce = jest
          .fn()
          .mockResolvedValue(undefined);
        mockContractClient.submitTransferWithAuthorization = jest.fn();
        mockContractClient.getAcpVersion = jest.fn().mockReturnValue("v1");

        const result = await acpJob.payAndAcceptRequirement("Payment done");

        expect(
          mockContractClient.submitTransferWithAuthorization,
        ).not.toHaveBeenCalled();
        expect(result).toEqual({ hash: "0xHash" });
      });

      it("should succeed when X402 polling receives budget on first try", async () => {
        const transactionMemo: Partial<AcpMemo> = {
          id: 2,
          type: MemoType.MESSAGE,
          content: "Requirements added",
          nextPhase: AcpJobPhases.TRANSACTION,
          status: AcpMemoStatus.PENDING,
          senderAddress: "0xProvider" as Address,
          sign: jest.fn(),
        };

        acpJob = new AcpJob(
          mockAcpClient,
          204,
          "0xClient" as Address,
          "0xProvider" as Address,
          "0xEvaluator" as Address,
          1,
          "0xBaseFare" as Address,
          [transactionMemo as AcpMemo],
          AcpJobPhases.TRANSACTION,
          {},
          "0xContract" as Address,
          1,
        );

        mockContractClient.getX402PaymentDetails = jest
          .fn()
          .mockResolvedValueOnce({ isX402: true })
          .mockResolvedValueOnce({ isBudgetReceived: true });

        mockContractClient.performX402Request = jest
          .fn()
          .mockResolvedValueOnce({
            isPaymentRequired: true,
            data: {
              accepts: [
                {
                  payTo: "0xPayTo" as Address,
                  maxAmountRequired: "1000000",
                  maxTimeoutSeconds: 3600,
                  asset: "0xAsset" as Address,
                },
              ],
            },
          })
          .mockResolvedValueOnce({
            isPaymentRequired: false,
          });

        mockContractClient.generateX402Payment = jest.fn().mockResolvedValue({
          encodedPayment: "0xEncodedPayment",
          signature: "0xSignature",
          message: {
            from: "0xFrom" as Address,
            to: "0xTo" as Address,
            value: "1000000",
            validAfter: "0",
            validBefore: "999999999",
            nonce: "0xNonce",
          },
        });

        mockContractClient.updateJobX402Nonce = jest
          .fn()
          .mockResolvedValue(undefined);
        mockContractClient.getAcpVersion = jest.fn().mockReturnValue("v1");

        const result = await acpJob.payAndAcceptRequirement("Payment done");

        expect(mockContractClient.getX402PaymentDetails).toHaveBeenCalledTimes(
          2,
        );
        expect(result).toEqual({ hash: "0xHash" });
      });

      it("should timeout when X402 polling exceeds max iterations", async () => {
        const transactionMemo: Partial<AcpMemo> = {
          id: 2,
          type: MemoType.MESSAGE,
          content: "Requirements added",
          nextPhase: AcpJobPhases.TRANSACTION,
          status: AcpMemoStatus.PENDING,
          senderAddress: "0xProvider" as Address,
          sign: jest.fn(),
        };

        acpJob = new AcpJob(
          mockAcpClient,
          205,
          "0xClient" as Address,
          "0xProvider" as Address,
          "0xEvaluator" as Address,
          1,
          "0xBaseFare" as Address,
          [transactionMemo as AcpMemo],
          AcpJobPhases.TRANSACTION,
          {},
          "0xContract" as Address,
          1,
        );

        let callCount = 0;
        mockContractClient.getX402PaymentDetails = jest
          .fn()
          .mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve({ isX402: true });
            }
            return Promise.resolve({ isBudgetReceived: false });
          });

        mockContractClient.performX402Request = jest
          .fn()
          .mockResolvedValueOnce({
            isPaymentRequired: true,
            data: {
              accepts: [
                {
                  payTo: "0xPayTo" as Address,
                  maxAmountRequired: "1000000",
                  maxTimeoutSeconds: 3600,
                  asset: "0xAsset" as Address,
                },
              ],
            },
          })
          .mockResolvedValueOnce({
            isPaymentRequired: false,
          });

        mockContractClient.generateX402Payment = jest.fn().mockResolvedValue({
          encodedPayment: "0xEncodedPayment",
          signature: "0xSignature",
          message: {
            from: "0xFrom" as Address,
            to: "0xTo" as Address,
            value: "1000000",
            validAfter: "0",
            validBefore: "999999999",
            nonce: "0xNonce",
          },
        });

        mockContractClient.updateJobX402Nonce = jest
          .fn()
          .mockResolvedValue(undefined);
        mockContractClient.getAcpVersion = jest.fn().mockReturnValue("v1");

        jest.useFakeTimers();

        const promise = acpJob.payAndAcceptRequirement("Payment done");

        let error: Error | undefined;
        promise.catch((e) => {
          error = e;
        });

        // Fast-forward through ALL polling iterations (10 iterations of exponential backoff)
        await jest.advanceTimersByTimeAsync(2000); // First iteration
        await jest.advanceTimersByTimeAsync(4000); // Second iteration
        await jest.advanceTimersByTimeAsync(8000); // Third iteration
        await jest.advanceTimersByTimeAsync(16000); // Fourth iteration
        await jest.advanceTimersByTimeAsync(30000); // Fifth iteration (capped at maxWaitMs)
        await jest.advanceTimersByTimeAsync(30000); // Sixth iteration
        await jest.advanceTimersByTimeAsync(30000); // Seventh iteration
        await jest.advanceTimersByTimeAsync(30000); // Eighth iteration
        await jest.advanceTimersByTimeAsync(30000); // Ninth iteration
        await jest.advanceTimersByTimeAsync(30000); // Tenth iteration -> should timeout

        expect(error).toBeInstanceOf(AcpError);
        expect((error as AcpError).message).toBe("X402 payment timed out");

        // Should have polled 10 times (maxIterations) + 1 initial check = 11 total
        expect(mockContractClient.getX402PaymentDetails).toHaveBeenCalledTimes(
          11,
        );

        jest.useRealTimers();
      });
    });
  });
});

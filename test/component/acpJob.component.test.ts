import { Address } from "viem";
import AcpJob from "../../src/acpJob";
import AcpClient from "../../src/acpClient";
import AcpMemo from "../../src/acpMemo";
import BaseAcpContractClient from "../../src/contractClients/baseAcpContractClient";
import {
  AcpJobPhases,
  MemoType,
} from "../../src/contractClients/baseAcpContractClient";
import { AcpMemoStatus } from "../../src/interfaces";
import { Fare, FareAmount, FareAmountBase } from "../../src/acpFare";

describe("AcpJob Component Testing", () => {
  let mockAcpClient: jest.Mocked<AcpClient>;
  let mockContractClient: jest.Mocked<BaseAcpContractClient>;
  let acpJob: AcpJob;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContractClient = {
      contractAddress: "0xContract" as Address,
      config: {
        baseFare: new Fare("0xBaseFare" as Address, 18),
        chain: { id: 8453 },
      },
      handleOperation: jest
        .fn()
        .mockResolvedValue({ hash: "0xComponentTestHash" }),
      createMemo: jest.fn().mockReturnValue({ type: "CREATE_MEMO" }),
      approveAllowance: jest
        .fn()
        .mockReturnValue({ type: "APPROVE_ALLOWANCE" }),
      signMemo: jest.fn().mockReturnValue({ type: "SIGN_MEMO" }),
      getX402PaymentDetails: jest.fn().mockResolvedValue({ isX402: false }),
    } as any;

    mockAcpClient = {
      contractClientByAddress: jest.fn().mockReturnValue(mockContractClient),
      getAgent: jest.fn().mockResolvedValue({ id: 1, name: "Test Agent" }),
      getAccountByJobId: jest
        .fn()
        .mockResolvedValue({ id: 1, clientAddress: "0xClient" }),
    } as any;
  });

  describe("payAndAcceptRequirement", () => {
    it("should orchestrate payment flow without payable details", async () => {
      const transactionMemo: Partial<AcpMemo> = {
        id: 2,
        type: MemoType.MESSAGE,
        content: "Requirements added",
        nextPhase: AcpJobPhases.TRANSACTION,
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xProvider" as Address,
        sign: jest.fn(),
        payableDetails: undefined,
      };

      acpJob = new AcpJob(
        mockAcpClient,
        124,
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

      const result = await acpJob.payAndAcceptRequirement("Payment completed");

      expect(mockContractClient.approveAllowance).toHaveBeenCalledTimes(1);
      expect(mockContractClient.approveAllowance).toHaveBeenCalledWith(
        1000000000000000000n,
        "0xBaseFare",
      );

      expect(mockContractClient.signMemo).toHaveBeenCalledWith(
        2,
        true,
        "Payment completed",
      );

      expect(mockContractClient.createMemo).toHaveBeenCalledWith(
        124,
        "Payment made. Payment completed",
        MemoType.MESSAGE,
        true,
        AcpJobPhases.EVALUATION,
      );

      expect(mockContractClient.getX402PaymentDetails).toHaveBeenCalledWith(
        124,
      );

      expect(mockContractClient.handleOperation).toHaveBeenCalledWith([
        { type: "APPROVE_ALLOWANCE" },
        { type: "SIGN_MEMO" },
        { type: "CREATE_MEMO" },
      ]);

      expect(result).toEqual({ hash: "0xComponentTestHash" });
    });

    it("should handle same token payment (combine allowances)", async () => {
      const transactionMemo: Partial<AcpMemo> = {
        id: 3,
        type: MemoType.MESSAGE,
        content: "Requirements added",
        nextPhase: AcpJobPhases.TRANSACTION,
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xProvider" as Address,
        sign: jest.fn(),
        payableDetails: {
          amount: 500000000000000000n,
          token: "0xBaseFare" as Address,
          recipient: "0xProvider" as Address,
          feeAmount: 500000000000000000n,
        },
      };

      acpJob = new AcpJob(
        mockAcpClient,
        125,
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

      jest
        .spyOn(FareAmountBase, "fromContractAddress")
        .mockResolvedValue(
          new FareAmount(5000, new Fare("0xBaseFare" as Address, 18)),
        );

      const result = await acpJob.payAndAcceptRequirement(
        "Payment with transfer",
      );

      expect(mockContractClient.approveAllowance).toHaveBeenCalledTimes(1);
      expect(mockContractClient.approveAllowance).toHaveBeenCalledWith(
        5001000000000000000000n,
        "0xBaseFare",
      );

      expect(result).toEqual({ hash: "0xComponentTestHash" });
    });

    it("should handle different token payment (separate allowances)", async () => {
      const transactionMemo: Partial<AcpMemo> = {
        id: 4,
        type: MemoType.MESSAGE,
        content: "Requirements added",
        nextPhase: AcpJobPhases.TRANSACTION,
        status: AcpMemoStatus.PENDING,
        senderAddress: "0xProvider" as Address,
        sign: jest.fn(),
        payableDetails: {
          amount: 2000000n, // 2 USDC (6 decimals)
          token: "0xUSDC" as Address, // Different token
          recipient: "0xProvider" as Address,
          feeAmount: 500000000000000000n,
        },
      };

      acpJob = new AcpJob(
        mockAcpClient,
        126,
        "0xClient" as Address,
        "0xProvider" as Address,
        "0xEvaluator" as Address,
        1, // 1 token base fare
        "0xBaseFare" as Address,
        [transactionMemo as AcpMemo],
        AcpJobPhases.TRANSACTION,
        {},
        "0xContract" as Address,
        1,
      );

      jest
        .spyOn(FareAmountBase, "fromContractAddress")
        .mockResolvedValue(
          new FareAmount(2000000, new Fare("0xUSDC" as Address, 6)),
        );

      // Act
      const result = await acpJob.payAndAcceptRequirement(
        "Multi-token payment",
      );

      // Assert: Should approve TWO separate allowances (different tokens)
      expect(mockContractClient.approveAllowance).toHaveBeenCalledTimes(2);

      // First: base fare token
      expect(mockContractClient.approveAllowance).toHaveBeenNthCalledWith(
        1,
        1000000000000000000n,
        "0xBaseFare",
      );

      // Second: transfer token (USDC)
      expect(mockContractClient.approveAllowance).toHaveBeenNthCalledWith(
        2,
        2000000000000n,
        "0xUSDC",
      );

      expect(result).toEqual({ hash: "0xComponentTestHash" });
    });
  });

  describe("performX402Payment - Component Integration", () => {
    // X402 component tests can go here if needed
    // These would test the orchestration of X402 payment flow
    // without making real HTTP requests or blockchain calls
  });
});

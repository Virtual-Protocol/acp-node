import { Address } from "viem";
import AcpMemo from "../../src/acpMemo";
import BaseAcpContractClient, {
  AcpJobPhases,
  MemoType,
} from "../../src/contractClients/baseAcpContractClient";
import { AcpMemoStatus, PayloadType } from "../../src/interfaces";

describe("AcpMemo Unit Testing", () => {
  let mockContractClient: jest.Mocked<BaseAcpContractClient>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContractClient = {
      createMemo: jest.fn().mockReturnValue({ type: "CREATE_MEMO" }),
      signMemo: jest.fn().mockReturnValue({ type: "SIGN_MEMO" }),
      handleOperation: jest.fn().mockResolvedValue({ hash: "0xHash" }),
    } as any;
  });

  describe("Constructor", () => {
    it("should create instance with all required parameters", () => {
      const memo = new AcpMemo(
        mockContractClient,
        1,
        MemoType.MESSAGE,
        "Test content",
        AcpJobPhases.NEGOTIATION,
        AcpMemoStatus.PENDING,
        "0xSender" as Address,
      );

      expect(memo.id).toBe(1);
      expect(memo.type).toBe(MemoType.MESSAGE);
      expect(memo.content).toBe("Test content");
      expect(memo.nextPhase).toBe(AcpJobPhases.NEGOTIATION);
      expect(memo.status).toBe(AcpMemoStatus.PENDING);
      expect(memo.senderAddress).toBe("0xSender");
    });

    it("should convert payableDetails amounts to BigInt", () => {
      const memo = new AcpMemo(
        mockContractClient,
        1,
        MemoType.PAYABLE_REQUEST,
        "Payment request",
        AcpJobPhases.TRANSACTION,
        AcpMemoStatus.PENDING,
        "0xSender" as Address,
        undefined,
        undefined,
        {
          amount: 1000000 as any, // Simulating number from API
          token: "0xToken" as Address,
          recipient: "0xRecipient" as Address,
          feeAmount: 5000 as any, // Simulating number from API
        },
      );

      expect(memo.payableDetails?.amount).toBe(1000000n);
      expect(memo.payableDetails?.feeAmount).toBe(5000n);
      expect(typeof memo.payableDetails?.amount).toBe("bigint");
      expect(typeof memo.payableDetails?.feeAmount).toBe("bigint");
    });

    it("should parse valid JSON content to structuredContent", () => {
      const payload = {
        type: PayloadType.FUND_RESPONSE,
        data: { walletAddress: "0xWallet" },
      };

      const memo = new AcpMemo(
        mockContractClient,
        1,
        MemoType.MESSAGE,
        JSON.stringify(payload),
        AcpJobPhases.NEGOTIATION,
        AcpMemoStatus.PENDING,
        "0xSender" as Address,
      );

      expect(memo.structuredContent).toEqual(payload);
      expect(memo.structuredContent?.type).toBe(PayloadType.FUND_RESPONSE);
    });

    it("should set structuredContent to undefined for non-JSON content", () => {
      const memo = new AcpMemo(
        mockContractClient,
        1,
        MemoType.MESSAGE,
        "Plain text content",
        AcpJobPhases.NEGOTIATION,
        AcpMemoStatus.PENDING,
        "0xSender" as Address,
      );

      expect(memo.structuredContent).toBeUndefined();
    });

    it("should work with all optional parameters", () => {
      const memo = new AcpMemo(
        mockContractClient,
        1,
        MemoType.MESSAGE,
        "Content",
        AcpJobPhases.NEGOTIATION,
        AcpMemoStatus.APPROVED,
        "0xSender" as Address,
        "Approval reason",
        new Date("2025-12-31"),
        {
          amount: 1000n,
          token: "0xToken" as Address,
          recipient: "0xRecipient" as Address,
          feeAmount: 50n,
        },
        "0xTxHash" as `0x${string}`,
        "0xSignedTxHash" as `0x${string}`,
      );

      expect(memo.signedReason).toBe("Approval reason");
      expect(memo.expiry).toEqual(new Date("2025-12-31"));
      expect(memo.payableDetails).toBeDefined();
      expect(memo.txHash).toBe("0xTxHash");
      expect(memo.signedTxHash).toBe("0xSignedTxHash");
    });

    it("should work without payableDetails", () => {
      const memo = new AcpMemo(
        mockContractClient,
        1,
        MemoType.MESSAGE,
        "Content",
        AcpJobPhases.NEGOTIATION,
        AcpMemoStatus.PENDING,
        "0xSender" as Address,
      );

      expect(memo.payableDetails).toBeUndefined();
    });

    it("should handle empty JSON object content", () => {
      const memo = new AcpMemo(
        mockContractClient,
        1,
        MemoType.MESSAGE,
        "{}",
        AcpJobPhases.NEGOTIATION,
        AcpMemoStatus.PENDING,
        "0xSender" as Address,
      );

      expect(memo.structuredContent).toEqual({});
    });
  });

  describe("payloadType getter", () => {
    it("should return payloadType when structuredContent exists", () => {
      const payload = {
        type: PayloadType.SWAP_TOKEN,
        data: { token: "0xToken" },
      };

      const memo = new AcpMemo(
        mockContractClient,
        1,
        MemoType.MESSAGE,
        JSON.stringify(payload),
        AcpJobPhases.NEGOTIATION,
        AcpMemoStatus.PENDING,
        "0xSender" as Address,
      );

      expect(memo.payloadType).toBe(PayloadType.SWAP_TOKEN);
    });

    it("should return undefined when structuredContent is undefined", () => {
      const memo = new AcpMemo(
        mockContractClient,
        1,
        MemoType.MESSAGE,
        "Plain text",
        AcpJobPhases.NEGOTIATION,
        AcpMemoStatus.PENDING,
        "0xSender" as Address,
      );

      expect(memo.payloadType).toBeUndefined();
    });
  });

  describe("getStructuredContent", () => {
    it("should return typed structuredContent", () => {
      interface CustomData {
        value: number;
      }

      const payload = {
        type: PayloadType.FUND_RESPONSE,
        data: { value: 42 },
      };

      const memo = new AcpMemo(
        mockContractClient,
        1,
        MemoType.MESSAGE,
        JSON.stringify(payload),
        AcpJobPhases.NEGOTIATION,
        AcpMemoStatus.PENDING,
        "0xSender" as Address,
      );

      const content = memo.getStructuredContent<CustomData>();

      expect(content).toEqual(payload);
      expect(content?.data.value).toBe(42);
    });

    it("should return undefined when structuredContent is undefined", () => {
      const memo = new AcpMemo(
        mockContractClient,
        1,
        MemoType.MESSAGE,
        "Plain text",
        AcpJobPhases.NEGOTIATION,
        AcpMemoStatus.PENDING,
        "0xSender" as Address,
      );

      const content = memo.getStructuredContent();

      expect(content).toBeUndefined();
    });
  });

  describe("create", () => {
    it("should call contractClient.createMemo with correct parameters and default isSecured", async () => {
      const memo = new AcpMemo(
        mockContractClient,
        1,
        MemoType.MESSAGE,
        "Test content",
        AcpJobPhases.NEGOTIATION,
        AcpMemoStatus.PENDING,
        "0xSender" as Address,
      );

      const result = await memo.create(123);

      expect(mockContractClient.createMemo).toHaveBeenCalledWith(
        123,
        "Test content",
        MemoType.MESSAGE,
        true, // Default isSecured
        AcpJobPhases.NEGOTIATION,
      );
      expect(result).toEqual({ type: "CREATE_MEMO" });
    });

    it("should use custom isSecured value when provided", async () => {
      const memo = new AcpMemo(
        mockContractClient,
        1,
        MemoType.NOTIFICATION,
        "Notification content",
        AcpJobPhases.COMPLETED,
        AcpMemoStatus.PENDING,
        "0xSender" as Address,
      );

      await memo.create(456, false);

      expect(mockContractClient.createMemo).toHaveBeenCalledWith(
        456,
        "Notification content",
        MemoType.NOTIFICATION,
        false, // Custom isSecured
        AcpJobPhases.COMPLETED,
      );
    });

    it("should handle PAYABLE_REQUEST memo type", async () => {
      const memo = new AcpMemo(
        mockContractClient,
        1,
        MemoType.PAYABLE_REQUEST,
        "Payment request",
        AcpJobPhases.TRANSACTION,
        AcpMemoStatus.PENDING,
        "0xProvider" as Address,
      );

      await memo.create(789);

      expect(mockContractClient.createMemo).toHaveBeenCalledWith(
        789,
        "Payment request",
        MemoType.PAYABLE_REQUEST,
        true,
        AcpJobPhases.TRANSACTION,
      );
    });
  });

  describe("sign", () => {
    it("should call signMemo and handleOperation with approved=true", async () => {
      const memo = new AcpMemo(
        mockContractClient,
        1,
        MemoType.MESSAGE,
        "Test content",
        AcpJobPhases.NEGOTIATION,
        AcpMemoStatus.PENDING,
        "0xSender" as Address,
      );

      const result = await memo.sign(true, "Looks good");

      expect(mockContractClient.signMemo).toHaveBeenCalledWith(
        1,
        true,
        "Looks good",
      );
      expect(mockContractClient.handleOperation).toHaveBeenCalledWith([
        { type: "SIGN_MEMO" },
      ]);
      expect(result).toEqual({ hash: "0xHash" });
    });

    it("should call signMemo and handleOperation with approved=false", async () => {
      const memo = new AcpMemo(
        mockContractClient,
        2,
        MemoType.MESSAGE,
        "Test content",
        AcpJobPhases.NEGOTIATION,
        AcpMemoStatus.PENDING,
        "0xSender" as Address,
      );

      const result = await memo.sign(false, "Not acceptable");

      expect(mockContractClient.signMemo).toHaveBeenCalledWith(
        2,
        false,
        "Not acceptable",
      );
      expect(mockContractClient.handleOperation).toHaveBeenCalledWith([
        { type: "SIGN_MEMO" },
      ]);
      expect(result).toEqual({ hash: "0xHash" });
    });

    it("should work without reason parameter", async () => {
      const memo = new AcpMemo(
        mockContractClient,
        3,
        MemoType.MESSAGE,
        "Test content",
        AcpJobPhases.NEGOTIATION,
        AcpMemoStatus.PENDING,
        "0xSender" as Address,
      );

      await memo.sign(true);

      expect(mockContractClient.signMemo).toHaveBeenCalledWith(
        3,
        true,
        undefined,
      );
      expect(mockContractClient.handleOperation).toHaveBeenCalledWith([
        { type: "SIGN_MEMO" },
      ]);
    });

    it("should sign COMPLETED phase memo for evaluation", async () => {
      const memo = new AcpMemo(
        mockContractClient,
        4,
        MemoType.MESSAGE,
        "Deliverable submitted",
        AcpJobPhases.COMPLETED,
        AcpMemoStatus.PENDING,
        "0xProvider" as Address,
      );

      await memo.sign(true, "Work accepted");

      expect(mockContractClient.signMemo).toHaveBeenCalledWith(
        4,
        true,
        "Work accepted",
      );
      expect(mockContractClient.handleOperation).toHaveBeenCalledWith([
        { type: "SIGN_MEMO" },
      ]);
    });

    it("should handle rejection with reason", async () => {
      const memo = new AcpMemo(
        mockContractClient,
        5,
        MemoType.MESSAGE,
        "Job request",
        AcpJobPhases.NEGOTIATION,
        AcpMemoStatus.PENDING,
        "0xProvider" as Address,
      );

      await memo.sign(false, "Price too high");

      expect(mockContractClient.signMemo).toHaveBeenCalledWith(
        5,
        false,
        "Price too high",
      );
    });
  });
});

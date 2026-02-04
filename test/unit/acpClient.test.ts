import { Address } from "viem";
import { BaseAcpContractClient } from "../../src";
import AcpClient, { EvaluateResult } from "../../src/acpClient";
import AcpError from "../../src/acpError";
import AcpMemo from "../../src/acpMemo";
import AcpJob from "../../src/acpJob";
import { AcpJobPhases } from "../../src";
import { AcpAccount } from "../../src/acpAccount";
import {
  AcpAgentSort,
  AcpGraduationStatus,
  AcpOnlineStatus,
} from "../../src/interfaces";
import axios, { AxiosError } from "axios";

jest.mock("axios");
jest.mock("socket.io-client", () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    disconnect: jest.fn(),
  })),
}));

describe("AcpClient Unit Testing", () => {
  let acpClient: AcpClient;
  let mockContractClient: jest.Mocked<BaseAcpContractClient>;
  let mockAxiosGet: jest.Mock;
  let mockAxiosPost: jest.Mock;

  beforeEach(() => {
    mockAxiosGet = jest.fn();
    mockAxiosPost = jest.fn();

    (axios.create as jest.Mock).mockReturnValue({
      get: mockAxiosGet,
      post: mockAxiosPost,
    });

    mockContractClient = {
      contractAddress: "0x1234567890123456789012345678901234567890" as Address,
      walletAddress: "0x0987654321098765432109876543210987654321" as Address,
      config: {
        acpUrl: "https://test-acp-url.com",
        contractAddress:
          "0x1234567890123456789012345678901234567890" as Address,
        chain: { id: 1 },
      },
      handleOperation: jest.fn(),
      getJobId: jest.fn(),
    } as any;

    acpClient = new AcpClient({
      acpContractClient: mockContractClient,
    });
  });

  it("should able to create EvaluateResult instance", () => {
    const result = new EvaluateResult(true, "Approved");

    expect(result.isApproved).toBe(true);
    expect(result.reasoning).toBe("Approved");
  });

  it("should return first client when address is undefined", () => {
    const result = acpClient.contractClientByAddress(undefined);
    expect(result).toBe(mockContractClient);
  });

  it("should throw error when contract client not found by address", () => {
    expect(() => {
      acpClient.contractClientByAddress("0xNonexistent" as Address);
    }).toThrow("ACP contract client not found");
  });

  it("should call defaultOnEvaluate when onEvaluate callback is not provided", async () => {
    const mockJob = {
      evaluate: jest.fn().mockResolvedValue(undefined),
    } as unknown as AcpJob;

    const defaultOnEvaluate = (acpClient as any)["defaultOnEvaluate"];

    await defaultOnEvaluate.call(acpClient, mockJob);

    expect(mockJob.evaluate).toHaveBeenCalledWith(true, "Evaluated by default");
  });

  it("should register SIGINT and SIGTERM cleanup handlers", () => {
    const processSpy = jest.spyOn(process, "on");

    const mockClient = new AcpClient({
      acpContractClient: mockContractClient,
    });

    expect(processSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(processSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
  });

  // describe("Socket Event Handlers", () => {
  //   it("should handle ON_EVALUATE socket event with memos", (done) => {
  //     const mockSocketData = {
  //       id: 123,
  //       clientAddress: "0xClient" as Address,
  //       providerAddress: "0xProvider" as Address,
  //       evaluatorAddress: "0xEvaluator" as Address,
  //       price: 10,
  //       priceTokenAddress: "0xUSDCTokenAddress" as Address,
  //       memos: [
  //         {
  //           id: 1,
  //           memoType: 0,
  //           content: "evaluation memo",
  //           nextPhase: 2,
  //           status: "PENDING",
  //           senderAddress: "0xSender" as Address,
  //           signedReason: undefined,
  //           expiry: undefined,
  //           payableDetails: undefined,
  //           txHash: "0xtxhash123",
  //           signedTxHash: "0xsignedtxhash123",
  //         },
  //       ],
  //       phase: 1,
  //       context: { test: "data" },
  //       contractAddress: "0xContract" as Address,
  //       netPayableAmount: 10,
  //     };
  //
  //     const onEvaluateMock = jest.fn((job: AcpJob) => {
  //       expect(job).toBeInstanceOf(AcpJob);
  //       expect(job.id).toBe(123);
  //       expect(job.clientAddress).toBe("0xClient");
  //       expect(job.memos.length).toBe(1);
  //       expect(job.memos[0]).toBeInstanceOf(AcpMemo);
  //       expect(job.memos[0].content).toBe("evaluation memo");
  //       expect(job.memos[0].txHash).toBe("0xtxhash123");
  //       done();
  //     });
  //
  //     const mockSocketInstance = {
  //       on: jest.fn((event: string, handler: any) => {
  //         if (event === "ON_EVALUATE") {
  //           setImmediate(() => handler(mockSocketData, jest.fn()));
  //         }
  //       }),
  //       disconnect: jest.fn(),
  //     };
  //
  //     const ioMock = require("socket.io-client");
  //     ioMock.io.mockReturnValue(mockSocketInstance);
  //
  //     new AcpClient({
  //       acpContractClient: mockContractClient,
  //       onEvaluate: onEvaluateMock,
  //     });
  //   });
  // });

  describe("Agent Browsing (browseAgents)", () => {
    const createMockAgent = (overrides = {}) => ({
      id: 1,
      documentId: "doc123",
      name: "Test Agent",
      description: "A test agent",
      walletAddress: "0xAgent" as Address,
      isVirtualAgent: false,
      profilePic: "pic.jpg",
      category: "test",
      tokenAddress: null,
      ownerAddress: "0xOwner" as Address,
      cluster: null,
      twitterHandle: "@testagent",
      jobs: [
        {
          id: 1,
          name: "Test Job",
          description: "A test job",
          priceV2: {
            value: 100,
            type: "NATIVE",
          },
          requirement: "Test requirement",
          status: "active",
        },
      ],
      resources: [],
      metrics: {},
      symbol: null,
      virtualAgentId: null,
      contractAddress: "0x1234567890123456789012345678901234567890" as Address,
      ...overrides,
    });

    it("should filter out own wallet address from results", async () => {
      const mockAgents = [
        createMockAgent({
          id: 1,
          walletAddress: "0xOther" as Address,
        }),
        createMockAgent({
          id: 2,
          walletAddress:
            "0x0987654321098765432109876543210987654321" as Address,
        }),
      ];

      mockAxiosGet.mockResolvedValue({
        data: { data: mockAgents },
      });

      const result = await acpClient.browseAgents("keyword", { topK: 10 });

      expect(result.length).toBe(1);
      expect(result[0].walletAddress).toBe("0xOther");
    });

    it("should filter agents by matching contract addresses", async () => {
      const mockAgents = [
        createMockAgent({
          id: 1,
          contractAddress:
            "0x1234567890123456789012345678901234567890" as Address,
        }),
        createMockAgent({
          id: 2,
          contractAddress: "0xDifferent" as Address,
        }),
      ];

      mockAxiosGet.mockResolvedValue({
        data: { data: mockAgents },
      });

      const result = await acpClient.browseAgents("keyword", { top_k: 10 });

      expect(result!.length).toBe(1);
      expect(result![0].contractAddress).toBe(
        "0x1234567890123456789012345678901234567890",
      );
    });

    it("should transform agents to include job offerings", async () => {
      const mockAgents = [createMockAgent()];

      mockAxiosGet.mockResolvedValue({
        data: { data: mockAgents },
      });

      const result = await acpClient.browseAgents("keyword", { top_k: 10 });

      expect(result![0]).toHaveProperty("jobOfferings");
      expect(Array.isArray(result![0].jobOfferings)).toBe(true);
      expect(result![0].jobOfferings.length).toBe(1);
    });

    it("should return empty array when no agents match filters", async () => {
      const mockAgents = [
        createMockAgent({
          contractAddress: "0xDifferent" as Address,
        }),
      ];

      mockAxiosGet.mockResolvedValue({
        data: { data: mockAgents },
      });

      const result = await acpClient.browseAgents("keyword", { top_k: 10 });

      expect(result).toEqual([]);
    });

    it("should build URL with correct query parameters", async () => {
      mockAxiosGet.mockResolvedValue({
        data: { data: [] },
      });

      const keyword = "Trading";
      const top_k_value = 5;

      await acpClient.browseAgents(keyword, {
        topK: top_k_value,
        sortBy: [AcpAgentSort.SUCCESSFUL_JOB_COUNT],
        graduationStatus: AcpGraduationStatus.GRADUATED,
        onlineStatus: AcpOnlineStatus.ALL,
      });

      expect(mockAxiosGet).toHaveBeenCalledWith("/agents/v4/search", {
        params: {
          search: keyword,
          top_k: top_k_value,
          sortBy: "successfulJobCount",
          walletAddressesToExclude: acpClient.walletAddress,
          graduationStatus: "graduated",
          onlineStatus: "all",
        },
      });
    });

    it("should handle agents with empty jobs array", async () => {
      const mockAgents = [
        createMockAgent({
          jobs: [],
        }),
      ];

      mockAxiosGet.mockResolvedValue({
        data: { data: mockAgents },
      });

      const result = await acpClient.browseAgents("keyword", { top_k: 10 });

      expect(result![0].jobOfferings).toEqual([]);
    });

    it("should include cluster parameter in URL when provided", async () => {
      mockAxiosGet.mockResolvedValue({
        data: { data: [] },
      });

      await acpClient.browseAgents("keyword", {
        top_k: 5,
        cluster: "defi",
      });

      expect(mockAxiosGet).toHaveBeenCalledWith("/agents/v4/search", {
        params: expect.objectContaining({
          cluster: "defi",
        }),
      });
    });
  });

  describe("Constructor Validations", () => {
    it("should throw error when no contract clients are provided", () => {
      expect(() => {
        new AcpClient({ acpContractClient: [] as any });
      }).toThrow("ACP contract client is required");
    });
    it("should throw error when contract clients have different addresses", () => {
      const mockClient1 = {
        contractAddress:
          "0x1111111111111111111111111111111111111111" as Address,
        walletAddress: "0x0987654321098765432109876543210987654320" as Address,
        config: {
          acpUrl: "https://test-acp-url.com",
          contractAddress:
            "0x1111111111111111111111111111111111111111" as Address,
          chain: { id: 1 },
        },
        handleOperation: jest.fn(),
        getJobId: jest.fn(),
      } as any;

      const mockClient2 = {
        contractAddress:
          "0x2222222222222222222222222222222222222222" as Address,
        walletAddress: "0x0987654321098765432109876543210987654321" as Address,
        config: {
          acpUrl: "https://test-acp-url.com",
          contractAddress:
            "0x2222222222222222222222222222222222222222" as Address,
          chain: { id: 1 },
        },
        handleOperation: jest.fn(),
        getJobId: jest.fn(),
      } as any;

      expect(() => {
        new AcpClient({
          acpContractClient: [mockClient1, mockClient2],
        });
      }).toThrow(
        "All contract clients must have the same agent wallet address",
      );
    });
  });

  describe("Getting Active Jobs", () => {
    it("should get all active jobs successfully", async () => {
      const mockIAcpJobResponse = [
        {
          id: 1,
          phase: AcpJobPhases.REQUEST,
          description: "bullish",
          clientAddress: "0xClient" as Address,
          providerAddress: "0xProvider" as Address,
          evaluatorAddress: "0xEvaluator" as Address,
          price: 10,
          priceTokenAddress: "0xPriceToken" as Address,
          deliverable: null,
          memos: [],
          contractAddress:
            "0x1234567890123456789012345678901234567890" as Address,
        },
      ];

      mockAxiosGet.mockResolvedValue({
        data: { data: mockIAcpJobResponse },
      });

      const result = await acpClient.getActiveJobs();

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toBeInstanceOf(AcpJob);
      expect(mockAxiosGet).toHaveBeenCalledWith("/jobs/active", {
        params: {
          pagination: {
            page: 1,
            pageSize: 10,
          },
        },
      });
    });

    it("should map memos to AcpMemo instances in active jobs", async () => {
      const mockIAcpJobResponse = [
        {
          id: 1,
          phase: AcpJobPhases.REQUEST,
          description: "bullish",
          clientAddress: "0xClient" as Address,
          providerAddress: "0xProvider" as Address,
          evaluatorAddress: "0xEvaluator" as Address,
          price: 10,
          priceTokenAddress: "0xPriceToken" as Address,
          deliverable: null,
          memos: [
            {
              id: 1,
              memoType: 0,
              content: "test memo",
              nextPhase: 1,
              status: "PENDING",
              senderAddress: "0xSender" as Address,
              signedReason: undefined,
              expiry: undefined,
              payableDetails: undefined,
              txHash: "0xtxhash",
              signedTxHash: "0xsignedtxhash",
            },
          ],
          contractAddress:
            "0x1234567890123456789012345678901234567890" as Address,
        },
      ];

      mockAxiosGet.mockResolvedValue({
        data: { data: mockIAcpJobResponse },
      });

      const result = await acpClient.getActiveJobs();

      expect(result[0].memos.length).toBe(1);
      expect(result[0].memos[0]).toBeInstanceOf(AcpMemo);
      expect(result[0].memos[0].content).toBe("test memo");
    });

    it("should throw AcpError when API returns error", async () => {
      mockAxiosGet.mockRejectedValue(new Error("Jobs Not Found"));

      await expect(acpClient.getActiveJobs()).rejects.toThrow(AcpError);
      await expect(acpClient.getActiveJobs()).rejects.toThrow("Failed to fetch ACP Endpoint");
    });

    it("should throw AcpError when fetch fails", async () => {
      mockAxiosGet.mockRejectedValue(new Error("Network Error"));

      await expect(acpClient.getActiveJobs()).rejects.toThrow(AcpError);
      await expect(acpClient.getActiveJobs()).rejects.toThrow(
        "Failed to fetch ACP Endpoint",
      );
    });
  });

  describe("Getting Pending Memo Jobs", () => {
    it("should get all pending memo jobs successfully", async () => {
      const mockIAcpJobResponse = [
        {
          id: 1,
          phase: AcpJobPhases.REQUEST,
          description: "bullish",
          clientAddress: "0xClient" as Address,
          providerAddress: "0xProvider" as Address,
          evaluatorAddress: "0xEvaluator" as Address,
          price: 10,
          priceTokenAddress: "0xPriceToken" as Address,
          deliverable: null,
          memos: [],
          contractAddress:
            "0x1234567890123456789012345678901234567890" as Address,
        },
      ];

      mockAxiosGet.mockResolvedValue({
        data: { data: mockIAcpJobResponse },
      });

      const result = await acpClient.getPendingMemoJobs();

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toBeInstanceOf(AcpJob);
      expect(mockAxiosGet).toHaveBeenCalledWith("/jobs/pending-memos", {
        params: {
          pagination: {
            page: 1,
            pageSize: 10,
          },
        },
      });
    });

    it("should map memos to AcpMemo instances in pending memo jobs", async () => {
      const mockIAcpJobResponse = [
        {
          id: 1,
          phase: AcpJobPhases.REQUEST,
          description: "bullish",
          clientAddress: "0xClient" as Address,
          providerAddress: "0xProvider" as Address,
          evaluatorAddress: "0xEvaluator" as Address,
          price: 10,
          priceTokenAddress: "0xPriceToken" as Address,
          deliverable: null,
          memos: [
            {
              id: 1,
              memoType: 0,
              content: "pending memo",
              nextPhase: 1,
              status: "PENDING",
              senderAddress: "0xSender" as Address,
              signedReason: undefined,
              expiry: undefined,
              payableDetails: undefined,
              txHash: "0xtxhash",
              signedTxHash: "0xsignedtxhash",
            },
          ],
          contractAddress:
            "0x1234567890123456789012345678901234567890" as Address,
        },
      ];

      mockAxiosGet.mockResolvedValue({
        data: { data: mockIAcpJobResponse },
      });

      const result = await acpClient.getPendingMemoJobs();

      expect(result[0].memos.length).toBe(1);
      expect(result[0].memos[0]).toBeInstanceOf(AcpMemo);
      expect(result[0].memos[0].content).toBe("pending memo");
    });

    it("should throw AcpError when API returns error", async () => {
      mockAxiosGet.mockRejectedValue(new Error("Jobs Not Found"));

      await expect(acpClient.getPendingMemoJobs()).rejects.toThrow(AcpError);
      await expect(acpClient.getPendingMemoJobs()).rejects.toThrow(
        "Failed to fetch ACP Endpoint",
      );
    });

    it("should throw AcpError when fetch fails", async () => {
      mockAxiosGet.mockRejectedValue(new Error("Network Error"));

      await expect(acpClient.getPendingMemoJobs()).rejects.toThrow(AcpError);
      await expect(acpClient.getPendingMemoJobs()).rejects.toThrow(
        "Failed to fetch ACP Endpoint",
      );
    });
  });

  describe("Getting Completed Jobs", () => {
    it("should get all completed jobs successfully", async () => {
      const mockIAcpJobResponse = [
        {
          id: 1,
          phase: AcpJobPhases.REQUEST,
          description: "bullish",
          clientAddress: "0xClient" as Address,
          providerAddress: "0xProvider" as Address,
          evaluatorAddress: "0xEvaluator" as Address,
          price: 10,
          priceTokenAddress: "0xPriceToken" as Address,
          deliverable: null,
          memos: [],
          contractAddress:
            "0x1234567890123456789012345678901234567890" as Address,
        },
      ];

      mockAxiosGet.mockResolvedValue({
        data: { data: mockIAcpJobResponse },
      });

      const result = await acpClient.getCompletedJobs();

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toBeInstanceOf(AcpJob);
      expect(mockAxiosGet).toHaveBeenCalledWith("/jobs/completed", {
        params: {
          pagination: {
            page: 1,
            pageSize: 10,
          },
        },
      });
    });

    it("should map memos to AcpMemo instances in completed jobs", async () => {
      const mockIAcpJobResponse = [
        {
          id: 1,
          phase: AcpJobPhases.REQUEST,
          description: "bullish",
          clientAddress: "0xClient" as Address,
          providerAddress: "0xProvider" as Address,
          evaluatorAddress: "0xEvaluator" as Address,
          price: 10,
          priceTokenAddress: "0xPriceToken" as Address,
          deliverable: null,
          memos: [
            {
              id: 1,
              memoType: 0,
              content: "completed memo",
              nextPhase: 1,
              status: "COMPLETED",
              senderAddress: "0xSender" as Address,
              signedReason: undefined,
              expiry: undefined,
              payableDetails: undefined,
              txHash: "0xtxhash",
              signedTxHash: "0xsignedtxhash",
            },
          ],
          contractAddress:
            "0x1234567890123456789012345678901234567890" as Address,
        },
      ];

      mockAxiosGet.mockResolvedValue({
        data: { data: mockIAcpJobResponse },
      });

      const result = await acpClient.getCompletedJobs();

      expect(result[0].memos.length).toBe(1);
      expect(result[0].memos[0]).toBeInstanceOf(AcpMemo);
      expect(result[0].memos[0].content).toBe("completed memo");
    });

    it("should throw AcpError when API returns error", async () => {
      mockAxiosGet.mockRejectedValue(new Error("Jobs Not Found"));

      await expect(acpClient.getCompletedJobs()).rejects.toThrow(AcpError);
      await expect(acpClient.getCompletedJobs()).rejects.toThrow(
        "Failed to fetch ACP Endpoint",
      );
    });

    it("should throw AcpError when fetch fails", async () => {
      mockAxiosGet.mockRejectedValue(new Error("Network Error"));

      await expect(acpClient.getCompletedJobs()).rejects.toThrow(AcpError);
      await expect(acpClient.getCompletedJobs()).rejects.toThrow(
        "Failed to fetch ACP Endpoint",
      );
    });
  });

  describe("Getting Cancelled Jobs", () => {
    it("should get all cancelled jobs successfully", async () => {
      const mockIAcpJobResponse = [
        {
          id: 1,
          phase: AcpJobPhases.REQUEST,
          description: "bullish",
          clientAddress: "0xClient" as Address,
          providerAddress: "0xProvider" as Address,
          evaluatorAddress: "0xEvaluator" as Address,
          price: 10,
          priceTokenAddress: "0xPriceToken" as Address,
          deliverable: null,
          memos: [],
          contractAddress:
            "0x1234567890123456789012345678901234567890" as Address,
        },
      ];

      mockAxiosGet.mockResolvedValue({
        data: { data: mockIAcpJobResponse },
      });

      const result = await acpClient.getCancelledJobs();

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toBeInstanceOf(AcpJob);
      expect(mockAxiosGet).toHaveBeenCalledWith("/jobs/cancelled", {
        params: {
          pagination: {
            page: 1,
            pageSize: 10,
          },
        },
      });
    });

    it("should map memos to AcpMemo instances in cancelled jobs", async () => {
      const mockIAcpJobResponse = [
        {
          id: 1,
          phase: AcpJobPhases.REQUEST,
          description: "bullish",
          clientAddress: "0xClient" as Address,
          providerAddress: "0xProvider" as Address,
          evaluatorAddress: "0xEvaluator" as Address,
          price: 10,
          priceTokenAddress: "0xPriceToken" as Address,
          deliverable: null,
          memos: [
            {
              id: 1,
              memoType: 0,
              content: "cancelled memo",
              nextPhase: 1,
              status: "CANCELLED",
              senderAddress: "0xSender" as Address,
              signedReason: undefined,
              expiry: undefined,
              payableDetails: undefined,
              txHash: "0xtxhash",
              signedTxHash: "0xsignedtxhash",
            },
          ],
          contractAddress:
            "0x1234567890123456789012345678901234567890" as Address,
        },
      ];

      mockAxiosGet.mockResolvedValue({
        data: { data: mockIAcpJobResponse },
      });

      const result = await acpClient.getCancelledJobs();

      expect(result[0].memos.length).toBe(1);
      expect(result[0].memos[0]).toBeInstanceOf(AcpMemo);
      expect(result[0].memos[0].content).toBe("cancelled memo");
    });

    it("should throw AcpError when API returns error", async () => {
      mockAxiosGet.mockRejectedValue(new Error("Jobs Not Found"));

      await expect(acpClient.getCancelledJobs()).rejects.toThrow(AcpError);
      await expect(acpClient.getCancelledJobs()).rejects.toThrow(
        "Failed to fetch ACP Endpoint",
      );
    });

    it("should throw AcpError when fetch fails", async () => {
      mockAxiosGet.mockRejectedValue(new Error("Network Error"));

      await expect(acpClient.getCancelledJobs()).rejects.toThrow(AcpError);
      await expect(acpClient.getCancelledJobs()).rejects.toThrow(
        "Failed to fetch ACP Endpoint",
      );
    });
  });

  describe("Getting Job by Id", () => {
    it("should get job by job id successfully", async () => {
      const mockJobId = 123;

      const mockAcpJobResponse = {
        id: 1,
        phase: AcpJobPhases.REQUEST,
        description: "bullish",
        clientAddress: "0xClient" as Address,
        providerAddress: "0xProvider" as Address,
        evaluatorAddress: "0xEvaluator" as Address,
        price: 10,
        priceTokenAddress: "0xPriceToken" as Address,
        deliverable: null,
        memos: [],
        contractAddress:
          "0x1234567890123456789012345678901234567890" as Address,
      };

      mockAxiosGet.mockResolvedValue({
        data: { data: mockAcpJobResponse },
      });

      const result = await acpClient.getJobById(mockJobId);

      expect(result).toBeInstanceOf(AcpJob);
      expect(result?.id).toBe(1);
      expect(mockAxiosGet).toHaveBeenCalledWith(`/jobs/${mockJobId}`, { params: undefined });
    });

    it("should map memos to AcpMemo instances when getting job by id", async () => {
      const mockJobId = 123;

      const mockAcpJobResponse = {
        id: 1,
        phase: AcpJobPhases.REQUEST,
        description: "bullish",
        clientAddress: "0xClient" as Address,
        providerAddress: "0xProvider" as Address,
        evaluatorAddress: "0xEvaluator" as Address,
        price: 10,
        priceTokenAddress: "0xPriceToken" as Address,
        deliverable: null,
        memos: [
          {
            id: 1,
            memoType: 0,
            content: "job memo",
            nextPhase: 1,
            status: "PENDING",
            senderAddress: "0xSender" as Address,
            signedReason: undefined,
            expiry: undefined,
            payableDetails: undefined,
            txHash: "0xtxhash",
            signedTxHash: "0xsignedtxhash",
          },
        ],
        contractAddress:
          "0x1234567890123456789012345678901234567890" as Address,
      };

      mockAxiosGet.mockResolvedValue({
        data: { data: mockAcpJobResponse },
      });

      const result = await acpClient.getJobById(mockJobId);

      expect(result?.memos.length).toBe(1);
      expect(result?.memos[0]).toBeInstanceOf(AcpMemo);
      expect(result?.memos[0].content).toBe("job memo");
    });

    it("should return undefined when job doesn't exist", async () => {
      mockAxiosGet.mockResolvedValue({
        data: { data: null },
      });

      const result = await acpClient.getJobById(123);

      expect(result).toBeNull();
    });

    it("should throw AcpError when API returns error", async () => {
      mockAxiosGet.mockRejectedValue(new Error("Job Not Found"));

      await expect(acpClient.getJobById(123)).rejects.toThrow(AcpError);
      await expect(acpClient.getJobById(123)).rejects.toThrow("Failed to fetch ACP Endpoint");
    });

    it("should throw AcpError when fetch fails", async () => {
      mockAxiosGet.mockRejectedValue(new Error("Network Fail"));

      await expect(acpClient.getJobById(123)).rejects.toThrow(AcpError);
      await expect(acpClient.getJobById(123)).rejects.toThrow(
        "Failed to fetch ACP Endpoint",
      );
    });
  });

  describe("Getting Memo by Id", () => {
    it("should get memo by job id successfully", async () => {
      const mockJobId = 123;
      const mockMemoId = 456;

      const mockMemoData = {
        id: mockMemoId,
        type: "MESSAGE",
        content: "Test memo content",
        createdAt: "2024-01-01",
        memoType: 0,
        nextPhase: 1,
        status: "PENDING",
        senderAddress: "0xSender" as Address,
        signedReason: undefined,
        expiry: undefined,
        payableDetails: undefined,
        contractAddress:
          "0x1234567890123456789012345678901234567890" as Address,
      };

      mockAxiosGet.mockResolvedValue({
        data: { data: mockMemoData },
      });

      const result = await acpClient.getMemoById(mockJobId, mockMemoId);

      expect(result).toBeInstanceOf(AcpMemo);
      expect(result?.content).toBe("Test memo content");
      expect(mockAxiosGet).toHaveBeenCalledWith(`/jobs/${mockJobId}/memos/${mockMemoId}`, { params: undefined });
    });

    it("should return undefined when memo doesn't exist", async () => {
      mockAxiosGet.mockResolvedValue({
        data: { data: null },
      });

      const result = await acpClient.getMemoById(123, 456);

      expect(result).toBeNull();
    });

    it("should throw AcpError when API returns error", async () => {
      mockAxiosGet.mockRejectedValue(new Error("Memo Not Found"));

      await expect(acpClient.getMemoById(123, 456)).rejects.toThrow(AcpError);
      await expect(acpClient.getMemoById(123, 456)).rejects.toThrow(
        "Failed to fetch ACP Endpoint",
      );
    });

    it("should throw AcpError when fetch fails", async () => {
      mockAxiosGet.mockRejectedValue(new Error("Network Error"));

      await expect(acpClient.getMemoById(123, 456)).rejects.toThrow(AcpError);
      await expect(acpClient.getMemoById(123, 456)).rejects.toThrow(
        "Failed to fetch ACP Endpoint",
      );
    });
  });

  describe("Getting Agent from Wallet Address", () => {
    it("should get first agent from wallet address successfully", async () => {
      const mockWalletAddress = "0xClient" as Address;

      const mockAgent1 = {
        id: 1,
        documentId: "doc123",
        name: "Agent One",
        description: "Test agent",
        walletAddress: mockWalletAddress,
        isVirtualAgent: false,
        profilePic: "pic.jpg",
        category: "test",
        tokenAddress: null,
        ownerAddress: "0xOwner",
        cluster: null,
        twitterHandle: "@agent",
        jobs: [],
        resources: [],
        symbol: null,
        virtualAgentId: null,
        metrics: {},
        contractAddress:
          "0x1234567890123456789012345678901234567890" as Address,
      };

      const mockAgent2 = {
        id: 2,
        documentId: "doc456",
        name: "Agent Two",
        description: "Second agent",
        walletAddress: mockWalletAddress,
        isVirtualAgent: false,
        profilePic: "pic2.jpg",
        category: "test",
        tokenAddress: null,
        ownerAddress: "0xOwner",
        cluster: null,
        twitterHandle: "@agent2",
        jobs: [],
        resources: [],
        symbol: null,
        virtualAgentId: null,
        metrics: {},
        contractAddress:
          "0x1234567890123456789012345678901234567890" as Address,
      };
      mockAxiosGet.mockResolvedValue({
        data: { data: [mockAgent1, mockAgent2] },
      });

      const result = await acpClient.getAgent(mockWalletAddress);

      // Result is hydrated AcpAgent, not raw data
      expect(result).toBeDefined();
      expect(result?.id).toBe("1");  // ID is stringified
      expect(result?.name).toBe("Agent One");
      expect(mockAxiosGet).toHaveBeenCalledWith("/agents", {
        params: {
          "filters[walletAddress]": mockWalletAddress,
        },
      });
    });
  });

  describe("Getting Account by Job Id ", () => {
    it("should get account by job id", async () => {
      const mockJobId = 123;

      const mockResponseData = {
        id: 0,
        clientAddress: "0xjohnson" as Address,
        providerAddress: "0xjoshua" as Address,
        metadata: { status: "Bullish" },
      };

      mockAxiosGet.mockResolvedValue({
        data: { data: mockResponseData },
      });

      const result = await acpClient.getAccountByJobId(mockJobId);

      expect(result).toBeInstanceOf(AcpAccount);
      expect(result?.id).toBe(0);
      expect(result?.clientAddress).toBe("0xjohnson");
      expect(mockAxiosGet).toHaveBeenCalledWith(`/accounts/job/${mockJobId}`, { params: undefined });
    });

    it("should return null when account doesn't exist", async () => {
      const mockJobId = 123;

      mockAxiosGet.mockResolvedValue({
        data: { data: null },
      });

      const result = await acpClient.getAccountByJobId(mockJobId);

      expect(result).toBeNull();
    });

    it("should throw AcpError when fetch fails", async () => {
      mockAxiosGet.mockRejectedValue(new Error("Network Error"));

      await expect(acpClient.getAccountByJobId(123)).rejects.toThrow(AcpError);
    });
  });

  describe("Getting Account by Client and Provider", () => {
    it("should get account by client and provider successfully", async () => {
      const mockClientAddress = "0xClient" as Address;
      const mockProviderAddress = "0xProvider" as Address;

      const mockResponseData = {
        id: 0,
        clientAddress: "0xjohnson" as Address,
        providerAddress: "0xjoshua" as Address,
        metadata: { status: "Bullish" },
      };

      mockAxiosGet.mockResolvedValue({
        data: { data: mockResponseData },
      });

      const result = await acpClient.getByClientAndProvider(
        mockClientAddress,
        mockProviderAddress,
      );

      expect(result).toBeInstanceOf(AcpAccount);
      expect(result?.id).toBe(0);
      expect(result?.clientAddress).toBe("0xjohnson");
      expect(mockAxiosGet).toHaveBeenCalledWith(
        `/accounts/client/${mockClientAddress}/provider/${mockProviderAddress}`,
        { params: {} }
      );
    });

    it("should return null when account doesn't exist", async () => {
      const mockClientAddress = "0xClient";
      const mockProviderAddress = "0xProvider";

      mockAxiosGet.mockResolvedValue({
        data: { data: null },
      });

      const result = await acpClient.getByClientAndProvider(
        mockClientAddress,
        mockProviderAddress,
      );

      expect(result).toBeNull();
    });

    it("should throw AcpError when fetch fails", async () => {
      mockAxiosGet.mockRejectedValue(new Error("Network error"));

      await expect(
        acpClient.getByClientAndProvider(
          "0xClient" as Address,
          "0xProvider" as Address,
        ),
      ).rejects.toThrow(AcpError);

      await expect(
        acpClient.getByClientAndProvider(
          "0xClient" as Address,
          "0xProvider" as Address,
        ),
      ).rejects.toThrow("Failed to fetch ACP Endpoint");
    });
  });

  describe("Getter Methods", () => {
    it("should get wallet address correctly", () => {
      expect(acpClient.walletAddress).toBe(
        "0x0987654321098765432109876543210987654321",
      );
    });

    it("should able to get acpUrl correctly", () => {
      expect(acpClient.acpUrl).toBe("https://test-acp-url.com");
    });

    it("should able to get the first acpContractClient when multi-client exists", () => {
      const mockClient1 = {
        ...mockContractClient,
        walletAddress: "0xfirst" as Address,
      } as any;
      const mockClient2 = {
        ...mockContractClient,
        walletAddress: "0xfirst" as Address,
      } as any;

      const multiClient = new AcpClient({
        acpContractClient: [mockClient1, mockClient2],
      });

      expect(multiClient.acpContractClient).toBe(mockClient1);
    });
  });
});

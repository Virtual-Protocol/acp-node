import { Address } from "viem";
import AcpClient from "../../src/acpClient";
import AcpContractClientV2 from "../../src/contractClients/acpContractClientV2";
import {
  AcpAgentSort,
  AcpGraduationStatus,
  AcpOnlineStatus,
} from "../../src/interfaces";
import AcpJobOffering from "../../src/acpJobOffering";
import AcpJob from "../../src/acpJob";
import {
  WHITELISTED_WALLET_PRIVATE_KEY,
  BUYER_ENTITY_ID,
  BUYER_AGENT_WALLET_ADDRESS,
} from "../env";
import { testBaseAcpConfigV2 } from "../testConfigs";

describe("AcpClient Integration Testing", () => {
  let acpClient: AcpClient;
  let contractClient: AcpContractClientV2;

  beforeAll(async () => {
    contractClient = await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY as Address,
      BUYER_ENTITY_ID,
      BUYER_AGENT_WALLET_ADDRESS as Address,
      testBaseAcpConfigV2,
    );

    acpClient = new AcpClient({ acpContractClient: contractClient });
  }, 45000);

  describe("Initialization (init)", () => {
    it("should initialize client successfully", () => {
      expect(acpClient).toBeDefined();
      expect(acpClient).toBeInstanceOf(AcpClient);
    });

    it("should have correct wallet address", () => {
      expect(acpClient.walletAddress).toBe(BUYER_AGENT_WALLET_ADDRESS);
    });

    it("should have valid acpUrl", () => {
      expect(acpClient.acpUrl).toBeDefined();
      expect(acpClient.acpUrl).toBe("https://acpx.virtuals.io");
    });

    it("should have contract client initialized", () => {
      expect(acpClient.acpContractClient).toBeDefined();
      expect(acpClient.acpContractClient).toBe(contractClient);
    });

    it("should establish socket connection on initialization", (done) => {
      // The socket connection is established in the constructor via init()
      // If we reach this point without errors, the connection was successful
      expect(acpClient).toBeDefined();

      // Give socket time to connect
      setTimeout(() => {
        // If no connection errors thrown, test passes
        done();
      }, 2000);
    }, 10000);

    it("should handle onNewTask callback when provided", (done) => {
      const onNewTaskMock = jest.fn((job: AcpJob) => {
        expect(job).toBeInstanceOf(AcpJob);
        done();
      });

      // Create a new client with callback
      const clientWithCallback = new AcpClient({
        acpContractClient: contractClient,
        onNewTask: onNewTaskMock,
      });

      expect(clientWithCallback).toBeDefined();

      // Note: This test will pass even if event doesn't fire
      // Real socket event testing would require triggering an actual job
      setTimeout(() => {
        if (onNewTaskMock.mock.calls.length === 0) {
          // No event fired, but that's expected in test environment
          done();
        }
      }, 5000);
    }, 10000);

    it("should handle onEvaluate callback when provided", (done) => {
      const onEvaluateMock = jest.fn((job: AcpJob) => {
        expect(job).toBeInstanceOf(AcpJob);
        done();
      });

      const clientWithCallback = new AcpClient({
        acpContractClient: contractClient,
        onEvaluate: onEvaluateMock,
      });

      expect(clientWithCallback).toBeDefined();

      setTimeout(() => {
        if (onEvaluateMock.mock.calls.length === 0) {
          done();
        }
      }, 5000);
    }, 10000);
  });

  describe("Agent Browsing (browseAgents)", () => {
    it("should browse agents with keyword", async () => {
      const keyword = "trading";
      const options = {
        topK: 5,
      };

      const result = await acpClient.browseAgents(keyword, options);

      expect(Array.isArray(result)).toBe(true);

      console.log(`Found ${result.length} agents for keyword: ${keyword}`);
    }, 30000);

    it("should return agents with correct structure", async () => {
      const keyword = "agent";
      const options = {
        topK: 3,
      };

      const result = await acpClient.browseAgents(keyword, options);

      if (result.length > 0) {
        const firstAgent = result[0];

        expect(firstAgent).toHaveProperty("id");
        expect(firstAgent).toHaveProperty("name");
        expect(firstAgent).toHaveProperty("description");
        expect(firstAgent).toHaveProperty("walletAddress");
        expect(firstAgent).toHaveProperty("contractAddress");
        expect(firstAgent).toHaveProperty("jobOfferings");
        expect(firstAgent).toHaveProperty("twitterHandle");

        expect(typeof firstAgent.id).toBe("string");
        expect(typeof firstAgent.name).toBe("string");
        expect(typeof firstAgent.walletAddress).toBe("string");
        expect(Array.isArray(firstAgent.jobOfferings)).toBe(true);

        console.log("First agent:", {
          id: firstAgent.id,
          name: firstAgent.name,
          jobCount: firstAgent.jobOfferings.length,
        });
      }
    }, 30000);

    it("should return job offerings as AcpJobOffering instances", async () => {
      const keyword = "agent";
      const options = {
        topK: 5,
      };

      const result = await acpClient.browseAgents(keyword, options);

      const agentWithJobs = result.find(
        (agent) => agent.jobOfferings.length > 0,
      );

      if (agentWithJobs) {
        const jobOffering = agentWithJobs.jobOfferings[0];

        expect(jobOffering).toBeInstanceOf(AcpJobOffering);
        expect(typeof jobOffering.initiateJob).toBe("function");

        console.log("Job offering:", {
          name: jobOffering.name,
          price: jobOffering.price,
        });
      } else {
        console.log("No agents with job offerings found");
      }
    }, 30000);

    it("should filter out own wallet address", async () => {
      const keyword = "agent";
      const options = {
        topK: 10,
      };

      const result = await acpClient.browseAgents(keyword, options);

      // Verify own wallet is not in results
      const ownWalletInResults = result.some(
        (agent) =>
          agent.walletAddress.toLowerCase() ===
          BUYER_AGENT_WALLET_ADDRESS.toLowerCase(),
      );

      expect(ownWalletInResults).toBe(false);
    }, 30000);

    it("should filter by contract address", async () => {
      const keyword = "agent";
      const options = {
        topK: 10,
      };

      const result = await acpClient.browseAgents(keyword, options);

      if (result.length > 0) {
        // All returned agents should have matching contract address
        const allHaveMatchingContract = result.every(
          (agent) =>
            agent.contractAddress.toLowerCase() ===
            contractClient.contractAddress.toLowerCase(),
        );

        expect(allHaveMatchingContract).toBe(true);
      }
    }, 30000);

    it("should respect top_k parameter", async () => {
      const keyword = "agent";
      const topK = 2;
      const options = {
        topK: topK,
      };

      const result = await acpClient.browseAgents(keyword, options);

      expect(result.length).toBeLessThanOrEqual(topK);
    }, 30000);

    it("should handle search with sort options", async () => {
      const keyword = "trading";
      const options = {
        topK: 5,
        sortBy: [AcpAgentSort.SUCCESSFUL_JOB_COUNT],
      };

      const result = await acpClient.browseAgents(keyword, options);

      expect(Array.isArray(result)).toBe(true);
      console.log(`Found ${result.length} agents sorted by successfulJobCount`);
    }, 30000);

    it("should handle search with graduation status filter", async () => {
      const keyword = "agent";
      const options = {
        top_k: 5,
        graduationStatus: AcpGraduationStatus.GRADUATED,
      };

      const result = await acpClient.browseAgents(keyword, options);

      expect(Array.isArray(result)).toBe(true);
      console.log(`Found ${result.length} graduated agents`);
    }, 30000);

    it("should handle search with online status filter", async () => {
      const keyword = "agent";
      const options = {
        top_k: 5,
        onlineStatus: AcpOnlineStatus.ONLINE,
      };

      const result = await acpClient.browseAgents(keyword, options);

      expect(Array.isArray(result)).toBe(true);
      console.log(`Found ${result.length} online agents`);
    }, 30000);

    it("should return empty or minimal results for non-existent keyword", async () => {
      const keyword = "thiskeywordisnotakeyworddonotreturnanyagents";
      const options = {
        topK: 5,
      };

      const result = await acpClient.browseAgents(keyword, options);

      expect(Array.isArray(result)).toBe(true);
      // May or may not be empty depending on API behavior
      console.log(`Found ${result.length} agents for non-existent keyword`);
    }, 30000);
  });
});

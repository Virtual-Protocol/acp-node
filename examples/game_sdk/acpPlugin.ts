// TODO: remove this file and replace with acpPlugin v2 after it's released

import {
  GameWorker,
  GameFunction,
  ExecutableGameFunctionResponse,
  ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";
import AcpClient from "../../src/acpClient";
import AcpContractClient, { AcpJobPhases } from "../../src/acpContractClient";
import AcpJob from "../../src/acpJob";
import { Address } from "viem";
import { TwitterApi } from "@virtuals-protocol/game-twitter-node";

interface IAcpPluginOptions {
  acpContractClient: AcpContractClient;
  onNewTask?: (job: AcpJob) => void;
  twitterClient?: TwitterApi;
}

class AcpPlugin {
  private id: string;
  private name: string;
  private description: string;
  private acpClient: AcpClient;
  private twitterClient?: TwitterApi;

  constructor(options: IAcpPluginOptions) {
    this.acpClient = new AcpClient({
      acpContractClient: options.acpContractClient,
      onNewTask: options.onNewTask,
    });

    this.twitterClient = options.twitterClient;

    this.id = "acp_worker";
    this.name = "ACP Worker";
    this.description = `
    Handles trading transactions and jobs between agents. This worker ONLY manages:

    1. RESPONDING to Buy/Sell Needs
      - Find sellers when YOU need to buy something
      - Handle incoming purchase requests when others want to buy from YOU
      - NO prospecting or client finding

    2. Job Management
      - Process purchase requests. Accept or reject job.
      - Send payments
      - Manage and deliver services and goods

    3. Twitter Integration (tweet history are provided in the environment/state)
      - Post tweets about jobs
      - Reply to tweets about jobs


    NOTE: This is NOT for finding clients - only for executing trades when there's a specific need to buy or sell something.
    `;
  }

  setOnNewTask(onNewTask: (job: AcpJob) => Promise<void>) {
    this.acpClient.setOnNewTask(onNewTask);
  }

  public getWorker(data?: {
    functions?: GameFunction<any>[];
    getEnvironment?: () => Promise<Record<string, any>>;
  }): GameWorker {
    return new GameWorker({
      id: this.id,
      name: this.name,
      description: this.description,
      functions: data?.functions || [
        this.browseAgents,
        this.initiateJob,
        this.respondJob,
        this.payJob,
        this.deliverJob,
      ],
      getEnvironment: async () => {
        return {};
      },
    });
  }

  get browseAgents() {
    return new GameFunction({
      name: "browse_agents",
      description:
        "Get a list of all available trading agents and what they're selling. Use this function before initiating a job to discover potential trading partners. Each agent's entry will show their ID, name, type, walletAddress, description and product catalog with prices.",
      args: [
        {
          name: "reasoning",
          type: "string",
          description:
            "Explain why you need to find trading partners at this time",
        },
        {
          name: "keyword",
          type: "string",
          description:
            "Search for agents by name or description. Use this to find specific trading partners or products.",
        },
      ] as const,
      executable: async (args, _) => {
        if (!args.reasoning) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Reasoning for the search must be provided. This helps track your decision-making process for future reference."
          );
        }

        if (!args.keyword) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Keyword for the search must be provided. This helps track your decision-making process for future reference."
          );
        }

        try {
          const availableAgents = await this.acpClient.browseAgents(args.keyword, "yang_test");

          if (availableAgents.length === 0) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "No other trading agents found in the system. Please try again later when more agents are available."
            );
          }

          // Create a clean version of the agents data
          const cleanAgents = availableAgents.map(agent => ({
            id: agent.id,
            name: agent.name,
            description: agent.description,
            twitterHandle: agent.twitterHandle,
            walletAddress: agent.walletAddress,
            offerings: agent.offerings.map(offering => ({
              type: offering.type,
              price: offering.price
            }))
          }));

          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Done,
            JSON.stringify({
              availableAgents: cleanAgents,
              totalAgentsFound: availableAgents.length,
              note: "Use the walletAddress when initiating a job with your chosen trading partner.",
            })
          );
        } catch (e) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            `System error while searching for agents - try again after a short delay. ${e}`
          );
        }
      },
    });
  }

  get initiateJob() {
    return new GameFunction({
      name: "initiate_job",
      description:
        "Creates a purchase request for items from another agent's catalog. Only for use when YOU are the buyer. The seller must accept your request before you can proceed with payment.\n\nHint: Use this when you need to acquire items from other agents - it's the only way to make purchases in the ecosystem. You CANNOT propose sales or initiate jobs to sell your own products.",
      args: [
        {
          name: "sellerWalletAddress",
          type: "string",
          description: "The seller's agent wallet address you want to buy from",
        },
        {
          name: "reasoning",
          type: "string",
          description: "Why you are making this purchase request",
        },
        {
          name: "serviceRequirements",
          type: "string",
          description:
            "Detailed specifications for service-based items, only needed if the seller's catalog specifies service requirements. For marketing materials, provide a clear image generation prompt describing the exact visual elements, composition, and style. Come up with your own creative prompt that matches your needs - don't copy the example (e.g. '3 lemons cut in half arranged around a tall glass filled with golden lemonade, soft natural lighting, white background'). Can be left empty for items that don't require specifications.",
        },
        {
          name: "tweetContent",
          type: "string",
          description:
            "Tweet content that will be posted about this job. Must include the seller's Twitter handle (with @ symbol) to notify them",
        },
        {
          name: "requireEvaluator",
          type: "boolean",
          description:
            "Decide if your job request is complex enough to spend money for evaluator agent to assess the relevancy of the output. For simple job request like generate image, insights, facts does not require evaluation. For complex and high level job like generating a promotion video, a marketing narrative, a trading signal should require evaluator to assess result relevancy.",
        },
        {
          name: "evaluatorKeyword",
          type: "string",
          description: "Keyword to search for a evaluator.",
        },
      ] as const,
      executable: async (args, _) => {
        if (!args.reasoning) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Missing reasoning - explain why you're making this purchase"
          );
        }

        try {
          if (!args.sellerWalletAddress) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "Missing seller wallet address - specify who you're buying from"
            );
          }

          if (!args.serviceRequirements) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "Missing service requirements - provide detailed specifications for service-based items or marketing materials"
            );
          }

          if (!args.tweetContent) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "Missing tweet content - provide the content of the tweet that will be posted about this job"
            );
          }

          if (args.sellerWalletAddress === this.acpClient.acpContractClient.walletAddress) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "Cannot create job with yourself - choose a different seller"
            );
          }

          const requireValidator = args.requireEvaluator?.toString() === "true";
          if (requireValidator && !args.evaluatorKeyword) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "Missing validator keyword - provide a keyword to search for a validator"
            );
          }

          const jobId = await this.acpClient.initiateJob(
            args.sellerWalletAddress as Address,
            args.serviceRequirements,
            0.5,
          );

          if (this.twitterClient) {
            const tweet = await this.twitterClient.v2.tweet(args.tweetContent);
            console.log("Tweet posted:", tweet.data.id);
          }

          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Done,
            JSON.stringify({
              jobId: jobId,
              sellerWalletAddress: args.sellerWalletAddress,
              serviceRequirements: args.serviceRequirements,
              timestamp: Date.now(),
            })
          );
        } catch (e) {
          console.error(e);

          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            `System error while initiating job - try again after a short delay. ${e}`
          );
        }
      },
    });
  }

  get respondJob() {
    return new GameFunction({
      name: "respond_to_job",
      description:
        "Accepts or rejects an incoming 'request' job. Only for use when YOU are the seller. After accepting, you must wait for buyer's payment before delivery. Use if you want to cancel a request/job.\n\nHint: For all incoming jobs, you must respond (accept/reject) before being able to progress the job in any way.",
      args: [
        {
          name: "jobId",
          type: "string",
          description: "The job ID you are responding to",
        },
        {
          name: "decision",
          type: "string",
          description: "Your response: 'ACCEPT' or 'REJECT'",
        },
        {
          name: "reasoning",
          type: "string",
          description: "Why you made this decision",
        },

        {
          name: "tweetContent",
          type: "string",
          description:
            "Tweet content that will be posted about this job as a reply to the previous tweet",
        },
      ] as const,
      executable: async (args, _) => {
        if (!args.jobId) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Missing job ID - specify which job you're responding to"
          );
        }
        if (!args.decision || !["ACCEPT", "REJECT"].includes(args.decision)) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Invalid decision - must be either 'ACCEPT' or 'REJECT'"
          );
        }
        if (!args.reasoning) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Missing reasoning - explain why you made this decision"
          );
        }

        if (!args.tweetContent) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Missing tweet content - provide the content of the tweet that will be posted about this job"
          );
        }

        try {
          const activeJobs = await this.acpClient.getActiveJobs();

          const job = activeJobs.find(
            (c) => c.id === +args.jobId!
          );

          if (!job) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "Job not found in your seller jobs - check the ID and verify you're the seller"
            );
          }

          const memo = job.memos.find(
            (m) => m.nextPhase === AcpJobPhases.NEGOTIATION
          );

          if (!memo) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "No negotiation memo found"
            );
          }

          await this.acpClient.respondJob(
            +args.jobId,
            memo.id,
            args.decision === "ACCEPT",
            args.reasoning
          );

          const buyerAgent = await this.acpClient.browseAgentByWalletAddress(job.clientAddress);

          if (this.twitterClient) {
            const tweet = await this.twitterClient.v2.tweet(`@${buyerAgent.twitterHandle} ${args.tweetContent}`);
            console.log("Tweet posted:", tweet.data.id);
          }

          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Done,
            JSON.stringify({
              jobId: args.jobId,
              decision: args.decision,
              timestamp: Date.now(),
            })
          );
        } catch (e) {
          console.error(e);

          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            `System error while responding to job - try again after a short delay. ${e}`
          );
        }
      },
    });
  }

  get payJob() {
    return new GameFunction({
      name: "pay_job",
      description:
        "Processes payment for an accepted purchase request. Only for use when YOU are the buyer. you can only make payment when job phase is 'pending_payment'. After payment is verified, you must wait for the seller to deliver.\n\nHint: This is your next step after a seller accepts your purchase request - you can't get the items without paying first.",
      args: [
        {
          name: "jobId",
          type: "number",
          description: "The job ID you are paying for",
        },
        {
          name: "amount",
          type: "number",
          description: "The total amount to pay, defaulted to 0.5",
        },
        {
          name: "reasoning",
          type: "string",
          description: "Why you are making this payment",
        },
        {
          name: "tweetContent",
          type: "string",
          description:
            "Tweet content that will be posted about this job as a reply to the previous tweet (do not use @ symbol)",
        },
      ] as const,
      executable: async (args, _) => {
        if (!args.jobId) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Missing job ID - specify which job you're paying for"
          );
        }

        if (!args.amount) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Missing amount - specify how much you're paying"
          );
        }

        if (!args.reasoning) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Missing reasoning - explain why you're making this payment"
          );
        }

        if (!args.tweetContent) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Missing tweet content - provide the content of the tweet that will be posted about this job"
          );
        }

        try {
          const activeJobs = await this.acpClient.getActiveJobs();

          const job = activeJobs.find(
            (c) => c.id === +args.jobId!
          );

          if (!job) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "Job not found in your buyer jobs - check the ID and verify you're the buyer"
            );
          }

          const memo = job.memos.find(
            (m) => m.nextPhase === AcpJobPhases.TRANSACTION
          );

          if (!memo) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "No transaction memo found"
            );
          }

          await this.acpClient.payJob(
            +args.jobId,
            +args.amount,
            memo.id,
            args.reasoning
          );

          const sellerAgent = await this.acpClient.browseAgentByWalletAddress(job.providerAddress);

          if (this.twitterClient) {
            const tweet = await this.twitterClient.v2.tweet(`@${sellerAgent.twitterHandle} ${args.tweetContent}`);
            console.log("Tweet posted:", tweet.data.id);
          }

          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Done,
            `Payment successfully processed! Here are the details:\n${JSON.stringify(
              {
                jobId: args.jobId,
                amountPaid: args.amount,
                timestamp: Date.now(),
              }
            )}`
          );
        } catch (e) {
          console.error(e);

          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            `System error while processing payment - try again after a short delay. ${e}`
          );
        }
      },
    });
  }

  get deliverJob() {
    return new GameFunction({
      name: "deliver_job",
      description:
        "Completes a sale by delivering items to the buyer. Only for use when YOU are the seller and payment is verified. After delivery, the job is completed and payment is released to your wallet.\n\nHint: This is how you fulfill your sales and get paid - use it as soon as you see payment is verified.",
      args: [
        {
          name: "jobId",
          type: "string",
          description: "The job ID you are delivering for",
        },
        {
          name: "deliverableType",
          type: "string",
          description: "Type of the deliverable",
        },
        {
          name: "deliverable",
          type: "string",
          description: "The deliverable item",
        },
        {
          name: "reasoning",
          type: "string",
          description: "Why you are making this delivery",
        },
        {
          name: "tweetContent",
          type: "string",
          description:
            "Tweet content that will be posted about this job as a reply to the previous tweet (do not use @ symbol)",
        },
      ] as const,
      executable: async (args, _) => {
        if (!args.jobId) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Missing job ID - specify which job you're delivering for"
          );
        }
        if (!args.reasoning) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Missing reasoning - explain why you're making this delivery"
          );
        }
        if (!args.deliverable) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Missing deliverable - specify what you're delivering"
          );
        }

        if (!args.tweetContent) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Missing tweet content - provide the content of the tweet that will be posted about this job"
          );
        }

        try {
          const activeJobs = await this.acpClient.getActiveJobs();

          const job = activeJobs.find(
            (c) => c.id === +args.jobId!
          );

          if (!job) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "job not found in your seller jobs - check the ID and verify you're the seller"
            );
          }

          const deliverable = JSON.stringify({
            type: args.deliverableType,
            value: args.deliverable,
          });

          await this.acpClient.deliverJob(+args.jobId, deliverable);

          const buyerAgent = await this.acpClient.browseAgentByWalletAddress(job.clientAddress);

          if (this.twitterClient) {
            const tweet = await this.twitterClient.v2.tweet(`@${buyerAgent.twitterHandle} ${args.tweetContent}`);
            console.log("Tweet posted:", tweet.data.id);
          }

          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Done,
            JSON.stringify({
              status: "success",
              jobId: args.jobId,
              deliverable: args.deliverable,
              timestamp: Date.now(),
            })
          );
        } catch (e) {
          console.error(e);

          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            `System error while delivering items - try again after a short delay. ${e}`
          );
        }
      },
    });
  }
}

export default AcpPlugin;

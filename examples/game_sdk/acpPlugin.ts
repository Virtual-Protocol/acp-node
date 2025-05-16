// TODO: Point the imports to acp-node after publishing

import {
  GameWorker,
  GameFunction,
  ExecutableGameFunctionResponse,
  ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";
import AcpClient from "../../src/acpClient";
import { AcpJobPhases } from "../../src/acpContractClient";
import {  IInventory } from "./interface";
import { TwitterApi } from "@virtuals-protocol/game-twitter-node";
import { Address } from "viem";

interface ITweetHistory {
  tweetId: string;
  content: string;
  jobId: number;
  phase: AcpJobPhases;
}

interface ITweetResponse {
  tweetId: string;
  content: string;
}

interface IAcpPluginOptions {
  acpClient: AcpClient;
  twitterClient?: TwitterApi;
  cluster?: string;
  jobExpiryDurationMins?: number;
}

class AcpPlugin {
  // .
  private twitterClient?: TwitterApi;
  private tweetHistory: Map<number, ITweetHistory[]> = new Map();

  constructor(options: IAcpPluginOptions) {
    // .
    // .
    this.twitterClient = options.twitterClient;
    // .
    // this.id = "acp_worker";
    // this.name = "ACP Worker";
    // .
  }

  /**
   * Helper method to handle tweet posting and history management
   * @param jobId - The job ID associated with the tweet
   * @param content - The tweet content
   * @param phase - The current job phase
   * @param replyToTweetId - Optional tweet ID to reply to
   * @returns Promise<ITweetResponse>
   */
  private async handleTweet(
    jobId: number,
    content: string,
    phase: AcpJobPhases,
    replyToTweetId?: string
  ): Promise<ITweetResponse> {
    if (!this.twitterClient) {
      throw new Error("Twitter client not initialized");
    }

    try {
      let tweet;
      if (replyToTweetId) {
        tweet = await this.twitterClient.v2.reply(replyToTweetId, content);
      } else {
        tweet = await this.twitterClient.v2.post(content);
      }

      const tweetData: ITweetHistory = {
        tweetId: tweet.data.id,
        content,
        jobId,
        phase,
      };

      // Update local tweet history
      const jobTweets = this.tweetHistory.get(jobId) || [];
      this.tweetHistory.set(jobId, [...jobTweets, tweetData]);

      // TODO: When API server is ready, implement proper tweet history storage
      // await this.acpClient.addTweet(jobId, tweet.data.id, content);

      return {
        tweetId: tweet.data.id,
        content,
      };
    } catch (error: unknown) {
      console.error("Error handling tweet:", error);
      throw new Error(`Failed to handle tweet: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get tweet history for a specific job
   * @param jobId - The job ID to get tweet history for
   * @returns ITweetHistory[]
   */
  private getJobTweetHistory(jobId: number): ITweetHistory[] {
    return this.tweetHistory.get(jobId) || [];
  }

  /**
   * Get the latest tweet for a specific job
   * @param jobId - The job ID to get the latest tweet for
   * @returns ITweetHistory | undefined
   */
  private getLatestJobTweet(jobId: number): ITweetHistory | undefined {
    const tweets = this.getJobTweetHistory(jobId);
    return tweets[tweets.length - 1];
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
          name: "price",
          type: "string",
          description: "Offered price for service",
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
        try {
          // .
          if (this.twitterClient) {
            await this.handleTweet(
              jobId,
              args.tweetContent,
              AcpJobPhases.REQUEST
            );
          }

          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Done,
            JSON.stringify({
              jobId: jobId,
              sellerWalletAddress: args.sellerWalletAddress,
              price: price,
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
            "Tweet content that will be posted about this job as a reply to the previous tweet (do not use @ symbol)",
        },
      ] as const,
      executable: async (args, _) => {
        try {
          // .
          if (this.twitterClient) {
            const latestTweet = this.getLatestJobTweet(+args.jobId);
            if (latestTweet) {
              await this.handleTweet(
                +args.jobId,
                args.tweetContent,
                AcpJobPhases.NEGOTIATION,
                latestTweet.tweetId
              );
            }
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
          description: "The total amount to pay",
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
        try{
          // .
          if (this.twitterClient) {
            const latestTweet = this.getLatestJobTweet(+args.jobId);
            if (latestTweet) {
              await this.handleTweet(
                +args.jobId,
                args.tweetContent,
                AcpJobPhases.TRANSACTION,
                latestTweet.tweetId
              );
            }
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
        try {
          // .
          if (this.twitterClient) {
            const latestTweet = this.getLatestJobTweet(+args.jobId);
            if (latestTweet) {
              await this.handleTweet(
                +args.jobId,
                args.tweetContent,
                AcpJobPhases.COMPLETED,
                latestTweet.tweetId
              );
            }
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

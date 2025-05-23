import { GameAgent } from "@virtuals-protocol/game";
import * as readline from "readline";
import {
  WHITELISTED_WALLET_PRIVATE_KEY,
  WHITELISTED_WALLET_ENTITY_ID,
  BUYER_AGENT_WALLET_ADDRESS,
  GAME_API_KEY,
} from "./env";
import AcpPlugin from "./acpPlugin";
import AcpJob from "../../src/acpJob";
import AcpContractClient from "../../src/acpContractClient";
import { TwitterApi } from "@virtuals-protocol/game-twitter-node";
import { BUYER_AGENT_GAME_TWITTER_ACCESS_TOKEN } from "./env";
import { baseSepoliaAcpConfig } from "../../src/configs";


function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

const twitterClient = new TwitterApi({
  gameTwitterAccessToken: BUYER_AGENT_GAME_TWITTER_ACCESS_TOKEN,
});

async function test() {
  const acpPlugin = new AcpPlugin({
    acpContractClient: await AcpContractClient.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      WHITELISTED_WALLET_ENTITY_ID,
      BUYER_AGENT_WALLET_ADDRESS,
      baseSepoliaAcpConfig,
    ),
    twitterClient: twitterClient,
  });

  const ACP_BUYER_AGENT_BASIC_CONFIG = {
    name: "Virtuals",
    goal: "Perform and complete transanction with seller, look for agents to help you generating meme",
    description: `
        Agent that gain market traction by posting meme. 
        You can head to acp to look for agents to help you with meme.
        Do not look a relevant validator to validate the deliverable.

        1. Initiate a job
        2. Pay for the job
        `,
  };

  /// start a new buyer agent to handle payments
  const buyerAgent = new GameAgent(GAME_API_KEY, {
    ...ACP_BUYER_AGENT_BASIC_CONFIG,
    workers: [
      acpPlugin.getWorker({
        functions: [acpPlugin.payJob],
      }),
    ],
  });

  await buyerAgent.init();

  // upon phase change, the buyer agent will respond to the transaction
  acpPlugin.setOnNewTask(async (job: AcpJob) => {
    console.log("buyer agent reacting to job", job);

    const cleanJob = {
      id: job.id,
      clientAddress: job.clientAddress,
      providerAddress: job.providerAddress,
      evaluatorAddress: job.evaluatorAddress,
      phase: job.phase,
      memos: job.memos.map(memo => ({
        id: memo.id,
        type: memo.type,
        content: memo.content,
        nextPhase: memo.nextPhase
      }))
    };

    console.log(`New job received! Here are the details:\n${JSON.stringify(cleanJob, null, 2)}`);

    await buyerAgent.getWorkerById("acp_worker").runTask(
      `
          Respond to the following transaction: 
          ${JSON.stringify(cleanJob, null, 2)}`,
      {
        verbose: true,
      }
    );

    console.log("buyer agent has responded to the job");
  });
  /// end of buyer reactive agent

  const agent = new GameAgent(GAME_API_KEY, {
    ...ACP_BUYER_AGENT_BASIC_CONFIG,
    workers: [
      acpPlugin.getWorker({
        // buyer to have only both search and initiate job, once job is initiated, it will be handled by the buyer reactive agent
        functions: [acpPlugin.browseAgents, acpPlugin.initiateJob],
      }),
    ],
  });

  await agent.init();

  while (true) {
    await agent.step({
      verbose: true,
    });

    await askQuestion("\nPress any key to continue...\n");
  }
}

test();

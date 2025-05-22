// TODO: Point the imports to acp-node after publishing

import AcpClient from "../../../src/acpClient";
import AcpContractClient, {
  AcpJobPhases,
} from "../../../src/acpContractClient";
import AcpJob from "../../../src/acpJob";
import { baseSepoliaAcpConfig } from "../../../src";
import {
  BUYER_AGENT_WALLET_ADDRESS,
  BUYER_ENTITY_ID,
  WHITELISTED_WALLET_PRIVATE_KEY,
  GAME_TWITTER_BEARER_TOKEN,
} from "./env";
import { TwitterApi } from "@virtuals-protocol/game-twitter-node";
async function buyer() {
  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClient.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      BUYER_ENTITY_ID,
      BUYER_AGENT_WALLET_ADDRESS,
      baseSepoliaAcpConfig
    ),
    gameTwitterClient: new TwitterApi({
      gameTwitterAccessToken: GAME_TWITTER_BEARER_TOKEN,
    }),
    onNewTask: async (job: AcpJob) => {
      if (
        job.phase === AcpJobPhases.NEGOTIATION &&
        job.memos.find((m) => m.nextPhase === AcpJobPhases.TRANSACTION)
      ) {
        console.log("Paying job", job);
        await job.pay(1);
        console.log(`Job ${job.id} paid`);
      } else if (job.phase === AcpJobPhases.COMPLETED) {
        console.log(`Job ${job.id} completed`);
      }
    },
    onEvaluate: async (job: AcpJob) => {
      console.log("Evaluation function called", job);
      await job.evaluate(true, "Self-evaluated and approved");
      console.log(`Job ${job.id} evaluated`);
    },
  });

  const relevantAgents = await acpClient.browseAgents("meme", "999");
  console.log("Relevant seller agents: ", relevantAgents);
  // Pick one of the agents based on your criteria (in this example we just pick the second one)
  const chosenAgent = relevantAgents[1];
  // Pick one of the service offerings based on your criteria (in this example we just pick the first one)
  const chosenJobOffering = chosenAgent.offerings[0];

  const jobId = await chosenJobOffering.initiateJob(
    chosenJobOffering.requirementSchema || {},
    new Date(Date.now() + 1000 * 60 * 60 * 24),
    BUYER_AGENT_WALLET_ADDRESS,
    chosenAgent.twitterHandle
  );

  console.log(`Job ${jobId} initiated`);
}

buyer();

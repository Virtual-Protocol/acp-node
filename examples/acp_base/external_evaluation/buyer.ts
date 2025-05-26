// TODO: Point the imports to acp-node after publishing

import AcpClient, {
  AcpContractClient,
  AcpJobPhases,
  AcpJob,
  baseSepoliaAcpConfig,
} from "@virtuals-protocol/acp-node";
import {
  BUYER_AGENT_WALLET_ADDRESS,
  EVALUATOR_AGENT_WALLET_ADDRESS,
  BUYER_ENTITY_ID,
  GAME_TWITTER_BEARER_TOKEN,
  BUYER_WALLET_PRIVATE_KEY,
} from "./env";
import { TwitterApi } from "@virtuals-protocol/game-twitter-node";
async function buyer() {
  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClient.build(
      BUYER_WALLET_PRIVATE_KEY,
      BUYER_ENTITY_ID,
      BUYER_AGENT_WALLET_ADDRESS,
      baseSepoliaAcpConfig
    ),
    onNewTask: async (job: AcpJob) => {
      if (
        job.phase === AcpJobPhases.NEGOTIATION &&
        job.memos.find((m) => m.nextPhase === AcpJobPhases.TRANSACTION)
      ) {
        console.log("Paying job", job);
        await job.pay(job.price);
        console.log(`Job ${job.id} paid`);
      } else if (job.phase === AcpJobPhases.COMPLETED) {
        console.log(`Job ${job.id} completed`);
      }
    },
    gameTwitterClient: new TwitterApi({
      gameTwitterAccessToken: GAME_TWITTER_BEARER_TOKEN,
    }),
  });

  // Browse available agents based on a keyword and cluster name
  const relevantAgents = await acpClient.browseAgents(
    "<your-filter-agent-keyword>",
    "<your-cluster-name>"
  );
  console.log("Relevant seller agents: ", relevantAgents);
  // Pick one of the agents based on your criteria (in this example we just pick the second one)
  const chosenAgent = relevantAgents[1];
  // Pick one of the service offerings based on your criteria (in this example we just pick the first one)
  const chosenJobOffering = chosenAgent.offerings[0];

  const jobId = await chosenJobOffering.initiateJob(
    // <your_schema_field> can be found in your ACP Visualiser's "Edit Service" pop-up.
    // Reference: (./images/specify-requirement-toggle-switch.png)
    { "<your_schema_field>": "Help me to generate a flower meme." },
    new Date(Date.now() + 1000 * 60 * 60 * 24),
    EVALUATOR_AGENT_WALLET_ADDRESS,
    chosenAgent.twitterHandle
  );

  console.log(`Job ${jobId} initiated`);
}

buyer();

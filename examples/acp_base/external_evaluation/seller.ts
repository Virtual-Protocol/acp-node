// TODO: Point the imports to acp-node after publishing
import AcpClient, {
  AcpContractClient,
  AcpJobPhases,
  AcpJob,
  baseSepoliaAcpConfig,
} from "@virtuals-protocol/acp-node";
import {
  SELLER_AGENT_WALLET_ADDRESS,
  SELLER_ENTITY_ID,
  SELLER_WALLET_PRIVATE_KEY,
  GAME_TWITTER_BEARER_TOKEN,
} from "./env";
import { TwitterApi } from "@virtuals-protocol/game-twitter-node";

async function seller() {
  new AcpClient({
    acpContractClient: await AcpContractClient.build(
      SELLER_WALLET_PRIVATE_KEY,
      SELLER_ENTITY_ID,
      SELLER_AGENT_WALLET_ADDRESS,
      baseSepoliaAcpConfig
    ),
    onNewTask: async (job: AcpJob) => {
      if (
        job.phase === AcpJobPhases.REQUEST &&
        job.memos.find((m) => m.nextPhase === AcpJobPhases.NEGOTIATION)
      ) {
        console.log("Responding to job", job);
        await job.respond(true);
        console.log(`Job ${job.id} responded`);
      } else if (
        job.phase === AcpJobPhases.TRANSACTION &&
        job.memos.find((m) => m.nextPhase === AcpJobPhases.EVALUATION)
      ) {
        console.log("Delivering job", job);
        await job.deliver(
          JSON.stringify({
            type: "url",
            value: "https://example.com",
          })
        );
        console.log(`Job ${job.id} delivered`);
      }
    },
    gameTwitterClient: new TwitterApi({
      gameTwitterAccessToken: GAME_TWITTER_BEARER_TOKEN,
    }),
  });
}

seller();

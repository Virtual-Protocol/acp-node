import {
  GameAgent,
} from "@virtuals-protocol/game";
import {
  GAME_API_KEY,
  SELLER_AGENT_WALLET_ADDRESS,
  WHITELISTED_WALLET_PRIVATE_KEY,
  WHITELISTED_WALLET_ENTITY_ID,
  SELLER_AGENT_GAME_TWITTER_ACCESS_TOKEN
} from "./env";
import AcpPlugin from "./acpPlugin";
import AcpJob from "../../src/acpJob";
import AcpContractClient, { AcpJobPhases } from "../../src/acpContractClient";
import { TwitterApi } from "@virtuals-protocol/game-twitter-node";
import { baseSepoliaAcpConfig } from "../../src/configs";


const twitterClient = new TwitterApi({
  gameTwitterAccessToken: SELLER_AGENT_GAME_TWITTER_ACCESS_TOKEN,
});

async function test() {
  const acpPlugin = new AcpPlugin({
    acpContractClient: await AcpContractClient.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      WHITELISTED_WALLET_ENTITY_ID,
      SELLER_AGENT_WALLET_ADDRESS,
      baseSepoliaAcpConfig
    ),
    twitterClient: twitterClient,
  });

  /// start a new seller agent to handle respond and deliver job
  const sellerAgent = new GameAgent(GAME_API_KEY, {
      name: "Memx",
      goal: "To provide meme generation as a service. You should go to ecosystem worker to respond to any job once you have gotten it as a seller.",
      description: `
      You are Memx, a meme generator. Meme generation is your life. You always give buyer the best meme.
      `,
      workers: [
          acpPlugin.getWorker({
              // restrict to just seller specified functions
              functions: [acpPlugin.respondJob, acpPlugin.deliverJob],
          }),
      ],
  });

  await sellerAgent.init();

  /// upon phase change, the seller agent will respond to the job
  acpPlugin.setOnNewTask(async (job: AcpJob) => {
      console.log("reacting to job", job);
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

      let prompt = "";

      if (job.phase === AcpJobPhases.REQUEST) {
          prompt = `
          Respond to the following transaction:
          ${JSON.stringify(cleanJob, null, 2)}

          decide to whether you should accept the job or not.
          once you have responded to the job, do not proceed with producing the deliverable and wait.
          `;
      } else if (job.phase === AcpJobPhases.TRANSACTION) {
          prompt = `
    Respond to the following transaction.
    ${JSON.stringify(cleanJob, null, 2)}

    you should produce the deliverable and deliver it to the buyer.
    `;
      }

      await sellerAgent.getWorkerById("acp_worker").runTask(prompt, {
          verbose: true,
      });

      console.log("reacting to job done");
  });
  /// end of seller reactive agent
  console.log("Listening");

  // NOTE: this agent only listen to the job and respond to it.
}

test();

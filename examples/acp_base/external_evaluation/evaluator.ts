// TODO: Point the imports to acp-node after publishing
import AcpClient, { 
    AcpContractClient, 
    AcpJobPhases, 
    AcpJob, 
    baseSepoliaAcpConfig 
  } from '@virtuals-protocol/acp-node';
import {
  EVALUATOR_AGENT_WALLET_ADDRESS,
  EVALUATOR_ENTITY_ID,
  EVALUATOR_WALLET_PRIVATE_KEY,
} from "./env";

async function evaluator() {
  new AcpClient({
    acpContractClient: await AcpContractClient.build(
      EVALUATOR_WALLET_PRIVATE_KEY,
      EVALUATOR_ENTITY_ID,
      EVALUATOR_AGENT_WALLET_ADDRESS,
      baseSepoliaAcpConfig
    ),
    onEvaluate: async (job: AcpJob) => {
      console.log("Evaluation function called", job);
      await job.evaluate(true, "Externally evaluated and approved");
      console.log(`Job ${job.id} evaluated`);
    },
  });
}

evaluator();

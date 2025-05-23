// TODO: Point the imports to acp-node after publishing

import AcpClient from "../../../src/acpClient";
import AcpContractClient from "../../../src/acpContractClient";
import AcpJob from "../../../src/acpJob";
import { baseSepoliaAcpConfig } from "../../../src";
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

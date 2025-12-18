import AcpClient, {
  AcpContractClientV2,
  AcpError,
  AcpJobPhases,
} from "@virtuals-protocol/acp-node";
import {
  WHITELISTED_WALLET_PRIVATE_KEY,
  EVALUATOR_AGENT_WALLET_ADDRESS,
  EVALUATOR_ENTITY_ID,
} from "./env";

// --- Configuration for the job polling interval ---
const POLL_INTERVAL_MS = 20000; // 20 seconds
// --------------------------------------------------

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function evaluator() {
  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      EVALUATOR_ENTITY_ID,
      EVALUATOR_AGENT_WALLET_ADDRESS,
    ),
  });
  console.log(`Evaluator ACP Initialized. Agent: ${EVALUATOR_AGENT_WALLET_ADDRESS}`);

  while (true) {
    console.log(`\nEvaluator: Polling for jobs assigned to ${EVALUATOR_AGENT_WALLET_ADDRESS} requiring evaluation...`);
    const activeJobsList = await acpClient.getActiveJobs();

    if (activeJobsList instanceof AcpError) {
      console.error(activeJobsList);
      break;
    }

    if (activeJobsList.length === 0) {
      console.log("Evaluator: No active jobs found in this poll.");
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    for (const job of activeJobsList) {
      const currentPhase = job.phase;
      const phaseName = AcpJobPhases[currentPhase];

      // Ensure this job is for the current evaluator
      if (job.evaluatorAddress !== EVALUATOR_AGENT_WALLET_ADDRESS) {
        continue;
      }

      if (currentPhase === AcpJobPhases.EVALUATION) {
        console.log(`Evaluator: Found Job ${job.id} in EVALUATION phase.`);

        // Simple evaluation logic: always accept
        const acceptTheDelivery = true;
        const evaluationReason = "Deliverable looks great, approved!";

        console.log(
          `  Job ${job.id}: Evaluating... Accepting: ${acceptTheDelivery}`
        );
        await job.evaluate(
          acceptTheDelivery,
          evaluationReason,
        );
        console.log(
          `  Job ${job.id}: Evaluation submitted.`
        );
      } else if (
        currentPhase === AcpJobPhases.REQUEST ||
        currentPhase === AcpJobPhases.NEGOTIATION
      ) {
        console.log(
          `Evaluator: Job ${job.id} is in ${phaseName} phase. Waiting for job to be delivered.`
        );
      } else if (
        currentPhase === AcpJobPhases.COMPLETED ||
        currentPhase === AcpJobPhases.REJECTED
      ) {
        console.log(
          `Evaluator: Job ${job.id} is already in ${phaseName}. No action.`
        );
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

evaluator();

import AcpClient, {
  AcpContractClientV2,
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

    if (!activeJobsList || activeJobsList.length === 0) {
      console.log("Evaluator: No active jobs found in this poll.");
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    for (const job of activeJobsList) {
      const onchainJobId = job.id;
      try {
        const job = await acpClient.getJobById(onchainJobId);
        if (!job) {
          console.log(`Evaluator: Job ${onchainJobId} not found.`);
          continue;
        }
        const currentPhase = job.phase;
        const phaseName = AcpJobPhases[currentPhase];

        // Ensure this job is for the current evaluator
        if (job.evaluatorAddress !== EVALUATOR_AGENT_WALLET_ADDRESS) {
          continue;
        }

        if (currentPhase === AcpJobPhases.EVALUATION) {
          console.log(`Evaluator: Found Job ${onchainJobId} in EVALUATION phase.`);

          // Simple evaluation logic: always accept
          const acceptTheDelivery = true;
          const evaluationReason = "Deliverable looks great, approved!";

          console.log(
            `  Job ${onchainJobId}: Evaluating... Accepting: ${acceptTheDelivery}`
          );
          await job.evaluate(
            acceptTheDelivery,
            evaluationReason,
          );
          console.log(
            `  Job ${onchainJobId}: Evaluation submitted.`
          );
        } else if (
          currentPhase === AcpJobPhases.REQUEST ||
          currentPhase === AcpJobPhases.NEGOTIATION
        ) {
          console.log(
            `Evaluator: Job ${onchainJobId} is in ${phaseName} phase. Waiting for job to be delivered.`
          );
        } else if (
          currentPhase === AcpJobPhases.COMPLETED ||
          currentPhase === AcpJobPhases.REJECTED
        ) {
          console.log(
            `Evaluator: Job ${onchainJobId} is already in ${phaseName}. No action.`
          );
        }
      } catch (e) {
        console.log(`Evaluator: Error processing job ${onchainJobId}: ${e}`);
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

evaluator();

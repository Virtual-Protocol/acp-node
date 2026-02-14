/**
 * Subscription Example - Buyer (Client)
 *
 * Run a specific scenario via --scenario flag:
 *   npx ts-node buyer.ts --scenario 1   # Subscription offering
 *   npx ts-node buyer.ts --scenario 2   # Non-subscription offering (fixed-price)
 *
 * Default: scenario 1
 *
 * Assumption:
 * - chosenAgent.jobOfferings[0] is a subscription offering
 * - chosenAgent.jobOfferings[1] is a non-subscription (fixed-price) offering
 */
import AcpClient, {
  AcpContractClientV2,
  AcpJobPhases,
  AcpJob,
  AcpMemo,
  MemoType,
  AcpAgentSort,
  AcpGraduationStatus,
  AcpOnlineStatus,
  baseSepoliaAcpConfigV2,
} from "../../../src/index";
import {
  BUYER_AGENT_WALLET_ADDRESS,
  BUYER_ENTITY_ID,
  WHITELISTED_WALLET_PRIVATE_KEY,
} from "./env";

// Subscription tier name — adjust to match your offering config
const SUBSCRIPTION_TIER = "sub_premium";

// Parse --scenario N from argv
const scenarioArg = process.argv.indexOf("--scenario");
const SCENARIO =
  scenarioArg !== -1 ? parseInt(process.argv[scenarioArg + 1], 10) : 1;

async function buyer() {
  console.log(`=== Subscription Example - Buyer (Scenario ${SCENARIO}) ===\n`);

  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      BUYER_ENTITY_ID,
      BUYER_AGENT_WALLET_ADDRESS,
      baseSepoliaAcpConfigV2,
    ),
    onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
      console.log(
        `Buyer: onNewTask - Job ${job.id}, phase: ${AcpJobPhases[job.phase]}, ` +
          `memoToSign: ${memoToSign?.id ?? "None"}, ` +
          `nextPhase: ${memoToSign?.nextPhase !== undefined ? AcpJobPhases[memoToSign.nextPhase] : "None"}`,
      );

      // Subscription payment requested (Scenario 1)
      if (
        job.phase === AcpJobPhases.NEGOTIATION &&
        memoToSign?.type === MemoType.PAYABLE_REQUEST_SUBSCRIPTION
      ) {
        console.log(
          `Buyer: Job ${job.id} — Subscription payment requested: ${memoToSign.content}`,
        );
        console.log(
          `Buyer: Job ${job.id} — Amount: ${memoToSign.payableDetails?.amount}`,
        );
        const { txnHash: subPayTx } = await job.paySubscription(
          `Subscription payment for ${SUBSCRIPTION_TIER}`,
        );
        console.log(
          `Buyer: Job ${job.id} — Subscription paid (tx: ${subPayTx})`,
        );

        // Fixed-price requirement — pay and advance to delivery (Scenario 2)
      } else if (
        job.phase === AcpJobPhases.NEGOTIATION &&
        memoToSign?.type === MemoType.PAYABLE_REQUEST
      ) {
        console.log(
          `Buyer: Job ${job.id} — Fixed-price requirement, paying now`,
        );
        const payResult = await job.payAndAcceptRequirement("Payment for job");
        console.log(
          `Buyer: Job ${job.id} — Paid and advanced to TRANSACTION phase (tx: ${payResult?.txnHash})`,
        );

        // Active subscription path — accept requirement without payment
      } else if (
        job.phase === AcpJobPhases.NEGOTIATION &&
        memoToSign?.type === MemoType.MESSAGE &&
        memoToSign?.nextPhase === AcpJobPhases.TRANSACTION
      ) {
        console.log(
          `Buyer: Job ${job.id} — Subscription active, accepting without payment`,
        );
        const { txnHash: signMemoTx } = await job.acceptRequirement(
          memoToSign,
          "Subscription verified, proceeding to delivery",
        );
        console.log(
          `Buyer: Job ${job.id} — Advanced to TRANSACTION phase (tx: ${signMemoTx})`,
        );
      } else if (job.phase === AcpJobPhases.COMPLETED) {
        console.log(
          `Buyer: Job ${job.id} — Completed! Deliverable:`,
          job.deliverable,
        );
      } else if (job.phase === AcpJobPhases.REJECTED) {
        console.log(
          `Buyer: Job ${job.id} — Rejected. Reason:`,
          job.rejectionReason,
        );
      } else {
        console.log(
          `Buyer: Job ${job.id} — Unhandled event (phase: ${AcpJobPhases[job.phase]}, ` +
            `memoType: ${memoToSign?.type !== undefined ? MemoType[memoToSign.type] : "None"}, ` +
            `nextPhase: ${memoToSign?.nextPhase !== undefined ? AcpJobPhases[memoToSign.nextPhase] : "None"})`,
        );
      }
    },
  });

  // Browse available agents
  const relevantAgents = await acpClient.browseAgents("", {
    sortBy: [AcpAgentSort.SUCCESSFUL_JOB_COUNT],
    topK: 5,
    graduationStatus: AcpGraduationStatus.ALL,
    onlineStatus: AcpOnlineStatus.ALL,
    showHiddenOfferings: true,
  });

  console.log("Relevant agents:", relevantAgents);

  if (!relevantAgents || relevantAgents.length === 0) {
    console.error("No agents found");
    return;
  }

  // Pick one of the agents based on your criteria (in this example we just pick the first one)
  const chosenAgent = relevantAgents[0];

  // Pick one of the service offerings based on your criteria:
  // - index 0: subscription offering
  // - index 1: non-subscription (fixed-price) offering
  const subscriptionOffering = chosenAgent.jobOfferings[0];
  const fixedOffering = chosenAgent.jobOfferings[1];

  switch (SCENARIO) {
    case 1: {
      const chosenJobOffering = subscriptionOffering;
      const jobId = await chosenJobOffering.initiateJob(
        // Requirement payload schema depends on your ACP service configuration.
        // If your service requires fields, replace {} with the expected schema payload.
        {},
        undefined, // evaluator address, undefined fallback to empty address
        new Date(Date.now() + 1000 * 60 * 15), // job expiry duration, minimum 5 minutes
        SUBSCRIPTION_TIER,
      );
      console.log(`Buyer: [Scenario 1 — Subscription Offering] Job ${jobId} initiated`);
      break;
    }

    case 2: {
      const chosenJobOffering = fixedOffering;
      const jobId = await chosenJobOffering.initiateJob(
        // Requirement payload schema depends on your ACP service configuration.
        // If your service requires fields, replace {} with the expected schema payload.
        {},
        undefined, // evaluator address, undefined fallback to empty address
        new Date(Date.now() + 1000 * 60 * 15), // job expiry duration, minimum 5 minutes
      );
      console.log(`Buyer: [Scenario 2 — Fixed-Price Job] Job ${jobId} initiated`);
      break;
    }

    default:
      console.error(`Unknown scenario: ${SCENARIO}. Use --scenario 1 or 2.`);
      process.exit(1);
  }
}

buyer().catch((error) => {
  console.error("Buyer error:", error);
  process.exit(1);
});

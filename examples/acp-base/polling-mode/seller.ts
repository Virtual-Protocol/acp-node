import AcpClient, {
  AcpContractClientV2,
  AcpError,
  AcpJobPhases,
  DeliverablePayload,
} from "@virtuals-protocol/acp-node";
import {
  SELLER_AGENT_WALLET_ADDRESS,
  SELLER_ENTITY_ID,
  WHITELISTED_WALLET_PRIVATE_KEY,
} from "./env";

// --- Configuration for the job polling interval ---
const POLL_INTERVAL_MS = 20000; // 20 seconds
// --------------------------------------------------

const REJECT_JOB = false;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seller() {
  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      SELLER_ENTITY_ID,
      SELLER_AGENT_WALLET_ADDRESS,
    ),
  });

  while (true) {
    console.log(`\nSeller: Polling for active jobs for ${SELLER_AGENT_WALLET_ADDRESS}...`);
    const activeJobsList = await acpClient.getActiveJobs();

    if (activeJobsList instanceof AcpError) {
      console.error(activeJobsList);
      break;
    }

    if (activeJobsList.length === 0) {
      console.log("Seller: No active jobs found in this poll.");
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    for (const job of activeJobsList) {
      // Ensure this job is for the current seller
      if (job.providerAddress !== SELLER_AGENT_WALLET_ADDRESS) {
        continue;
      }
      try {
        const currentPhase = job.phase;
        const phaseName = AcpJobPhases[currentPhase];
        console.log(`Seller: Checking job ${job.id}. Current Phase: ${phaseName}`);

        // 1. Respond to Job Request
        if (currentPhase === AcpJobPhases.REQUEST) {
          console.log(
            `Seller: Job ${job.id} is in REQUEST. Responding to buyer's request with requirement: ${job.requirement}`
          );
          const response = true;
          if (response) {
            await job.accept("Job requirement matches agent capability");
            await job.createRequirement(`Job ${job.id} accepted, please make payment to proceed`);
          } else {
            await job.reject("Job requirement does not meet agent capability");
          }
          console.log(`Job ${job.id} ${response ? "accepted" : "rejected"}.`);
        }
        // 2. Submit Deliverable
        else if (currentPhase === AcpJobPhases.TRANSACTION) {
          // Buyer has paid, job is in TRANSACTION. Seller needs to deliver.
          // to cater cases where agent decide to reject job after payment has been made
          if (REJECT_JOB) { // conditional check for job rejection logic
            const reason = "Job requirement does not meet agent capability";
            console.log(`Rejecting job ${job.id} with reason: ${reason}`)
            await job.respond(false, reason);
            console.log(`Job ${job.id} rejected`);
            return;
          }

          const deliverable: DeliverablePayload = {
            type: "url",
            value: "https://example.com",
          }
          console.log(`Delivering job ${job.id} with deliverable`, deliverable);
          await job.deliver(deliverable);
          console.log(`Job ${job.id} delivered`);
        } else if (
          currentPhase === AcpJobPhases.EVALUATION ||
          currentPhase === AcpJobPhases.COMPLETED ||
          currentPhase === AcpJobPhases.REJECTED
        ) {
          console.log(`Seller: Job ${job.id} is in ${phaseName}. No further action for seller.`);
        }
      } catch (e) {
        console.log(`Seller: Error processing job ${job.id}: ${e}`);
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

seller();

import AcpClient, {
    AcpContractClient,
    AcpJobPhases,
} from "@virtuals-protocol/acp-node";
import {
    SELLER_AGENT_WALLET_ADDRESS,
    SELLER_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY,
} from "./env";

// --- Configuration for the job polling interval ---
const POLL_INTERVAL_MS = 20000; // 20 seconds
// --------------------------------------------------

async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seller() {
    const acpClient = new AcpClient({
        acpContractClient: await AcpContractClient.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            SELLER_ENTITY_ID,
            SELLER_AGENT_WALLET_ADDRESS,
        ),
    });
    console.log(`Seller ACP Initialized. Agent: ${SELLER_AGENT_WALLET_ADDRESS}`);

    // job_id: { responded_to_request: boolean, delivered_work: boolean }
    const processedJobStages: Record<string, { responded_to_request?: boolean; delivered_work?: boolean }> = {};

    while (true) {
        console.log(`\nSeller: Polling for active jobs for ${SELLER_AGENT_WALLET_ADDRESS}...`);
        const activeJobsList = await acpClient.getActiveJobs();

        if (!activeJobsList || activeJobsList.length === 0) {
            console.log("Seller: No active jobs found in this poll.");
            await sleep(POLL_INTERVAL_MS);
            continue;
        }

        for (const job of activeJobsList) {
            const onchainJobId = job.id;
            // Ensure this job is for the current seller
            if (job.providerAddress !== SELLER_AGENT_WALLET_ADDRESS) {
                continue;
            }
            const jobStages = processedJobStages[onchainJobId] || {};
            try {
                // Fetch full details to get current phase and memos
                const job = await acpClient.getJobById(onchainJobId);
                if (!job) {
                    console.log(`Seller: Job ${onchainJobId} not found.`);
                    continue;
                }
                const currentPhase = job.phase;
                const phaseName = AcpJobPhases[currentPhase];
                console.log(`Seller: Checking job ${onchainJobId}. Current Phase: ${phaseName}`);

                // 1. Respond to Job Request (if not already responded)
                if (currentPhase === AcpJobPhases.REQUEST && !jobStages.responded_to_request) {
                    console.log(
                        `Seller: Job ${onchainJobId} is in REQUEST. Responding to buyer's request...`
                    );
                    await job.respond(true);
                    console.log(`Seller: Accepted job ${onchainJobId}. Job phase should move to NEGOTIATION.`);
                    jobStages.responded_to_request = true;
                }
                // 2. Submit Deliverable (if job is paid and not yet delivered)
                else if (currentPhase === AcpJobPhases.TRANSACTION && !jobStages.delivered_work) {
                    // Buyer has paid, job is in TRANSACTION. Seller needs to deliver.
                    console.log(`Seller: Job ${onchainJobId} is PAID (TRANSACTION phase). Submitting deliverable...`);
                    await job.deliver(
                        {
                            type: "url",
                            value: "https://example.com",
                        }
                    );
                    console.log(`Seller: Deliverable submitted for job ${onchainJobId}. Job should move to EVALUATION.`);
                    jobStages.delivered_work = true;
                }
                else if (
                    currentPhase === AcpJobPhases.EVALUATION ||
                    currentPhase === AcpJobPhases.COMPLETED ||
                    currentPhase === AcpJobPhases.REJECTED
                ) {
                    console.log(`Seller: Job ${onchainJobId} is in ${phaseName}. No further action for seller.`);
                    // Mark as fully handled for this script
                    jobStages.responded_to_request = true;
                    jobStages.delivered_work = true;
                }
                processedJobStages[onchainJobId] = jobStages;
            } catch (e) {
                console.log(`Seller: Error processing job ${onchainJobId}: ${e}`);
            }
        }
        await sleep(POLL_INTERVAL_MS);
    }
}

seller();

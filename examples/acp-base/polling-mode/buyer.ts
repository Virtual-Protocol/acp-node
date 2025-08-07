import AcpClient, {
    AcpContractClient,
    AcpJobPhases,
    AcpGraduationStatus,
    AcpOnlineStatus,
} from "@virtuals-protocol/acp-node";
import {
    BUYER_AGENT_WALLET_ADDRESS,
    EVALUATOR_AGENT_WALLET_ADDRESS,
    WHITELISTED_WALLET_PRIVATE_KEY,
    BUYER_ENTITY_ID,
} from "./env";

// --- Configuration for the job polling interval ---
const POLL_INTERVAL_MS = 20000; // 20 seconds
// --------------------------------------------------

async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buyer() {
    const acpClient = new AcpClient({
        acpContractClient: await AcpContractClient.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            BUYER_ENTITY_ID,
            BUYER_AGENT_WALLET_ADDRESS,
        ),
    });
    // Print initialization message (matches Python)
    console.log(`Buyer ACP Initialized. Agent: ${BUYER_AGENT_WALLET_ADDRESS}`);

    // Browse available agents based on a keyword and cluster name
    const relevantAgents = await acpClient.browseAgents(
        "<your-filter-agent-keyword>",
        {
            cluster: "<your-cluster-name>",
            graduationStatus: AcpGraduationStatus.ALL,
            onlineStatus: AcpOnlineStatus.ALL,
        }
    );
    console.log("Relevant agents:", relevantAgents);

    // Pick one of the agents based on your criteria (in this example we just pick the first one)
    const chosenAgent = relevantAgents[0];
    // Pick one of the service offerings based on your criteria (in this example we just pick the first one)
    const chosenJobOffering = chosenAgent.offerings[0];

    // 1. Initiate Job
    console.log(
        `Initiating job with Seller: ${chosenAgent.walletAddress}, Evaluator: ${EVALUATOR_AGENT_WALLET_ADDRESS}`
    );

    const jobId = await chosenJobOffering.initiateJob(
        // <your_schema_field> can be found in your ACP Visualiser's "Edit Service" pop-up.
        // Reference: (../self_evaluation/images/specify-requirement-toggle-switch.png)
        { "<your_schema_field>": "Help me to generate a flower meme." },
        EVALUATOR_AGENT_WALLET_ADDRESS,
        new Date(Date.now() + 1000 * 60 * 60 * 24) // expiredAt as last parameter
    );

    console.log(`Job ${jobId} initiated`);
    // 2. Wait for Seller's acceptance memo (which sets next_phase to TRANSACTION)
    console.log(`\nWaiting for Seller to accept job ${jobId}...`);

    let finished = false;
    while (!finished) {
        // wait for some time before checking job again
        await sleep(POLL_INTERVAL_MS);

        const job = await acpClient.getJobById(jobId);
        if (!job) {
            console.error(`Job ${jobId} not found.`);
            return;
        }
        const phaseName = AcpJobPhases[job.phase]
        console.log(`Polling Job ${jobId}: Current Phase: ${phaseName}`);

        if (job.phase === AcpJobPhases.NEGOTIATION) {
            // Check if there's a memo that indicates next phase is TRANSACTION
            for (const memo of job.memos) {
                if (memo.nextPhase === AcpJobPhases.TRANSACTION) {
                    console.log("Paying job", jobId);
                    await job.pay(job.price);
                }
            }
        } else if (job.phase === AcpJobPhases.REQUEST) {
            console.log(`Job ${jobId} still in REQUEST phase. Waiting for seller...`);
        } else if (job.phase === AcpJobPhases.EVALUATION) {
            console.log(`Job ${jobId} is in EVALUATION. Waiting for evaluator's decision...`);
        } else if (job.phase === AcpJobPhases.TRANSACTION) {
            console.log(`Job ${jobId} is in TRANSACTION. Waiting for seller to deliver...`);
        } else if (job.phase === AcpJobPhases.COMPLETED) {
            console.log("Job completed", job);
            finished = true;
        } else if (job.phase === AcpJobPhases.REJECTED) {
            console.log("Job rejected", job);
            finished = true;
        }
    }
    console.log("\n--- Buyer Script Finished ---");
    process.exit(0);
}

buyer();

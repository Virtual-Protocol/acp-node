import AcpClient, {
    AcpContractClient,
    AcpJobPhases,
    AcpJob,
    AcpAgentSort,
    AcpGraduationStatus,
    AcpOnlineStatus
} from "@virtuals-protocol/acp-node";
import {
    BUYER_AGENT_WALLET_ADDRESS,
    WHITELISTED_WALLET_PRIVATE_KEY,
    BUYER_ENTITY_ID,
} from "./env";

async function buyer() {
    const acpClient = new AcpClient({
        acpContractClient: await AcpContractClient.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            BUYER_ENTITY_ID,
            BUYER_AGENT_WALLET_ADDRESS
        ),
        onNewTask: async (job: AcpJob) => {
            if (
                job.phase === AcpJobPhases.NEGOTIATION &&
                job.memos.find((m) => m.nextPhase === AcpJobPhases.TRANSACTION)
            ) {
                console.log("Paying job", job);
                await job.pay(job.price);
                console.log(`Job ${job.id} paid`);
            } else if (job.phase === AcpJobPhases.COMPLETED) {
                console.log(`Job ${job.id} completed`);
            } else if (job.phase === AcpJobPhases.REJECTED) {
                console.log(`Job ${job.id} rejected`);
            }
        },
        onEvaluate: async (job: AcpJob) => {
            console.log("Evaluation function called", job);
            await job.evaluate(true, "Self-evaluated and approved");
            console.log(`Job ${job.id} evaluated`);
        },
    });

    // Browse available agents based on a keyword and cluster name
    const relevantAgents = await acpClient.browseAgents(
        "<your-filter-agent-keyword>",
        {
            sort_by: [AcpAgentSort.SUCCESSFUL_JOB_COUNT],
            top_k: 5,
            graduationStatus: AcpGraduationStatus.ALL,
            onlineStatus: AcpOnlineStatus.ALL,
        }
    );

    // Pick one of the agents based on your criteria (in this example we just pick the first one)
    const chosenAgent = relevantAgents[0];
    // Pick one of the service offerings based on your criteria (in this example we just pick the first one)
    const chosenJobOffering = chosenAgent.offerings[0];

    const jobId = await chosenJobOffering.initiateJob(
        // <your_schema_field> can be found in your ACP Visualiser's "Edit Service" pop-up.
        // Reference: (./images/specify-requirement-toggle-switch.png)
        { "<your_schema_field>": "Help me to generate a flower meme." },
        BUYER_AGENT_WALLET_ADDRESS,// Use default evaluator address
        new Date(Date.now() + 1000 * 60 * 60 * 24) // expiredAt as last parameter
    );

    console.log(`Job ${jobId} initiated`);
}

buyer();

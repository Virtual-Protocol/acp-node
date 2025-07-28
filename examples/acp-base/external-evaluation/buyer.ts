import AcpClient, {
    AcpContractClient,
    AcpJobPhases,
    AcpJob,
    AcpAgentSort,
    AcpGraduatedStatus,
    AcpOnlineStatus
} from "@virtuals-protocol/acp-node";
import {
    BUYER_AGENT_WALLET_ADDRESS,
    EVALUATOR_AGENT_WALLET_ADDRESS,
    BUYER_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY
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
    });

    // Browse available agents based on a keyword and cluster name
    const relevantAgents = await acpClient.browseAgents(
        "<your-filter-agent-keyword>",
        {
            cluster: "<your-cluster-name>",
            sort_by: [AcpAgentSort.SUCCESSFUL_JOB_COUNT],
            rerank: true,
            top_k: 5,
            graduatedStatus: AcpGraduatedStatus.ALL,
            onlineStatus: AcpOnlineStatus.ALL,
        }
    );
    // Pick one of the agents based on your criteria (in this example we just pick the second one)
    const chosenAgent = relevantAgents[0];
    // Pick one of the service offerings based on your criteria (in this example we just pick the first one)
    const chosenJobOffering = chosenAgent.offerings[0];

    const jobId = await chosenJobOffering.initiateJob(
        // <your_schema_field> can be found in your ACP Visualiser's "Edit Service" pop-up.
        // Reference: (./images/specify-requirement-toggle-switch.png)
        { '<your_schema_field>': "Help me to generate a flower meme." },
        EVALUATOR_AGENT_WALLET_ADDRESS,
        new Date(Date.now() + 1000 * 60 * 60 * 24)
    );

    console.log(`Job ${jobId} initiated`);
}

buyer();

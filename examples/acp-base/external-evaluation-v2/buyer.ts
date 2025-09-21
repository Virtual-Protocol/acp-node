import AcpClient, {
    AcpContractClient,
    AcpJobPhases,
    AcpJob,
    AcpMemo,
    AcpAgentSort,
    AcpGraduationStatus,
    AcpOnlineStatus,
    baseSepoliaAcpConfig
} from "../../../src";
import {
    BUYER_AGENT_WALLET_ADDRESS,
    WHITELISTED_WALLET_PRIVATE_KEY,
    BUYER_ENTITY_ID,
    EVALUATOR_AGENT_WALLET_ADDRESS
} from "./env";

async function buyer() {
    const config = baseSepoliaAcpConfig;
    
    const acpClient = new AcpClient({
        acpContractClient: await AcpContractClient.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            BUYER_ENTITY_ID,
            BUYER_AGENT_WALLET_ADDRESS,
            config  // v2 requires config parameter
        ),
        onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {  // v2 has memoToSign parameter
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
        }
    });

    // Browse available agents based on a keyword
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
    const chosenJobOffering = chosenAgent.jobOfferings[0];  // v2 uses jobOfferings instead of offerings

    const jobId = await chosenJobOffering.initiateJob(
        "Help me to generate a flower meme.",  // v2 simplified - uses string instead of schema object
        EVALUATOR_AGENT_WALLET_ADDRESS, // Use external evaluator address
        new Date(Date.now() + 1000 * 60 * 60 * 24) // expiredAt
    );

    console.log(`Job ${jobId} initiated`);
}

buyer();

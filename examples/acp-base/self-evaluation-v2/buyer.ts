import AcpClient, {
    AcpContractClient,
    AcpJobPhases,
    AcpJob,
    AcpMemo,
    AcpAgentSort,
    AcpGraduationStatus,
    AcpOnlineStatus,
    baseSepoliaAcpConfigV2
} from "../../../src";
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
            BUYER_AGENT_WALLET_ADDRESS,
            baseSepoliaAcpConfigV2
        ),
        onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
            if (
                job.phase === AcpJobPhases.NEGOTIATION &&
                memoToSign?.nextPhase === AcpJobPhases.TRANSACTION
            ) {
                console.log("Paying job", job);
                await job.payAndAcceptRequirement();
                console.log(`Job ${job.id} paid`);
            } else if (
                job.phase === AcpJobPhases.TRANSACTION &&
                memoToSign?.nextPhase === AcpJobPhases.REJECTED
            ) {
                console.log("Signing job rejection memo", job);
                await memoToSign?.sign(true, "Accepts job rejection")
                console.log(`Job ${job.id} rejection memo signed`);
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

    console.log("Relevant agents:", relevantAgents);

    // Pick one of the agents based on your criteria (in this example we just pick the first one)
    const chosenAgent = relevantAgents[0];
    // Pick one of the service offerings based on your criteria (in this example we just pick the first one)
    const chosenJobOffering = chosenAgent.jobOfferings[0];  // v2 uses jobOfferings instead of offerings

    const jobId = await chosenJobOffering.initiateJob(
        { "<your_schema_field>": "<your_schema_value>" },
        BUYER_AGENT_WALLET_ADDRESS, // evaluator address
        new Date(Date.now() + 1000 * 60 * 60 * 24) // expiredAt
    );

    console.log(`Job ${jobId} initiated`);
}

buyer();

import * as readline from "readline";
import AcpClient, {
    AcpAgentSort,
    AcpContractClientV2,
    AcpGraduationStatus,
    AcpJob,
    AcpJobPhases,
    AcpMemo,
    AcpOnlineStatus,
    baseAcpConfigV2,
    FareAmount,
    MemoType,
} from "../../../../src";
import {
    BUYER_AGENT_WALLET_ADDRESS,
    BUYER_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY,
} from "./env";
import { FundsV2DemoJobPayload } from "./jobTypes";

async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            resolve(answer.trim());
        });
    });
};

const SERVICE_REQUIREMENTS_JOB_TYPE_MAPPING: Record<string, FundsV2DemoJobPayload> = {
    swap_token: {
        fromSymbol: "USDC",
        fromContractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base USDC Token
        amount: 0.008,
        toSymbol: "VIRTUAL",
        toContractAddress: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b"
    },
    open_position: {
        symbol: "BTC",
        amount: 0.009,
        tp: { percentage: 5 },
        sl: { percentage: 2 },
        direction: "long",
    },
    close_position: { symbol: "BTC" },
}

async function main() {
    let currentJobId: number | null = null;

    const acpClient = new AcpClient({
        acpContractClient: await AcpContractClientV2.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            BUYER_ENTITY_ID,
            BUYER_AGENT_WALLET_ADDRESS
        ),
        onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
            const { id: jobId, phase: jobPhase } = job;
            if (!memoToSign) {
                if (job.phase === AcpJobPhases.REJECTED || job.phase === AcpJobPhases.COMPLETED) {
                    currentJobId = null;
                    console.log(`[onNewTask] Job ${jobId} ${AcpJobPhases[jobPhase]}, received ${job.phase === AcpJobPhases.COMPLETED ? `deliverable: ${job.deliverable}` : `rejection reason: ${job.rejectionReason}`}`);
                    return;
                }
                console.log("[onNewTask] No memo to sign", { jobId });
                return;
            }
            const memoId = memoToSign.id;
            console.log("[onNewTask] New job received", { jobId, memoId, phase: AcpJobPhases[jobPhase] });

            if (
                jobPhase === AcpJobPhases.NEGOTIATION &&
                memoToSign.nextPhase === AcpJobPhases.TRANSACTION
            ) {
                console.log(`[onNewTask] Paying for job ${jobId}`);
                await job.payAndAcceptRequirement();
                currentJobId = jobId;
                console.log(`[onNewTask] Job ${jobId} paid`);
            } else if (
                jobPhase === AcpJobPhases.TRANSACTION
            ) {
                if (memoToSign.nextPhase === AcpJobPhases.REJECTED) {
                    console.log("[onNewTask] Signing job rejection memo", { jobId, memoId });
                    await memoToSign.sign(true, "Accepts job rejection");
                    console.log("[onNewTask] Rejection memo signed", { jobId });
                    currentJobId = null;
                } else if (
                    memoToSign.nextPhase === AcpJobPhases.TRANSACTION &&
                    memoToSign.type === MemoType.PAYABLE_TRANSFER_ESCROW
                ) {
                    console.log("[onNewTask] Accepting funds transfer", { jobId, memoId });
                    await memoToSign.sign(true, "Accepts funds transfer");
                    console.log("[onNewTask] Funds transfer memo signed", { jobId });
                }
            } else if (memoToSign.type === MemoType.NOTIFICATION || memoToSign.type === MemoType.PAYABLE_NOTIFICATION) {
                console.log(`[onNewTask] Job ${jobId} received notification: ${memoToSign.content}`);
                await memoToSign.sign(true, "Acknowledged on job update notification");
            }
        }
    });

    const agents = await acpClient.browseAgents(
        "<your-filter-agent-keyword>",
        {
            sort_by: [AcpAgentSort.SUCCESSFUL_JOB_COUNT],
            top_k: 5,
            graduationStatus: AcpGraduationStatus.ALL,
            onlineStatus: AcpOnlineStatus.ALL,
        }
    );
    console.log(agents);
    const { jobOfferings } = agents[0];
    console.log(jobOfferings);
    const actionsDefinition = (jobOfferings ?? [])
        .map((offering, idx) => {
            return {
                index: idx + 1,
                desc: offering.name,
                action: async() => {
                    currentJobId = await offering.initiateJob(SERVICE_REQUIREMENTS_JOB_TYPE_MAPPING[offering.name])
                },
            };
        })

    while (true) {
        await sleep(100);
        if (currentJobId) {
            // No job found, waiting for new job
            continue;
        }

        console.log("\nAvailable actions:");
        actionsDefinition.forEach((action) => {
            console.log(`${action.index}. ${action.desc}`);
        });

        const answer = await question("\nSelect an action (enter the number): ");
        console.log("Initiating job...");
        const selectedIndex = parseInt(answer, 10);

        const selectedAction = actionsDefinition.find(
            (action) => action.index === selectedIndex
        );

        if (selectedAction) {
            await selectedAction.action();
        } else {
            console.log("Invalid selection. Please try again.");
        }
    }
}

main();

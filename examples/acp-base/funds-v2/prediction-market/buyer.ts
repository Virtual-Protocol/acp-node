import * as readline from "readline";
import AcpClient, {
    AcpAgentSort,
    AcpContractClientV2,
    AcpGraduationStatus,
    AcpJob,
    AcpJobPhases,
    AcpMemo,
    AcpOnlineStatus,
    MemoType,
} from "@virtuals-protocol/acp-node";
import {
    BUYER_AGENT_WALLET_ADDRESS,
    BUYER_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY,
} from "./env";
import { PredictionMarketDemoJobPayload } from "./jobTypes";

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

const SERVICE_REQUIREMENTS_JOB_TYPE_MAPPING: Record<string, PredictionMarketDemoJobPayload> = {
    create_market: {
        question: "Will ETH close above $3000 on Dec 31, 2025?",
        outcomes: ["Yes", "No"],  // array that requires at least 2 outcomes
        endTime: "Dec 31, 2025, 11:59 PM UTC",
        liquidity: 0.005,  // Initial liquidity (USDC)
    },
    place_bet: {
        marketId: "0xfc274053",
        outcome: "Yes",
        token: "USDC",
        amount: 0.003,
    },
    close_bet: {
        marketId: "0xfc274053",
    },
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
    console.log(jobOfferings);

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
        const selectedIndex = parseInt(answer, 10);

        const selectedAction = actionsDefinition.find(
            (action) => action.index === selectedIndex
        );

        if (selectedAction) {
            console.log("Initiating job...");
            await selectedAction.action();
            console.log(`Job ${currentJobId} initiated`);
        } else {
            console.log("Invalid selection. Please try again.");
        }
    }
}

main();

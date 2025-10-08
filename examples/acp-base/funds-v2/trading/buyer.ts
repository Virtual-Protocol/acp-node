import * as readline from "readline";
import AcpClient, {
    AcpAgentSort,
    AcpContractClientV2,
    AcpGraduationStatus,
    AcpJob,
    AcpJobPhases,
    AcpMemo,
    AcpOnlineStatus,
    baseSepoliaAcpConfigV2,
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

const SERVICE_REQUIREMENTS_JOB_TYPE_MAPPING: Record<string, FundsV2DemoJobPayload> = {
    swap_token: {
        fromSymbol: "USDC",
        fromContractAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia USDC Token
        amount: 0.08,
        toSymbol: "BMW",
        toContractAddress: "0xbfAB80ccc15DF6fb7185f9498d6039317331846a"
    },
    open_position: {
        symbol: "BTC",
        amount: 0.09,
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
            BUYER_AGENT_WALLET_ADDRESS,
            baseSepoliaAcpConfigV2
        ),
        onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
            const { id: jobId, phase: jobPhase } = job;
            if (!memoToSign) {
                if (job.phase === AcpJobPhases.REJECTED || job.phase === AcpJobPhases.COMPLETED) {
                    currentJobId = null;
                    console.log(`[onNewTask] Job ${jobId} ${AcpJobPhases[jobPhase]}`);
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
                console.log("[onNewTask] Paying job", jobId);
                await job.payAndAcceptRequirement();
                currentJobId = jobId;
                console.log("[onNewTask] Job paid", jobId);
            } else if (
                jobPhase === AcpJobPhases.TRANSACTION
            ) {
                if (memoToSign.nextPhase === AcpJobPhases.REJECTED) {
                    console.log("[onNewTask] Signing job rejection memo", { jobId, memoId });
                    await memoToSign.sign(true, "Accepted job rejection");
                    console.log("[onNewTask] Rejection memo signed", { jobId });
                    currentJobId = null;
                } else if (
                    memoToSign.nextPhase === AcpJobPhases.TRANSACTION &&
                    memoToSign.type === MemoType.PAYABLE_TRANSFER_ESCROW
                ) {
                    console.log("[onNewTask] Accepting funds transfer", { jobId, memoId });
                    await memoToSign.sign(true, "Accepted funds transfer");
                    console.log("[onNewTask] Funds transfer memo signed", { jobId });
                }
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

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const question = (prompt: string): Promise<string> =>
        new Promise((resolve) => rl.question(prompt, resolve));

    while (true) {
        await sleep(5000);

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

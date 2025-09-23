import * as readline from "readline";
import AcpClient, {
    AcpAgentSort,
    AcpContractClient,
    AcpGraduationStatus,
    AcpJob,
    AcpJobPhases,
    AcpMemo,
    AcpOnlineStatus,
    baseSepoliaAcpConfig,
    PayloadType,
} from "../../../src";
import {
    BUYER_AGENT_WALLET_ADDRESS,
    WHITELISTED_WALLET_PRIVATE_KEY,
    BUYER_ENTITY_ID,
} from "./env";

async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const SERVICE_REQUIREMENTS_JOB_TYPE_MAPPING: Record<string, object | string> = {
    swap_token: {
        fromSymbol: "USDC",
        fromContractAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        amount: 0.01,
        toSymbol: "BMW",
    },
    open_position: {
        symbol: "BTC",
        amount: 0.001,
        tp: { percentage: 5 },
        sl: { percentage: 2 },
        direction: "long",
    },
    close_position: { positionId: 0 },
}

async function main() {
    let currentJob: number | null = null;

    const acpClient = new AcpClient({
        acpContractClient: await AcpContractClient.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            BUYER_ENTITY_ID,
            BUYER_AGENT_WALLET_ADDRESS,
            baseSepoliaAcpConfig
        ),
        onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
            memoToSign && console.log("New job", job.id, memoToSign?.id);

            if (job.phase === AcpJobPhases.NEGOTIATION) {
                console.log("Pay for job");
                await job.payAndAcceptRequirement();
                currentJob = job.id;
                return;
            }

            currentJob = job.id;
            console.log(job.phase)

            if (job.phase !== AcpJobPhases.TRANSACTION) {
                console.log("Job is not in transaction phase");
                return;
            }

            if (!memoToSign) {
                console.log("No memo to sign");
                return;
            }

            switch (memoToSign.payloadType) {
                case PayloadType.CLOSE_JOB_AND_WITHDRAW:
                    await job.confirmJobClosure(memoToSign.id, true);
                    console.log("Closed job");
                    break;

                case PayloadType.RESPONSE_SWAP_TOKEN:
                    await memoToSign.sign(true, "accepts swap token");
                    console.log("Swapped token");
                    break;

                case PayloadType.CLOSE_POSITION:
                    await job.confirmClosePosition(memoToSign.id, true);
                    console.log("Closed position");
                    break;

                default:
                    console.log("Unhandled payload type", memoToSign.payloadType);
            }
        },
        onEvaluate: async (job: AcpJob) => {
            console.log("Evaluation function called", job);
            await job.evaluate(true, "job auto-evaluated")
            console.log(`Job ${job.id} evaluated`);
            currentJob = null
        }
    });

    console.log("Initiating job");

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
                    currentJob = await offering.initiateJob(SERVICE_REQUIREMENTS_JOB_TYPE_MAPPING[offering.name])
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

        if (currentJob) {
            // No job found, waiting for new job
            continue;
        }

        console.log("\nAvailable actions:");
        actionsDefinition.forEach((action) => {
            console.log(`${action.index}. ${action.desc}`);
        });

        const answer = await question("Select an action (enter the number): ");
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

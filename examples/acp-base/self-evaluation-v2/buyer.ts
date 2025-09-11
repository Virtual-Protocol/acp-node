import * as readline from "readline";
import AcpClient, {
AcpContractClient,
    AcpJob,
    AcpJobPhases,
    AcpMemo,
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

async function main() {
    let currentJob: AcpJob | null = null;
    const config = baseSepoliaAcpConfig;

    const acpClient = new AcpClient({
        acpContractClient: await AcpContractClient.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            BUYER_ENTITY_ID,
            BUYER_AGENT_WALLET_ADDRESS,
            config
        ),
        onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
            console.log("New job", job.id, memoToSign?.id);

            if (job.phase === AcpJobPhases.NEGOTIATION) {
                console.log("Pay to job");
                await job.pay(0);
                currentJob = job;
                return;
            }

            currentJob = job;

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
    });

    console.log("Initiating job");

    const agents = await acpClient.browseAgents("<your-filter-agent-keyword>", {});
    console.log(agents);
    console.log(agents[0].jobOfferings);

    agents[0].jobOfferings[0].price = 0;
    const jobId = await agents[0].jobOfferings[0].initiateJob("Help me trade");
    console.log("Job initiated", jobId);

    const actionsDefinition = [
        {
        index: 1,
        desc: "Open position",
        action: async () => {
            const result = await currentJob?.openPosition(
            [
                {
                symbol: "BTC",
                amount: 0.001, // amount in $VIRTUAL
                tp: { percentage: 5 },
                sl: { percentage: 2 },
                },
                {
                symbol: "ETH",
                amount: 0.002, // amount in $VIRTUAL
                tp: { percentage: 10 },
                sl: { percentage: 5 },
                },
            ],
            0.001, // fee amount in $VIRTUAL
            new Date(Date.now() + 1000 * 60 * 3) // 3 minutes
            );
            console.log("Opening position result", result);
        },
        },
        {
        index: 2,
        desc: "Swap token",
        action: async () => {
            const result = await currentJob?.swapToken(
            {
                fromSymbol: "BMW",
                fromContractAddress:
                "0xbfAB80ccc15DF6fb7185f9498d6039317331846a", // BMW token address
                amount: 0.01,
                toSymbol: "USDC",
            },
            18, // decimals from BMW
            0.001 // fee amount in $USDC
            );
            console.log("Swapping token result", result);
        },
        },
        {
        index: 3,
        desc: "Close partial position",
        action: async () => {
            const result = await currentJob?.closePartialPosition({
            positionId: 0,
            amount: 1,
            });
            console.log("Closing partial position result", result);
        },
        },
        {
        index: 4,
        desc: "Close position",
        action: async () => {
            const result = await currentJob?.requestClosePosition({
            positionId: 0,
            });
            console.log("Closing position result", result);
        },
        },
        {
        index: 5,
        desc: "Close job",
        action: async () => {
            const result = await currentJob?.closeJob();
            console.log("Closing job result", result);
        },
        },
    ];

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const question = (prompt: string): Promise<string> =>
        new Promise((resolve) => rl.question(prompt, resolve));

    while (true) {
        await sleep(5000);

        if (!currentJob) {
            console.log("No job found, waiting for new job");
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

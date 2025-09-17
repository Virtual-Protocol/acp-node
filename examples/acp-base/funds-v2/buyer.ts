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
                await job.payAndAcceptRequirement("I accept the job requirements");
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

            // switch (memoToSign.payloadType) {
            //     case PayloadType.CLOSE_JOB_AND_WITHDRAW:
            //     await job.confirmJobClosure(memoToSign.id, true);
            //     console.log("Closed job");
            //     break;

            //     case PayloadType.RESPONSE_SWAP_TOKEN:
            //     await memoToSign.sign(true, "accepts swap token");
            //     console.log("Swapped token");
            //     break;

            //     case PayloadType.CLOSE_POSITION:
            //     await job.confirmClosePosition(memoToSign.id, true);
            //     console.log("Closed position");
            //     break;

            //     default:
            //     console.log("Unhandled payload type", memoToSign.payloadType);
            // }
        },
    });

    console.log("Initiating job");

    const agents = await acpClient.browseAgents(
        "calm_seller",
         {
            sort_by: [AcpAgentSort.SUCCESSFUL_JOB_COUNT],
            top_k: 5,
            graduationStatus: AcpGraduationStatus.ALL,
            onlineStatus: AcpOnlineStatus.ALL,
         }
        );
    console.log(agents);
    console.log(agents[0].jobOfferings);

    const jobId = await agents[0].jobOfferings[0].initiateJob({
        "fromSymbol": "USDC",
        "fromContractAddress": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // USDC token address
        "amount": 0.01,
        "toSymbol": "BMW",
        "toContractAddress": "0xbfAB80ccc15DF6fb7185f9498d6039317331846a" // BMW token address
    });
    console.log("Job initiated", jobId);

    // while (true) {
    //     await sleep(5000);

    //     if (!currentJob) {
    //         console.log("No job found, waiting for new job");
    //         continue;
    //     }

    //     console.log("\nAvailable actions:");
    //     actionsDefinition.forEach((action) => {
    //         console.log(`${action.index}. ${action.desc}`);
    //     });

    //     const answer = await question("Select an action (enter the number): ");
    //     const selectedIndex = parseInt(answer, 10);

    //     const selectedAction = actionsDefinition.find(
    //         (action) => action.index === selectedIndex
    //     );

    //     if (selectedAction) {
    //         await selectedAction.action();
    //     } else {
    //         console.log("Invalid selection. Please try again.");
    //     }
    // }
}

main();

// TODO: Point the imports to acp-node after publishing

import AcpClient from "../../../src/acpClient";
import AcpContractClient, { AcpJobPhases } from "../../../src/acpContractClient";
import AcpJob from "../../../src/acpJob";
import { baseSepoliaAcpConfig } from "../../../src";
import {
    BUYER_WALLET_ADDRESS,
    SELLER_WALLET_ADDRESS,
    WHITELISTED_WALLET_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY
} from "./env";

async function buyer() {
    const acpClient = new AcpClient({
        acpContractClient: await AcpContractClient.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            WHITELISTED_WALLET_ENTITY_ID,
            BUYER_WALLET_ADDRESS,
            baseSepoliaAcpConfig
        ),
        onNewTask: async (job: AcpJob) => {
            if (
                job.phase === AcpJobPhases.NEGOTIATION &&
                job.memos.find((m) => m.nextPhase === AcpJobPhases.TRANSACTION)
            ) {
                console.log("Paying job", job);
                await job.pay(1);
                console.log(`Job ${job.id} paid`);
            } else if (job.phase === AcpJobPhases.COMPLETED) {
                console.log(`Job ${job.id} completed`);
            }
        },
        onEvaluate: async (job: AcpJob) => {
            console.log("Evaluation function called", job);
            await job.evaluate(true, "Self-evaluated and approved");
            console.log(`Job ${job.id} evaluated`);
        },
    });

    const relevantAgents = await acpClient.browseAgent("Meme generator");
    console.log("Relevant seller agents: ", relevantAgents);

    const jobId = await acpClient.initiateJob(
        SELLER_WALLET_ADDRESS,
        "Meme generator",
        undefined
    );
    console.log(`Job ${jobId} initiated`);
}

buyer();

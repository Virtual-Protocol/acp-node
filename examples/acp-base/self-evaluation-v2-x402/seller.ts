import AcpClient, { 
    AcpContractClientV2, 
    AcpJobPhases, 
    AcpJob
} from "@virtuals-protocol/acp-node";
import {
    SELLER_AGENT_WALLET_ADDRESS,
    SELLER_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY
} from "./env";

async function seller() {
    new AcpClient({
        acpContractClient: await AcpContractClientV2.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            SELLER_ENTITY_ID,
            SELLER_AGENT_WALLET_ADDRESS
        ),
        onNewTask: async (job: AcpJob) => {
            if (
                job.phase === AcpJobPhases.REQUEST &&
                job.memos.find((m) => m.nextPhase === AcpJobPhases.NEGOTIATION)
            ) {
                console.log("Responding to job", job);
                await job.respond(true);
                console.log(`Job ${job.id} responded`);
            } else if (
                job.phase === AcpJobPhases.TRANSACTION &&
                job.memos.find((m) => m.nextPhase === AcpJobPhases.EVALUATION)
            ) {
                console.log("Delivering job", job);
                await job.deliver(
                    {
                        type: "url",
                        value: 
                        `https://example.com`,
                    }
                );
                console.log(`Job ${job.id} delivered`);
            }
        },
    });
}

seller();

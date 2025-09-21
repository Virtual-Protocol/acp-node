import AcpClient, { 
    AcpContractClient, 
    AcpJobPhases, 
    AcpJob,
    AcpMemo,
    baseSepoliaAcpConfig
} from '../../../src';
import {
    SELLER_AGENT_WALLET_ADDRESS,
    SELLER_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY
} from "./env";

async function seller() {
    const config = baseSepoliaAcpConfig;
    
    const acpClient = new AcpClient({
        acpContractClient: await AcpContractClient.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            SELLER_ENTITY_ID,
            SELLER_AGENT_WALLET_ADDRESS,
            config  // v2 requires config parameter
        ),
        onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {  // v2 has memoToSign parameter
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
                        value: "https://example.com",
                    }
                );
                console.log(`Job ${job.id} delivered`);
            }
        },
    });
}

seller();

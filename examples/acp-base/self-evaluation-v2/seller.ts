import AcpClient, {
    AcpContractClient,
    AcpJob,
    AcpJobPhases,
    AcpMemo,
    baseSepoliaAcpConfigV2
} from '../../../src';
import {
    SELLER_AGENT_WALLET_ADDRESS,
    SELLER_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY
} from "./env";

async function seller() {
    new AcpClient({
        acpContractClient: await AcpContractClient.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            SELLER_ENTITY_ID,
            SELLER_AGENT_WALLET_ADDRESS,
            baseSepoliaAcpConfigV2
        ),
        onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
            if (
                job.phase === AcpJobPhases.REQUEST &&
                memoToSign?.nextPhase === AcpJobPhases.NEGOTIATION
            ) {
                console.log("Responding to job", job);
                await job.respond(true);
                console.log(`Job ${job.id} responded`);
            } else if (
                job.phase === AcpJobPhases.TRANSACTION &&
                memoToSign?.nextPhase === AcpJobPhases.EVALUATION
            ) {
                // // to cater cases where agent decide to reject job after payment has been made
                // console.log("Rejecting job", job)
                // await job.reject("Job requirement does not meet agent capability");
                // console.log(`Job ${job.id} rejected`);

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

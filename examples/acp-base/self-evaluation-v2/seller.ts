import AcpClient, {
    AcpContractClient,
    AcpJob,
    AcpJobPhases,
    AcpMemo,
    baseSepoliaAcpConfigV2,
    IDeliverable
} from '../../../src';
import {
    SELLER_AGENT_WALLET_ADDRESS,
    SELLER_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY
} from "./env";

const REJECT_JOB = false;

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
                console.log(`Responding to job ${job.id} with requirement`, job.requirement);
                await job.respond(true);
                console.log(`Job ${job.id} responded`);
            } else if (
                job.phase === AcpJobPhases.TRANSACTION &&
                memoToSign?.nextPhase === AcpJobPhases.EVALUATION
            ) {
                // to cater cases where agent decide to reject job after payment has been made
                if (REJECT_JOB) { // conditional check for job rejection logic
                    console.log("Rejecting job", job)
                    await job.reject("Job requirement does not meet agent capability");
                    console.log(`Job ${job.id} rejected`);
                    return;
                }

                const deliverable: IDeliverable = {
                    type: "url",
                    value: "https://example.com",
                }
                console.log(`Delivering job ${job.id} with deliverable`, deliverable);
                await job.deliver(deliverable);
                console.log(`Job ${job.id} delivered`);
            }
        },
    });
}

seller();

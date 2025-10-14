import AcpClient, {
    AcpContractClientV2,
    AcpJobPhases,
    AcpJob,
    AcpMemo,
    DeliverablePayload
} from '../../../src';
import {
    SELLER_AGENT_WALLET_ADDRESS,
    SELLER_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY
} from "./env";

const REJECT_JOB = false

async function seller() {
    new AcpClient({
        acpContractClient: await AcpContractClientV2.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            SELLER_ENTITY_ID,
            SELLER_AGENT_WALLET_ADDRESS
        ),
        onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
            if (
                job.phase === AcpJobPhases.REQUEST &&
                job.memos.find((m) => m.nextPhase === AcpJobPhases.NEGOTIATION)
            ) {
                const response = true;
                console.log(`Responding to job ${job.id} with requirement`, job.requirement);
                await job.respond(response);
                console.log(`Job ${job.id} responded with ${response}`);
            } else if (
                job.phase === AcpJobPhases.TRANSACTION &&
                memoToSign?.nextPhase === AcpJobPhases.EVALUATION
            ) {
                // to cater cases where agent decide to reject job after payment has been made
                if (REJECT_JOB) { // conditional check for job rejection logic
                    const reason = "Job requirement does not meet agent capability";
                    console.log(`Rejecting job ${job.id} with reason: ${reason}`)
                    await job.respond(false, reason);
                    console.log(`Job ${job.id} rejected`);
                    return;
                }

                const deliverable: DeliverablePayload = {
                    type: "url",
                    value: "https://example.com",
                }
                console.log(`Delivering job ${job.id} with deliverable`, deliverable);
                await job.deliver(deliverable);
                console.log(`Job ${job.id} delivered`);
            }
        }
    });
}

seller();

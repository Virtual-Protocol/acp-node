import AcpClient, {
    AcpContractClientV2,
    AcpJob,
    baseSepoliaAcpConfigV2
} from '../../../src';
import {
    EVALUATOR_AGENT_WALLET_ADDRESS,
    EVALUATOR_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY
} from "./env";

async function evaluator() {
    new AcpClient({
        acpContractClient: await AcpContractClientV2.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            EVALUATOR_ENTITY_ID,
            EVALUATOR_AGENT_WALLET_ADDRESS,
            baseSepoliaAcpConfigV2
        ),
        onEvaluate: async (job: AcpJob) => {
            console.log("[onEvaluate] Evaluation function called", job.memos);
            try {
                await job.evaluate(true, "Externally evaluated and approved");
                console.log(`[onEvaluate] Job ${job.id} evaluated`);
            } catch (err) {
                console.error(`[onEvaluate] Job ${job.id}:`, err);
            }
        }
    });

    console.log("[Evaluator] Listening for new jobs...");
}

evaluator();

import AcpClient, {
  AcpContractClientV2,
  AcpJobPhases,
  AcpJob,
  AcpMemo,
  AcpAgentSort,
  AcpGraduationStatus,
  AcpOnlineStatus,
  baseAcpX402ConfigV2,
} from "@virtuals-protocol/acp-node";
import {
  BUYER_AGENT_WALLET_ADDRESS,
  WHITELISTED_WALLET_PRIVATE_KEY,
  BUYER_ENTITY_ID,
  EVALUATOR_AGENT_WALLET_ADDRESS
} from "./env";

async function buyer() {
  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      BUYER_ENTITY_ID,
      BUYER_AGENT_WALLET_ADDRESS,
      baseAcpX402ConfigV2, // route to x402 for payment, undefined defaulted back to direct transfer
    ),
    onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
      if (
        job.phase === AcpJobPhases.NEGOTIATION &&
        memoToSign?.nextPhase === AcpJobPhases.TRANSACTION
      ) {
        console.log(`Paying for job ${job.id}`);
        await job.payAndAcceptRequirement();
        console.log(`Job ${job.id} paid`);
      } else if (
        job.phase === AcpJobPhases.TRANSACTION &&
        memoToSign?.nextPhase === AcpJobPhases.REJECTED
      ) {
        console.log(`Signing job ${job.id} rejection memo, rejection reason: ${memoToSign?.content}`);
        await memoToSign?.sign(true, "Accepts job rejection")
        console.log(`Job ${job.id} rejection memo signed`);
      } else if (job.phase === AcpJobPhases.COMPLETED) {
        console.log(`Job ${job.id} completed, received deliverable:`, job.deliverable);
      } else if (job.phase === AcpJobPhases.REJECTED) {
        console.log(`Job ${job.id} rejected`);
      }
    }
  });

  // Browse available agents based on a keyword
  const relevantAgents = await acpClient.browseAgents(
    "<your-filter-agent-keyword>",
    {
      sort_by: [AcpAgentSort.SUCCESSFUL_JOB_COUNT],
      top_k: 5,
      graduationStatus: AcpGraduationStatus.ALL,
      onlineStatus: AcpOnlineStatus.ALL,
      showHiddenOfferings: true,
    }
  );

  // Pick one of the agents based on your criteria (in this example we just pick the first one)
  const chosenAgent = relevantAgents[0];
  // Pick one of the service offerings based on your criteria (in this example we just pick the first one)
  const chosenJobOffering = chosenAgent.jobOfferings[0];

  const jobId = await chosenJobOffering.initiateJob(
    "Help me to generate a flower meme.",
    EVALUATOR_AGENT_WALLET_ADDRESS, // evaluator address
    new Date(Date.now() + 1000 * 60 * 3.1) // job expiry duration, minimum 3 minutes
  );

  console.log(`Job ${jobId} initiated`);
}

buyer();

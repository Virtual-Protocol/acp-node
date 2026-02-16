import AcpClient, {
  AcpContractClientV2,
  AcpJobPhases,
  AcpJob,
  AcpMemo,
  AcpAgentSort,
  AcpGraduationStatus,
  AcpOnlineStatus,
  baseSepoliaAcpX402ConfigV2,
} from "../../../src/index";
import {
  BUYER_AGENT_WALLET_ADDRESS,
  WHITELISTED_WALLET_PRIVATE_KEY,
  BUYER_ENTITY_ID,
} from "./env";

async function buyer() {
  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      BUYER_ENTITY_ID,
      BUYER_AGENT_WALLET_ADDRESS,
      baseSepoliaAcpX402ConfigV2
    ),
    onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
      if (
        job.phase === AcpJobPhases.NEGOTIATION &&
        (memoToSign?.nextPhase === AcpJobPhases.TRANSACTION ||
          memoToSign?.nextPhase === AcpJobPhases.COMPLETED)
      ) {
          console.log(`Paying for job ${job.id}`);
          await job.payAndAcceptRequirement();
          console.log(`Job ${job.id} paid`);
      } else if (
        job.phase === AcpJobPhases.TRANSACTION &&
        memoToSign?.nextPhase === AcpJobPhases.REJECTED
      ) {
        console.log(
          `Signing job ${job.id} rejection memo, rejection reason: ${memoToSign?.content}`
        );
        await memoToSign?.sign(true, "Accepts job rejection");
        console.log(`Job ${job.id} rejection memo signed`);
      } else if (job.phase === AcpJobPhases.COMPLETED) {
        console.log(
          `Job ${job.id} completed, received deliverable:`,
          job.deliverable
        );
      } else if (job.phase === AcpJobPhases.REJECTED) {
        console.log(`Job ${job.id} rejected by seller`);
      } else if (job.phase === AcpJobPhases.TRANSACTION) {
        // console.log(`Memo to sign ${memoToSign?.id} for job ${job.id}`);
        await memoToSign?.sign(true, "Accepts transaction memo");
      }
    },
  });

  // Browse available agents based on a keyword
  const relevantAgents = await acpClient.browseAgents("cross chain transfer", {
    sort_by: [AcpAgentSort.SUCCESSFUL_JOB_COUNT],
    top_k: 5,
    graduationStatus: AcpGraduationStatus.ALL,
    onlineStatus: AcpOnlineStatus.ALL,
    // showHiddenOfferings: true,
  });

  console.log("Relevant agents:", relevantAgents);

  // Pick one of the agents based on your criteria (in this example we just pick the first one)
  const chosenAgent = relevantAgents[0];
  // Pick one of the service offerings based on your criteria (in this example we just pick the first one)
  const chosenJobOffering = chosenAgent.jobOfferings[1];

  const jobId = await chosenJobOffering.initiateJob(
    // <your-schema-field> can be found in your ACP Visualiser's "Edit Service" pop-up.
    // Reference: (./images/specify_requirement_toggle_switch.png)
    {},
    undefined, // evaluator address, undefined fallback to empty address - skip-evaluation
  );

  console.log(`Job ${jobId} initiated`);
}

buyer();

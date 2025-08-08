import AcpClient, {
  AcpContractClient,
  AcpGraduationStatus,
  AcpJob,
  AcpJobPhases,
  AcpMemo,
  MemoType,
  PayloadType,
  AcpAgentSort,
  AcpOnlineStatus,
} from "@virtuals-protocol/acp-node";
import {
  BUYER_AGENT_WALLET_ADDRESS,
  BUYER_ENTITY_ID,
  WHITELISTED_WALLET_PRIVATE_KEY,
} from "./env";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buyer() {
  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClient.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      BUYER_ENTITY_ID,
      BUYER_AGENT_WALLET_ADDRESS
    ),
    onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
      if (
        job.phase === AcpJobPhases.NEGOTIATION &&
        memoToSign?.nextPhase === AcpJobPhases.TRANSACTION
      ) {
        console.log("Paying job", job, "with memo", memoToSign.id);
        await job.pay(job.price);
        console.log(`Job ${job.id} paid`);

        // Buyer starts opening positions
        console.log("Opening position", job);
        await job.openPosition(
          [
            {
              symbol: "BTC",
              amount: 0.001, // amount in $VIRTUAL
              tp: { percentage: 5 },
              sl: { percentage: 2 },
            },
            {
              symbol: "ETH",
              amount: 0.002, // amount in $VIRTUAL
              tp: { percentage: 10 },
              sl: { percentage: 5 },
            },
          ],
          0.001 // fee amount in $VIRTUAL
        );
        console.log(`Job ${job.id} 2 positions opened`);

        // Buyer open 1 more position
        await delay(20000);
        console.log(`Job ${job.id} opening 1 more position`);
        await job.openPosition(
          [
            {
              symbol: "VIRTUAL",
              amount: 0.003, // amount in $VIRTUAL
              tp: { percentage: 33000 },
              sl: { percentage: 2 },
            },
          ],
          0.0001 // fee amount in $VIRTUAL
        );
        console.log(`Job ${job.id} 1 more position opened`);

        // Buyer starts closing positions on initiative, before TP/SL hit
        await delay(20000);
        console.log(`Job ${job.id} closing BTC position`);
        await job.closePartialPosition({
          positionId: 0,
          amount: 0.00101,
        });
        console.log(`Job ${job.id} BTC position closed`);

        // Buyer close job upon all positions return
        await delay(20000);
        await job.closeJob();
        console.log(`Start closing Job ${job.id}`);
        return;
      }

      // receiving funds transfer from provider for the unfulfilled positions
      if (
        job.phase === AcpJobPhases.TRANSACTION &&
        memoToSign?.nextPhase === AcpJobPhases.TRANSACTION &&
        memoToSign?.type === MemoType.PAYABLE_TRANSFER_ESCROW
      ) {
        console.log(
          "Accepting funds transfer",
          job,
          "with memo",
          memoToSign.id
        );
        if (memoToSign?.payloadType === PayloadType.UNFULFILLED_POSITION) {
          await job.responseUnfulfilledPosition(
            memoToSign?.id,
            true,
            "Accepting funds transfer for the unfulfilled positions"
          );
          console.log(
            `Job ${job.id} funds transfer for the unfulfilled position accepted`
          );
          return;
        }

        await job.responsePositionFulfilled(
          memoToSign?.id,
          true,
          "Accepting funds transfer for the fulfilled positions"
        );
        console.log(
          `Job ${job.id} funds transfer for the fulfilled position accepted`
        );
        return;
      }

      // receiving funds transfer from provider at closing of the job
      if (
        job.phase === AcpJobPhases.TRANSACTION &&
        memoToSign?.type === MemoType.PAYABLE_TRANSFER_ESCROW &&
        memoToSign?.nextPhase === AcpJobPhases.EVALUATION // if phase is evaluation, it means the job is closing
      ) {
        console.log(
          "Accepting funds transfer",
          job,
          "with memo",
          memoToSign.id
        );
        await job.confirmJobClosure(memoToSign?.id, true);
        console.log(`Job ${job.id} closed and funds transfer accepted`);
        return;
      }

      if (job.phase === AcpJobPhases.COMPLETED) {
        console.log(`Job ${job.id} completed`);
        return;
      }
    },
    onEvaluate: async (job: AcpJob) => {
      console.log("Evaluation function called", job);
      await job.evaluate(true, "Self-evaluated and approved");
      console.log(`Job ${job.id} evaluated`);
    },
  });

  // Browse available agents based on a keyword and cluster name
  const relevantAgents = await acpClient.browseAgents(
    "<your-filter-agent-keyword>",
    {
      cluster: "<your-cluster-name>",
      sort_by: [AcpAgentSort.SUCCESSFUL_JOB_COUNT],
      top_k: 5,
      graduationStatus: AcpGraduationStatus.ALL,
      onlineStatus: AcpOnlineStatus.ALL,
    }
  );
  // Pick one of the agents based on your criteria (in this example we just pick the first one)
  const chosenAgent = relevantAgents[0];
  // Pick one of the service offerings based on your criteria (in this example we just pick the first one)
  const chosenJobOffering = chosenAgent.offerings[0];

  const jobId = await chosenJobOffering.initiateJob(
    "<your_service_requirement>",
    BUYER_AGENT_WALLET_ADDRESS, // Use default evaluator address
    new Date(Date.now() + 1000 * 60 * 6) // expiredAt as last parameter
  );

  console.log(`Job ${jobId} initiated`);
}

buyer();

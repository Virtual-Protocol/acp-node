import AcpClient, {
  AcpContractClient,
  AcpJob,
  AcpJobPhases,
  MemoType,
} from "../../../src";

async function buyer() {
  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClient.build(
      "private_key",
      "entity_id",
      "agent_address"
    ),
    onNewTask: async (job: AcpJob) => {
      if (
        job.phase === AcpJobPhases.NEGOTIATION &&
        job.memos.find((m) => m.nextPhase === AcpJobPhases.TRANSACTION)
      ) {
        console.log("Paying job", job);
        await job.pay(job.price);
        console.log(`Job ${job.id} paid`);

        return;
      }

      // provider requesting funds, usually initial transfer
      if (
        job.phase === AcpJobPhases.TRANSACTION &&
        job.memos.pop()?.type === MemoType.PAYABLE_REQUEST
      ) {
        console.log("Requesting funds", job);
        await job.resposneFundsRequest(100, true);
        console.log(`Job ${job.id} funds requested`);

        return;
      }

      // depositing more funds
      if (
        job.phase === AcpJobPhases.TRANSACTION &&
        job.memos.pop()?.type === MemoType.PAYABLE_REQUEST
      ) {
        console.log("Accepting funds transfer", job);
        await job.transferFunds(100);
        console.log(`Job ${job.id} requesting funds transfer`);

        return;
      }

      // receiving funds transfer from provider (usually closing of the job)
      if (
        job.phase === AcpJobPhases.TRANSACTION &&
        job.memos.pop()?.type === MemoType.PAYABLE_TRANSFER &&
        job.memos.pop()?.nextPhase === AcpJobPhases.EVALUATION // if phase is evaluation, it means the job is closing
      ) {
        console.log("Accepting funds transfer", job);
        await job.responseFundsTransfer(100, true, "accepts funds transfer");
        console.log(`Job ${job.id} funds transfer accepted`);

        return;
      }

      await job.sendMessage("Close all position");

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
  const job = await acpClient.initiateJob(
    "0x0000000000000000000000000000000000000000",
    "starting an investment with 100 virtuals",
    2
  );
}

buyer();

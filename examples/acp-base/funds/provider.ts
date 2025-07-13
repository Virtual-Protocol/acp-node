import AcpClient, {
  AcpContractClient,
  AcpJob,
  AcpJobPhases,
  MemoType,
} from "../../../src";

async function seller() {
  new AcpClient({
    acpContractClient: await AcpContractClient.build(
      "private_key",
      "entity_id",
      "agent_address"
    ),
    onNewTask: async (job: AcpJob) => {
      if (
        job.phase === AcpJobPhases.REQUEST &&
        job.memos.find((m) => m.nextPhase === AcpJobPhases.NEGOTIATION)
      ) {
        console.log("Responding to job", job);
        await job.respond(true);
        console.log(`Job ${job.id} responded`);

        return;
      }

      if (
        job.phase === AcpJobPhases.TRANSACTION &&
        job.latestMemo?.nextPhase === AcpJobPhases.EVALUATION
      ) {
        // receiving funds transfer from client (usually more deposit)
        if (job.latestMemo?.type === MemoType.PAYABLE_TRANSFER) {
          console.log("Accepting funds transfer", job);
          await job.responseFundsTransfer(100, true, "accepts funds transfer");
          console.log(`Job ${job.id} funds transfer accepted`);

          return;
        }

        // provider requesting funds, usually initial transfer
        console.log("requesting funds");
        await job.requestFunds(1.5, "https://example.com");
        console.log(`Job ${job.id} funds requested`);

        return;
      }

      // closing the job
      if (
        job.phase === AcpJobPhases.TRANSACTION &&
        job.latestMemo?.type === MemoType.MESSAGE
      ) {
        console.log("Delivering job", job);
        await job.transferFunds(100, AcpJobPhases.EVALUATION); // transfer amount to client (closing the job)
        console.log(`Job ${job.id} delivered`);

        return;
      }
    },
  });
}

seller();

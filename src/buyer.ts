import AcpClient from "./acpClient";
import AcpContractClient, { AcpJobPhases } from "./acpContractClient";
import AcpJob from "./acpJob";
import { baseSepoliaAcpConfig } from "./configs";

async function buyer() {
  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClient.build(
      "0xc693f94783e4ecfa7e68d0d2c29bb73e66fe3848e0b6011803d15bc07b82227b",
      1,
      // 0x29348362eAcD334BAE3b1623D486A70A78603b6c
      "0x29348362eAcD334BAE3b1623D486A70A78603b6c",
      baseSepoliaAcpConfig
    ),
    onNewTask: async (job: AcpJob) => {
      console.log("New task", job);
      if (job.memos.find((m) => m.nextPhase === AcpJobPhases.TRANSACTION)) {
        await job.pay(2);
      } else if (job.phase === AcpJobPhases.COMPLETED) {
        console.log("Job completed", job);
      }
    },
  });

  await acpClient.initiateJob(
    "0xe02A848EbFf0a12e41BE96e86c73728dA5E3c3EF",
    "Meme generator",
    undefined,
    "0x29348362eAcD334BAE3b1623D486A70A78603b6c"
  );
}

buyer();

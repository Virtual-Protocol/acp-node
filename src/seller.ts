import AcpClient from "./acpClient";
import AcpContractClient, { AcpJobPhases } from "./acpContractClient";
import AcpJob from "./acpJob";
import { baseSepoliaAcpConfig } from "./configs";

async function seller() {
  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClient.build(
      "0xc693f94783e4ecfa7e68d0d2c29bb73e66fe3848e0b6011803d15bc07b82227b",
      1,
      // 0xe02A848EbFf0a12e41BE96e86c73728dA5E3c3EF
      "0xe02A848EbFf0a12e41BE96e86c73728dA5E3c3EF",
      baseSepoliaAcpConfig
    ),
    onNewTask: async (job: AcpJob) => {
      console.log("New task", job);
      if (job.memos.find((m) => m.nextPhase === AcpJobPhases.NEGOTIOATION)) {
        await job.respond(true);
      } else if (
        job.memos.find((m) => m.nextPhase === AcpJobPhases.EVALUATION)
      ) {
        await job.deliver(
          JSON.stringify({
            type: "url",
            content: "https://example.com",
          })
        );
      }
    },
  });
}

seller();

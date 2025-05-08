import AcpClient from "./acpClient";
import AcpContractClient from "./acpContractClient";
import { baseSepoliaAcpConfig } from "./configs";

async function evaluator() {
  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClient.build(
      "0xc693f94783e4ecfa7e68d0d2c29bb73e66fe3848e0b6011803d15bc07b82227b",
      1,
      "0x29348362eAcD334BAE3b1623D486A70A78603b6c",
      baseSepoliaAcpConfig
    ),
    onEvaluate: async (job) => {
      console.log("Evaluation function called", job);
      await job.evaluate(true);
    },
  });
}

evaluator();

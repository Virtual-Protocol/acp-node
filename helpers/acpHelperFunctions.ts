import * as path from 'path';
import AcpClient from "../src/acpClient";
import AcpContractClient from "../src/acpContractClient";
import { baseSepoliaAcpConfig } from "../src/configs";
import * as dotenv from "dotenv";
import { Address } from "viem";

// Load environment variables
dotenv.config({ override: true });

async function testHelperFunctions() {
  console.log("Testing ACP helper functions...");

  // Initialize AcpClient
  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClient.build(
      process.env.WHITELISTED_WALLET_PRIVATE_KEY as `0x${string}`,
      Number(process.env.WHITELISTED_WALLET_ENTITY_ID),
      process.env.BUYER_AGENT_WALLET_ADDRESS as Address,
      baseSepoliaAcpConfig
    )
  });

  // Get active jobs
  const activeJobs = await acpClient.getActiveJobs(1, 10);
  console.log("\n🔵 Active Jobs:");
  console.log(activeJobs.data.length > 0 ? activeJobs.data : "No active jobs found.");

  // Get completed jobs
  const completedJobs = await acpClient.getCompletedJobs(1, 10);
  console.log("\n✅ Completed Jobs:");
  console.log(completedJobs.data.length > 0 ? completedJobs.data : "No completed jobs found.");

  // Get cancelled jobs
  const cancelledJobs = await acpClient.getCancelledJobs(1, 10);
  console.log("\n❌ Cancelled Jobs:");
  console.log(cancelledJobs.data.length > 0 ? cancelledJobs.data : "No cancelled jobs found.");

  if (completedJobs.data.length > 0) {
    const onChainJobId = completedJobs.data[0].onChainJobId;
    if (onChainJobId) {
      const job = await acpClient.getJobByOnChainJobId(onChainJobId);
      console.log(`\n📄 Job Details (Job ID: ${onChainJobId}):`);
      console.log(job.data);

      const memos = completedJobs.data[0].memos;
      if (memos && memos.length > 0) {
        const memoId = memos[0].memoId;
        const memo = await acpClient.getMemoById(onChainJobId, memoId);
        console.log(`\n📝 Memo Details (Job ID: ${onChainJobId}, Memo ID: ${memoId}):`);
        console.log(memo.data);
      } else {
        console.log("\n⚠️ No memos found for the completed job.");
      }
    }
  } else {
    console.log("\n⚠️ No completed jobs available for detailed inspection.");
  }
}

// Run the test
testHelperFunctions().catch(error => {
  console.error("Error in helper functions test:", error);
  process.exit(1);
});
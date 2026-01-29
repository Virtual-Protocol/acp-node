import AcpClient, { AcpContractClientV2 } from "../../../src";
import * as dotenv from "dotenv";
import { BUYER_AGENT_WALLET_ADDRESS, BUYER_ENTITY_ID, WHITELISTED_WALLET_PRIVATE_KEY } from "./env";

// Load environment variables
dotenv.config({override: true});

function subsection(title: string) {
  console.log(`\n--- ${title} ---`);
}

async function testHelperFunctions() {
  console.log(`\n${"=".repeat(60)}`);
  console.log("🔹 ACP Helper Functions Test");
  console.log(`${"=".repeat(60)}\n`);

  console.log("Initializing ACP client...\n");
  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      BUYER_ENTITY_ID,
      BUYER_AGENT_WALLET_ADDRESS,
    )
  });

  /* ---------------- ACTIVE JOBS ---------------- */
  subsection("Active Jobs");
  const activeJobs = await acpClient.getActiveJobs(1, 3);
  console.log("\n🔵 Active Jobs:");
  console.log(activeJobs.length > 0 ? activeJobs : "No active jobs found.");

  /* ---------------- COMPLETED JOBS ---------------- */
  const completedJobs = await acpClient.getCompletedJobs(1, 3);
  console.log("\n✅ Completed Jobs:");
  if (completedJobs.length > 0) {
    console.log(completedJobs);

    const onChainJobId = completedJobs[0].id;
    if (onChainJobId) {
      const job = await acpClient.getJobById(onChainJobId);
      console.log(`\n📄 Job Details (Job ID: ${onChainJobId}):`);
      console.log(job);

      const memos = completedJobs[0].memos;
      if (memos && memos.length > 0) {
        const memoId = memos[0].id;
        const memo = await acpClient.getMemoById(onChainJobId, memoId);
        console.log(`\n📝 Memo Details (Job ID: ${onChainJobId}, Memo ID: ${memoId}):`);
        console.log(memo);
      } else {
        console.log("\n⚠️ No memos found for the completed job.");
      }
    }
  } else {
    console.log("No completed jobs found.");
  }

  /* ---------------- CANCELLED JOBS ---------------- */
  const cancelledJobs = await acpClient.getCancelledJobs(1, 3);
  console.log("\n❌ Cancelled Jobs:");
  console.log(cancelledJobs.length > 0 ? cancelledJobs : "No cancelled jobs found.");

  /* ---------------- PENDING MEMO JOBS ---------------- */
  const jobsWithPendingMemos = await acpClient.getPendingMemoJobs(1, 3);
  console.log(jobsWithPendingMemos.length > 0 ? jobsWithPendingMemos : "No jobs with pending memos jobs found.");

  /* ---------------- AGENT INFO ---------------- */
  const agentWalletAddress = acpClient.walletAddress;
  const agent = await acpClient.getAgent(agentWalletAddress, { showHiddenOfferings: true });
  console.log(agent ?? `No agent with wallet address ${agentWalletAddress} found.`);
}

testHelperFunctions()
  .then(() => {
    console.log("\n✨ Test completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error in helper functions test:");
    console.error(error);
    process.exit(1);
  });

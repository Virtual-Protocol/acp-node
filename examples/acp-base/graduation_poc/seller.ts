/**
 * Seller (Meme Provider Agent) - Generates meme samples for evaluation
 * 
 * This agent:
 * 1. Receives graduation evaluation jobs from the Evaluator Agent
 * 2. Generates a meme sample based on the job requirement
 * 3. Submits the meme sample deliverable for evaluation
 */

import AcpClient, {
  AcpContractClientV2,
  AcpJobPhases,
  AcpJob,
  AcpMemo,
  DeliverablePayload,
  baseAcpX402ConfigV2,
  AcpError,
} from "@virtuals-protocol/acp-node";
import {
  SELLER_AGENT_WALLET_ADDRESS,
  SELLER_ENTITY_ID,
  WHITELISTED_WALLET_PRIVATE_KEY,
} from "./env";

// ============================================================================
// Constants
// ============================================================================

const POLLING_INTERVAL = 10000; // 10 seconds

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a meme sample deliverable
 * This is a mock implementation - in production, this would generate actual memes
 */
async function generateMemeSample(job: AcpJob): Promise<DeliverablePayload> {
  console.log(`[Seller] Generating meme sample for job ${job.id}`);
  
  const memeSample: DeliverablePayload = {
    type: "meme",
    url: "https://example.com/meme-sample.jpg",
    title: "Sample Meme for Graduation Evaluation",
    description: "A sample meme generated for graduation evaluation purposes",
    timestamp: new Date().toISOString(),
    metadata: {
      format: "jpg",
      dimensions: { width: 800, height: 600 },
      size: "245KB",
      generatedAt: new Date().toISOString(),
    },
  };

  console.log(`[Seller] Meme sample generated:`, JSON.stringify(memeSample, null, 2));
  return memeSample;
}

/**
 * Handle job request - accept and request payment
 */
async function handleJobRequest(job: AcpJob): Promise<void> {
  console.log(`[Seller] Received graduation evaluation job ${job.id}`);
  console.log(`[Seller] Job requirement:`, job.requirement);
  
  await job.accept("Graduation evaluation job accepted");
  await job.createRequirement(
    `Graduation evaluation job accepted. Please make payment to proceed with evaluation.`
  );
}

/**
 * Handle payment and deliver meme sample
 */
async function handleTransaction(job: AcpJob, memoToSign?: AcpMemo): Promise<void> {
  console.log(`[Seller] Job ${job.id} is in TRANSACTION phase`);
  
  if (job.deliverable) {
    console.log(`[Seller] Job ${job.id} already has deliverable submitted:`, job.deliverable);
    return;
  }

  if (memoToSign?.nextPhase === AcpJobPhases.EVALUATION) {
    console.log(`[Seller] Signing payment confirmation memo for job ${job.id}`);
    await memoToSign.sign(true, "Payment received, generating meme sample");
  }

  console.log(`[Seller] Payment received for job ${job.id}, generating meme sample...`);

  try {
    const memeSample = await generateMemeSample(job);
    
    console.log(`[Seller] Meme sample generated, submitting deliverable for job ${job.id}...`);
    console.log(`[Seller] Deliverable content:`, JSON.stringify(memeSample, null, 2));
    await job.deliver(memeSample);
    
    console.log(`[Seller] Meme sample deliverable submitted for job ${job.id}`);
  } catch (error) {
    console.error(`[Seller] Error generating meme sample for job ${job.id}:`, error);
    await job.reject(`Meme generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Poll for jobs in TRANSACTION phase that need delivery
 * This ensures we catch jobs even if onNewTask wasn't called
 */
async function pollForJobsToDeliver(acpClient: AcpClient): Promise<void> {
  try {
    const activeJobs = await acpClient.getActiveJobs();
    
    if (activeJobs instanceof AcpError || activeJobs.length === 0) {
      return;
    }

    for (const job of activeJobs) {
      if (job.phase === AcpJobPhases.TRANSACTION && !job.deliverable) {
        console.log(`[Seller] Polling found job ${job.id} in TRANSACTION phase, delivering...`);
        await handleNewTask(job);
      }
    }
  } catch (error) {
    console.error(`[Seller] Error polling for jobs:`, error);
  }
}

/**
 * Handle new tasks from the evaluator
 */
async function handleNewTask(
  job: AcpJob,
  memoToSign?: AcpMemo
): Promise<void> {
  try {
    console.log(
      `[Seller] handleNewTask called for job ${job.id}, ` +
      `phase: ${AcpJobPhases[job.phase]}, ` +
      `memoToSign: ${memoToSign ? `yes (nextPhase: ${AcpJobPhases[memoToSign.nextPhase]})` : 'no'}`
    );
    
    if (
      job.phase === AcpJobPhases.REQUEST &&
      memoToSign?.nextPhase === AcpJobPhases.NEGOTIATION
    ) {
      await handleJobRequest(job);
      return;
    }

    if (job.phase === AcpJobPhases.TRANSACTION) {
      await handleTransaction(job, memoToSign);
      return;
    }

    // Handle other phases
    if (job.phase === AcpJobPhases.REJECTED) {
      console.log(`[Seller] Job ${job.id} was rejected`);
    } else if (job.phase === AcpJobPhases.COMPLETED) {
      console.log(`[Seller] Job ${job.id} completed`);
    }
  } catch (error) {
    console.error(`[Seller] Error handling task for job ${job.id}:`, error);
  }
}

// ============================================================================
// Main Function
// ============================================================================

async function seller() {
  try {
    const acpClient = new AcpClient({
      acpContractClient: await AcpContractClientV2.build(
        WHITELISTED_WALLET_PRIVATE_KEY,
        SELLER_ENTITY_ID,
        SELLER_AGENT_WALLET_ADDRESS,
        baseAcpX402ConfigV2,
      ),
      onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
        await handleNewTask(job, memoToSign);
      },
    });

    console.log("[Seller] Pending graduation agent is running and ready to receive jobs");
    console.log("[Seller] Waiting for graduation evaluation jobs...");
    
    setInterval(() => {
      pollForJobsToDeliver(acpClient);
    }, POLLING_INTERVAL);
  } catch (error) {
    console.error("[Seller] Failed to initialize seller:", error);
    process.exit(1);
  }
}

seller();

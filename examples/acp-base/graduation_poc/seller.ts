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

/**
 * Generate a meme sample deliverable
 * This is a mock implementation - in production, this would generate actual memes
 */
async function generateMemeSample(job: AcpJob): Promise<DeliverablePayload> {
  console.log(`[Seller] Generating meme sample for job ${job.id}`);
  
  // Generate a mock meme sample
  // In a real implementation, this would use an image generation API or service
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
 * Poll for jobs in TRANSACTION phase that need delivery
 * This ensures we catch jobs even if onNewTask wasn't called
 */
async function pollForJobsToDeliver(acpClient: AcpClient) {
  try {
    // Get active jobs for this seller
    const activeJobs = await acpClient.getActiveJobs();
    
    if (activeJobs instanceof AcpError || activeJobs.length === 0) {
      return;
    }

    for (const job of activeJobs) {
      // Check if job is in TRANSACTION phase and needs delivery
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
 * Main seller function
 */
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
    
    // Poll for jobs that need delivery every 10 seconds
    // This ensures we catch jobs even if onNewTask wasn't called when phase changed
    // This is a backup mechanism - onNewTask should still be the primary notification method
    setInterval(() => {
      pollForJobsToDeliver(acpClient);
    }, 10000);
  } catch (error) {
    console.error("[Seller] Failed to initialize seller:", error);
    process.exit(1);
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
    console.log(`[Seller] handleNewTask called for job ${job.id}, phase: ${AcpJobPhases[job.phase]}, memoToSign: ${memoToSign ? `yes (nextPhase: ${AcpJobPhases[memoToSign.nextPhase]})` : 'no'}`);
    
    // Handle job request - accept and request payment
    if (
      job.phase === AcpJobPhases.REQUEST &&
      memoToSign?.nextPhase === AcpJobPhases.NEGOTIATION
    ) {
      console.log(`[Seller] Received graduation evaluation job ${job.id}`);
      console.log(`[Seller] Job requirement:`, job.requirement);
      
      // Accept the job
      console.log(`[Seller] Accepting graduation evaluation job ${job.id}`);
      await job.accept("Graduation evaluation job accepted");
      
      // Request payment
      console.log(`[Seller] Requesting payment for graduation evaluation job ${job.id}`);
      await job.createRequirement(
        `Graduation evaluation job accepted. Please make payment to proceed with evaluation.`
      );
      
      return;
    }

    // Handle payment and deliver meme sample
    // After evaluator pays, job moves to TRANSACTION phase
    if (job.phase === AcpJobPhases.TRANSACTION) {
      console.log(`[Seller] Job ${job.id} is in TRANSACTION phase`);
      
      // Check if deliverable has already been submitted
      if (job.deliverable) {
        console.log(`[Seller] Job ${job.id} already has deliverable submitted:`, job.deliverable);
        return;
      }

      // Sign payment confirmation memo if present
      if (memoToSign?.nextPhase === AcpJobPhases.EVALUATION) {
        console.log(`[Seller] Signing payment confirmation memo for job ${job.id}`);
        await memoToSign.sign(true, "Payment received, generating meme sample");
      }

      console.log(`[Seller] Payment received for job ${job.id}, generating meme sample...`);

      // Generate and deliver meme sample
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
      return;
    }

    // Handle job rejection
    if (job.phase === AcpJobPhases.REJECTED) {
      console.log(`[Seller] Job ${job.id} was rejected`);
    }

    // Handle job completion
    if (job.phase === AcpJobPhases.COMPLETED) {
      console.log(`[Seller] Job ${job.id} completed`);
    }
  } catch (error) {
    console.error(`[Seller] Error handling task for job ${job.id}:`, error);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  seller();
}

export { seller, generateMemeSample };


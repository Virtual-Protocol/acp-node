/**
 * Buyer (Agent Team) - Submits graduation evaluation requests
 * 
 * This agent submits a graduation request with:
 * - agentName: The name of the agent to be evaluated
 * - agentWalletAddress: The wallet address of the agent to be evaluated
 */

import AcpClient, {
  AcpContractClientV2,
  AcpJobPhases,
  AcpJob,
  AcpMemo,
  baseAcpX402ConfigV2,
  baseAcpConfigV2,
  AcpError,
  AcpOnlineStatus,
  AcpGraduationStatus,
} from "@virtuals-protocol/acp-node";
import {
  BUYER_AGENT_WALLET_ADDRESS,
  WHITELISTED_WALLET_PRIVATE_KEY,
  BUYER_ENTITY_ID,
  EVALUATOR_AGENT_WALLET_ADDRESS,
} from "./env";

// ============================================================================
// Constants
// ============================================================================

const JOB_EXPIRY_MINUTES = 30;
const POLLING_INTERVAL = 10000; // 10 seconds

// ============================================================================
// Types
// ============================================================================

interface GraduationRequest {
  agentName: string;
  agentWalletAddress: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function handleJobPhase(job: AcpJob, memoToSign?: AcpMemo): void {
  switch (job.phase) {
    case AcpJobPhases.NEGOTIATION:
      if (memoToSign?.nextPhase === AcpJobPhases.TRANSACTION) {
        console.log(`[Buyer] Paying for graduation evaluation job ${job.id}`);
      }
      break;
    case AcpJobPhases.TRANSACTION:
      if (memoToSign?.nextPhase === AcpJobPhases.REJECTED) {
        console.log(`[Buyer] Signing job ${job.id} rejection memo, rejection reason: ${memoToSign?.content}`);
      }
      break;
    case AcpJobPhases.COMPLETED:
      console.log(`[Buyer] Job ${job.id} completed, received deliverable:`, job.deliverable);
      break;
    case AcpJobPhases.REJECTED:
      console.log(`[Buyer] Job ${job.id} rejected`);
      break;
    case AcpJobPhases.EVALUATION:
      console.log(`[Buyer] Job ${job.id} is being evaluated`);
      break;
  }
}

async function handlePayment(job: AcpJob): Promise<void> {
  try {
    await job.payAndAcceptRequirement();
    console.log(`[Buyer] Job ${job.id} paid`);
  } catch (error) {
    if (error instanceof AcpError && error.message.includes("X402")) {
      console.error(`[Buyer] X402 payment failed for job ${job.id}:`, error.message);
      console.error(`[Buyer] This might be due to X402 service issues. Try using direct transfer (baseAcpConfigV2) instead.`);
    }
    throw error;
  }
}

async function handleRejection(job: AcpJob, memoToSign?: AcpMemo): Promise<void> {
  if (memoToSign) {
    await memoToSign.sign(true, "Accepts job rejection");
    console.log(`[Buyer] Job ${job.id} rejection memo signed`);
  }
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Submit a graduation evaluation request
 * 
 * @param request - The graduation request containing agentName and agentWalletAddress
 * @returns The job ID of the initiated graduation evaluation job
 */
async function submitGraduationRequest(request: GraduationRequest): Promise<number> {
  const useX402 = process.env.USE_X402_PAYMENT === "true";
  
  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      BUYER_ENTITY_ID,
      BUYER_AGENT_WALLET_ADDRESS,
      useX402 ? baseAcpX402ConfigV2 : baseAcpConfigV2,
    ),
    onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
      handleJobPhase(job, memoToSign);

      if (
        job.phase === AcpJobPhases.NEGOTIATION &&
        memoToSign?.nextPhase === AcpJobPhases.TRANSACTION
      ) {
        await handlePayment(job);
      } else if (
        job.phase === AcpJobPhases.TRANSACTION &&
        memoToSign?.nextPhase === AcpJobPhases.REJECTED
      ) {
        await handleRejection(job, memoToSign);
      }
    },
  });

  const graduationRequestPayload = {
    agentName: request.agentName,
    agentWalletAddress: request.agentWalletAddress,
  };

  console.log(`[Buyer] Submitting graduation request for agent: ${request.agentName} (${request.agentWalletAddress})`);

  const evaluatorAgent = await acpClient.browseAgents(
    EVALUATOR_AGENT_WALLET_ADDRESS,
    {
      top_k: 1,
      graduationStatus: AcpGraduationStatus.ALL,
      onlineStatus: AcpOnlineStatus.ONLINE,
    }
  );

  if (!evaluatorAgent[0]?.jobOfferings[0]) {
    throw new Error("Evaluator agent not found or has no job offerings");
  }

  const jobId = await evaluatorAgent[0].jobOfferings[0].initiateJob(
    graduationRequestPayload,
    undefined,
    new Date(Date.now() + JOB_EXPIRY_MINUTES * 60 * 1000)
  );

  console.log(`[Buyer] Graduation evaluation job ${jobId} initiated`);
  return jobId;
}

/**
 * Main function to submit a graduation request
 */
async function buyer() {
  try {
    const graduationRequest: GraduationRequest = {
      agentName: process.env.PENDING_AGENT_NAME || "ExampleAgent",
      agentWalletAddress: process.env.PENDING_AGENT_WALLET_ADDRESS || "0x0000000000000000000000000000000000000000",
    };

    if (!graduationRequest.agentName || !graduationRequest.agentWalletAddress) {
      throw new Error("PENDING_AGENT_NAME and PENDING_AGENT_WALLET_ADDRESS must be set in environment variables");
    }

    const jobId = await submitGraduationRequest(graduationRequest);
    console.log(`[Buyer] Successfully submitted graduation request. Job ID: ${jobId}`);
    console.log("[Buyer] Waiting for evaluation results...");
  } catch (error) {
    console.error("[Buyer] Error submitting graduation request:", error);
    process.exit(1);
  }
}

buyer();

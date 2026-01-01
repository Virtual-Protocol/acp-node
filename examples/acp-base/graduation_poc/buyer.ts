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
  FareAmount,
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

interface GraduationRequest {
  agentName: string;
  agentWalletAddress: string;
}

/**
 * Submit a graduation evaluation request
 * 
 * @param request - The graduation request containing agentName and agentWalletAddress
 * @returns The job ID of the initiated graduation evaluation job
 */
async function submitGraduationRequest(request: GraduationRequest): Promise<number> {
  // For free evaluations (fareAmount = 0), use direct transfer instead of X402
  // X402 is typically used for USDC payments and can fail for free jobs or have service issues
  // Use baseAcpConfigV2 for direct transfer (recommended for free jobs)
  // Use baseAcpX402ConfigV2 for X402 routing (for paid USDC jobs)
  const useX402 = process.env.USE_X402_PAYMENT === "true"; // Set USE_X402_PAYMENT=true in .env to use X402
  
  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      BUYER_ENTITY_ID,
      BUYER_AGENT_WALLET_ADDRESS,
      useX402 ? baseAcpX402ConfigV2 : baseAcpConfigV2,
    ),
    onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
      if (
        job.phase === AcpJobPhases.NEGOTIATION &&
        memoToSign?.nextPhase === AcpJobPhases.TRANSACTION
      ) {
        console.log(`[Buyer] Paying for graduation evaluation job ${job.id}`);
        try {
          await job.payAndAcceptRequirement();
          console.log(`[Buyer] Job ${job.id} paid`);
        } catch (error) {
          // Handle X402 payment errors gracefully
          if (error instanceof AcpError && error.message.includes("X402")) {
            console.error(`[Buyer] X402 payment failed for job ${job.id}:`, error.message);
            console.error(`[Buyer] This might be due to X402 service issues. Try using direct transfer (baseAcpConfigV2) instead.`);
            throw error;
          }
          throw error;
        }
      } else if (
        job.phase === AcpJobPhases.TRANSACTION &&
        memoToSign?.nextPhase === AcpJobPhases.REJECTED
      ) {
        console.log(`[Buyer] Signing job ${job.id} rejection memo, rejection reason: ${memoToSign?.content}`);
        await memoToSign?.sign(true, "Accepts job rejection");
        console.log(`[Buyer] Job ${job.id} rejection memo signed`);
      } else if (job.phase === AcpJobPhases.COMPLETED) {
        console.log(`[Buyer] Job ${job.id} completed, received deliverable:`, job.deliverable);
      } else if (job.phase === AcpJobPhases.REJECTED) {
        console.log(`[Buyer] Job ${job.id} rejected`);
      } else if (job.phase === AcpJobPhases.EVALUATION) {
        console.log(`[Buyer] Job ${job.id} is being evaluated`);
      }
    }
  });

  // Create the graduation request payload
  const graduationRequestPayload = {
    agentName: request.agentName,
    agentWalletAddress: request.agentWalletAddress,
  };

  console.log(`[Buyer] Submitting graduation request for agent: ${request.agentName} (${request.agentWalletAddress})`);

  // Initiate the job with the evaluator agent
  const evaluatorAgent = await acpClient.browseAgents(
    EVALUATOR_AGENT_WALLET_ADDRESS,
    {
      top_k: 1,
      graduationStatus: AcpGraduationStatus.NOT_GRADUATED,
      onlineStatus: AcpOnlineStatus.ONLINE,
    }
  );
  const jobId = await evaluatorAgent[0].jobOfferings[0].initiateJob(
    graduationRequestPayload,
    undefined,
    new Date(Date.now() + 1000 * 60 * 30) // 30 minutes expiry
  );

  console.log(`[Buyer] Graduation evaluation job ${jobId} initiated`);
  return jobId;
}

/**
 * Main function to submit a graduation request
 * 
 * Example usage:
 * - agentName: "MyAgent"
 * - agentWalletAddress: "0x..."
 */
async function buyer() {
  try {
    // Example: Submit graduation request
    // Replace these with actual values
    const graduationRequest: GraduationRequest = {
      agentName: process.env.PENDING_AGENT_NAME || "ExampleAgent",
      agentWalletAddress: process.env.PENDING_AGENT_WALLET_ADDRESS || "0x0000000000000000000000000000000000000000",
    };

    if (!graduationRequest.agentName || !graduationRequest.agentWalletAddress) {
      throw new Error("PENDING_AGENT_NAME and PENDING_AGENT_WALLET_ADDRESS must be set in environment variables");
    }

    const jobId = await submitGraduationRequest(graduationRequest);
    console.log(`[Buyer] Successfully submitted graduation request. Job ID: ${jobId}`);
    
    // Keep the process alive to receive callbacks
    console.log("[Buyer] Waiting for evaluation results...");
  } catch (error) {
    console.error("[Buyer] Error submitting graduation request:", error);
    process.exit(1);
  }
}

buyer();

/**
 * Seller (Pending Graduation Agent) - Executes graduation evaluation jobs
 * 
 * This agent:
 * 1. Receives graduation evaluation jobs from the Evaluator Agent
 * 2. Executes the job according to the requirement schema
 * 3. Submits the deliverable for evaluation
 */

import AcpClient, {
  AcpContractClientV2,
  AcpJobPhases,
  AcpJob,
  AcpMemo,
  DeliverablePayload,
  baseAcpX402ConfigV2,
} from "@virtuals-protocol/acp-node";
import {
  SELLER_AGENT_WALLET_ADDRESS,
  SELLER_ENTITY_ID,
  WHITELISTED_WALLET_PRIVATE_KEY,
} from "./env";

// Helper function to parse JSON
function tryParseJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    return null;
  }
}

interface GraduationEvaluationJob {
  type: "graduation_evaluation_job";
  requirementSchema: Object | string;
  deliverableSchema?: Object | string;
  evaluationPrompt?: string;
  evaluationRubric?: string;
  jobDescription?: string;
  offeringName?: string;
}

/**
 * Execute a graduation evaluation job
 * This is where the pending graduation agent performs its work
 */
async function executeGraduationJob(job: AcpJob): Promise<DeliverablePayload> {
  console.log(`[Seller] Executing graduation evaluation job ${job.id}`);

  // Parse the job requirement
  const jobRequirement = typeof job.requirement === 'string'
    ? tryParseJson<GraduationEvaluationJob>(job.requirement)
    : job.requirement as GraduationEvaluationJob;

  if (!jobRequirement || jobRequirement.type !== "graduation_evaluation_job") {
    throw new Error("Invalid graduation evaluation job format");
  }

  const requirementSchema = jobRequirement.requirementSchema || {};
  const deliverableSchema = jobRequirement.deliverableSchema || requirementSchema;
  const jobDescription = jobRequirement.jobDescription || "Graduation evaluation";
  const offeringName = jobRequirement.offeringName || "Unknown";

  console.log(`[Seller] Job description: ${jobDescription}`);
  console.log(`[Seller] Offering name: ${offeringName}`);
  console.log(`[Seller] Requirement schema:`, requirementSchema);
  console.log(`[Seller] Deliverable schema:`, deliverableSchema);

  // Execute the job based on the requirement schema
  // This is a placeholder - in a real implementation, the agent would:
  // 1. Understand the requirement schema
  // 2. Perform the actual work (e.g., generate content, process data, etc.)
  // 3. Format the deliverable according to the deliverable schema

  const deliverable = await generateDeliverable(requirementSchema, deliverableSchema, jobDescription);

  console.log(`[Seller] Deliverable generated for job ${job.id}`);
  return deliverable;
}

/**
 * Generate a deliverable based on the requirement schema and deliverable schema
 * This is a placeholder implementation - replace with actual agent logic
 */
async function generateDeliverable(
  requirementSchema: Object | string,
  deliverableSchema: Object | string,
  jobDescription: string
): Promise<DeliverablePayload> {
  // Parse the deliverable schema (use deliverable schema, fallback to requirement schema)
  const schema = typeof deliverableSchema === 'string'
    ? tryParseJson(deliverableSchema) || {}
    : deliverableSchema;

  // Example: If schema has specific fields, populate them
  // In a real implementation, this would be the agent's actual work
  const deliverable: any = {};

  if (typeof schema === 'object' && schema !== null && Object.keys(schema).length > 0) {
    // If schema defines expected fields, try to populate them
    for (const [key, value] of Object.entries(schema)) {
      // Placeholder: generate sample data
      // In reality, the agent would perform actual work here
      if (typeof value === 'object' && value !== null) {
        deliverable[key] = value;
      } else {
        deliverable[key] = `Sample value for ${key}`;
      }
    }
  }

  // If no schema structure, return a simple deliverable
  if (Object.keys(deliverable).length === 0) {
    return {
      type: "text",
      value: `Graduation evaluation deliverable for: ${jobDescription}`,
      timestamp: new Date().toISOString(),
      status: "completed",
    };
  }

  return deliverable;
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
        await handleNewTask(acpClient, job, memoToSign);
      },
    });

    console.log("[Seller] Pending graduation agent is running and ready to receive jobs");
    console.log("[Seller] Waiting for graduation evaluation jobs...");
  } catch (error) {
    console.error("[Seller] Failed to initialize seller:", error);
    process.exit(1);
  }
}

/**
 * Handle new tasks from the evaluator
 */
async function handleNewTask(
  acpClient: AcpClient,
  job: AcpJob,
  memoToSign?: AcpMemo
): Promise<void> {
  try {
    // Handle job request
    if (
      job.phase === AcpJobPhases.REQUEST &&
      job.memos.find((m) => m.nextPhase === AcpJobPhases.NEGOTIATION)
    ) {
      console.log(`[Seller] Received graduation evaluation job ${job.id}`);
      
      // Check if this is a graduation evaluation job
      const requestMemo = job.memos.find(
        (m) => m.nextPhase === AcpJobPhases.NEGOTIATION
      );

      if (requestMemo) {
        const jobPayload = tryParseJson<GraduationEvaluationJob>(requestMemo.content);
        
        if (jobPayload?.type === "graduation_evaluation_job") {
          // Accept the job
          console.log(`[Seller] Accepting graduation evaluation job ${job.id}`);
          await job.accept("Graduation evaluation job accepted");
          
          // Create requirement memo (if needed)
          await job.createRequirement(
            `Graduation evaluation job accepted. Will execute according to requirement schema.`
          );
          
          return;
        }
      }
    }

    // Handle payment and execute job
    if (
      job.phase === AcpJobPhases.TRANSACTION &&
      memoToSign?.nextPhase === AcpJobPhases.EVALUATION
    ) {
      console.log(`[Seller] Payment received for job ${job.id}, executing job...`);
      
      // Sign the payment memo
      await memoToSign.sign(true, "Payment received, executing job");

      // Execute the job
      try {
        const deliverable = await executeGraduationJob(job);
        
        console.log(`[Seller] Job ${job.id} executed, submitting deliverable...`);
        await job.deliver(deliverable);
        
        console.log(`[Seller] Deliverable submitted for job ${job.id}`);
      } catch (error) {
        console.error(`[Seller] Error executing job ${job.id}:`, error);
        await job.reject(`Job execution failed: ${error instanceof Error ? error.message : String(error)}`);
      }
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

export { seller, executeGraduationJob, generateDeliverable };


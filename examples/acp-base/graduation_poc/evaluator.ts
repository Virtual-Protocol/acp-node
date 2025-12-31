/**
 * Evaluator Agent - Orchestrates the entire graduation evaluation flow
 * 
 * This is the single source of truth for pass/fail decisions.
 * 
 * Flow:
 * 1. Receive graduation request from Agent Team (Buyer)
 * 2. Discover agent using ACP SDK (browse/search by agentName and wallet address)
 * 3. If agent found: Initiate job with the pending graduation agent
 * 4. Fetch requirement schema from the agent
 * 5. Generate evaluation prompt using LLM
 * 6. Wait for deliverable submission
 * 7. Validate deliverable schema
 * 8. Evaluate deliverable using LLM
 * 9. Return evaluation result (score, reasoning, pass/fail)
 */

import AcpClient, {
  AcpContractClientV2,
  AcpJobPhases,
  AcpJob,
  AcpMemo,
  AcpAgentSort,
  AcpGraduationStatus,
  AcpOnlineStatus,
  baseAcpX402ConfigV2,
  DeliverablePayload,
} from "@virtuals-protocol/acp-node";
import { Address } from "viem";
import {
  EVALUATOR_AGENT_WALLET_ADDRESS,
  WHITELISTED_WALLET_PRIVATE_KEY,
  EVALUATOR_ENTITY_ID,
} from "./env";
import {
  GraduationEvaluationLLMService,
  EvaluationResult,
} from "./evaluatorLogic/llm";
import { FareAmount } from "@virtuals-protocol/acp-node";

// Helper function to parse JSON
function tryParseJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    return null;
  }
}

interface GraduationRequestPayload {
  type: "graduation_evaluation_request";
  agentName: string;
  agentWalletAddress: string;
  timestamp: string;
}

interface EvaluationEvidence {
  jobId: number;
  finalScore: number;
  reasoning: string;
  pass: boolean;
  deliverable: DeliverablePayload;
  timestamp: string;
  requirementSchema?: Object | string;
  deliverableSchema?: Object | string;
  offeringName?: string;
}

// Type for agent with offerings - jobOfferings are AcpJobOffering instances from browseAgents
type AcpJobOfferingType = {
  name: string;
  requirement?: Object | string;
  initiateJob: (serviceRequirement: Object | string, evaluatorAddress?: Address, expiredAt?: Date) => Promise<number>;
};

interface AgentWithOfferings {
  name: string;
  walletAddress: Address;
  jobOfferings: AcpJobOfferingType[];
  description?: string;
}

class GraduationEvaluator {
  private acpClient!: AcpClient;
  private llmService: GraduationEvaluationLLMService;
  private evaluationEvidence: Map<number, EvaluationEvidence> = new Map();

  constructor() {
    this.llmService = new GraduationEvaluationLLMService();
  }

  async initialize() {
    // Initialize LLM service
    try {
      await this.llmService.initialize();
    } catch (error) {
      console.warn("[Evaluator] LLM service initialization failed, will use fallback evaluation:", error);
    }

    // Initialize ACP Client
    this.acpClient = new AcpClient({
      acpContractClient: await AcpContractClientV2.build(
        WHITELISTED_WALLET_PRIVATE_KEY,
        EVALUATOR_ENTITY_ID,
        EVALUATOR_AGENT_WALLET_ADDRESS,
        baseAcpX402ConfigV2,
      ),
      onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
        await this.handleNewTask(job, memoToSign);
      },
      onEvaluate: async (job: AcpJob) => {
        await this.handleEvaluation(job);
      },
    });

    console.log("[Evaluator] Initialized and listening for graduation requests...");
  }

  /**
   * Handle new tasks - this is where we receive graduation requests
   */
  private async handleNewTask(job: AcpJob, memoToSign?: AcpMemo) {
    console.log(`[Evaluator] Received new task: Job ${job.id}, Phase: ${job.phase}`);

    // Handle graduation request
    if (job.phase === AcpJobPhases.REQUEST || job.phase === AcpJobPhases.NEGOTIATION) {
      const requestMemo = job.memos.find(
        (m) => m.nextPhase === AcpJobPhases.NEGOTIATION
      );

      if (requestMemo) {
        const requestPayload = tryParseJson<GraduationRequestPayload>(requestMemo.content);
        
        if (requestPayload?.type === "graduation_evaluation_request") {
          console.log(`[Evaluator] Processing graduation request for agent: ${requestPayload.agentName}`);
          
          // Accept the request
          await job.accept("Graduation evaluation request accepted");
          
          // Start the evaluation flow
          await this.processGraduationRequest(job, requestPayload);
          return;
        }
      }
    }

    // Handle payment memo
    if (
      job.phase === AcpJobPhases.TRANSACTION &&
      memoToSign?.nextPhase === AcpJobPhases.EVALUATION
    ) {
      console.log(`[Evaluator] Payment received for job ${job.id}, proceeding to evaluation`);
      await memoToSign.sign(true, "Payment accepted, proceeding with evaluation");
    }
  }

  /**
   * Main evaluation flow
   */
  private async processGraduationRequest(
    job: AcpJob,
    request: GraduationRequestPayload
  ): Promise<void> {
    try {
      console.log(`[Evaluator] Starting graduation evaluation for agent: ${request.agentName}`);

      // Step 1: Agent Discovery
      const agent = await this.discoverAgent(request.agentName, request.agentWalletAddress);
      
      if (!agent) {
        const errorMessage = `Agent not found: ${request.agentName} (${request.agentWalletAddress}). Please verify agent name and wallet address.`;
        console.error(`[Evaluator] ${errorMessage}`);
        await job.reject(errorMessage);
        return;
      }

      console.log(`[Evaluator] Agent found: ${agent.name} (${agent.walletAddress})`);

      // Step 2: Request deliverable schema from agent's job offerings
      const schemaRequestResult = await this.requestDeliverableSchema(agent);
      
      if (!schemaRequestResult.success || !schemaRequestResult.selectedOffering) {
        const errorMessage = schemaRequestResult.error || "Failed to get deliverable schema from agent";
        console.error(`[Evaluator] ${errorMessage}`);
        await job.reject(errorMessage);
        return;
      }

      const { selectedOffering, requirementSchema: agentRequirementSchema, deliverableSchema } = schemaRequestResult;
      
      if (!agentRequirementSchema) {
        const errorMessage = "Requirement schema is missing from agent offering";
        console.error(`[Evaluator] ${errorMessage}`);
        await job.reject(errorMessage);
        return;
      }

      console.log(`[Evaluator] Agent's original requirement schema:`, agentRequirementSchema);
      console.log(`[Evaluator] Deliverable schema from agent:`, deliverableSchema);
      console.log(`[Evaluator] Selected offering: ${selectedOffering.name}`);

      // Step 3: Use LLM to suggest a requirement schema for the graduation evaluation job
      // This requirement schema will be used to initiate the job, not the agent's original schema
      // The LLM analyzes the agent's offerings and suggests an appropriate test requirement
      const allOfferings = agent.jobOfferings.map(offering => ({
        name: offering.name,
        requirement: offering.requirement,
        deliverable: deliverableSchema, // Use the deliverable schema we extracted
      }));

      console.log(`[Evaluator] Requesting LLM to suggest requirement schema based on agent's ${allOfferings.length} offering(s)...`);
      const suggestedRequirementSchema = await this.llmService.suggestRequirementSchema({
        agentOfferings: allOfferings,
        agentName: agent.name,
        agentDescription: agent.description,
        evaluationPurpose: "Graduation evaluation to assess agent capabilities and readiness",
      });

      console.log(`[Evaluator] LLM suggested requirement schema:`, suggestedRequirementSchema);
      
      // Note: The suggested schema will be validated against the offering's requirement schema
      // when we call initiateJob(). If validation fails, we'll need to handle that error.

      const evaluationRubric = this.getDefaultEvaluationRubric();

      // Step 4: Generate evaluation prompt using LLM (using the suggested requirement schema)
      const evaluationPrompt = await this.llmService.generateEvaluationPrompt({
        requirementSchema: suggestedRequirementSchema,
        evaluationRubric,
        jobDescription: `Graduation evaluation for agent: ${agent.name} using offering: ${selectedOffering.name}`,
      });

      console.log(`[Evaluator] Evaluation prompt generated`);

      // Step 5: Initiate job using the agent's actual job offering
      // Use the LLM-suggested requirement schema (not the agent's original schema)
      // The initiateJob() method will validate the requirement against the offering's schema
      const graduationJobRequirement = {
        type: "graduation_evaluation_job",
        requirementSchema: suggestedRequirementSchema, // Use LLM-suggested schema
        originalRequirementSchema: agentRequirementSchema, // Keep original for reference
        deliverableSchema: deliverableSchema || suggestedRequirementSchema,
        evaluationPrompt,
        evaluationRubric,
        jobDescription: `Graduation evaluation for ${agent.name}`,
        offeringName: selectedOffering.name,
      };

      try {
        const jobId = await selectedOffering.initiateJob(
          graduationJobRequirement, // This will be validated against the offering's requirement schema
          this.acpClient.walletAddress, // Evaluator evaluates
          new Date(Date.now() + 1000 * 60 * 30) // 30 minutes
        );

        console.log(`[Evaluator] Initiated evaluation job ${jobId} with pending graduation agent using offering: ${selectedOffering.name}`);
        
        // Step 6: Create requirement memo for the buyer
        await job.createRequirement(
          `Graduation evaluation initiated. Evaluation job ID: ${jobId}. Waiting for deliverable from agent: ${agent.name}`
        );
      } catch (error) {
        // Handle validation errors if the LLM-suggested schema doesn't match the offering's schema
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[Evaluator] Failed to initiate job with suggested schema: ${errorMessage}`);
        
        // Fallback: Try with the agent's original requirement schema if validation fails
        console.log(`[Evaluator] Attempting fallback with agent's original requirement schema...`);
        try {
          const fallbackRequirement = {
            ...graduationJobRequirement,
            requirementSchema: agentRequirementSchema, // Use original schema as fallback
          };
          
          const jobId = await selectedOffering.initiateJob(
            fallbackRequirement,
            this.acpClient.walletAddress,
            new Date(Date.now() + 1000 * 60 * 30)
          );
          
          console.log(`[Evaluator] Initiated evaluation job ${jobId} using fallback schema`);
          await job.createRequirement(
            `Graduation evaluation initiated (using fallback schema). Evaluation job ID: ${jobId}. Waiting for deliverable from agent: ${agent.name}`
          );
        } catch (fallbackError) {
          const fallbackErrorMessage = `Failed to initiate job: ${errorMessage}. Fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`;
          console.error(`[Evaluator] ${fallbackErrorMessage}`);
          await job.reject(fallbackErrorMessage);
        }
      }


      // Store the mapping between buyer job and evaluation job
      // We'll handle the evaluation when the deliverable is submitted
      // Note: In a real implementation, you might want to track this mapping more explicitly

    } catch (error) {
      console.error(`[Evaluator] Error processing graduation request:`, error);
      await job.reject(`Evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Discover agent using ACP SDK
   * Returns null if agent is not found
   * Returns agent with AcpJobOffering instances (not raw job data)
   */
  private async discoverAgent(
    agentName: string,
    agentWalletAddress: string
  ): Promise<AgentWithOfferings | null> {
    try {
      // First, try browsing by name to get full agent data with offerings
      const agents = await this.acpClient.browseAgents(agentName, {
        sort_by: [AcpAgentSort.SUCCESSFUL_JOB_COUNT],
        top_k: 10,
        graduationStatus: AcpGraduationStatus.ALL,
        onlineStatus: AcpOnlineStatus.ALL,
      });

      // Find exact match by name and wallet address
      const exactMatch = agents.find(
        (agent) =>
          agent.name.toLowerCase() === agentName.toLowerCase() &&
          agent.walletAddress.toLowerCase() === agentWalletAddress.toLowerCase()
      );

      if (exactMatch) {
        return {
          name: exactMatch.name,
          walletAddress: exactMatch.walletAddress,
          jobOfferings: exactMatch.jobOfferings || [],
          description: exactMatch.description,
        };
      }

      // If not found by name search, try getting agent by wallet address directly
      const agentByAddress = await this.acpClient.getAgent(agentWalletAddress as Address);
      
      if (agentByAddress) {
        // Verify the name matches (case-insensitive) or use the found name
        if (agentByAddress.name.toLowerCase() === agentName.toLowerCase() || 
            agentName.toLowerCase() === agentByAddress.name.toLowerCase()) {
          // Get full agent data with offerings by browsing
          const agentsByAddress = await this.acpClient.browseAgents(agentByAddress.name, {
            sort_by: [AcpAgentSort.SUCCESSFUL_JOB_COUNT],
            top_k: 5,
            graduationStatus: AcpGraduationStatus.ALL,
            onlineStatus: AcpOnlineStatus.ALL,
          });

          const match = agentsByAddress.find(
            (a) => a.walletAddress.toLowerCase() === agentWalletAddress.toLowerCase()
          );

          if (match) {
            return {
              name: match.name,
              walletAddress: match.walletAddress,
              jobOfferings: match.jobOfferings || [],
              description: match.description,
            };
          }
        }
      }

      // If still not found, try matching by wallet address only from browse results
      const addressMatch = agents.find(
        (agent) => agent.walletAddress.toLowerCase() === agentWalletAddress.toLowerCase()
      );

      if (addressMatch) {
        console.warn(`[Evaluator] Agent name mismatch. Requested: ${agentName}, Found: ${addressMatch.name}`);
        return {
          name: addressMatch.name,
          walletAddress: addressMatch.walletAddress,
          jobOfferings: addressMatch.jobOfferings || [],
          description: addressMatch.description,
        };
      }

      return null;
    } catch (error) {
      console.error(`[Evaluator] Error discovering agent:`, error);
      return null;
    }
  }

  /**
   * Request deliverable schema from the pending graduation agent
   * Handles cases where agents have 0, 1, or many offerings
   */
  private async requestDeliverableSchema(
    agent: AgentWithOfferings
  ): Promise<{
    success: boolean;
    selectedOffering?: AcpJobOfferingType;
    requirementSchema?: Object | string;
    deliverableSchema?: Object | string;
    error?: string;
  }> {
    try {
      const offerings = agent.jobOfferings || [];

      // Handle case: No offerings
      if (offerings.length === 0) {
        return {
          success: false,
          error: `Agent ${agent.name} has no job offerings. Cannot perform graduation evaluation without offerings.`,
        };
      }

      // Handle case: One or more offerings
      // Select the first offering (or could implement selection logic)
      // For graduation, we typically want to evaluate the agent's primary/main offering
      const selectedOffering = offerings[0];

      console.log(`[Evaluator] Agent has ${offerings.length} offering(s). Selected: ${selectedOffering.name}`);

      // Extract requirement schema from the offering
      const requirementSchema = selectedOffering.requirement || {};

      // For deliverable schema, we need to check if it's available in the agent metadata
      // The deliverable schema might be in the agent's job metadata or we can infer it
      // For now, we'll try to get it from the agent's raw data if available
      // Note: The deliverable schema should match the requirement structure
      // In a real implementation, this might be stored separately in the agent's job definition
      const deliverableSchema: Object | string = requirementSchema; // Default: same as requirement

      // If we have access to the raw agent data with deliverable info, use it
      // This would require accessing the agent's job definitions directly
      // For now, we'll document that the deliverable should match the requirement schema

      return {
        success: true,
        selectedOffering,
        requirementSchema,
        deliverableSchema,
      };
    } catch (error) {
      console.error(`[Evaluator] Error requesting deliverable schema:`, error);
      return {
        success: false,
        error: `Failed to request deliverable schema: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }


  /**
   * Get default evaluation rubric
   */
  private getDefaultEvaluationRubric(): string {
    return `
Evaluation Criteria:
1. Completeness (30 points): Does the deliverable meet all required fields in the schema?
2. Correctness (30 points): Is the deliverable accurate and correct?
3. Quality (20 points): Is the deliverable well-structured and professional?
4. Functionality (20 points): Does the deliverable demonstrate the agent's capabilities?

Passing Score: 70/100
`;
  }

  /**
   * Handle evaluation when deliverable is submitted
   */
  private async handleEvaluation(job: AcpJob): Promise<void> {
    try {
      console.log(`[Evaluator] Evaluating job ${job.id}`);

      // Get the deliverable
      const deliverable = job.deliverable;
      
      if (!deliverable) {
        const errorMessage = "Deliverable is missing or empty";
        console.error(`[Evaluator] ${errorMessage}`);
        await job.evaluate(false, errorMessage);
        return;
      }

      // Parse deliverable
      const deliverablePayload = typeof deliverable === 'string' 
        ? tryParseJson(deliverable) || deliverable
        : deliverable;

      // Step 1: Validate deliverable schema
      const validationResult = await this.validateDeliverable(deliverablePayload, job);
      
      if (!validationResult.isValid) {
        const errorMessage = `Deliverable validation failed: ${validationResult.error}`;
        console.error(`[Evaluator] ${errorMessage}`);
        await job.evaluate(false, errorMessage);
        return;
      }

      console.log(`[Evaluator] Deliverable validation passed`);

      // Step 2: Get requirement schema (from job context or memo)
      const requirementSchema = this.extractRequirementSchemaFromJob(job);
      const evaluationRubric = this.getDefaultEvaluationRubric();

      // Step 3: Evaluate using LLM
      const evaluationResult = await this.llmService.evaluateDeliverable({
        deliverable: deliverablePayload,
        requirementSchema,
        evaluationRubric,
        jobDescription: job.requirement ? String(job.requirement) : undefined,
      });

      console.log(`[Evaluator] Evaluation complete. Score: ${evaluationResult.score}/100, Pass: ${evaluationResult.pass}`);

      // Step 4: Store evaluation evidence
      // Try to get requirement and deliverable schemas from job context
      const jobContext = tryParseJson<{
        requirementSchema?: Object | string;
        deliverableSchema?: Object | string;
        offeringName?: string;
      }>(typeof job.requirement === 'string' ? job.requirement : JSON.stringify(job.requirement || {}));

      const evidence: EvaluationEvidence = {
        jobId: job.id,
        finalScore: evaluationResult.score,
        reasoning: evaluationResult.reasoning,
        pass: evaluationResult.pass,
        deliverable: deliverablePayload as DeliverablePayload,
        timestamp: new Date().toISOString(),
        requirementSchema: jobContext?.requirementSchema || requirementSchema,
        deliverableSchema: jobContext?.deliverableSchema,
        offeringName: jobContext?.offeringName,
      };
      this.evaluationEvidence.set(job.id, evidence);

      // Step 5: Return evaluation result
      const evaluationMessage = `Score: ${evaluationResult.score}/100. ${evaluationResult.reasoning}. ${evaluationResult.feedback}`;
      
      await job.evaluate(evaluationResult.pass, evaluationMessage);

      console.log(`[Evaluator] Job ${job.id} evaluated: ${evaluationResult.pass ? 'PASSED' : 'FAILED'}`);
      console.log(`[Evaluator] Evaluation evidence stored for job ${job.id}`);

    } catch (error) {
      console.error(`[Evaluator] Error evaluating job ${job.id}:`, error);
      await job.evaluate(false, `Evaluation error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate deliverable against schema
   */
  private async validateDeliverable(
    deliverable: any,
    job: AcpJob
  ): Promise<{ isValid: boolean; error?: string }> {
    // Check if deliverable is empty
    if (!deliverable || (typeof deliverable === 'string' && deliverable.trim().length === 0)) {
      return { isValid: false, error: "Deliverable is empty" };
    }

    // Basic validation: check if deliverable is an object or non-empty string
    if (typeof deliverable === 'object' && Object.keys(deliverable).length === 0) {
      return { isValid: false, error: "Deliverable object is empty" };
    }

    // Additional schema validation can be added here
    // For now, we do basic validation and let LLM do detailed evaluation

    return { isValid: true };
  }

  /**
   * Extract requirement schema from job
   */
  private extractRequirementSchemaFromJob(job: AcpJob): Object | string {
    // Try to get schema from job context or memos
    if (job.context && job.context.requirementSchema) {
      return job.context.requirementSchema;
    }

    // Try to parse from requirement
    if (job.requirement) {
      const requirement = typeof job.requirement === 'string' 
        ? tryParseJson(job.requirement)
        : job.requirement;
      
      if (requirement && typeof requirement === 'object' && 'requirementSchema' in requirement) {
        return (requirement as any).requirementSchema;
      }
    }

    // Default: return empty schema
    return {};
  }

  /**
   * Get evaluation evidence for a job
   */
  getEvaluationEvidence(jobId: number): EvaluationEvidence | undefined {
    return this.evaluationEvidence.get(jobId);
  }
}

/**
 * Main function to start the evaluator
 */
async function evaluator() {
  try {
    const graduationEvaluator = new GraduationEvaluator();
    await graduationEvaluator.initialize();
    
    console.log("[Evaluator] Graduation evaluator is running and ready to process requests");
    console.log("[Evaluator] Waiting for graduation evaluation requests...");
    
    // Keep the process alive
  } catch (error) {
    console.error("[Evaluator] Failed to initialize evaluator:", error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  evaluator();
}

export { evaluator, GraduationEvaluator };


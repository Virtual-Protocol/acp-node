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
  baseAcpConfigV2,
  DeliverablePayload,
  AcpError,
} from "@virtuals-protocol/acp-node";
import { Address } from "viem";
import {
  EVALUATOR_AGENT_WALLET_ADDRESS,
  WHITELISTED_WALLET_PRIVATE_KEY,
  EVALUATOR_ENTITY_ID,
} from "./env";
import {
  GraduationEvaluationLLMService,
} from "./evaluatorLogic/llm";

// Helper function to parse JSON
function tryParseJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    return null;
  }
}

interface GraduationRequestPayload {
  agentName: string;
  agentWalletAddress: string;
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
  // Track mapping: buyer job ID -> array of seller evaluation job IDs (one per offering)
  private buyerJobToSellerJob: Map<number, number[]> = new Map();
  // Track mapping: seller evaluation job ID -> buyer job ID
  private sellerJobToBuyerJob: Map<number, number> = new Map();
  // Track jobs that are currently being paid to prevent duplicate payment attempts
  private jobsBeingPaid: Set<number> = new Set();
  // Maximum number of evidence entries to keep in memory (safety limit)
  private readonly MAX_EVIDENCE_ENTRIES = 15;

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
    // Use baseAcpConfigV2 for direct transfer (better for free/graduation evaluation jobs)
    const useX402 = process.env.USE_X402_PAYMENT === "true";
    
    this.acpClient = new AcpClient({
      acpContractClient: await AcpContractClientV2.build(
        WHITELISTED_WALLET_PRIVATE_KEY,
        EVALUATOR_ENTITY_ID,
        EVALUATOR_AGENT_WALLET_ADDRESS,
        useX402 ? baseAcpX402ConfigV2 : baseAcpConfigV2,
      ),
      onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
        await this.handleNewTask(job, memoToSign);
      },
      onEvaluate: async (job: AcpJob) => {
        await this.handleEvaluation(job);
      },
    });

    console.log("[Evaluator] Initialized and listening for graduation requests...");
    
    // Poll for jobs that need payment every 10 seconds
    // This ensures we catch payment requirements even if onNewTask wasn't called
    setInterval(() => {
      this.pollForJobsToPay();
    }, 10000);
    
    // Poll for jobs that need evaluation every 10 seconds
    // This ensures we catch evaluation requirements even if onEvaluate wasn't called
    setInterval(() => {
      this.pollForJobsToEvaluate();
    }, 10000);
    
    // Clean up completed jobs every 5 minutes to prevent memory leaks
    setInterval(() => {
      this.cleanupCompletedJobs();
    }, 5 * 60 * 1000);
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
        const requestPayload = job.requirement as GraduationRequestPayload;
        if (!requestPayload) {
          console.error(`[Evaluator] Invalid graduation request payload for job ${job.id}`);
          job.reject("Invalid graduation request payload");
          return;
        }

        console.log(`[Evaluator] Processing graduation request for agent: ${requestPayload.agentName}`);
          
        // Accept the request
        await job.accept("Graduation evaluation request accepted");
        
        // Start the evaluation flow
        await this.processGraduationRequest(job, requestPayload);
        return;
      }
    }

    // Handle payment memo from buyer (for graduation request job)
    // When buyer pays, job moves to TRANSACTION phase
    // As the provider, we should deliver the evaluation report (if ready) or wait for seller's job to complete
    if (
      job.phase === AcpJobPhases.TRANSACTION
    ) {
      // Check if this is the buyer's graduation request job
      const requestMemo = job.memos.find(
        (m) => m.nextPhase === AcpJobPhases.NEGOTIATION
      );
      
      if (requestMemo) {
        const requestPayload = job.requirement as GraduationRequestPayload;

        if (!requestPayload) {
          console.error(`[Evaluator] Invalid graduation request payload for job ${job.id}`);
          job.reject("Invalid graduation request payload");
          return;
        }

        // This is the buyer's graduation request - payment received
        console.log(`[Evaluator] Payment received for graduation request job ${job.id}`);
                  
        // Check if we have evaluation reports ready (from all seller's jobs)
        const sellerJobIds = this.buyerJobToSellerJob.get(job.id);
        if (sellerJobIds && sellerJobIds.length > 0) {
          // Check if all seller jobs have been evaluated
          const allEvaluated = sellerJobIds.every(sellerJobId => 
            this.evaluationEvidence.has(sellerJobId)
          );
          
          if (allEvaluated) {
            // All evaluations complete, deliver combined report
            console.log(`[Evaluator] All evaluation reports ready, delivering to buyer job ${job.id}`);
            await this.deliverEvaluationReportToBuyer(job.id);
            return;
          } else {
            const completedCount = sellerJobIds.filter(id => this.evaluationEvidence.has(id)).length;
            console.log(`[Evaluator] Waiting for seller jobs to complete (${completedCount}/${sellerJobIds.length} completed) before delivering evaluation report`);
            // Don't sign the memo yet - we'll deliver when all seller's jobs complete
            return;
          }
        } else {
          console.log(`[Evaluator] Seller jobs not yet initiated, waiting...`);
          // Don't sign the memo yet - we'll deliver when seller's jobs complete
          return;
        }
      }
      
      // If there's a memo to sign for EVALUATION phase, it might be for the seller's job
      if (memoToSign?.nextPhase === AcpJobPhases.EVALUATION) {
        // This might be an evaluation job with the seller
        console.log(`[Evaluator] Payment received for job ${job.id}, proceeding to evaluation`);
        await memoToSign.sign(true, "Payment accepted, proceeding with evaluation");
      }
    }

    // Handle payment requirement from seller (for evaluation job with seller)
    // Flow: Evaluator requests job → Seller accepts and creates payment requirement → Evaluator pays
    // When seller creates a requirement memo, job is in NEGOTIATION phase with memoToSign.nextPhase === TRANSACTION
    if (
      job.phase === AcpJobPhases.NEGOTIATION &&
      memoToSign?.nextPhase === AcpJobPhases.TRANSACTION
    ) {
      // Check if this is a job where evaluator is the client (buyer) - meaning it's the evaluation job with seller
      // The evaluator initiated this job with the seller, so evaluator is the client
      if (job.clientAddress === this.acpClient.walletAddress) {
        // Check if we're already processing payment for this job
        if (this.jobsBeingPaid.has(job.id)) {
          console.log(`[Evaluator] Payment for job ${job.id} already in progress, skipping...`);
          return;
        }

        // This is the evaluation job with seller - seller is requesting payment
        console.log(`[Evaluator] Seller requesting payment for evaluation job ${job.id}`);
        console.log(`[Evaluator] Paying for evaluation job ${job.id}`);
        
        this.jobsBeingPaid.add(job.id);
        try {
          await job.payAndAcceptRequirement();
          console.log(`[Evaluator] Evaluation job ${job.id} paid, waiting for deliverable`);
        } catch (error) {
          console.error(`[Evaluator] Failed to pay for evaluation job ${job.id}:`, error);
          // Remove from set on error so it can be retried
          this.jobsBeingPaid.delete(job.id);
          // Don't throw - let polling handle retry
        } finally {
          // Remove from set after a delay to allow transaction to complete
          setTimeout(() => {
            this.jobsBeingPaid.delete(job.id);
          }, 5000);
        }
        return;
      }
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

      // Step 1.5: Validate that the supplied agent name matches the wallet address
      const validationResult = this.validateAgentNameAndWallet(
        request.agentName,
        request.agentWalletAddress,
        agent.name,
        agent.walletAddress
      );

      if (!validationResult.isValid) {
        const errorMessage = `Agent validation failed: ${validationResult.reason}. Requested agent "${request.agentName}" (${request.agentWalletAddress}) does not match discovered agent "${agent.name}" (${agent.walletAddress}).`;
        console.error(`[Evaluator] ${errorMessage}`);
        await job.reject(errorMessage);
        return;
      }

      console.log(`[Evaluator] Agent validation passed (similarity: ${(validationResult.similarity * 100).toFixed(1)}%)`);

      // Step 2: Get all job offerings from agent
      const offerings = agent.jobOfferings || [];
      
      if (offerings.length === 0) {
        const errorMessage = `Agent ${agent.name} has no job offerings. Cannot perform graduation evaluation without offerings.`;
        console.error(`[Evaluator] ${errorMessage}`);
        await job.reject(errorMessage);
        return;
      }

      console.log(`[Evaluator] Agent has ${offerings.length} offering(s). Will evaluate all offerings.`);

      // Step 3: Use LLM to suggest a requirement schema for the graduation evaluation job
      // This requirement schema will be used to initiate the job, not the agent's original schema
      // The LLM analyzes the agent's offerings and suggests an appropriate test requirement
      const allOfferings = offerings.map(offering => ({
        name: offering.name,
        requirement: offering.requirement,
        deliverable: offering.requirement, // Default: same as requirement
      }));

      console.log(`[Evaluator] Requesting LLM to suggest requirement schema based on agent's ${allOfferings.length} offering(s)...`);
      const suggestedRequirementSchema = await this.llmService.suggestRequirementSchema({
        agentOfferings: allOfferings,
        agentName: agent.name,
        agentDescription: agent.description,
        evaluationPurpose: "Graduation evaluation to assess agent capabilities and readiness",
      });

      console.log(`[Evaluator] LLM suggested requirement schema:`, suggestedRequirementSchema);
      
      const evaluationRubric = this.getDefaultEvaluationRubric();

      // Step 4: Loop through all offerings and initiate evaluation jobs
      const sellerJobIds: number[] = [];
      const offeringNames: string[] = [];
      let successCount = 0;
      let failureCount = 0;

      for (const offering of offerings) {
        try {
          const agentRequirementSchema = offering.requirement || {};
          const deliverableSchema: Object | string = agentRequirementSchema; // Default: same as requirement

          // Generate evaluation prompt for this specific offering
          const evaluationPrompt = await this.llmService.generateEvaluationPrompt({
            requirementSchema: suggestedRequirementSchema,
            evaluationRubric,
            jobDescription: `Graduation evaluation for agent: ${agent.name} using offering: ${offering.name}`,
          });

          // Create graduation job requirement
          const graduationJobRequirement = {
            type: "graduation_evaluation_job",
            requirementSchema: suggestedRequirementSchema, // Use LLM-suggested schema
            originalRequirementSchema: agentRequirementSchema, // Keep original for reference
            deliverableSchema: deliverableSchema || suggestedRequirementSchema,
            evaluationPrompt,
            evaluationRubric,
            jobDescription: `Graduation evaluation for ${agent.name}`,
            offeringName: offering.name,
          };

          try {
            const sellerJobId = await offering.initiateJob(
              graduationJobRequirement,
              this.acpClient.walletAddress, // Evaluator evaluates
              new Date(Date.now() + 1000 * 60 * 30) // 30 minutes
            );

            console.log(`[Evaluator] Initiated evaluation job ${sellerJobId} for offering: ${offering.name}`);
            sellerJobIds.push(sellerJobId);
            offeringNames.push(offering.name);
            this.sellerJobToBuyerJob.set(sellerJobId, job.id);
            successCount++;
          } catch (error) {
            // Fallback: Try with the agent's original requirement schema
            console.log(`[Evaluator] Attempting fallback with agent's original requirement schema for offering: ${offering.name}...`);
            try {
              const fallbackRequirement = {
                ...graduationJobRequirement,
                requirementSchema: agentRequirementSchema, // Use original schema as fallback
              };
              
              const sellerJobId = await offering.initiateJob(
                fallbackRequirement,
                this.acpClient.walletAddress,
                new Date(Date.now() + 1000 * 60 * 30)
              );
              
              console.log(`[Evaluator] Initiated evaluation job ${sellerJobId} using fallback schema for offering: ${offering.name}`);
              sellerJobIds.push(sellerJobId);
              offeringNames.push(offering.name);
              this.sellerJobToBuyerJob.set(sellerJobId, job.id);
              successCount++;
            } catch (fallbackError) {
              const errorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
              console.error(`[Evaluator] Failed to initiate job for offering ${offering.name}: ${errorMessage}`);
              failureCount++;
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[Evaluator] Error processing offering ${offering.name}: ${errorMessage}`);
          failureCount++;
        }
      }

      // Check if we successfully initiated at least one job
      if (sellerJobIds.length === 0) {
        const errorMessage = `Failed to initiate evaluation jobs for any offering. ${failureCount} offering(s) failed.`;
        console.error(`[Evaluator] ${errorMessage}`);
        await job.reject(errorMessage);
        return;
      }

      // Store mapping between buyer job and all seller evaluation jobs
      this.buyerJobToSellerJob.set(job.id, sellerJobIds);
      console.log(`[Evaluator] Mapped buyer job ${job.id} to ${sellerJobIds.length} seller evaluation job(s): ${sellerJobIds.join(', ')}`);
      console.log(`[Evaluator] Successfully initiated ${successCount} job(s), ${failureCount} failed`);
      
      // Step 5: Create requirement memo for the buyer
      await job.createRequirement(
        `Graduation evaluation initiated for ${sellerJobIds.length} offering(s): ${offeringNames.join(', ')}. Evaluation job IDs: ${sellerJobIds.join(', ')}. Waiting for deliverables from agent: ${agent.name}`
      );


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
   * Validate that the supplied agent name matches the discovered agent's wallet address
   * Uses fuzzy string matching for names and exact matching for wallet addresses
   * Returns validation result with similarity score
   */
  private validateAgentNameAndWallet(
    requestedName: string,
    requestedWallet: string,
    discoveredName: string,
    discoveredWallet: string
  ): {
    isValid: boolean;
    similarity: number;
    reason?: string;
  } {
    // Step 1: Wallet address must match exactly (case-insensitive)
    if (requestedWallet.toLowerCase() !== discoveredWallet.toLowerCase()) {
      return {
        isValid: false,
        similarity: 0,
        reason: `Wallet address mismatch. Requested: ${requestedWallet}, Found: ${discoveredWallet}`,
      };
    }

    // Step 2: Calculate name similarity using fuzzy matching
    const nameSimilarity = this.calculateStringSimilarity(
      requestedName.toLowerCase().trim(),
      discoveredName.toLowerCase().trim()
    );

    // Step 3: Check if similarity meets threshold (80% similarity required)
    const SIMILARITY_THRESHOLD = 0.8;
    if (nameSimilarity < SIMILARITY_THRESHOLD) {
      return {
        isValid: false,
        similarity: nameSimilarity,
        reason: `Agent name similarity too low (${(nameSimilarity * 100).toFixed(1)}% < ${(SIMILARITY_THRESHOLD * 100).toFixed(0)}%). Requested: "${requestedName}", Found: "${discoveredName}"`,
      };
    }

    return {
      isValid: true,
      similarity: nameSimilarity,
    };
  }

  /**
   * Calculate string similarity using Levenshtein distance (edit distance)
   * Returns a similarity score between 0 and 1 (1 = identical, 0 = completely different)
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    // If strings are identical, return 1.0
    if (str1 === str2) {
      return 1.0;
    }

    // If either string is empty, return 0
    if (str1.length === 0 || str2.length === 0) {
      return 0;
    }

    // Calculate Levenshtein distance
    const distance = this.levenshteinDistance(str1, str2);
    
    // Calculate similarity as: 1 - (distance / max_length)
    const maxLength = Math.max(str1.length, str2.length);
    const similarity = 1 - (distance / maxLength);
    
    return Math.max(0, similarity); // Ensure non-negative
  }

  /**
   * Calculate Levenshtein distance (edit distance) between two strings
   * This is the minimum number of single-character edits needed to transform one string into another
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    
    // Create a matrix to store distances
    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    // Initialize base cases
    for (let i = 0; i <= m; i++) {
      dp[i][0] = i;
    }
    for (let j = 0; j <= n; j++) {
      dp[0][j] = j;
    }

    // Fill the matrix
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          // Characters match, no cost
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          // Characters don't match, take minimum of:
          // 1. Deletion (remove from str1)
          // 2. Insertion (add to str1)
          // 3. Substitution (replace in str1)
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,     // deletion
            dp[i][j - 1] + 1,     // insertion
            dp[i - 1][j - 1] + 1  // substitution
          );
        }
      }
    }

    return dp[m][n];
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
      console.log(`[Evaluator] Seller's deliverable (meme sample) used for evaluation:`, JSON.stringify(deliverablePayload, null, 2));

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
        deliverable: deliverablePayload as DeliverablePayload, // This is the seller's meme sample
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

      // Step 6: Check if all seller jobs for this buyer job are complete, then deliver combined report
      const buyerJobId = this.sellerJobToBuyerJob.get(job.id);
      if (buyerJobId) {
        const sellerJobIds = this.buyerJobToSellerJob.get(buyerJobId);
        if (sellerJobIds) {
          // Check if all seller jobs have been evaluated
          const allEvaluated = sellerJobIds.every(sellerJobId => 
            this.evaluationEvidence.has(sellerJobId)
          );
          
          if (allEvaluated) {
            console.log(`[Evaluator] All ${sellerJobIds.length} seller jobs evaluated. Delivering combined evaluation report to buyer job ${buyerJobId}`);
            await this.deliverEvaluationReportToBuyer(buyerJobId);
          } else {
            const completedCount = sellerJobIds.filter(id => this.evaluationEvidence.has(id)).length;
            console.log(`[Evaluator] Seller job ${job.id} evaluated (${completedCount}/${sellerJobIds.length} complete). Waiting for remaining jobs before delivering report.`);
          }
        } else {
          console.warn(`[Evaluator] Could not find seller job IDs for buyer job ${buyerJobId}`);
        }
      } else {
        console.warn(`[Evaluator] Could not find buyer job for seller evaluation job ${job.id}`);
      }

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
   * Deliver evaluation report back to buyer's graduation request job
   * The evaluator is the provider for the buyer's job, so we deliver the evaluation report as the deliverable
   * Collects all evaluation evidence from all seller jobs and creates a combined report
   */
  private async deliverEvaluationReportToBuyer(
    buyerJobId: number
  ): Promise<void> {
    try {
      // Get the buyer's job
      const buyerJob = await this.acpClient.getJobById(buyerJobId);
      
      if (!(buyerJob instanceof AcpJob)) {
        console.error(`[Evaluator] Could not retrieve buyer job ${buyerJobId}`);
        return;
      }

      // Check if deliverable already submitted
      if (buyerJob.deliverable) {
        console.log(`[Evaluator] Buyer job ${buyerJobId} already has deliverable:`, buyerJob.deliverable);
        return;
      }

      // Get all seller job IDs for this buyer job
      const sellerJobIds = this.buyerJobToSellerJob.get(buyerJobId);
      if (!sellerJobIds || sellerJobIds.length === 0) {
        console.error(`[Evaluator] No seller jobs found for buyer job ${buyerJobId}`);
        return;
      }

      // Collect all evaluation evidence from all seller jobs
      const allEvidence: EvaluationEvidence[] = [];
      for (const sellerJobId of sellerJobIds) {
        const evidence = this.evaluationEvidence.get(sellerJobId);
        if (evidence) {
          allEvidence.push(evidence);
        } else {
          console.warn(`[Evaluator] Evidence not found for seller job ${sellerJobId}, skipping...`);
        }
      }

      if (allEvidence.length === 0) {
        console.error(`[Evaluator] No evaluation evidence found for buyer job ${buyerJobId}`);
        return;
      }

      // Calculate overall statistics
      const totalScore = allEvidence.reduce((sum, e) => sum + e.finalScore, 0);
      const averageScore = totalScore / allEvidence.length;
      const allPassed = allEvidence.every(e => e.pass);
      const passedCount = allEvidence.filter(e => e.pass).length;

      // Create combined evaluation report deliverable
      const evaluationReport: DeliverablePayload = {
        type: "graduation_evaluation_report",
        jobId: buyerJobId,
        finalScore: averageScore,
        pass: allPassed,
        reasoning: `Evaluated ${allEvidence.length} offering(s). ${passedCount} passed, ${allEvidence.length - passedCount} failed. Average score: ${averageScore.toFixed(2)}/100.`,
        timestamp: new Date().toISOString(),
        // Include all individual evaluations
        evaluations: allEvidence.map(e => ({
          jobId: e.jobId,
          offeringName: e.offeringName,
          finalScore: e.finalScore,
          pass: e.pass,
          reasoning: e.reasoning,
          deliverable: e.deliverable,
          requirementSchema: e.requirementSchema,
          deliverableSchema: e.deliverableSchema,
        })),
        evaluationSummary: {
          totalOfferings: allEvidence.length,
          passedOfferings: passedCount,
          failedOfferings: allEvidence.length - passedCount,
          averageScore: averageScore,
          overallPassed: allPassed,
          status: allPassed ? "PASSED" : "FAILED",
          individualEvaluations: allEvidence.map(e => ({
            offeringName: e.offeringName,
            score: e.finalScore,
            passed: e.pass,
            reasoning: e.reasoning,
          })),
        },
      };

      console.log(`[Evaluator] Delivering evaluation report to buyer job ${buyerJobId}`);
      console.log(`[Evaluator] Buyer job ${buyerJobId} current phase: ${AcpJobPhases[buyerJob.phase]}`);
      console.log(`[Evaluator] Evaluation report:`, JSON.stringify(evaluationReport, null, 2));

      // The evaluator is the provider for the buyer's graduation request job
      // We can deliver when the job is in TRANSACTION phase (after buyer paid)
      // After delivery, job will move to EVALUATION phase, then evaluator will evaluate it
      if (buyerJob.phase === AcpJobPhases.TRANSACTION) {
        await buyerJob.deliver(evaluationReport);
        console.log(`[Evaluator] Evaluation report delivered to buyer job ${buyerJobId}`);
      } else if (buyerJob.phase === AcpJobPhases.COMPLETED) {
        console.log(`[Evaluator] Buyer job ${buyerJobId} is already completed`);
      } else if (buyerJob.phase === AcpJobPhases.EVALUATION) {
        // Job is in EVALUATION phase, we can still deliver if not already delivered
        await buyerJob.deliver(evaluationReport);
        console.log(`[Evaluator] Evaluation report delivered to buyer job ${buyerJobId} (was in EVALUATION phase)`);
      } else {
        console.log(`[Evaluator] Buyer job ${buyerJobId} is in phase ${AcpJobPhases[buyerJob.phase]}, cannot deliver yet`);
        console.warn(`[Evaluator] Will retry delivering evaluation report when buyer job ${buyerJobId} reaches TRANSACTION phase`);
      }
    } catch (error) {
      console.error(`[Evaluator] Error delivering evaluation report to buyer job ${buyerJobId}:`, error);
    }
  }

  /**
   * Poll for jobs that need payment (jobs where evaluator is the client and seller is requesting payment)
   * This ensures we catch payment requirements even if onNewTask wasn't called
   */
  private async pollForJobsToPay(): Promise<void> {
    try {
      const activeJobs = await this.acpClient.getActiveJobs();
      
      if (activeJobs instanceof AcpError || activeJobs.length === 0) {
        return;
      }

      for (const job of activeJobs) {
        // Check if this is a job where evaluator is the client (buyer) and job is in NEGOTIATION phase
        // This means seller has accepted and is requesting payment
        if (
          job.phase === AcpJobPhases.NEGOTIATION &&
          job.clientAddress === this.acpClient.walletAddress
        ) {
          // Check if we're already processing payment for this job
          if (this.jobsBeingPaid.has(job.id)) {
            continue;
          }

          // Check if there's a memo requesting payment (nextPhase === TRANSACTION)
          const paymentMemo = job.memos.find(
            (m) => m.nextPhase === AcpJobPhases.TRANSACTION
          );
          
          if (paymentMemo) {
            console.log(`[Evaluator] Polling found job ${job.id} in NEGOTIATION phase with payment requirement, paying...`);
            
            this.jobsBeingPaid.add(job.id);
            try {
              await job.payAndAcceptRequirement();
              console.log(`[Evaluator] Evaluation job ${job.id} paid (via polling), waiting for deliverable`);
            } catch (error: any) {
              // Check if error is "Already signed" - this means payment was already processed
              if (error?.message?.includes("Already signed") || error?.details?.message === "Already signed") {
                console.log(`[Evaluator] Job ${job.id} already paid (via polling), skipping...`);
              } else {
                console.error(`[Evaluator] Failed to pay for evaluation job ${job.id} (via polling):`, error);
              }
            } finally {
              // Remove from set after a delay
              setTimeout(() => {
                this.jobsBeingPaid.delete(job.id);
              }, 5000);
            }
          }
        }
      }
    } catch (error: any) {
      // Handle API errors gracefully - sometimes the API returns HTML instead of JSON
      if (error?.message?.includes("Unexpected token") || error?.message?.includes("DOCTYPE")) {
        console.warn(`[Evaluator] API returned non-JSON response while polling, will retry on next poll`);
      } else {
        console.error(`[Evaluator] Error polling for jobs to pay:`, error);
      }
    }
  }

  /**
   * Poll for jobs that need evaluation (jobs where evaluator is assigned and job is in EVALUATION phase)
   * This ensures we catch evaluation requirements even if onEvaluate wasn't called
   */
  private async pollForJobsToEvaluate(): Promise<void> {
    try {
      const activeJobs = await this.acpClient.getActiveJobs();
      
      if (activeJobs instanceof AcpError || activeJobs.length === 0) {
        return;
      }

      for (const job of activeJobs) {
        // Check if this job is assigned to this evaluator and is in EVALUATION phase
        if (
          job.phase === AcpJobPhases.EVALUATION &&
          job.evaluatorAddress === this.acpClient.walletAddress
        ) {
          // Check if deliverable exists (required for evaluation)
          if (!job.deliverable) {
            console.log(`[Evaluator] Polling found job ${job.id} in EVALUATION phase but no deliverable yet, skipping...`);
            continue;
          }

          // Check if we've already evaluated this job (by checking if evidence exists)
          // This prevents duplicate evaluations
          if (this.evaluationEvidence.has(job.id)) {
            console.log(`[Evaluator] Job ${job.id} already evaluated (via polling), skipping...`);
            continue;
          }

          console.log(`[Evaluator] Polling found job ${job.id} in EVALUATION phase with deliverable, evaluating...`);
          
          try {
            await this.handleEvaluation(job);
            console.log(`[Evaluator] Job ${job.id} evaluated (via polling)`);
          } catch (error: any) {
            console.error(`[Evaluator] Failed to evaluate job ${job.id} (via polling):`, error);
            // Don't throw - let it retry on next poll if needed
          }
        }
      }
    } catch (error: any) {
      // Handle API errors gracefully - sometimes the API returns HTML instead of JSON
      if (error?.message?.includes("Unexpected token") || error?.message?.includes("DOCTYPE")) {
        console.warn(`[Evaluator] API returned non-JSON response while polling for evaluation, will retry on next poll`);
      } else {
        console.error(`[Evaluator] Error polling for jobs to evaluate:`, error);
      }
    }
  }

  /**
   * Clean up completed jobs from memory to prevent unbounded growth
   * Removes evidence and mappings for jobs that are in COMPLETED phase
   * Also enforces max size limit by removing oldest entries if needed
   */
  private async cleanupCompletedJobs(): Promise<void> {
    try {
      const activeJobs = await this.acpClient.getActiveJobs();
      
      if (activeJobs instanceof AcpError) {
        return;
      }

      // Get all job IDs that are currently active
      const activeJobIds = new Set(activeJobs.map(job => job.id));
      
      // Clean up evaluation evidence for jobs that are no longer active
      let cleanedEvidence = 0;
      for (const [jobId] of this.evaluationEvidence) {
        if (!activeJobIds.has(jobId)) {
          this.evaluationEvidence.delete(jobId);
          cleanedEvidence++;
        }
      }
      
      // Clean up buyer-to-seller job mappings for completed buyer jobs
      let cleanedBuyerMappings = 0;
      for (const [buyerJobId, sellerJobIds] of this.buyerJobToSellerJob) {
        if (!activeJobIds.has(buyerJobId)) {
          // Remove all seller job mappings for this buyer job
          for (const sellerJobId of sellerJobIds) {
            this.sellerJobToBuyerJob.delete(sellerJobId);
          }
          this.buyerJobToSellerJob.delete(buyerJobId);
          cleanedBuyerMappings++;
        }
      }
      
      // Also clean up seller-to-buyer mappings for completed seller jobs
      let cleanedSellerMappings = 0;
      for (const [sellerJobId, buyerJobId] of this.sellerJobToBuyerJob) {
        if (!activeJobIds.has(sellerJobId)) {
          this.sellerJobToBuyerJob.delete(sellerJobId);
          // Remove this seller job from the buyer's array if it exists
          const sellerJobIds = this.buyerJobToSellerJob.get(buyerJobId);
          if (sellerJobIds) {
            const index = sellerJobIds.indexOf(sellerJobId);
            if (index > -1) {
              sellerJobIds.splice(index, 1);
              // If no more seller jobs, remove the buyer job entry
              if (sellerJobIds.length === 0) {
                this.buyerJobToSellerJob.delete(buyerJobId);
              }
            }
          }
          cleanedSellerMappings++;
        }
      }
      
      // Enforce max size limit: if evidence map exceeds limit, remove oldest entries
      // (Maps maintain insertion order, so we can remove the first entries)
      if (this.evaluationEvidence.size > this.MAX_EVIDENCE_ENTRIES) {
        const entriesToRemove = this.evaluationEvidence.size - this.MAX_EVIDENCE_ENTRIES;
        let removedCount = 0;
        for (const [jobId] of this.evaluationEvidence) {
          if (removedCount >= entriesToRemove) break;
          // Only remove if job is not active
          if (!activeJobIds.has(jobId)) {
            this.evaluationEvidence.delete(jobId);
            removedCount++;
          }
        }
        if (removedCount > 0) {
          console.log(`[Evaluator] Removed ${removedCount} oldest evidence entries to enforce size limit`);
        }
      }
      
      if (cleanedEvidence > 0 || cleanedBuyerMappings > 0 || cleanedSellerMappings > 0) {
        console.log(`[Evaluator] Cleaned up ${cleanedEvidence} evidence entries, ${cleanedBuyerMappings} buyer mappings, ${cleanedSellerMappings} seller mappings`);
      }
    } catch (error: any) {
      // Handle API errors gracefully
      if (error?.message?.includes("Unexpected token") || error?.message?.includes("DOCTYPE")) {
        console.warn(`[Evaluator] API returned non-JSON response during cleanup, will retry on next cleanup cycle`);
      } else {
        console.error(`[Evaluator] Error during cleanup:`, error);
      }
    }
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

evaluator();


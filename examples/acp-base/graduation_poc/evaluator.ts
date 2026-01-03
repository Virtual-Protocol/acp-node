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

// ============================================================================
// Constants
// ============================================================================

const POLLING_INTERVALS = {
  PAYMENT_CHECK: 10000, // 10 seconds
  EVALUATION_CHECK: 10000, // 10 seconds
  CLEANUP: 5 * 60 * 1000, // 5 minutes
} as const;

const JOB_TIMEOUTS = {
  PAYMENT_PROCESSING: 5000, // 5 seconds
  JOB_EXPIRY: 30 * 60 * 1000, // 30 minutes
} as const;

const VALIDATION = {
  MAX_EVIDENCE_ENTRIES: 15,
  NAME_SIMILARITY_THRESHOLD: 0.8,
} as const;

const GRADUATION_JOB_NAME = "graduationEvaluation";

// ============================================================================
// Types & Interfaces
// ============================================================================

interface GraduationRequestPayload {
  agentName: string;
  agentWalletAddress: string;
}

interface EvaluationEvidence {
  jobId: number;
  finalScore: number;
  reasoning: string;
  feedback: string; // Actionable feedback from LLM evaluation
  pass: boolean;
  deliverable: DeliverablePayload;
  timestamp: string;
  requirementSchema?: Object | string;
  deliverableSchema?: Object | string;
  offeringName?: string;
  // Per-criteria scores and reasoning
  completenessScore?: number;
  completenessReasoning?: string;
  correctnessScore?: number;
  correctnessReasoning?: string;
  qualityScore?: number;
  qualityReasoning?: string;
  functionalityScore?: number;
  functionalityReasoning?: string;
}

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

interface ValidationResult {
  isValid: boolean;
  similarity: number;
  reason?: string;
}

interface JobInitiationResult {
  sellerJobId: number;
  offeringName: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

function tryParseJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function isJsonSchema(schema: any): boolean {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    !Array.isArray(schema) &&
    ('type' in schema || 'properties' in schema)
  );
}

function handleApiError(error: any, context: string): void {
  if (error?.message?.includes("Unexpected token") || error?.message?.includes("DOCTYPE")) {
    console.warn(`[Evaluator] API returned non-JSON response in ${context}, will retry`);
  } else {
    console.error(`[Evaluator] Error in ${context}:`, error);
  }
}

// ============================================================================
// Main Evaluator Class
// ============================================================================

class GraduationEvaluator {
  private acpClient!: AcpClient;
  private llmService: GraduationEvaluationLLMService;
  private evaluationEvidence: Map<number, EvaluationEvidence> = new Map();
  private buyerJobToSellerJob: Map<number, number[]> = new Map();
  private sellerJobToBuyerJob: Map<number, number> = new Map();
  private jobsBeingPaid: Set<number> = new Set();
  private sellerJobInitiatedAt: Map<number, number> = new Map(); // Track when seller jobs were initiated
  private sellerJobStatus: Map<number, 'pending' | 'rejected' | 'expired' | 'completed'> = new Map(); // Track seller job status

  constructor() {
    this.llmService = new GraduationEvaluationLLMService();
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    try {
      await this.llmService.initialize();
    } catch (error) {
      console.warn("[Evaluator] LLM service initialization failed, will use fallback evaluation:", error);
    }

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
    
    this.startPolling();
  }

  private startPolling(): void {
    setInterval(() => this.pollForJobsToPay(), POLLING_INTERVALS.PAYMENT_CHECK);
    setInterval(() => this.pollForJobsToEvaluate(), POLLING_INTERVALS.EVALUATION_CHECK);
    setInterval(() => this.checkSellerJobStatus(), POLLING_INTERVALS.EVALUATION_CHECK); // Check seller job status
    setInterval(() => this.cleanupCompletedJobs(), POLLING_INTERVALS.CLEANUP);
  }

  // ==========================================================================
  // Task Handling
  // ==========================================================================

  private async handleNewTask(job: AcpJob, memoToSign?: AcpMemo): Promise<void> {
    console.log(`[Evaluator] Received new task: Job ${job.id}, Phase: ${AcpJobPhases[job.phase]}`);

    if (this.isGraduationRequest(job)) {
      await this.handleGraduationRequest(job);
      return;
    }

    if (this.isBuyerPaymentReceived(job)) {
      await this.handleBuyerPayment(job);
      return;
    }

    if (this.isSellerPaymentRequest(job, memoToSign)) {
      await this.handleSellerPaymentRequest(job);
      return;
    }
  }

  private isGraduationRequest(job: AcpJob): boolean {
    return (
      (job.phase === AcpJobPhases.REQUEST || job.phase === AcpJobPhases.NEGOTIATION) &&
      job.name === GRADUATION_JOB_NAME
    );
  }

  private isBuyerPaymentReceived(job: AcpJob): boolean {
    return (
      job.phase === AcpJobPhases.TRANSACTION &&
      job.name === GRADUATION_JOB_NAME
    );
  }

  private isSellerPaymentRequest(job: AcpJob, memoToSign?: AcpMemo): boolean {
    return (
      job.phase === AcpJobPhases.NEGOTIATION &&
      memoToSign?.nextPhase === AcpJobPhases.TRANSACTION &&
      job.clientAddress === this.acpClient.walletAddress
    );
  }

  private async handleGraduationRequest(job: AcpJob): Promise<void> {
    const requestPayload = this.parseGraduationRequest(job);
    if (!requestPayload) {
      await job.reject("Invalid graduation request payload: missing agentName or agentWalletAddress");
      return;
    }

    console.log(`[Evaluator] Processing graduation request for agent: ${requestPayload.agentName}`);
    await this.processGraduationRequest(job, requestPayload);
  }

  private parseGraduationRequest(job: AcpJob): GraduationRequestPayload | null {
    const requestMemo = job.memos.find(m => m.nextPhase === AcpJobPhases.NEGOTIATION);
    
    if (requestMemo?.content) {
      const parsed = tryParseJson<any>(requestMemo.content);
      if (parsed?.agentName && parsed?.agentWalletAddress) {
        return parsed;
      }
      
      const nested = parsed?.requirement || parsed?.serviceRequirement;
      if (nested) {
        const nestedParsed = typeof nested === 'string' ? tryParseJson<any>(nested) : nested;
        if (nestedParsed?.agentName && nestedParsed?.agentWalletAddress) {
          return nestedParsed;
        }
      }
    }

    if (job.requirement) {
      const req = typeof job.requirement === 'string' 
        ? tryParseJson<GraduationRequestPayload>(job.requirement)
        : job.requirement as any;
      
      if (req?.agentName && req?.agentWalletAddress) {
        return req;
      }
    }

    return null;
  }

  private async handleBuyerPayment(job: AcpJob): Promise<void> {
    console.log(`[Evaluator] Payment received for graduation request job ${job.id}`);
    
    const sellerJobIds = this.buyerJobToSellerJob.get(job.id);
    if (!sellerJobIds || sellerJobIds.length === 0) {
      console.log(`[Evaluator] Seller jobs not yet initiated, waiting...`);
      return;
    }

    const allEvaluated = sellerJobIds.every(id => this.evaluationEvidence.has(id));
    if (allEvaluated) {
      console.log(`[Evaluator] All evaluation reports ready, delivering to buyer job ${job.id}`);
      await this.deliverEvaluationReportToBuyer(job.id);
    } else {
      const completedCount = sellerJobIds.filter(id => this.evaluationEvidence.has(id)).length;
      console.log(`[Evaluator] Waiting for seller jobs to complete (${completedCount}/${sellerJobIds.length} completed)`);
    }
  }

  private async handleSellerPaymentRequest(job: AcpJob): Promise<void> {
    if (this.jobsBeingPaid.has(job.id)) {
      console.log(`[Evaluator] Payment for job ${job.id} already in progress, skipping...`);
      return;
    }

    console.log(`[Evaluator] Seller requesting payment for evaluation job ${job.id}`);
    this.jobsBeingPaid.add(job.id);
    
    try {
      await job.payAndAcceptRequirement();
      console.log(`[Evaluator] Evaluation job ${job.id} paid, waiting for deliverable`);
    } catch (error) {
      console.error(`[Evaluator] Failed to pay for evaluation job ${job.id}:`, error);
    } finally {
      setTimeout(() => this.jobsBeingPaid.delete(job.id), JOB_TIMEOUTS.PAYMENT_PROCESSING);
    }
  }

  // ==========================================================================
  // Graduation Request Processing
  // ==========================================================================

  private async processGraduationRequest(
    job: AcpJob,
    request: GraduationRequestPayload
  ): Promise<void> {
    try {
      console.log(`[Evaluator] Starting graduation evaluation for agent: ${request.agentName}`);

      const agent = await this.discoverAgent(request.agentName, request.agentWalletAddress);
      if (!agent) {
        // Check if an agent with the wallet address exists but has a different name
        const agentByAddress = await this.checkAgentByWalletAddress(request.agentWalletAddress);
        if (agentByAddress) {
          await job.reject(
            `Agent not found: ${request.agentName} (${request.agentWalletAddress}). ` +
            `Found agent with wallet address ${request.agentWalletAddress}: "${agentByAddress.name}". ` +
            `Please verify the agent name matches the wallet address.`
          );
        } else {
          await job.reject(`Agent not found: ${request.agentName} (${request.agentWalletAddress})`);
        }
        return;
      }
      await job.accept("Graduation evaluation request accepted");

      console.log(`[Evaluator] Agent found: ${agent.name} (${agent.walletAddress})`);

      const validationResult = this.validateAgentNameAndWallet(
        request.agentName,
        request.agentWalletAddress,
        agent.name,
        agent.walletAddress
      );

      if (!validationResult.isValid) {
        await job.reject(`Agent validation failed: ${validationResult.reason}`);
        return;
      }

      console.log(`[Evaluator] Agent validation passed (similarity: ${(validationResult.similarity * 100).toFixed(1)}%)`);

      const offerings = agent.jobOfferings || [];
      if (offerings.length === 0) {
        await job.reject(`Agent ${agent.name} has no job offerings`);
        return;
      }

      console.log(`[Evaluator] Agent has ${offerings.length} offering(s). Will evaluate all offerings.`);

      const suggestedRequirementSchema = await this.getSuggestedRequirementSchema(agent, offerings);
      const evaluationRubric = this.getDefaultEvaluationRubric();

      const initiationResults = await this.initiateEvaluationJobs(
        job.id,
        offerings,
        suggestedRequirementSchema,
        evaluationRubric,
        agent.name
      );

      if (initiationResults.length === 0) {
        await job.reject("Failed to initiate evaluation jobs for any offering");
        return;
      }

      const sellerJobIds = initiationResults.map(r => r.sellerJobId);
      const offeringNames = initiationResults.map(r => r.offeringName);

      this.buyerJobToSellerJob.set(job.id, sellerJobIds);
      initiationResults.forEach(r => {
        this.sellerJobToBuyerJob.set(r.sellerJobId, job.id);
        this.sellerJobInitiatedAt.set(r.sellerJobId, Date.now()); // Track when job was initiated
        this.sellerJobStatus.set(r.sellerJobId, 'pending'); // Initialize status
      });

      console.log(`[Evaluator] Mapped buyer job ${job.id} to ${sellerJobIds.length} seller evaluation job(s): ${sellerJobIds.join(', ')}`);

      await job.createRequirement(
        `Graduation evaluation initiated for ${sellerJobIds.length} offering(s): ${offeringNames.join(', ')}. ` +
        `Evaluation job IDs: ${sellerJobIds.join(', ')}. Waiting for deliverables from agent: ${agent.name}`
      );
    } catch (error) {
      console.error(`[Evaluator] Error processing graduation request:`, error);
      await job.reject(`Evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async getSuggestedRequirementSchema(
    agent: AgentWithOfferings,
    offerings: AcpJobOfferingType[]
  ): Promise<Object | string> {
    const allOfferings = offerings.map(offering => ({
      name: offering.name,
      requirement: offering.requirement,
      deliverable: offering.requirement,
    }));

    console.log(`[Evaluator] Requesting LLM to suggest requirement schema based on agent's ${allOfferings.length} offering(s)...`);
    const suggestedSchema = await this.llmService.suggestRequirementSchema({
      agentOfferings: allOfferings,
      agentName: agent.name,
      agentDescription: agent.description,
      evaluationPurpose: "Graduation evaluation to assess agent capabilities and readiness",
    });

    console.log(`[Evaluator] LLM suggested requirement schema:`, suggestedSchema);
    return suggestedSchema;
  }

  private async initiateEvaluationJobs(
    buyerJobId: number,
    offerings: AcpJobOfferingType[],
    suggestedRequirementSchema: Object | string,
    evaluationRubric: string,
    agentName: string
  ): Promise<JobInitiationResult[]> {
    const results: JobInitiationResult[] = [];

    for (const offering of offerings) {
      try {
        const result = await this.initiateSingleEvaluationJob(
          buyerJobId,
          offering,
          suggestedRequirementSchema,
          evaluationRubric,
          agentName
        );
        if (result) {
          results.push(result);
        }
      } catch (error) {
        console.error(`[Evaluator] Error processing offering ${offering.name}:`, error);
      }
    }

    return results;
  }

  private async initiateSingleEvaluationJob(
    buyerJobId: number,
    offering: AcpJobOfferingType,
    suggestedRequirementSchema: Object | string,
    evaluationRubric: string,
    agentName: string
  ): Promise<JobInitiationResult | null> {
    const agentRequirementSchema = offering.requirement || {};
    const finalRequirementSchema = await this.prepareRequirementSchema(
      suggestedRequirementSchema,
      agentRequirementSchema,
      offering.name
    );

    const evaluationPrompt = await this.llmService.generateEvaluationPrompt({
      requirementSchema: suggestedRequirementSchema,
      evaluationRubric,
      jobDescription: `Graduation evaluation for agent: ${agentName} using offering: ${offering.name}`,
    });

    try {
      const sellerJobId = await offering.initiateJob(
        finalRequirementSchema,
        this.acpClient.walletAddress,
        new Date(Date.now() + JOB_TIMEOUTS.JOB_EXPIRY)
      );

      console.log(`[Evaluator] Initiated evaluation job ${sellerJobId} for offering: ${offering.name}`);
      return { sellerJobId, offeringName: offering.name };
    } catch (error) {
      console.log(`[Evaluator] Attempting fallback with agent's original requirement schema for offering: ${offering.name}...`);
      return this.tryFallbackInitiation(buyerJobId, offering, agentRequirementSchema);
    }
  }

  private async prepareRequirementSchema(
    suggestedSchema: Object | string,
    agentSchema: Object | string,
    offeringName: string
  ): Promise<Object | string> {
    let finalSchema: Object | string = suggestedSchema;

    if (isJsonSchema(agentSchema) && typeof suggestedSchema === 'string') {
      console.log(`[Evaluator] Agent has JSON schema, converting natural language requirement to JSON for offering: ${offeringName}`);
      try {
        const jsonRequirement = await this.llmService.convertNaturalLanguageToJsonSchema(
          suggestedSchema,
          agentSchema as Object
        );
        console.log(`[Evaluator] Converted requirement to JSON:`, JSON.stringify(jsonRequirement, null, 2));
        finalSchema = jsonRequirement;
      } catch (error) {
        console.warn(`[Evaluator] Failed to convert natural language to JSON, using natural language as-is:`, error);
        finalSchema = suggestedSchema;
      }
    } else {
      console.log(`[Evaluator] Agent has plain text requirement or no schema, using natural language as-is for offering: ${offeringName}`);
      finalSchema = suggestedSchema;
    }

    // Check if requirement needs image URLs or short URLs and generate appropriate ones
    finalSchema = await this.injectUrlsIfNeeded(finalSchema, agentSchema, suggestedSchema, offeringName);

    return finalSchema;
  }

  /**
   * Detect if requirement schema needs image URLs or short URLs and inject appropriate ones
   */
  private async injectUrlsIfNeeded(
    requirement: Object | string,
    agentSchema: Object | string,
    originalRequirement: Object | string,
    offeringName: string
  ): Promise<Object | string> {
    // Check if agent schema or requirement mentions image URLs or short URLs
    const schemaStr = typeof agentSchema === 'string' ? agentSchema : JSON.stringify(agentSchema);
    const requirementStr = typeof requirement === 'string' ? requirement : JSON.stringify(requirement);
    const originalRequirementStr = typeof originalRequirement === 'string' ? originalRequirement : JSON.stringify(originalRequirement);
    const combinedStr = (schemaStr + ' ' + requirementStr + ' ' + originalRequirementStr).toLowerCase();

    // Check text-based detection
    let needsImageUrl = combinedStr.includes('image') && (
      combinedStr.includes('url') || 
      combinedStr.includes('link') || 
      combinedStr.includes('source') ||
      combinedStr.includes('imageurl') ||
      combinedStr.includes('image_url')
    );

    let needsShortUrl = combinedStr.includes('short') && (
      combinedStr.includes('url') || 
      combinedStr.includes('link')
    );

    // Also check JSON schema structure for URL fields
    if (isJsonSchema(agentSchema)) {
      const schema = agentSchema as any;
      if (schema.properties) {
        for (const [key, value] of Object.entries(schema.properties)) {
          const prop = value as any;
          const lowerKey = key.toLowerCase();
          
          // Check for image/avatar URL fields in schema (including avatar_url, avatar2_url, etc.)
          if (!needsImageUrl && (
            (lowerKey.includes('image') || lowerKey.includes('avatar') || lowerKey.includes('photo') || lowerKey.includes('picture')) && 
            (lowerKey.includes('url') || lowerKey.includes('link')) ||
            (prop.type === 'string' && prop.format === 'uri' && (lowerKey.includes('image') || lowerKey.includes('avatar')))
          )) {
            needsImageUrl = true;
            console.log(`[Evaluator] Detected URL field in schema: ${key}`);
          }
          
          // Check for short URL fields in schema
          if (!needsShortUrl && (
            lowerKey.includes('short') && (lowerKey.includes('url') || lowerKey.includes('link')) ||
            (prop.type === 'string' && prop.format === 'uri' && lowerKey.includes('short'))
          )) {
            needsShortUrl = true;
            console.log(`[Evaluator] Detected short URL field in schema: ${key}`);
          }
        }
      }
    }

    // Check requirement object structure for missing URL fields or placeholder values
    if (typeof requirement === 'object' && requirement !== null) {
      const reqObj = requirement as Record<string, any>;
      const reqKeys = Object.keys(reqObj);
      
      // Check for URL fields (including avatar_url, avatar2_url, etc.) that need values
      for (const key of reqKeys) {
        const lowerKey = key.toLowerCase();
        const value = reqObj[key];
        const valueStr = typeof value === 'string' ? value.toLowerCase() : '';
        
        // Check if field is a URL field (avatar_url, image_url, etc.)
        const isUrlField = lowerKey.includes('url') || lowerKey.includes('link') || lowerKey.includes('source');
        
        // Check if value is a placeholder or empty
        const isPlaceholder = valueStr.includes('[insert') || 
                             valueStr.includes('placeholder') || 
                             valueStr.includes('insert') ||
                             !value || 
                             value === null ||
                             value === '';
        
        // Check if it's an image/avatar URL field
        if (isUrlField && isPlaceholder) {
          if (lowerKey.includes('image') || lowerKey.includes('avatar') || lowerKey.includes('photo') || lowerKey.includes('picture')) {
            needsImageUrl = true;
            console.log(`[Evaluator] Detected placeholder/empty URL field: ${key} = ${value}`);
          } else if (lowerKey.includes('short')) {
            needsShortUrl = true;
            console.log(`[Evaluator] Detected placeholder/empty short URL field: ${key} = ${value}`);
          } else {
            // Generic URL field - assume it might need an image if context suggests it
            if (combinedStr.includes('avatar') || combinedStr.includes('image') || combinedStr.includes('photo')) {
              needsImageUrl = true;
              console.log(`[Evaluator] Detected placeholder/empty URL field (likely image): ${key} = ${value}`);
            }
          }
        }
      }
    }

    if (!needsImageUrl && !needsShortUrl) {
      return requirement; // No URL requirements detected
    }

    console.log(`[Evaluator] Detected URL requirements for offering ${offeringName}. Needs image URL: ${needsImageUrl}, Needs short URL: ${needsShortUrl}`);

    // Inject URLs into requirement
    if (typeof requirement === 'object' && requirement !== null) {
      const requirementObj = requirement as Record<string, any>;
      const updated = { ...requirementObj };
      let urlInjected = false;

      if (needsImageUrl) {
        // Find all URL fields that need values
        const urlFieldsToFill: Array<{ key: string; value: any; index?: number }> = [];
        
        for (const key of Object.keys(updated)) {
          const lowerKey = key.toLowerCase();
          const value = updated[key];
          
          // Check if this is a URL field that needs a value
          const isUrlField = lowerKey.includes('url') || lowerKey.includes('link') || lowerKey.includes('source');
          const isImageField = lowerKey.includes('image') || lowerKey.includes('avatar') || lowerKey.includes('photo') || lowerKey.includes('picture');
          
          // Check if value is a placeholder or invalid
          const isPlaceholder = typeof value === 'string' && (
            value.includes('[insert') || 
            value.includes('placeholder') || 
            value.includes('insert') ||
            value === '' ||
            value === null
          );
          
          // Check if value is already a valid URL (starts with http/https and doesn't contain placeholder text)
          const isValidUrl = typeof value === 'string' && 
            (value.startsWith('http://') || value.startsWith('https://')) &&
            !value.includes('[insert') &&
            !value.includes('placeholder') &&
            !value.includes('insert') &&
            value.length > 10; // Basic validation - real URLs are usually longer
          
          // Only replace if it's a placeholder or empty, NOT if it's already a valid URL
          if (isUrlField && (isImageField || isPlaceholder) && !isValidUrl) {
            // Extract index if it's avatar2_url, avatar3_url, etc.
            const indexMatch = lowerKey.match(/avatar(\d+)/);
            const index = indexMatch ? parseInt(indexMatch[1]) : (lowerKey.includes('avatar2') || lowerKey.includes('2')) ? 2 : 
                          (lowerKey.includes('avatar3') || lowerKey.includes('3')) ? 3 : 1;
            urlFieldsToFill.push({ key, value, index });
          }
        }
        
        // Generate URLs for each field (different URLs for different avatars)
        for (const field of urlFieldsToFill) {
          // Generate URL based on requirement and field context
          const fieldContext = field.value && typeof field.value === 'string' ? field.value : '';
          const imageUrl = await this.generateMatchingImageUrl(
            `${originalRequirementStr} ${fieldContext} ${field.key}`, 
            `${offeringName}-${field.key}`
          );
          updated[field.key] = imageUrl;
          console.log(`[Evaluator] Injected image URL into field '${field.key}': ${imageUrl} (replaced: ${field.value})`);
          urlInjected = true;
        }
        
        // If no specific field found, add common field names
        if (!urlInjected) {
          const imageUrl = await this.generateMatchingImageUrl(originalRequirementStr, offeringName);
          updated.imageUrl = imageUrl;
          updated.image_url = imageUrl;
          console.log(`[Evaluator] Added imageUrl field: ${imageUrl}`);
        }
      }

      if (needsShortUrl) {
        const shortUrl = await this.generateShortUrl(originalRequirementStr, offeringName);
        let shortUrlInjected = false;
        
        // Try to find and populate short URL fields
        for (const key of Object.keys(updated)) {
          const lowerKey = key.toLowerCase();
          if (lowerKey.includes('short') && (lowerKey.includes('url') || lowerKey.includes('link'))) {
            updated[key] = shortUrl;
            console.log(`[Evaluator] Injected short URL into field '${key}': ${shortUrl}`);
            shortUrlInjected = true;
          }
        }
        // If no specific field found, add common field names
        if (!shortUrlInjected) {
          updated.shortUrl = shortUrl;
          updated.short_url = shortUrl;
          console.log(`[Evaluator] Added shortUrl field: ${shortUrl}`);
        }
      }

      return updated;
    } else if (typeof requirement === 'string') {
      // For string requirements, append URL information
      let updated = requirement;
      if (needsImageUrl) {
        const imageUrl = await this.generateMatchingImageUrl(originalRequirementStr, offeringName);
        updated += `\n\nImage URL provided: ${imageUrl}`;
      }
      if (needsShortUrl) {
        const shortUrl = await this.generateShortUrl(originalRequirementStr, offeringName);
        updated += `\n\nShort URL provided: ${shortUrl}`;
      }
      return updated;
    }

    return requirement;
  }

  /**
   * Generate an image URL that matches the requirement using LLM
   * This generates a URL to an image that fulfills the requirement description
   */
  private async generateMatchingImageUrl(requirement: string, offeringName: string): Promise<string> {
    try {
      // Use LLM to suggest an appropriate image URL or description that matches the requirement
      const prompt = `
You are helping to generate an image URL for an evaluation requirement. The requirement is:
${requirement}

Based on this requirement, suggest an appropriate image URL that would fulfill this requirement. The image should:
1. Match the requirement description/topic exactly
2. Be publicly accessible
3. Be appropriate for the evaluation context

You can suggest:
- A specific image URL from a public image service (like Unsplash, Pexels, etc.) that matches the requirement
- A description of what the image should contain (which we can use to find a matching image)
- A search query that would find appropriate images

IMPORTANT: 
- The image must match the requirement (e.g., if requirement asks for "dogs", the image should show dogs)
- If the requirement mentions specific topics, subjects, or themes, the image must reflect those
- Return ONLY a single URL or a very brief description (1-2 sentences max)
- If you can't find a specific URL, provide a clear description of what image is needed

Respond with only the URL or description, no additional text.
`;

      const urlOrDescription = await this.llmService.callLLM(prompt);
      const cleaned = urlOrDescription.trim().replace(/^["']|["']$/g, '');

      // If it's already a URL, validate and return it
      try {
        const url = new URL(cleaned);
        // Check if it's a valid HTTP/HTTPS URL
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          console.log(`[Evaluator] LLM suggested image URL: ${cleaned}`);
          return cleaned;
        }
      } catch {
        // Not a valid URL format, will use fallback
      }

      // If LLM didn't provide a valid URL, use Unsplash or other reliable image services
      // Extract key terms from requirement for better image selection
      const requirementLower = requirement.toLowerCase();
      let imageServiceUrl = '';
      
      // Use Unsplash Source API which provides working images based on search terms
      if (requirementLower.includes('penguin')) {
        // Use a known working penguin image from Unsplash
        imageServiceUrl = 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?w=800&h=600&fit=crop&q=80';
      } else if (requirementLower.includes('pixel') || requirementLower.includes('art')) {
        imageServiceUrl = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&h=600&fit=crop&q=80';
      } else if (requirementLower.includes('music') || requirementLower.includes('video') || requirementLower.includes('rockstar')) {
        imageServiceUrl = 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&h=600&fit=crop&q=80';
      } else {
        // Generic fallback - use a working Unsplash image
        imageServiceUrl = 'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?w=800&h=600&fit=crop&q=80';
      }
      
      console.log(`[Evaluator] LLM did not provide valid URL (got: "${cleaned}"), using image service URL: ${imageServiceUrl}`);
      return imageServiceUrl;
    } catch (error) {
      console.warn(`[Evaluator] Failed to generate matching image URL, using fallback:`, error);
      // Fallback to a working Unsplash image
      return 'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?w=800&h=600&fit=crop&q=80';
    }
  }

  /**
   * Generate a short URL for evaluation purposes
   */
  private async generateShortUrl(requirement: string, offeringName: string): Promise<string> {
    // For evaluation purposes, generate a deterministic short URL
    const timestamp = Date.now();
    const shortCode = timestamp.toString(36).substring(0, 8);
    const mockShortUrl = `https://short.ly/${shortCode}`;
    console.log(`[Evaluator] Generated short URL: ${mockShortUrl}`);
    return mockShortUrl;
  }

  private async tryFallbackInitiation(
    buyerJobId: number,
    offering: AcpJobOfferingType,
    agentRequirementSchema: Object | string
  ): Promise<JobInitiationResult | null> {
    try {
      const fallbackRequirement = typeof agentRequirementSchema === 'object' && agentRequirementSchema !== null
        ? agentRequirementSchema
        : {};

      const sellerJobId = await offering.initiateJob(
        fallbackRequirement,
        this.acpClient.walletAddress,
        new Date(Date.now() + JOB_TIMEOUTS.JOB_EXPIRY)
      );

      console.log(`[Evaluator] Initiated evaluation job ${sellerJobId} using fallback schema for offering: ${offering.name}`);
      return { sellerJobId, offeringName: offering.name };
    } catch (error) {
      console.error(`[Evaluator] Failed to initiate job for offering ${offering.name}:`, error);
      return null;
    }
  }

  // ==========================================================================
  // Agent Discovery & Validation
  // ==========================================================================

  private async discoverAgent(
    agentName: string,
    agentWalletAddress: string
  ): Promise<AgentWithOfferings | null> {
    try {
      const agents = await this.acpClient.browseAgents(agentName, {
        top_k: 1,
        graduationStatus: AcpGraduationStatus.ALL,
        onlineStatus: AcpOnlineStatus.ALL,
      });

      const exactMatch = agents.find(
        agent =>
          agent.name.toLowerCase() === agentName.toLowerCase() &&
          agent.walletAddress.toLowerCase() === agentWalletAddress.toLowerCase()
      );

      if (exactMatch) {
        return this.mapAgentToOfferings(exactMatch);
      }

      const agentByAddress = await this.acpClient.getAgent(agentWalletAddress as Address);
      if (agentByAddress) {
        if (agentByAddress.name.toLowerCase() === agentName.toLowerCase()) {
          const agentsByAddress = await this.acpClient.browseAgents(agentByAddress.name, {
            sort_by: [AcpAgentSort.SUCCESSFUL_JOB_COUNT],
            top_k: 5,
            graduationStatus: AcpGraduationStatus.ALL,
            onlineStatus: AcpOnlineStatus.ALL,
          });

          const match = agentsByAddress.find(
            a => a.walletAddress.toLowerCase() === agentWalletAddress.toLowerCase()
          );

          if (match) {
            return this.mapAgentToOfferings(match);
          }
        }
      }

      const addressMatch = agents.find(
        agent => agent.walletAddress.toLowerCase() === agentWalletAddress.toLowerCase()
      );

      if (addressMatch) {
        console.warn(`[Evaluator] Agent name mismatch. Requested: ${agentName}, Found: ${addressMatch.name}`);
        return this.mapAgentToOfferings(addressMatch);
      }

      return null;
    } catch (error) {
      console.error(`[Evaluator] Error discovering agent:`, error);
      return null;
    }
  }

  private mapAgentToOfferings(agent: any): AgentWithOfferings {
    return {
      name: agent.name,
      walletAddress: agent.walletAddress,
      jobOfferings: agent.jobOfferings || [],
      description: agent.description,
    };
  }

  /**
   * Check if an agent exists with the given wallet address
   * Returns the agent name if found, null otherwise
   */
  private async checkAgentByWalletAddress(walletAddress: string): Promise<{ name: string } | null> {
    try {
      const agent = await this.acpClient.getAgent(walletAddress as Address);
      if (agent) {
        return { name: agent.name };
      }
      return null;
    } catch (error) {
      // If getAgent fails, the agent doesn't exist or there's an API error
      // Return null to indicate agent not found
      return null;
    }
  }

  private validateAgentNameAndWallet(
    requestedName: string,
    requestedWallet: string,
    discoveredName: string,
    discoveredWallet: string
  ): ValidationResult {
    if (requestedWallet.toLowerCase() !== discoveredWallet.toLowerCase()) {
      return {
        isValid: false,
        similarity: 0,
        reason: `Wallet address mismatch. Requested: ${requestedWallet}, Found: ${discoveredWallet}`,
      };
    }

    const nameSimilarity = this.calculateStringSimilarity(
      requestedName.toLowerCase().trim(),
      discoveredName.toLowerCase().trim()
    );

    if (nameSimilarity < VALIDATION.NAME_SIMILARITY_THRESHOLD) {
      return {
        isValid: false,
        similarity: nameSimilarity,
        reason: `Agent name similarity too low (${(nameSimilarity * 100).toFixed(1)}% < ${(VALIDATION.NAME_SIMILARITY_THRESHOLD * 100).toFixed(0)}%)`,
      };
    }

    return { isValid: true, similarity: nameSimilarity };
  }

  private calculateStringSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (str1.length === 0 || str2.length === 0) return 0;

    const distance = this.levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);
    return Math.max(0, 1 - (distance / maxLength));
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + 1
          );
        }
      }
    }

    return dp[m][n];
  }

  // ==========================================================================
  // Evaluation Handling
  // ==========================================================================

  private async handleEvaluation(job: AcpJob): Promise<void> {
    try {
      console.log(`[Evaluator] Evaluating job ${job.id}`);

      if (!job.deliverable) {
        await job.evaluate(false, "Deliverable is missing or empty");
        return;
      }

      const deliverablePayload = typeof job.deliverable === 'string'
        ? tryParseJson(job.deliverable) || job.deliverable
        : job.deliverable;

      const validationResult = await this.validateDeliverable(deliverablePayload, job);
      if (!validationResult.isValid) {
        await job.evaluate(false, `Deliverable validation failed: ${validationResult.error}`);
        return;
      }

      console.log(`[Evaluator] Deliverable validation passed`);

      const requirementSchema = this.extractRequirementSchemaFromJob(job);
      const evaluationRubric = this.getDefaultEvaluationRubric();

      const evaluationResult = await this.llmService.evaluateDeliverable({
        deliverable: deliverablePayload,
        requirementSchema,
        evaluationRubric,
        jobDescription: job.requirement ? String(job.requirement) : undefined,
      });

      console.log(`[Evaluator] Evaluation complete. Score: ${evaluationResult.score}/100, Pass: ${evaluationResult.pass}`);
      console.log(`[Evaluator] Seller's deliverable used for evaluation:`, JSON.stringify(deliverablePayload, null, 2));

      this.storeEvaluationEvidence(job, deliverablePayload, evaluationResult, requirementSchema);

      const evaluationMessage = `Score: ${evaluationResult.score}/100. ${evaluationResult.reasoning}. ${evaluationResult.feedback}`;
      await job.evaluate(evaluationResult.pass, evaluationMessage);

      console.log(`[Evaluator] Job ${job.id} evaluated: ${evaluationResult.pass ? 'PASSED' : 'FAILED'}`);

      await this.checkAndDeliverCombinedReport(job.id);
    } catch (error) {
      console.error(`[Evaluator] Error evaluating job ${job.id}:`, error);
      await job.evaluate(false, `Evaluation error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private storeEvaluationEvidence(
    job: AcpJob,
    deliverable: any,
    evaluationResult: any,
    requirementSchema: Object | string
  ): void {
    const jobContext = tryParseJson<{
      requirementSchema?: Object | string;
      deliverableSchema?: Object | string;
      offeringName?: string;
    }>(typeof job.requirement === 'string' ? job.requirement : JSON.stringify(job.requirement || {}));

    const evidence: EvaluationEvidence = {
      jobId: job.id,
      finalScore: evaluationResult.score,
      reasoning: evaluationResult.reasoning,
      feedback: evaluationResult.feedback || "", // Store feedback for detailed report
      pass: evaluationResult.pass,
      deliverable: deliverable as DeliverablePayload,
      timestamp: new Date().toISOString(),
      requirementSchema: jobContext?.requirementSchema || requirementSchema,
      deliverableSchema: jobContext?.deliverableSchema,
      offeringName: jobContext?.offeringName,
      // Store per-criteria scores and reasoning
      completenessScore: evaluationResult.completenessScore,
      completenessReasoning: evaluationResult.completenessReasoning,
      correctnessScore: evaluationResult.correctnessScore,
      correctnessReasoning: evaluationResult.correctnessReasoning,
      qualityScore: evaluationResult.qualityScore,
      qualityReasoning: evaluationResult.qualityReasoning,
      functionalityScore: evaluationResult.functionalityScore,
      functionalityReasoning: evaluationResult.functionalityReasoning,
    };

    this.evaluationEvidence.set(job.id, evidence);
  }

  private async checkAndDeliverCombinedReport(sellerJobId: number): Promise<void> {
    const buyerJobId = this.sellerJobToBuyerJob.get(sellerJobId);
    if (!buyerJobId) {
      console.warn(`[Evaluator] Could not find buyer job for seller evaluation job ${sellerJobId}`);
      return;
    }

    const sellerJobIds = this.buyerJobToSellerJob.get(buyerJobId);
    if (!sellerJobIds) {
      console.warn(`[Evaluator] Could not find seller job IDs for buyer job ${buyerJobId}`);
      return;
    }

    const allEvaluated = sellerJobIds.every(id => this.evaluationEvidence.has(id));
    if (allEvaluated) {
      console.log(`[Evaluator] All ${sellerJobIds.length} seller jobs evaluated. Delivering combined evaluation report to buyer job ${buyerJobId}`);
      await this.deliverEvaluationReportToBuyer(buyerJobId);
    } else {
      const completedCount = sellerJobIds.filter(id => this.evaluationEvidence.has(id)).length;
      console.log(`[Evaluator] Seller job ${sellerJobId} evaluated (${completedCount}/${sellerJobIds.length} complete). Waiting for remaining jobs.`);
    }
  }

  private async validateDeliverable(
    deliverable: any,
    job: AcpJob
  ): Promise<{ isValid: boolean; error?: string }> {
    if (!deliverable || (typeof deliverable === 'string' && deliverable.trim().length === 0)) {
      return { isValid: false, error: "Deliverable is empty" };
    }

    if (typeof deliverable === 'object' && Object.keys(deliverable).length === 0) {
      return { isValid: false, error: "Deliverable object is empty" };
    }

    return { isValid: true };
  }

  private extractRequirementSchemaFromJob(job: AcpJob): Object | string {
    if (job.context?.requirementSchema) {
      return job.context.requirementSchema;
    }

    if (job.requirement) {
      const requirement = typeof job.requirement === 'string'
        ? tryParseJson(job.requirement)
        : job.requirement;

      if (requirement && typeof requirement === 'object' && 'requirementSchema' in requirement) {
        return (requirement as any).requirementSchema;
      }
    }

    return {};
  }

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

  // ==========================================================================
  // Report Delivery
  // ==========================================================================

  private async deliverEvaluationReportToBuyer(buyerJobId: number): Promise<void> {
    try {
      const buyerJob = await this.acpClient.getJobById(buyerJobId);
      
      if (!(buyerJob instanceof AcpJob)) {
        console.error(`[Evaluator] Could not retrieve buyer job ${buyerJobId}`);
        return;
      }

      if (buyerJob.deliverable) {
        console.log(`[Evaluator] Buyer job ${buyerJobId} already has deliverable`);
        return;
      }

      const sellerJobIds = this.buyerJobToSellerJob.get(buyerJobId);
      if (!sellerJobIds || sellerJobIds.length === 0) {
        console.error(`[Evaluator] No seller jobs found for buyer job ${buyerJobId}`);
        return;
      }

      const allEvidence = this.collectEvaluationEvidence(sellerJobIds);
      if (allEvidence.length === 0) {
        console.error(`[Evaluator] No evaluation evidence found for buyer job ${buyerJobId}`);
        return;
      }

      const evaluationReport = this.createEvaluationReport(allEvidence, sellerJobIds);

      console.log(`[Evaluator] Delivering evaluation report to buyer job ${buyerJobId}`);
      console.log(`[Evaluator] Evaluation report:`, JSON.stringify(evaluationReport, null, 2));

      if (buyerJob.phase === AcpJobPhases.TRANSACTION || buyerJob.phase === AcpJobPhases.EVALUATION) {
        await buyerJob.deliver(evaluationReport);
        console.log(`[Evaluator] Evaluation report delivered to buyer job ${buyerJobId}`);
      } else if (buyerJob.phase === AcpJobPhases.COMPLETED) {
        console.log(`[Evaluator] Buyer job ${buyerJobId} is already completed`);
      } else {
        console.log(`[Evaluator] Buyer job ${buyerJobId} is in phase ${AcpJobPhases[buyerJob.phase]}, cannot deliver yet`);
      }
    } catch (error) {
      console.error(`[Evaluator] Error delivering evaluation report to buyer job ${buyerJobId}:`, error);
    }
  }

  private collectEvaluationEvidence(sellerJobIds: number[]): EvaluationEvidence[] {
    const allEvidence: EvaluationEvidence[] = [];
    for (const sellerJobId of sellerJobIds) {
      const evidence = this.evaluationEvidence.get(sellerJobId);
      if (evidence) {
        allEvidence.push(evidence);
      } else {
        console.warn(`[Evaluator] Evidence not found for seller job ${sellerJobId}, skipping...`);
      }
    }
    return allEvidence;
  }

  private createEvaluationReport(
    allEvidence: EvaluationEvidence[],
    sellerJobIds: number[]
  ): DeliverablePayload {
    const totalScore = allEvidence.reduce((sum, e) => sum + e.finalScore, 0);
    const averageScore = totalScore / allEvidence.length;
    const allPassed = allEvidence.every(e => e.pass);
    const passedCount = allEvidence.filter(e => e.pass).length;
    const failedCount = allEvidence.length - passedCount;

    // Build detailed reasoning based on marking rubric
    const reasoning = this.buildDetailedReasoning(allEvidence, averageScore, passedCount, failedCount, allPassed);

    return {
      type: "graduation_evaluation_report",
      sellerJobIds,
      finalScore: averageScore,
      pass: allPassed,
      reasoning,
      timestamp: new Date().toISOString(),
      status: allPassed ? "PASSED" : "FAILED",
    };
  }

  /**
   * Build detailed reasoning explaining the evaluation score based on the marking rubric
   */
  private buildDetailedReasoning(
    allEvidence: EvaluationEvidence[],
    averageScore: number,
    passedCount: number,
    failedCount: number,
    allPassed: boolean
  ): string {
    const rubricCriteria = [
      { name: "Completeness", weight: 30, description: "Does the deliverable meet all required fields in the schema?" },
      { name: "Correctness", weight: 30, description: "Is the deliverable accurate and correct?" },
      { name: "Quality", weight: 20, description: "Is the deliverable well-structured and professional?" },
      { name: "Functionality", weight: 20, description: "Does the deliverable demonstrate the agent's capabilities?" },
    ];

    let reasoning = `## Graduation Evaluation Report\n\n`;
    reasoning += `**Overall Result:** ${averageScore >= 70 ? "PASSED" : "FAILED"} (Score: ${averageScore.toFixed(2)}/100)\n\n`;
    reasoning += `**Summary:** Evaluated ${allEvidence.length} offering(s). ${passedCount} passed, ${failedCount} failed.\n\n`;

    // Score distribution statistics
    const scores = allEvidence.map(e => e.finalScore);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const scoreVariance = this.calculateVariance(scores);
    const scoreStdDev = Math.sqrt(scoreVariance);
    
    reasoning += `**Score Statistics:**\n`;
    reasoning += `- Average Score: ${averageScore.toFixed(2)}/100\n`;
    reasoning += `- Highest Score: ${maxScore.toFixed(2)}/100\n`;
    reasoning += `- Lowest Score: ${minScore.toFixed(2)}/100\n`;
    reasoning += `- Score Range: ${(maxScore - minScore).toFixed(2)} points\n`;
    if (allEvidence.length > 1) {
      reasoning += `- Standard Deviation: ${scoreStdDev.toFixed(2)} (${scoreStdDev < 5 ? "consistent" : scoreStdDev < 10 ? "moderate variation" : "high variation"} across offerings)\n`;
    }
    reasoning += `\n`;

    // Per-offering breakdown with more details
    reasoning += `### Per-Offering Evaluation:\n\n`;
    allEvidence.forEach((evidence, index) => {
      const offeringName = evidence.offeringName || `Offering ${index + 1}`;
      reasoning += `**${offeringName}** (Job ID: ${evidence.jobId}):\n`;
      reasoning += `- Score: ${evidence.finalScore.toFixed(2)}/100 - ${evidence.pass ? "PASSED" : "FAILED"}\n`;
      reasoning += `- Evaluated: ${new Date(evidence.timestamp).toLocaleString()}\n`;
      reasoning += `- Overall Reasoning: ${evidence.reasoning}\n`;
      
      // Per-criteria scoring breakdown
      if (evidence.completenessScore !== undefined || 
          evidence.correctnessScore !== undefined || 
          evidence.qualityScore !== undefined || 
          evidence.functionalityScore !== undefined) {
        reasoning += `\n  **Per-Criteria Scoring Breakdown:**\n`;
        
        if (evidence.completenessScore !== undefined) {
          reasoning += `  - **Completeness** (30 points): ${evidence.completenessScore.toFixed(1)}/30\n`;
          if (evidence.completenessReasoning) {
            reasoning += `    Reasoning: ${evidence.completenessReasoning}\n`;
          }
        }
        
        if (evidence.correctnessScore !== undefined) {
          reasoning += `  - **Correctness** (30 points): ${evidence.correctnessScore.toFixed(1)}/30\n`;
          if (evidence.correctnessReasoning) {
            reasoning += `    Reasoning: ${evidence.correctnessReasoning}\n`;
          }
        }
        
        if (evidence.qualityScore !== undefined) {
          reasoning += `  - **Quality** (20 points): ${evidence.qualityScore.toFixed(1)}/20\n`;
          if (evidence.qualityReasoning) {
            reasoning += `    Reasoning: ${evidence.qualityReasoning}\n`;
          }
        }
        
        if (evidence.functionalityScore !== undefined) {
          reasoning += `  - **Functionality** (20 points): ${evidence.functionalityScore.toFixed(1)}/20\n`;
          if (evidence.functionalityReasoning) {
            reasoning += `    Reasoning: ${evidence.functionalityReasoning}\n`;
          }
        }
        
        // Verify score sum
        const calculatedTotal = (evidence.completenessScore || 0) + 
                                (evidence.correctnessScore || 0) + 
                                (evidence.qualityScore || 0) + 
                                (evidence.functionalityScore || 0);
        if (calculatedTotal > 0) {
          reasoning += `  - **Total Calculated**: ${calculatedTotal.toFixed(1)}/100\n`;
        }
        reasoning += `\n`;
      }
      
      if (evidence.feedback) {
        reasoning += `- **Actionable Feedback**: ${evidence.feedback}\n`;
      }
      
      // Deliverable summary
      if (evidence.deliverable) {
        const deliverableSummary = this.summarizeDeliverable(evidence.deliverable);
        if (deliverableSummary) {
          reasoning += `- Deliverable: ${deliverableSummary}\n`;
        }
      }
      reasoning += `\n`;
    });

    // Overall performance analysis based on rubric
    reasoning += `### Performance Analysis (Based on Evaluation Rubric):\n\n`;
    
    // Analyze score distribution
    const scoreRanges = {
      excellent: allEvidence.filter(e => e.finalScore >= 90).length,
      good: allEvidence.filter(e => e.finalScore >= 80 && e.finalScore < 90).length,
      satisfactory: allEvidence.filter(e => e.finalScore >= 70 && e.finalScore < 80).length,
      needsImprovement: allEvidence.filter(e => e.finalScore < 70).length,
    };

    if (averageScore >= 90) {
      reasoning += `**Overall Assessment:** Excellent performance. The agent consistently demonstrates strong capabilities across all evaluated offerings.\n\n`;
    } else if (averageScore >= 80) {
      reasoning += `**Overall Assessment:** Good performance. The agent meets expectations with minor areas for improvement.\n\n`;
    } else if (averageScore >= 70) {
      reasoning += `**Overall Assessment:** Satisfactory performance. The agent meets the minimum passing threshold but has room for improvement.\n\n`;
    } else {
      reasoning += `**Overall Assessment:** Needs improvement. The agent did not meet the passing threshold (70/100) and requires significant improvements.\n\n`;
    }

    // Explain score based on rubric criteria with actual per-criteria scores if available
    reasoning += `**Score Breakdown by Rubric Criteria:**\n\n`;
    reasoning += `The evaluation assessed each deliverable against four key criteria:\n\n`;
    
    // Calculate average per-criteria scores if available
    const hasPerCriteriaScores = allEvidence.some(e => 
      e.completenessScore !== undefined || 
      e.correctnessScore !== undefined || 
      e.qualityScore !== undefined || 
      e.functionalityScore !== undefined
    );
    
    if (hasPerCriteriaScores) {
      const completenessScores = allEvidence
        .filter(e => e.completenessScore !== undefined)
        .map(e => e.completenessScore!);
      const avgCompleteness = completenessScores.length > 0
        ? completenessScores.reduce((sum, s) => sum + s, 0) / completenessScores.length
        : 0;
      
      const correctnessScores = allEvidence
        .filter(e => e.correctnessScore !== undefined)
        .map(e => e.correctnessScore!);
      const avgCorrectness = correctnessScores.length > 0
        ? correctnessScores.reduce((sum, s) => sum + s, 0) / correctnessScores.length
        : 0;
      
      const qualityScores = allEvidence
        .filter(e => e.qualityScore !== undefined)
        .map(e => e.qualityScore!);
      const avgQuality = qualityScores.length > 0
        ? qualityScores.reduce((sum, s) => sum + s, 0) / qualityScores.length
        : 0;
      
      const functionalityScores = allEvidence
        .filter(e => e.functionalityScore !== undefined)
        .map(e => e.functionalityScore!);
      const avgFunctionality = functionalityScores.length > 0
        ? functionalityScores.reduce((sum, s) => sum + s, 0) / functionalityScores.length
        : 0;
      
      reasoning += `**Average Scores Across All Offerings:**\n`;
      reasoning += `- **Completeness** (30 points): ${avgCompleteness.toFixed(1)}/30 - ${this.getPerformanceLevel(avgCompleteness, 30)} - ${rubricCriteria[0].description}\n`;
      reasoning += `- **Correctness** (30 points): ${avgCorrectness.toFixed(1)}/30 - ${this.getPerformanceLevel(avgCorrectness, 30)} - ${rubricCriteria[1].description}\n`;
      reasoning += `- **Quality** (20 points): ${avgQuality.toFixed(1)}/20 - ${this.getPerformanceLevel(avgQuality, 20)} - ${rubricCriteria[2].description}\n`;
      reasoning += `- **Functionality** (20 points): ${avgFunctionality.toFixed(1)}/20 - ${this.getPerformanceLevel(avgFunctionality, 20)} - ${rubricCriteria[3].description}\n`;
      reasoning += `- **Total Average**: ${(avgCompleteness + avgCorrectness + avgQuality + avgFunctionality).toFixed(1)}/100\n\n`;
    } else {
      // Fallback to estimated scores if per-criteria scores not available
      rubricCriteria.forEach(criterion => {
        const estimatedPoints = (averageScore * criterion.weight / 100);
        const performance = this.getPerformanceLevel(estimatedPoints, criterion.weight);
        
        reasoning += `- **${criterion.name}** (${criterion.weight} points): ${performance} - ${criterion.description}\n`;
        reasoning += `  Estimated points: ~${estimatedPoints.toFixed(1)}/${criterion.weight}\n\n`;
      });
    }

    // Consistency analysis
    if (allEvidence.length > 1) {
      reasoning += `### Consistency Analysis:\n\n`;
      const consistencyScore = this.analyzeConsistency(allEvidence);
      reasoning += `**Cross-Offering Performance:** ${consistencyScore.assessment}\n`;
      reasoning += `${consistencyScore.details}\n\n`;
    }

    // Recommendations for improvement
    reasoning += `### Recommendations:\n\n`;
    const recommendations = this.generateRecommendations(allEvidence, averageScore);
    if (recommendations.length > 0) {
      recommendations.forEach((rec, index) => {
        reasoning += `${index + 1}. ${rec}\n`;
      });
    } else {
      reasoning += `The agent demonstrates strong performance across all evaluation criteria. Continue maintaining high standards.\n`;
    }
    reasoning += `\n`;

    // Final verdict
    reasoning += `### Final Verdict:\n\n`;
    if (averageScore >= 70) {
      reasoning += `**PASSED** - The agent achieved an average score of ${averageScore.toFixed(2)}/100, meeting the passing threshold of 70/100. `;
      if (allPassed) {
        reasoning += `All ${allEvidence.length} offering(s) passed evaluation. `;
      } else {
        reasoning += `${passedCount} out of ${allEvidence.length} offering(s) passed evaluation. `;
      }
      reasoning += `The agent demonstrates sufficient capability to graduate.\n\n`;
      reasoning += `**Next Steps:** Please attach a screenshot of this evaluation report to your graduation form submission.\n\n`;
    } else {
      reasoning += `**FAILED** - The agent achieved an average score of ${averageScore.toFixed(2)}/100, below the passing threshold of 70/100. `;
      reasoning += `Only ${passedCount} out of ${allEvidence.length} offering(s) passed evaluation. `;
      reasoning += `The agent requires improvement in one or more of the evaluation criteria (Completeness, Correctness, Quality, or Functionality) before graduation.\n\n`;
      reasoning += `**Next Steps:** Please improve the deliverable quality based on the feedback and recommendations provided above, then resubmit for evaluation.\n\n`;
    }

    // Disclaimer
    reasoning += `### Important Disclaimer:\n\n`;
    reasoning += `**This evaluation report is provided as a supporting factor only.**\n\n`;
    reasoning += `The final graduation decision remains with Virtual's review team. This evaluator agent performs automated assessment based on predefined criteria, but Virtual reserves the right to make the ultimate decision regarding agent graduation. `;
    reasoning += `Please use this report as guidance for improvement and as supporting documentation in your graduation application.\n\n`;

    return reasoning;
  }

  /**
   * Calculate variance of scores
   */
  private calculateVariance(scores: number[]): number {
    if (scores.length === 0) return 0;
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const squaredDiffs = scores.map(score => Math.pow(score - mean, 2));
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / scores.length;
  }

  /**
   * Summarize deliverable for reporting
   */
  private summarizeDeliverable(deliverable: DeliverablePayload): string {
    if (typeof deliverable === 'string') {
      return deliverable.length > 100 ? deliverable.substring(0, 100) + '...' : deliverable;
    }
    
    if (deliverable.type) {
      const type = deliverable.type;
      if (deliverable.url) {
        return `${type} deliverable: ${deliverable.url}`;
      }
      if (deliverable.title) {
        return `${type}: ${deliverable.title}`;
      }
      return `${type} deliverable submitted`;
    }
    
    return "Deliverable submitted";
  }

  /**
   * Analyze consistency across multiple offerings
   */
  private analyzeConsistency(allEvidence: EvaluationEvidence[]): { assessment: string; details: string } {
    const scores = allEvidence.map(e => e.finalScore);
    const stdDev = Math.sqrt(this.calculateVariance(scores));
    const allPassed = allEvidence.every(e => e.pass);
    const allFailed = allEvidence.every(e => !e.pass);
    
    if (stdDev < 5) {
      return {
        assessment: "Highly Consistent",
        details: `The agent demonstrates consistent performance across all offerings with a standard deviation of ${stdDev.toFixed(2)}. This indicates reliable and predictable behavior.`
      };
    } else if (stdDev < 10) {
      return {
        assessment: "Moderately Consistent",
        details: `The agent shows moderate variation in performance (standard deviation: ${stdDev.toFixed(2)}). Some offerings perform better than others, suggesting room for improvement in consistency.`
      };
    } else {
      return {
        assessment: "Inconsistent",
        details: `The agent shows significant variation in performance (standard deviation: ${stdDev.toFixed(2)}). This inconsistency suggests the agent may need more training or refinement to ensure reliable outputs across different scenarios.`
      };
    }
  }

  /**
   * Generate actionable recommendations based on evaluation results
   */
  private generateRecommendations(allEvidence: EvaluationEvidence[], averageScore: number): string[] {
    const recommendations: string[] = [];
    
    // Check for common issues
    const failedOfferings = allEvidence.filter(e => !e.pass);
    const lowScores = allEvidence.filter(e => e.finalScore < 70);
    
    if (averageScore < 70) {
      recommendations.push(`Focus on improving overall performance to meet the passing threshold of 70/100. Current average: ${averageScore.toFixed(2)}/100.`);
    }
    
    if (failedOfferings.length > 0) {
      const failedNames = failedOfferings.map(e => e.offeringName || `Job ${e.jobId}`).join(", ");
      recommendations.push(`Address issues in the following offering(s): ${failedNames}. Review the detailed feedback for each.`);
    }
    
    // Analyze common feedback themes
    const allFeedback = allEvidence.map(e => e.feedback).filter(f => f && f.length > 0);
    if (allFeedback.length > 0) {
      const commonIssues = this.extractCommonIssues(allFeedback);
      if (commonIssues.length > 0) {
        recommendations.push(`Common areas for improvement identified: ${commonIssues.join(", ")}.`);
      }
    }
    
    // Score-based recommendations
    if (averageScore >= 70 && averageScore < 80) {
      recommendations.push(`While passing, consider improvements to reach higher performance levels (target: 80+).`);
    }
    
    if (allEvidence.length > 1) {
      const scoreRange = Math.max(...allEvidence.map(e => e.finalScore)) - Math.min(...allEvidence.map(e => e.finalScore));
      if (scoreRange > 15) {
        recommendations.push(`Work on consistency across offerings. Current score range: ${scoreRange.toFixed(2)} points.`);
      }
    }
    
    return recommendations;
  }

  /**
   * Get performance level based on score and max points
   */
  private getPerformanceLevel(score: number, maxPoints: number): string {
    const percentage = (score / maxPoints) * 100;
    if (percentage >= 90) return "Excellent";
    if (percentage >= 80) return "Good";
    if (percentage >= 70) return "Satisfactory";
    return "Needs Improvement";
  }

  /**
   * Extract common issues from feedback
   */
  private extractCommonIssues(feedbackArray: string[]): string[] {
    const issueKeywords = [
      "missing", "incomplete", "incomplete", "missing fields",
      "incorrect", "wrong", "error", "mistake",
      "quality", "structure", "format", "professional",
      "functionality", "capability", "demonstrate"
    ];
    
    const issues: Set<string> = new Set();
    
    feedbackArray.forEach(feedback => {
      const lowerFeedback = feedback.toLowerCase();
      if (lowerFeedback.includes("completeness") || lowerFeedback.includes("missing") || lowerFeedback.includes("incomplete")) {
        issues.add("Completeness");
      }
      if (lowerFeedback.includes("correctness") || lowerFeedback.includes("incorrect") || lowerFeedback.includes("wrong")) {
        issues.add("Correctness");
      }
      if (lowerFeedback.includes("quality") || lowerFeedback.includes("structure") || lowerFeedback.includes("professional")) {
        issues.add("Quality");
      }
      if (lowerFeedback.includes("functionality") || lowerFeedback.includes("capability") || lowerFeedback.includes("demonstrate")) {
        issues.add("Functionality");
      }
    });
    
    return Array.from(issues);
  }

  // ==========================================================================
  // Polling & Cleanup
  // ==========================================================================

  private async pollForJobsToPay(): Promise<void> {
    try {
      const activeJobs = await this.acpClient.getActiveJobs();
      
      if (activeJobs instanceof AcpError) {
        // If it's a network/API error, log and continue - don't crash
        const errorMsg = activeJobs.message || String(activeJobs);
        if (errorMsg.includes("Failed to fetch") || errorMsg.includes("Failed to parse")) {
          console.warn(`[Evaluator] API error while polling for jobs to pay (will retry):`, errorMsg);
          return;
        }
        return;
      }

      if (!activeJobs || activeJobs.length === 0) {
        return;
      }

      for (const job of activeJobs) {
        if (
          job.phase === AcpJobPhases.NEGOTIATION &&
          job.clientAddress === this.acpClient.walletAddress &&
          !this.jobsBeingPaid.has(job.id)
        ) {
          const paymentMemo = job.memos.find(m => m.nextPhase === AcpJobPhases.TRANSACTION);
          if (paymentMemo) {
            await this.processPaymentForJob(job);
          }
        }
      }
    } catch (error: any) {
      // Handle API errors gracefully - don't crash the evaluator
      if (error?.message?.includes("Failed to fetch") || 
          error?.message?.includes("Failed to parse") ||
          error?.message?.includes("Unexpected token")) {
        console.warn(`[Evaluator] API error while polling for jobs to pay (will retry):`, error.message);
      } else {
        handleApiError(error, "polling for jobs to pay");
      }
    }
  }

  private async processPaymentForJob(job: AcpJob): Promise<void> {
    console.log(`[Evaluator] Polling found job ${job.id} in NEGOTIATION phase with payment requirement, paying...`);
    
    this.jobsBeingPaid.add(job.id);
    try {
      await job.payAndAcceptRequirement();
      console.log(`[Evaluator] Evaluation job ${job.id} paid (via polling), waiting for deliverable`);
    } catch (error: any) {
      if (error?.message?.includes("Already signed") || error?.details?.message === "Already signed") {
        console.log(`[Evaluator] Job ${job.id} already paid (via polling), skipping...`);
      } else {
        console.error(`[Evaluator] Failed to pay for evaluation job ${job.id} (via polling):`, error);
      }
    } finally {
      setTimeout(() => this.jobsBeingPaid.delete(job.id), JOB_TIMEOUTS.PAYMENT_PROCESSING);
    }
  }

  private async pollForJobsToEvaluate(): Promise<void> {
    try {
      const activeJobs = await this.acpClient.getActiveJobs();
      
      if (activeJobs instanceof AcpError) {
        // If it's a network/API error, log and continue - don't crash
        const errorMsg = activeJobs.message || String(activeJobs);
        if (errorMsg.includes("Failed to fetch") || errorMsg.includes("Failed to parse")) {
          console.warn(`[Evaluator] API error while polling for jobs to evaluate (will retry):`, errorMsg);
          return;
        }
        return;
      }

      if (!activeJobs || activeJobs.length === 0) {
        return;
      }

      for (const job of activeJobs) {
        if (
          job.phase === AcpJobPhases.EVALUATION &&
          job.evaluatorAddress === this.acpClient.walletAddress &&
          job.deliverable &&
          !this.evaluationEvidence.has(job.id)
        ) {
          console.log(`[Evaluator] Polling found job ${job.id} in EVALUATION phase with deliverable, evaluating...`);
          try {
            await this.handleEvaluation(job);
            console.log(`[Evaluator] Job ${job.id} evaluated (via polling)`);
            // Mark as completed when evaluation is done
            this.sellerJobStatus.set(job.id, 'completed');
          } catch (error: any) {
            console.error(`[Evaluator] Failed to evaluate job ${job.id} (via polling):`, error);
          }
        }
      }
    } catch (error: any) {
      // Handle API errors gracefully - don't crash the evaluator
      if (error?.message?.includes("Failed to fetch") || 
          error?.message?.includes("Failed to parse") ||
          error?.message?.includes("Unexpected token")) {
        console.warn(`[Evaluator] API error while polling for jobs to evaluate (will retry):`, error.message);
      } else {
        handleApiError(error, "polling for jobs to evaluate");
      }
    }
  }

  /**
   * Check status of seller jobs - detect rejections, timeouts, and non-responses
   */
  private async checkSellerJobStatus(): Promise<void> {
    try {
      // Get all tracked seller jobs
      const sellerJobIds = Array.from(this.sellerJobToBuyerJob.keys());
      if (sellerJobIds.length === 0) {
        return;
      }

      // Check each seller job individually to avoid API errors affecting all jobs
      for (const sellerJobId of sellerJobIds) {
        try {
          const job = await this.acpClient.getJobById(sellerJobId);
          
          if (!(job instanceof AcpJob)) {
            // Job not found - might be expired or deleted
            await this.handleSellerJobFailure(sellerJobId, 'expired', 'Job not found or expired');
            continue;
          }

          const buyerJobId = this.sellerJobToBuyerJob.get(sellerJobId);
          if (!buyerJobId) {
            continue; // No buyer job mapped, skip
          }

          // Check if job was rejected
          if (job.phase === AcpJobPhases.REJECTED) {
            if (this.sellerJobStatus.get(sellerJobId) !== 'rejected') {
              const rejectionMemo = job.memos.find(m => m.nextPhase === AcpJobPhases.REJECTED);
              const rejectionReason = rejectionMemo?.content || 'Seller rejected the job';
              await this.handleSellerJobFailure(sellerJobId, 'rejected', rejectionReason);
            }
          }
          // Check if job has timed out (still in REQUEST or NEGOTIATION after expiry time)
          else if (job.phase === AcpJobPhases.REQUEST || job.phase === AcpJobPhases.NEGOTIATION) {
            const initiatedAt = this.sellerJobInitiatedAt.get(sellerJobId);
            if (initiatedAt) {
              const elapsed = Date.now() - initiatedAt;
              if (elapsed > JOB_TIMEOUTS.JOB_EXPIRY) {
                if (this.sellerJobStatus.get(sellerJobId) !== 'expired') {
                  await this.handleSellerJobFailure(sellerJobId, 'expired', `Seller did not respond within ${JOB_TIMEOUTS.JOB_EXPIRY / 1000 / 60} minutes`);
                }
              }
            }
          }
          // Check if job is completed (evaluation done)
          else if (job.phase === AcpJobPhases.COMPLETED || job.phase === AcpJobPhases.EVALUATION) {
            if (this.sellerJobStatus.get(sellerJobId) !== 'completed') {
              this.sellerJobStatus.set(sellerJobId, 'completed');
            }
          }
        } catch (error: any) {
          // If we can't fetch a specific job, it might be expired or deleted
          if (error?.message?.includes("not found") || error?.message?.includes("Failed to fetch")) {
            await this.handleSellerJobFailure(sellerJobId, 'expired', 'Job not found or expired');
          } else {
            // Log but don't fail - continue checking other jobs
            console.warn(`[Evaluator] Error checking seller job ${sellerJobId}:`, error?.message || error);
          }
        }
      }
    } catch (error: any) {
      // Handle API errors gracefully
      if (error?.message?.includes("Failed to fetch") || 
          error?.message?.includes("Failed to parse") ||
          error?.message?.includes("Unexpected token")) {
        console.warn(`[Evaluator] API error while checking seller job status (will retry):`, error.message);
      } else {
        console.error(`[Evaluator] Error checking seller job status:`, error);
      }
    }
  }

  /**
   * Handle seller job failure (rejection, timeout, or non-response)
   */
  private async handleSellerJobFailure(
    sellerJobId: number,
    reason: 'rejected' | 'expired',
    message: string
  ): Promise<void> {
    const buyerJobId = this.sellerJobToBuyerJob.get(sellerJobId);
    if (!buyerJobId) {
      console.warn(`[Evaluator] No buyer job found for seller job ${sellerJobId}`);
      return;
    }

    // Update status
    this.sellerJobStatus.set(sellerJobId, reason);

    console.log(`[Evaluator] Seller job ${sellerJobId} ${reason}: ${message}`);

    // Check if all seller jobs for this buyer job have failed
    const sellerJobIds = this.buyerJobToSellerJob.get(buyerJobId);
    if (!sellerJobIds) {
      return;
    }

    const allSellerJobsStatus = sellerJobIds.map(id => this.sellerJobStatus.get(id) || 'pending');
    const allFailed = allSellerJobsStatus.every(status => status === 'rejected' || status === 'expired');
    const allCompleted = allSellerJobsStatus.every(status => status === 'completed');
    const someCompleted = allSellerJobsStatus.some(status => status === 'completed');

    // If all seller jobs failed, notify buyer
    if (allFailed && !someCompleted) {
      try {
        const buyerJob = await this.acpClient.getJobById(buyerJobId);
        if (buyerJob instanceof AcpJob) {
          const failedCount = allSellerJobsStatus.filter(s => s === 'rejected' || s === 'expired').length;
          const failureDetails = sellerJobIds
            .map(id => {
              const status = this.sellerJobStatus.get(id);
              return `Job ${id}: ${status === 'rejected' ? 'rejected' : 'expired'}`;
            })
            .join(', ');

          const errorMessage = `All ${failedCount} evaluation job(s) failed. ${failureDetails}. ` +
            `Reason: ${reason === 'rejected' ? 'Seller rejected the evaluation job(s)' : 'Seller did not respond to the evaluation job(s) within the timeout period'}`;

          // If buyer job is still active, deliver error report
          if (buyerJob.phase === AcpJobPhases.TRANSACTION || buyerJob.phase === AcpJobPhases.EVALUATION) {
            await buyerJob.deliver({
              type: "graduation_evaluation_error",
              error: errorMessage,
              sellerJobIds,
              timestamp: new Date().toISOString(),
              status: "FAILED",
            });
            console.log(`[Evaluator] Delivered error report to buyer job ${buyerJobId}: All seller jobs failed`);
          } else {
            console.log(`[Evaluator] Buyer job ${buyerJobId} is in phase ${AcpJobPhases[buyerJob.phase]}, cannot deliver error report`);
          }
        }
      } catch (error) {
        console.error(`[Evaluator] Failed to notify buyer job ${buyerJobId} about seller job failures:`, error);
      }
    } else if (someCompleted) {
      // Some jobs completed, some failed - deliver partial report
      console.log(`[Evaluator] Some seller jobs completed, some failed for buyer job ${buyerJobId}. Will deliver partial report when all completed jobs are evaluated.`);
    }
  }

  private async cleanupCompletedJobs(): Promise<void> {
    try {
      const activeJobs = await this.acpClient.getActiveJobs();
      
      if (activeJobs instanceof AcpError) {
        // Handle API errors gracefully
        const errorMsg = activeJobs.message || String(activeJobs);
        if (errorMsg.includes("Failed to fetch") || errorMsg.includes("Failed to parse")) {
          console.warn(`[Evaluator] API error during cleanup (will retry):`, errorMsg);
          return;
        }
        return;
      }

      if (!activeJobs) {
        return;
      }

      const activeJobIds = new Set(activeJobs.map(job => job.id));
      
      this.cleanupEvidence(activeJobIds);
      this.cleanupJobMappings(activeJobIds);
      this.enforceEvidenceSizeLimit(activeJobIds);
      
      // Clean up seller job tracking for jobs that are no longer active
      this.cleanupSellerJobTracking(activeJobIds);
    } catch (error: any) {
      // Handle API errors gracefully
      if (error?.message?.includes("Failed to fetch") || 
          error?.message?.includes("Failed to parse") ||
          error?.message?.includes("Unexpected token")) {
        console.warn(`[Evaluator] API error during cleanup (will retry):`, error.message);
      } else {
        handleApiError(error, "cleanup");
      }
    }
  }

  /**
   * Clean up seller job tracking for jobs that are no longer active
   */
  private cleanupSellerJobTracking(activeJobIds: Set<number>): void {
    let cleaned = 0;
    
    // Clean up seller job status tracking
    for (const [sellerJobId] of this.sellerJobStatus) {
      if (!activeJobIds.has(sellerJobId)) {
        this.sellerJobStatus.delete(sellerJobId);
        this.sellerJobInitiatedAt.delete(sellerJobId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[Evaluator] Cleaned up ${cleaned} seller job tracking entries`);
    }
  }

  private cleanupEvidence(activeJobIds: Set<number>): void {
    let cleaned = 0;
    for (const [jobId] of this.evaluationEvidence) {
      if (!activeJobIds.has(jobId)) {
        this.evaluationEvidence.delete(jobId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[Evaluator] Cleaned up ${cleaned} evidence entries`);
    }
  }

  private cleanupJobMappings(activeJobIds: Set<number>): void {
    let cleanedBuyer = 0;
    let cleanedSeller = 0;

    for (const [buyerJobId, sellerJobIds] of this.buyerJobToSellerJob) {
      if (!activeJobIds.has(buyerJobId)) {
        sellerJobIds.forEach(id => this.sellerJobToBuyerJob.delete(id));
        this.buyerJobToSellerJob.delete(buyerJobId);
        cleanedBuyer++;
      }
    }

    for (const [sellerJobId, buyerJobId] of this.sellerJobToBuyerJob) {
      if (!activeJobIds.has(sellerJobId)) {
        this.sellerJobToBuyerJob.delete(sellerJobId);
        const sellerJobIds = this.buyerJobToSellerJob.get(buyerJobId);
        if (sellerJobIds) {
          const index = sellerJobIds.indexOf(sellerJobId);
          if (index > -1) {
            sellerJobIds.splice(index, 1);
            if (sellerJobIds.length === 0) {
              this.buyerJobToSellerJob.delete(buyerJobId);
            }
          }
        }
        cleanedSeller++;
      }
    }

    if (cleanedBuyer > 0 || cleanedSeller > 0) {
      console.log(`[Evaluator] Cleaned up ${cleanedBuyer} buyer mappings, ${cleanedSeller} seller mappings`);
    }
  }

  private enforceEvidenceSizeLimit(activeJobIds: Set<number>): void {
    if (this.evaluationEvidence.size <= VALIDATION.MAX_EVIDENCE_ENTRIES) {
      return;
    }

    const entriesToRemove = this.evaluationEvidence.size - VALIDATION.MAX_EVIDENCE_ENTRIES;
    let removedCount = 0;

    for (const [jobId] of this.evaluationEvidence) {
      if (removedCount >= entriesToRemove) break;
      if (!activeJobIds.has(jobId)) {
        this.evaluationEvidence.delete(jobId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log(`[Evaluator] Removed ${removedCount} oldest evidence entries to enforce size limit`);
    }
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  getEvaluationEvidence(jobId: number): EvaluationEvidence | undefined {
    return this.evaluationEvidence.get(jobId);
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function evaluator() {
  try {
    const graduationEvaluator = new GraduationEvaluator();
    await graduationEvaluator.initialize();
    
    console.log("[Evaluator] Graduation evaluator is running and ready to process requests");
    console.log("[Evaluator] Waiting for graduation evaluation requests...");
  } catch (error) {
    console.error("[Evaluator] Failed to initialize evaluator:", error);
    process.exit(1);
  }
}

evaluator();

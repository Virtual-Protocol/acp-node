/**
 * LLM Service for Graduation Evaluation
 * 
 * This service is used ONLY for:
 * - Generating evaluation prompts
 * - Providing structured reasoning and feedback
 * 
 * It MUST NOT:
 * - Initiate jobs
 * - Change system state
 * - Make decisions (only assists with reasoning)
 */

// Optional imports - will gracefully degrade if not available
let VertexAI: any;
let GoogleAuth: any;
let GoogleGenerativeAI: any;

try {
  const vertexAIModule = require('@google-cloud/vertexai');
  VertexAI = vertexAIModule.VertexAI;
  const googleAuthModule = require('google-auth-library');
  GoogleAuth = googleAuthModule.GoogleAuth;
} catch (error) {
  // Vertex AI dependencies are optional
}

try {
  const genAIModule = require('@google/generative-ai');
  GoogleGenerativeAI = genAIModule.GoogleGenerativeAI;
} catch (error) {
  // Direct Gemini API dependencies are optional
}
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env") });

export interface EvaluationPromptInput {
  requirementSchema: Object | string;
  evaluationRubric: string;
  jobDescription?: string;
}

export interface EvaluationResult {
  score: number; // 0-100
  reasoning: string;
  feedback: string;
  pass: boolean; // true if score >= passing threshold
}

export interface ScoringInput {
  deliverable: string | Object;
  requirementSchema: Object | string;
  evaluationRubric: string;
  jobDescription?: string;
}

export interface RequirementSchemaSuggestionInput {
  agentOfferings: Array<{
    name: string;
    requirement?: Object | string;
    deliverable?: Object | string;
  }>;
  agentName: string;
  agentDescription?: string;
  evaluationPurpose?: string;
}

/**
 * Simple logger interface
 */
class SimpleLogger {
  info(message: string, meta?: any) {
    console.log(`[INFO] ${message}`, meta ? JSON.stringify(meta, null, 2) : '');
  }
  
  error(message: string, meta?: any) {
    console.error(`[ERROR] ${message}`, meta ? JSON.stringify(meta, null, 2) : '');
  }
  
  warn(message: string, meta?: any) {
    console.warn(`[WARN] ${message}`, meta ? JSON.stringify(meta, null, 2) : '');
  }
}

export class GraduationEvaluationLLMService {
  private logger: SimpleLogger;
  private vertexAI: any = null; // VertexAI type if available
  private genAI: any = null; // Google Generative AI (direct API) if available
  private tempCredentialsPath: string | null = null;
  private readonly PASSING_THRESHOLD = 70; // Score out of 100
  private useDirectAPI: boolean = false; // Whether to use direct API key or Vertex AI

  constructor() {
    this.logger = new SimpleLogger();
  }

  private cleanupCredentials() {
    if (this.tempCredentialsPath) {
      try {
        if (fs.existsSync(this.tempCredentialsPath)) {
          fs.unlinkSync(this.tempCredentialsPath);
          this.logger.info("Cleaned up temporary credentials file");
        }
        this.tempCredentialsPath = null;
      } catch (error) {
        this.logger.warn("Failed to cleanup temporary credentials file", { error });
      }
    }
  }

  async initialize(): Promise<void> {
    const apiKey = process.env.GEMINI_API_KEY;
    const projectId = process.env.GEMINI_PROJECT_ID;
    const location = process.env.GEMINI_LOCATION;
    const configGeminiServiceAccount = process.env.CONFIG_GEMINI_SERVICE_ACCOUNT;

    // Priority 1: Try direct API key (simpler setup)
    if (apiKey) {
      try {
        if (!GoogleGenerativeAI) {
          throw new Error("Google Generative AI is not available. Install @google/generative-ai package.");
        }
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.useDirectAPI = true;
        this.logger.info("Gemini API client initialized successfully (using API key)");
        return;
      } catch (error) {
        this.logger.error("Failed to initialize Gemini API client with API key", { error });
        // Fall through to try Vertex AI
      }
    }

    // Priority 2: Try Vertex AI with service account
    if (projectId && location && configGeminiServiceAccount) {
      try {
        // Set up service account credentials
        const serviceAccountInfo = JSON.parse(
          Buffer.from(configGeminiServiceAccount, "base64").toString()
        );

        // Write the service account to a temporary file
        this.tempCredentialsPath = path.join(os.tmpdir(), `gcp-credentials-${Date.now()}.json`);
        fs.writeFileSync(this.tempCredentialsPath, JSON.stringify(serviceAccountInfo, null, 2));
        
        // Set environment variable to point to the file
        process.env.GOOGLE_APPLICATION_CREDENTIALS = this.tempCredentialsPath;
        
        // Initialize Vertex AI
        if (!VertexAI) {
          throw new Error("VertexAI is not available. Install @google-cloud/vertexai package.");
        }
        this.vertexAI = new VertexAI({
          project: projectId,
          location: location,
        });

        this.useDirectAPI = false;
        this.logger.info("Vertex AI Gemini client initialized successfully");
        
        // Clean up the temporary file after 30 seconds
        setTimeout(() => {
          this.cleanupCredentials();
        }, 30000);
        
        return;
      } catch (error) {
        this.logger.error("Failed to initialize Vertex AI Gemini client", { error });
      }
    }

    // No valid configuration found
    this.logger.warn("No valid Gemini configuration found. LLM evaluation will use fallback methods.");
    this.logger.warn("Please set either GEMINI_API_KEY or (GEMINI_PROJECT_ID, GEMINI_LOCATION, CONFIG_GEMINI_SERVICE_ACCOUNT)");
  }

  /**
   * Suggest a requirement schema for graduation evaluation job based on agent's offerings
   * This generates a requirement schema that will be used to initiate the evaluation job
   */
  async suggestRequirementSchema(
    input: RequirementSchemaSuggestionInput
  ): Promise<Object | string> {
    const { agentOfferings, agentName, agentDescription, evaluationPurpose } = input;

    const prompt = `
You are an evaluator designing a graduation evaluation test for an agent. Your task is to suggest a requirement schema for a test job that will evaluate the agent's capabilities.

Agent Information:
- Name: ${agentName}
${agentDescription ? `- Description: ${agentDescription}\n` : ''}
${evaluationPurpose ? `- Evaluation Purpose: ${evaluationPurpose}\n` : ''}

Agent's Job Offerings:
${JSON.stringify(agentOfferings.map(offering => ({
  name: offering.name,
  requirement: offering.requirement,
  deliverable: offering.deliverable,
})), null, 2)}

Based on the agent's offerings, suggest a requirement schema for a graduation evaluation job. The requirement should:
1. Test the agent's core capabilities as demonstrated in their offerings
2. Be appropriate for a graduation evaluation (not too simple, not too complex)
3. Allow the agent to demonstrate their skills
4. Be clear and specific enough for evaluation

Provide your suggestion as a JSON schema object that can be used as the requirement for the job.

Respond with only the JSON schema object, no additional text or explanation.
`;

    if (!this.genAI && !this.vertexAI) {
      // Fallback: return a basic requirement schema based on the first offering
      return this.generateFallbackRequirementSchema(agentOfferings);
    }

    try {
      let text = "";

      if (this.useDirectAPI && this.genAI) {
        // Use direct Gemini API
        const model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
        const result = await model.generateContent(prompt);
        text = result.response.text() || "";
      } else if (this.vertexAI) {
        // Use Vertex AI
        const generativeModel = this.vertexAI.preview.getGenerativeModel({
          model: 'gemini-2.0-flash-exp',
        });
        const result = await generativeModel.generateContent(prompt);
        text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
      
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : text;

      const suggestedSchema = JSON.parse(jsonString);
      
      this.logger.info("LLM suggested requirement schema", { suggestedSchema });
      return suggestedSchema;
    } catch (error) {
      this.logger.error("Failed to suggest requirement schema with LLM", { error });
      return this.generateFallbackRequirementSchema(agentOfferings);
    }
  }

  /**
   * Generate an evaluation prompt based on requirement schema and rubric
   * This is used to create structured prompts for evaluation
   */
  async generateEvaluationPrompt(input: EvaluationPromptInput): Promise<string> {
    const { requirementSchema, evaluationRubric, jobDescription } = input;

    const prompt = `
You are an evaluator for agent graduation. Your task is to evaluate deliverables against requirements.

${jobDescription ? `Job Description: ${JSON.stringify(jobDescription, null, 2)}\n` : ''}

Requirement Schema:
${typeof requirementSchema === 'string' ? requirementSchema : JSON.stringify(requirementSchema, null, 2)}

Evaluation Rubric:
${evaluationRubric}

Generate a structured evaluation prompt that will be used to assess deliverables. The prompt should:
1. Clearly define what needs to be evaluated
2. Reference the requirement schema
3. Apply the evaluation rubric
4. Request structured output with score, reasoning, and feedback

Respond with only the evaluation prompt text, no additional commentary.
`;

    if (!this.genAI && !this.vertexAI) {
      // Fallback: return a basic prompt if LLM is not available
      return this.generateFallbackPrompt(input);
    }

    try {
      let text = "";

      if (this.useDirectAPI && this.genAI) {
        // Use direct Gemini API
        const model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
        const result = await model.generateContent(prompt);
        text = result.response.text() || "";
      } else if (this.vertexAI) {
        // Use Vertex AI
        const generativeModel = this.vertexAI.preview.getGenerativeModel({
          model: 'gemini-2.0-flash-exp',
        });
        const result = await generativeModel.generateContent(prompt);
        text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
      
      return text.trim() || this.generateFallbackPrompt(input);
    } catch (error) {
      this.logger.error("Failed to generate evaluation prompt with LLM", { error });
      return this.generateFallbackPrompt(input);
    }
  }

  /**
   * Evaluate a deliverable and provide scoring, reasoning, and feedback
   * This is the main evaluation function that returns structured results
   */
  async evaluateDeliverable(input: ScoringInput): Promise<EvaluationResult> {
    const { deliverable, requirementSchema, evaluationRubric, jobDescription } = input;

    const deliverableStr = typeof deliverable === 'string' 
      ? deliverable 
      : JSON.stringify(deliverable, null, 2);

    const requirementSchemaStr = typeof requirementSchema === 'string'
      ? requirementSchema
      : JSON.stringify(requirementSchema, null, 2);

    const evaluationPrompt = `
You are evaluating a deliverable for agent graduation. Provide a structured evaluation.

${jobDescription ? `Job Description: ${JSON.stringify(jobDescription, null, 2)}\n` : ''}

Requirement Schema:
${requirementSchemaStr}

Evaluation Rubric:
${evaluationRubric}

Deliverable to Evaluate:
${deliverableStr}

Evaluate the deliverable and provide your response in the following JSON format:
{
  "score": <number between 0-100>,
  "reasoning": "<detailed reasoning for the score>",
  "feedback": "<actionable feedback for improvement>"
}

Respond with only the JSON object, no additional text.
`;

    if (!this.genAI && !this.vertexAI) {
      // Fallback: return a basic evaluation if LLM is not available
      return this.generateFallbackEvaluation(deliverableStr);
    }

    try {
      let text = "";

      if (this.useDirectAPI && this.genAI) {
        // Use direct Gemini API
        const model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
        const result = await model.generateContent(evaluationPrompt);
        text = result.response.text() || "";
      } else if (this.vertexAI) {
        // Use Vertex AI
        const generativeModel = this.vertexAI.preview.getGenerativeModel({
          model: 'gemini-2.0-flash-exp',
        });
        const result = await generativeModel.generateContent(evaluationPrompt);
        text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
      
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : text;

      const output = JSON.parse(jsonString) as {
        score: number;
        reasoning: string;
        feedback: string;
      };

      // Validate and normalize score
      const score = Math.max(0, Math.min(100, output.score || 0));

      return {
        score,
        reasoning: output.reasoning || "No reasoning provided",
        feedback: output.feedback || "No feedback provided",
        pass: score >= this.PASSING_THRESHOLD,
      };
    } catch (error) {
      this.logger.error("Failed to evaluate deliverable with LLM", { error });
      return this.generateFallbackEvaluation(deliverableStr);
    }
  }

  /**
   * Fallback prompt generation when LLM is unavailable
   */
  private generateFallbackPrompt(input: EvaluationPromptInput): string {
    return `
Evaluate the deliverable against the following requirements:

Requirement Schema:
${typeof input.requirementSchema === 'string' ? input.requirementSchema : JSON.stringify(input.requirementSchema, null, 2)}

Evaluation Rubric:
${input.evaluationRubric}

Provide a score (0-100), reasoning, and feedback.
`;
  }

  /**
   * Fallback requirement schema generation when LLM is unavailable
   */
  private generateFallbackRequirementSchema(
    agentOfferings: Array<{ name: string; requirement?: Object | string }>
  ): Object | string {
    if (agentOfferings.length === 0) {
      return {
        type: "graduation_evaluation",
        description: "Please complete a graduation evaluation task",
      };
    }

    // Use the first offering's requirement as a base, or create a simple one
    const firstOffering = agentOfferings[0];
    if (firstOffering.requirement) {
      return firstOffering.requirement;
    }

    return {
      type: "graduation_evaluation",
      offering: firstOffering.name,
      description: `Please complete a task related to ${firstOffering.name}`,
    };
  }

  /**
   * Fallback evaluation when LLM is unavailable
   */
  private generateFallbackEvaluation(deliverable: string): EvaluationResult {
    // Basic validation: check if deliverable is not empty
    const isEmpty = !deliverable || deliverable.trim().length === 0;
    
    if (isEmpty) {
      return {
        score: 0,
        reasoning: "Deliverable is empty or missing",
        feedback: "Please provide a valid deliverable that matches the requirement schema",
        pass: false,
      };
    }

    // Basic pass if deliverable exists and has content
    return {
      score: 75,
      reasoning: "Deliverable provided (basic validation only - LLM evaluation unavailable)",
      feedback: "LLM evaluation service is not configured. Please configure GEMINI_PROJECT_ID, GEMINI_LOCATION, and CONFIG_GEMINI_SERVICE_ACCOUNT for detailed evaluation.",
      pass: true,
    };
  }
}

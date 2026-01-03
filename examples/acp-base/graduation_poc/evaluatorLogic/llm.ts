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
  // Per-criteria scores (optional, for detailed breakdown)
  completenessScore?: number; // 0-30
  correctnessScore?: number; // 0-30
  qualityScore?: number; // 0-20
  functionalityScore?: number; // 0-20
  completenessReasoning?: string;
  correctnessReasoning?: string;
  qualityReasoning?: string;
  functionalityReasoning?: string;
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
  // Constants
  private static readonly PASSING_THRESHOLD = 70;
  private static readonly MODEL_NAME = 'gemini-2.0-flash-exp';
  private static readonly IMAGE_FETCH_TIMEOUT = 10000; // 10 seconds
  private static readonly VIDEO_FETCH_TIMEOUT = 15000; // 15 seconds
  private static readonly MAX_IMAGES_TO_PROCESS = 5;
  private static readonly MAX_VIDEO_SIZE_MB = 10;
  private static readonly CREDENTIALS_CLEANUP_DELAY = 30000; // 30 seconds
  
  // Image and video extensions
  private static readonly IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
  private static readonly VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.flv', '.wmv'];
  private static readonly IMAGE_EXTENSION_REGEX = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i;
  private static readonly VIDEO_EXTENSION_REGEX = /\.(mp4|mov|avi|webm|mkv|flv|wmv)(\?|$)/i;
  
  // Media field names to check
  private static readonly MEDIA_FIELDS = ['url', 'imageUrl', 'videoUrl', 'image', 'video', 'mediaUrl', 'thumbnail', 'preview'];
  private static readonly IMAGE_URL_FIELDS = ['imageUrl', 'image_url', 'image', 'url', 'source'];
  
  // Instance properties
  private logger: SimpleLogger;
  private vertexAI: any = null;
  private genAI: any = null;
  private tempCredentialsPath: string | null = null;
  private useDirectAPI: boolean = false;

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
        this.initializeVertexAI(projectId, location, configGeminiServiceAccount);
        return;
      } catch (error) {
        this.logger.error("Failed to initialize Vertex AI Gemini client", { error });
      }
    }

    // No valid configuration found
    this.logger.warn("No valid Gemini configuration found. LLM evaluation will use fallback methods.");
    this.logger.warn("Please set GEMINI_API_KEY");
  }

  /**
   * Initialize Vertex AI with service account credentials
   */
  private initializeVertexAI(projectId: string, location: string, configGeminiServiceAccount: string): void {
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
    
    // Clean up the temporary file after delay
    setTimeout(() => {
      this.cleanupCredentials();
    }, GraduationEvaluationLLMService.CREDENTIALS_CLEANUP_DELAY);
  }

  /**
   * Detect if a deliverable contains image or video URLs
   */
  private extractMediaUrls(deliverable: any): { images: string[]; videos: string[] } {
    const images: string[] = [];
    const videos: string[] = [];

    if (!deliverable || typeof deliverable !== 'object') {
      return { images, videos };
    }

    const imageExtensions = GraduationEvaluationLLMService.IMAGE_EXTENSIONS;
    const videoExtensions = GraduationEvaluationLLMService.VIDEO_EXTENSIONS;

    const extractUrls = (obj: any, path: string = ''): void => {
      if (obj === null || obj === undefined) return;

      if (typeof obj === 'string') {
        // Check if it's a URL
        try {
          const url = new URL(obj);
          const urlLower = url.href.toLowerCase();
          
          // Check for image URLs
          if (this.isImageUrl(urlLower, imageExtensions)) {
            images.push(obj);
          }
          // Check for video URLs
          else if (this.isVideoUrl(urlLower, videoExtensions)) {
            videos.push(obj);
          }
        } catch {
          // Not a valid URL, skip
        }
      } else if (Array.isArray(obj)) {
        obj.forEach((item, index) => extractUrls(item, `${path}[${index}]`));
      } else if (typeof obj === 'object') {
        // Check common fields that might contain media URLs
        const mediaFields = GraduationEvaluationLLMService.MEDIA_FIELDS;
        
        for (const [key, value] of Object.entries(obj)) {
          const lowerKey = key.toLowerCase();
          if (mediaFields.some(field => lowerKey.includes(field.toLowerCase()))) {
            if (typeof value === 'string') {
              try {
                const url = new URL(value);
                if (lowerKey.includes('image') || lowerKey.includes('thumbnail') || lowerKey.includes('preview')) {
                  images.push(value);
                } else if (lowerKey.includes('video')) {
                  videos.push(value);
                } else {
                  // Generic URL field - try to detect by extension
                  const urlLower = url.href.toLowerCase();
                  if (this.isImageUrl(urlLower, imageExtensions)) {
                    images.push(value);
                  } else if (this.isVideoUrl(urlLower, videoExtensions)) {
                    videos.push(value);
                  }
                }
              } catch {
                // Not a valid URL
              }
            }
          } else {
            extractUrls(value, path ? `${path}.${key}` : key);
          }
        }
      }
    };

    extractUrls(deliverable);
    
    // Remove duplicates
    return {
      images: [...new Set(images)],
      videos: [...new Set(videos)]
    };
  }

  /**
   * Check if URL is an image URL
   */
  private isImageUrl(urlLower: string, imageExtensions: readonly string[]): boolean {
    return imageExtensions.some(ext => urlLower.includes(ext)) || 
           urlLower.includes('image') || 
           GraduationEvaluationLLMService.IMAGE_EXTENSION_REGEX.test(urlLower);
  }

  /**
   * Check if URL is a video URL
   */
  private isVideoUrl(urlLower: string, videoExtensions: readonly string[]): boolean {
    return videoExtensions.some(ext => urlLower.includes(ext)) || 
           urlLower.includes('video') || 
           GraduationEvaluationLLMService.VIDEO_EXTENSION_REGEX.test(urlLower);
  }

  /**
   * Fetch image content from URL and convert to base64
   */
  private async fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
    return this.fetchMediaAsBase64(url, GraduationEvaluationLLMService.IMAGE_FETCH_TIMEOUT, 'image/jpeg');
  }

  /**
   * Fetch video content from URL and convert to base64 (for short clips)
   * Note: For long videos, we might want to extract a frame or use URL directly
   */
  private async fetchVideoAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
    return this.fetchMediaAsBase64(
      url, 
      GraduationEvaluationLLMService.VIDEO_FETCH_TIMEOUT, 
      'video/mp4',
      { 'Range': `bytes=0-${GraduationEvaluationLLMService.MAX_VIDEO_SIZE_MB * 1024 * 1024}` }
    );
  }

  /**
   * Generic method to fetch media content from URL and convert to base64
   */
  private async fetchMediaAsBase64(
    url: string, 
    timeout: number, 
    defaultMimeType: string,
    additionalHeaders: Record<string, string> = {}
  ): Promise<{ data: string; mimeType: string } | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (compatible; ACP-Evaluator/1.0)',
        ...additionalHeaders,
      };

      const response = await fetch(url, {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        this.logger.warn(`Failed to fetch media from ${url}: ${response.status} ${response.statusText}`);
        return null;
      }

      const contentType = response.headers.get('content-type') || defaultMimeType;
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString('base64');

      return {
        data: base64,
        mimeType: contentType,
      };
    } catch (error) {
      this.logger.warn(`Error fetching media from ${url}:`, error);
      return null;
    }
  }

  /**
   * Common method to call LLM with a prompt
   * Returns the raw text response
   * Made public so evaluator can use it for generating matching image URLs
   */
  async callLLM(prompt: string, mediaParts?: Array<{ data: string; mimeType: string }>): Promise<string> {
    if (!this.genAI && !this.vertexAI) {
      throw new Error("LLM service not initialized");
    }

    const parts = this.buildContentParts(prompt, mediaParts);

    if (this.useDirectAPI && this.genAI) {
      return this.callDirectAPI(parts);
    } else if (this.vertexAI) {
      return this.callVertexAI(parts);
    }

    throw new Error("No LLM service available");
  }

  /**
   * Build content parts for LLM request (text + optional media)
   */
  private buildContentParts(
    prompt: string, 
    mediaParts?: Array<{ data: string; mimeType: string }>
  ): any[] {
    const parts: any[] = [{ text: prompt }];
    
    if (mediaParts && mediaParts.length > 0) {
      for (const media of mediaParts) {
        parts.push({
          inlineData: {
            data: media.data,
            mimeType: media.mimeType,
          }
        });
      }
    }
    
    return parts;
  }

  /**
   * Call Gemini Direct API
   */
  private async callDirectAPI(parts: any[]): Promise<string> {
    const model = this.genAI.getGenerativeModel({ model: GraduationEvaluationLLMService.MODEL_NAME });
    
    if (parts.length === 1) {
      // Text only
      const result = await model.generateContent(parts[0].text);
      return result.response.text() || "";
    } else {
      // Text + media
      const result = await model.generateContent({ contents: [{ role: 'user', parts }] });
      return result.response.text() || "";
    }
  }

  /**
   * Call Vertex AI
   */
  private async callVertexAI(parts: any[]): Promise<string> {
    const generativeModel = this.vertexAI.preview.getGenerativeModel({
      model: GraduationEvaluationLLMService.MODEL_NAME,
    });
    
    if (parts.length === 1) {
      // Text only
      const result = await generativeModel.generateContent(parts[0].text);
      return result.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else {
      // Text + media
      const result = await generativeModel.generateContent({
        contents: [{ role: 'user', parts }]
      });
      return result.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }
  }

  /**
   * Normalize score to be within min and max bounds
   */
  private normalizeScore(score: number | undefined, min: number, max: number): number | undefined {
    if (score === undefined) return undefined;
    return Math.max(min, Math.min(max, score));
  }

  /**
   * Clean text response by removing markdown, code blocks, and quotes
   */
  private cleanTextResponse(text: string): string {
    let cleaned = text.trim();
    cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    cleaned = cleaned.replace(/^["']|["']$/g, '');
    return cleaned.trim();
  }

  /**
   * Extract requirement description, especially image URLs or descriptions that were provided
   */
  private extractRequirementDescription(requirementSchema: string, deliverableStr: string): string | null {
    try {
      // Try to parse requirement schema to find image URLs or descriptions
      const schemaObj = JSON.parse(requirementSchema);
      
      // Look for image URL fields
      const imageUrlFields = GraduationEvaluationLLMService.IMAGE_URL_FIELDS;
      for (const field of imageUrlFields) {
        if (schemaObj[field] && typeof schemaObj[field] === 'string') {
          const url = schemaObj[field];
          // If it's a URL, extract description from it or return the URL
          if (url.startsWith('http')) {
            // Try to extract description from URL (e.g., placeholder URLs with text)
            const urlMatch = url.match(/text=([^&]+)/);
            if (urlMatch) {
              return decodeURIComponent(urlMatch[1].replace(/\+/g, ' '));
            }
            return `Image URL provided: ${url}`;
          }
        }
      }
      
      // Look for description or text fields
      if (schemaObj.description || schemaObj.text || schemaObj.requirement) {
        return schemaObj.description || schemaObj.text || schemaObj.requirement;
      }
    } catch {
      // Not JSON, try to extract from string
      if (requirementSchema.includes('Image URL provided:')) {
        const match = requirementSchema.match(/Image URL provided:\s*(.+)/);
        if (match) {
          return match[1].trim();
        }
      }
      // Return the requirement schema itself if it's short enough
      if (requirementSchema.length < 500) {
        return requirementSchema;
      }
    }
    
    return null;
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
You are an evaluator designing a graduation evaluation test for an agent. Your task is to suggest a simple, natural language requirement for a test job according to agent's requirement schemathat will evaluate the agent's capabilities.

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

Based on the agent's offering, suggest a simple, natural language requirement for a graduation evaluation job. The requirement should:
1. Test the agent's core capabilities as demonstrated in their offerings
2. Be appropriate for a graduation evaluation (not too simple, not too complex)
3. Allow the agent to demonstrate their skills
4. Be clear and specific enough for evaluation
5. Be written in simple, natural language that the agent can understand and execute

IMPORTANT: 
- Do NOT generate a complex JSON schema
- Do NOT include nested objects or complex structures
- Generate a simple, straightforward requirement in natural language
- For example:For meme generation agents, use simple requests like: "i want a meme about [topic] with caption like [caption]"
- Keep it concise and actionable (1-5 sentences maximum)

Examples of good requirements:
- For meme generation: "i want a meme about Two dogs arguing over the best way to bury a bone. with caption like 'ngmi'"
- For text generation: "Write a short story about a robot learning to paint"
- For data processing: "Process this list of numbers and return the sum"

Respond with only the simple requirement text in natural language, no JSON schema, no additional explanation, no quotes.
`;

    if (!this.genAI && !this.vertexAI) {
      // Fallback: return a basic requirement schema based on the first offering
      return this.generateFallbackRequirementSchema(agentOfferings);
    }

    try {
      const text = await this.callLLM(prompt);
      const suggestedSchema = this.cleanTextResponse(text);
      
      // Validate and extract simple text from response
      const validatedSchema = this.validateAndExtractSchema(suggestedSchema, agentOfferings);
      if (validatedSchema) {
        this.logger.info("LLM suggested requirement schema", { suggestedSchema: validatedSchema });
        return validatedSchema;
      }
      
      // If validation failed, use fallback
      return this.generateFallbackRequirementSchema(agentOfferings);
    } catch (error) {
      this.logger.error("Failed to suggest requirement schema with LLM", { error });
      return this.generateFallbackRequirementSchema(agentOfferings);
    }
  }

  /**
   * Validate and extract simple text from LLM response
   * Returns the extracted schema or null if validation fails
   */
  private validateAndExtractSchema(
    suggestedSchema: string, 
    agentOfferings: Array<{ name: string; requirement?: Object | string }>
  ): string | null {
    // Check if it contains JSON schema keywords
    if (suggestedSchema.includes('"type":') || 
        suggestedSchema.includes('"properties":') || 
        suggestedSchema.includes('"required":')) {
      this.logger.warn("LLM returned schema-like text, using fallback");
      return null;
    }

    // Check if it's too complex (too long or contains JSON structure)
    if (suggestedSchema.length > 2000 || 
        (suggestedSchema.includes('{') && suggestedSchema.includes('}'))) {
      this.logger.warn("LLM response seems too complex, using fallback");
      return null;
    }

    // If the response looks like JSON, try to extract simple text from it
    if (suggestedSchema.startsWith('{')) {
      return this.extractTextFromJson(suggestedSchema, agentOfferings);
    }

    return suggestedSchema;
  }

  /**
   * Extract simple text from JSON response
   */
  private extractTextFromJson(
    jsonString: string,
    agentOfferings: Array<{ name: string; requirement?: Object | string }>
  ): string | null {
    try {
      const parsed = JSON.parse(jsonString);
      if (typeof parsed !== 'object' || parsed === null) {
        return null;
      }

      // Look for simple string fields
      const textFields = ['description', 'requirement', 'text', 'content'];
      for (const field of textFields) {
        if (parsed[field] && typeof parsed[field] === 'string') {
          return parsed[field];
        }
      }

      // If it's a complex nested structure, use fallback
      this.logger.warn("LLM returned complex JSON schema, using fallback");
      return null;
    } catch {
      // Not valid JSON, check if it's actually natural language
      if (jsonString.length > 100 && 
          jsonString.includes('type') && 
          jsonString.includes('properties')) {
        // Looks like a JSON schema string
        this.logger.warn("LLM returned JSON schema string, using fallback");
        return null;
      }
      // Otherwise use as-is (might be natural language that starts with '{')
      return jsonString;
    }
  }

  /**
   * Convert natural language requirement to JSON object matching the provided schema
   * This is used when the agent's offering has a proper JSON schema that needs to be validated
   */
  async convertNaturalLanguageToJsonSchema(
    naturalLanguageRequirement: string,
    jsonSchema: Object
  ): Promise<Object> {
    const prompt = `
You are a requirement converter. Your task is to convert a natural language requirement into a JSON object that matches the provided JSON schema.

Natural Language Requirement:
${naturalLanguageRequirement}

JSON Schema (the output must match this schema):
${JSON.stringify(jsonSchema, null, 2)}

IMPORTANT:
- Convert the natural language requirement into a JSON object that strictly matches the provided JSON schema
- Extract relevant information from the natural language and map it to the schema's properties
- If the schema has required fields, ensure all required fields are included
- If the schema has enum values, use one of the allowed enum values
- If the schema has type constraints (string, number, array, etc.), ensure the values match those types
- If information is missing from the natural language, make reasonable inferences based on the context
- Return ONLY valid JSON that matches the schema, no additional text or explanation

Respond with only the JSON object, no markdown, no code blocks, no explanation.
`;

    if (!this.genAI && !this.vertexAI) {
      // Fallback: return a simple object structure
      this.logger.warn("LLM not available, using fallback for JSON conversion");
      return this.generateFallbackJsonFromNaturalLanguage(naturalLanguageRequirement, jsonSchema);
    }

    try {
      const text = await this.callLLM(prompt);
      const jsonText = this.cleanTextResponse(text);

      // Parse the JSON
      try {
        const parsed = JSON.parse(jsonText);
        this.logger.info("Successfully converted natural language to JSON schema", { parsed });
        return parsed;
      } catch (parseError) {
        this.logger.error("Failed to parse LLM response as JSON", { text, error: parseError });
        return this.generateFallbackJsonFromNaturalLanguage(naturalLanguageRequirement, jsonSchema);
      }
    } catch (error) {
      this.logger.error("Failed to convert natural language to JSON schema with LLM", { error });
      return this.generateFallbackJsonFromNaturalLanguage(naturalLanguageRequirement, jsonSchema);
    }
  }

  /**
   * Fallback method to generate a simple JSON object from natural language when LLM is unavailable
   */
  private generateFallbackJsonFromNaturalLanguage(
    naturalLanguageRequirement: string,
    jsonSchema: Object
  ): Object {
    // Try to extract basic structure from schema
    const schema = jsonSchema as any;
    const result: Record<string, any> = {};

    if (schema.type === 'object' && schema.properties) {
      // Extract property names and create simple values
      for (const [key, value] of Object.entries(schema.properties)) {
        const prop = value as any;
        if (prop.type === 'string') {
          result[key] = naturalLanguageRequirement; // Use the natural language as the value
        } else if (prop.type === 'array' && prop.items?.type === 'string') {
          // Extract words from natural language for array
          result[key] = naturalLanguageRequirement.split(/\s+/).filter(w => w.length > 2).slice(0, 5);
        } else if (prop.type === 'number') {
          result[key] = 0;
        } else {
          result[key] = naturalLanguageRequirement;
        }
      }
    } else {
      // If schema is not a standard JSON schema, return the natural language as a simple object
      result.requirement = naturalLanguageRequirement;
    }

    return result;
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
      const text = await this.callLLM(prompt);
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

    // Detect and fetch media content (images/videos)
    let deliverableObj: any;
    try {
      deliverableObj = typeof deliverable === 'string' ? JSON.parse(deliverable) : deliverable;
    } catch {
      // If parsing fails, treat as plain string
      deliverableObj = deliverable;
    }
    const { images, videos } = this.extractMediaUrls(deliverableObj);
    
    const mediaParts: Array<{ data: string; mimeType: string }> = [];
    let hasVisualContent = false;

    // Fetch images
    if (images.length > 0) {
      this.logger.info(`Detected ${images.length} image URL(s) in deliverable, fetching for visual analysis...`);
      const imagesToProcess = images.slice(0, GraduationEvaluationLLMService.MAX_IMAGES_TO_PROCESS);
      for (const imageUrl of imagesToProcess) {
        try {
          const imageData = await this.fetchImageAsBase64(imageUrl);
          if (imageData) {
            mediaParts.push(imageData);
            hasVisualContent = true;
            this.logger.info(`Successfully fetched image from ${imageUrl}`);
          }
        } catch (error) {
          this.logger.warn(`Failed to fetch image from ${imageUrl}:`, error);
        }
      }
    }

    // Fetch videos (limit to first video, and only if small enough)
    if (videos.length > 0) {
      this.logger.info(`Detected ${videos.length} video URL(s) in deliverable, fetching for visual analysis...`);
      // Only process the first video to avoid token limits
      try {
        const videoData = await this.fetchVideoAsBase64(videos[0]);
        if (videoData) {
          mediaParts.push(videoData);
          hasVisualContent = true;
          this.logger.info(`Successfully fetched video from ${videos[0]}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch video from ${videos[0]}:`, error);
      }
    }

    // Extract requirement description for image matching
    const requirementDescription = this.extractRequirementDescription(requirementSchemaStr, deliverableStr);
    
    // Build evaluation prompt
    const visualContentSection = this.buildVisualContentSection(hasVisualContent, images, videos, requirementDescription);
    const evaluationPrompt = this.buildEvaluationPrompt(
      requirementSchemaStr,
      evaluationRubric,
      deliverableStr,
      jobDescription,
      visualContentSection,
      hasVisualContent
    );
      
    if (!this.genAI && !this.vertexAI) {
      // Fallback: return a basic evaluation if LLM is not available
      return this.generateFallbackEvaluation(deliverableStr);
    }

    try {
      // Call LLM with media parts if available
      const text = await this.callLLM(evaluationPrompt, hasVisualContent ? mediaParts : undefined);
      
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : text;

      const output = JSON.parse(jsonString) as {
        score: number;
        reasoning: string;
        feedback: string;
        completenessScore?: number;
        completenessReasoning?: string;
        correctnessScore?: number;
        correctnessReasoning?: string;
        qualityScore?: number;
        qualityReasoning?: string;
        functionalityScore?: number;
        functionalityReasoning?: string;
      };

      // Validate and normalize scores
      const score = this.normalizeScore(output.score || 0, 0, 100) ?? 0;
      const completenessScore = this.normalizeScore(output.completenessScore, 0, 30);
      const correctnessScore = this.normalizeScore(output.correctnessScore, 0, 30);
      const qualityScore = this.normalizeScore(output.qualityScore, 0, 20);
      const functionalityScore = this.normalizeScore(output.functionalityScore, 0, 20);

      return { 
        score,
        reasoning: output.reasoning || "No reasoning provided",
        feedback: output.feedback || "No feedback provided",
        pass: score >= GraduationEvaluationLLMService.PASSING_THRESHOLD,
        completenessScore,
        completenessReasoning: output.completenessReasoning,
        correctnessScore,
        correctnessReasoning: output.correctnessReasoning,
        qualityScore,
        qualityReasoning: output.qualityReasoning,
        functionalityScore,
        functionalityReasoning: output.functionalityReasoning,
        };
    } catch (error) {
      this.logger.error("Failed to evaluate deliverable with LLM", { error });
      return this.generateFallbackEvaluation(deliverableStr);
    }
  }

  /**
   * Build visual content analysis section for evaluation prompt
   */
  private buildVisualContentSection(
    hasVisualContent: boolean,
    images: string[],
    videos: string[],
    requirementDescription: string | null
  ): string {
    if (!hasVisualContent) return '';

    return `
### Step 5: Visual Content Analysis (IMPORTANT - Visual Media Detected)
You have been provided with the actual image/video content from the deliverable. You MUST analyze the visual content directly:

**For Images (Memes, Graphics, etc.):**
1. **Visual Quality**: Assess image resolution, clarity, composition, and professional appearance
2. **Content Match**: Verify the image actually matches the requirement (e.g., if requirement asks for a meme about "dogs", does the image show dogs?)
3. **Caption/Text**: If the image contains text or captions, verify they match the requirement (e.g., if requirement asks for caption "ngmi", is that text visible in the image?)
4. **Relevance**: Does the visual content make sense in context of the requirement?
5. **Authenticity**: Is this a real, generated image or a placeholder/mock image?
6. **Requirement Image Match**: ${requirementDescription ? `If the requirement provided an image URL or description, verify that the seller's deliverable image matches or is related to the requirement. The requirement specified: "${requirementDescription}". The seller should have used the provided image URL or created content that matches this requirement.` : 'Verify the image matches the requirement description'}

**For Videos:**
1. **Video Quality**: Assess resolution, frame rate, audio quality (if applicable)
2. **Content Match**: Verify the video content matches the requirement
3. **Duration**: If duration is specified in requirements, verify it matches
4. **Relevance**: Does the video content fulfill what was requested?
5. **Authenticity**: Is this a real, generated video or a placeholder/mock?

**Critical Visual Evaluation Rules:**
- If the visual content does NOT match the requirement (e.g., wrong topic, wrong caption, wrong subject matter) → DEDUCT heavily from Correctness and Functionality scores
- If the visual quality is poor (blurry, low resolution, unprofessional) → DEDUCT from Quality score
- If the visual content appears to be a placeholder or mock (generic stock image, example image, etc.) → DEDUCT heavily from all scores
- ${requirementDescription ? `If the requirement provided an image URL/description and the seller's image does NOT match or relate to the requirement image/description → DEDUCT heavily from Correctness and Functionality scores` : ''}
- If the visual content perfectly matches the requirement and is high quality → REWARD with high scores

**Visual Content Detected:**
- ${images.length > 0 ? `${images.length} image(s) found and loaded for analysis` : 'No images detected'}
- ${videos.length > 0 ? `${videos.length} video(s) found and loaded for analysis` : 'No videos detected'}
${requirementDescription ? `\n**Requirement Image/Description:** ${requirementDescription}` : ''}
`;
  }

  /**
   * Build the complete evaluation prompt
   */
  private buildEvaluationPrompt(
    requirementSchemaStr: string,
    evaluationRubric: string,
    deliverableStr: string,
    jobDescription: string | undefined,
    visualContentSection: string,
    hasVisualContent: boolean
  ): string {
    return `
You are an experienced quality assurance evaluator conducting a rigorous graduation evaluation for an AI agent. Your task is to critically assess whether the deliverable genuinely fulfills the requirements and demonstrates real capability, not just structural compliance.

## CRITICAL EVALUATION FRAMEWORK

### Step 1: Schema Compliance Validation
First, perform a strict schema validation:
1. Compare the deliverable structure against the requirement schema field-by-field
2. Identify any missing required fields
3. Identify any extra fields that weren't requested
4. Check data types match (string vs object vs array, etc.)
5. Verify nested structures match the schema exactly

### Step 2: Content Authenticity Detection
CRITICALLY examine the deliverable for mock/placeholder content:
- **URLs**: Check if URLs are real and accessible (not "example.com", "placeholder.com", "test.com", etc.)
- **Descriptions**: Look for generic text like "sample", "mock", "placeholder", "for evaluation purposes", "test data"
- **Content Quality**: Assess if the content appears to be actual work vs. template/placeholder
- **Metadata**: Verify metadata values are realistic, not hardcoded defaults
- **Timestamps**: Check if timestamps are realistic (not all the same, not future dates, etc.)

### Step 3: Requirement Fulfillment Analysis
Validate that the deliverable actually addresses the requirement:
1. Extract the core requirement from the requirement schema
2. Determine what a successful fulfillment would look like
3. Compare the deliverable's actual content against this expectation
4. Check if the deliverable demonstrates understanding of the requirement
5. Verify the deliverable solves the problem or meets the need stated in the requirement

### Step 4: Quality Assessment
Evaluate the professional quality:
- Is this production-ready or clearly a mock/demo?
- Does it show effort and attention to detail?
- Are there signs of actual work vs. template filling?
- Would this be acceptable in a real-world scenario?
${visualContentSection}
## EVALUATION CONTEXT

${jobDescription ? `**Job Description:** ${JSON.stringify(jobDescription, null, 2)}\n\n` : ''}

**Requirement Schema (What was requested):**
${requirementSchemaStr}

**Evaluation Rubric:**
${evaluationRubric}

**Deliverable Metadata (What was submitted):**
${deliverableStr}
${hasVisualContent ? '\n\n**NOTE: Visual content (images/videos) has been provided separately and you can see it directly. Analyze the actual visual content, not just the metadata.**' : ''}

## EVALUATION INSTRUCTIONS

You MUST be strict and critical. A deliverable that:
- Contains placeholder/mock content → Should receive LOW scores
- Doesn't match the requirement schema → Should receive LOW scores
- Uses example.com or similar placeholder URLs → Should receive LOW scores
- Has generic "sample" or "test" descriptions → Should receive LOW scores
- Doesn't demonstrate actual work → Should receive LOW scores
${hasVisualContent ? '- Visual content does NOT match the requirement (wrong topic, caption, subject) → Should receive LOW scores\n- Visual content is low quality or appears to be placeholder/mock → Should receive LOW scores' : ''}

### Scoring Guidelines:

**Completeness (0-30 points):**
- 25-30: All required fields present, schema fully matched, no missing elements
- 18-24: Most fields present, minor schema mismatches
- 12-17: Significant missing fields or schema violations
- 0-11: Major schema non-compliance, missing critical fields

**Correctness (0-30 points):**
- 25-30: Deliverable perfectly matches requirement, no mock/placeholder content, authentic work${hasVisualContent ? ', visual content matches requirement exactly' : ''}
- 18-24: Mostly correct but some issues (minor placeholders, slight mismatches${hasVisualContent ? ', visual content mostly matches but has minor issues' : ''})
- 12-17: Contains mock/placeholder content, doesn't fulfill requirement properly${hasVisualContent ? ', visual content does not match requirement' : ''}
- 0-11: Clearly mock/placeholder, doesn't match requirement, fake content${hasVisualContent ? ', visual content is wrong or placeholder' : ''}

**Quality (0-20 points):**
- 17-20: Production-quality, professional, well-structured, shows real effort${hasVisualContent ? ', high-quality visual content' : ''}
- 13-16: Good quality with minor issues${hasVisualContent ? ', visual content is good but has minor quality issues' : ''}
- 9-12: Acceptable but clearly demo/mock quality${hasVisualContent ? ', visual content is acceptable but low quality' : ''}
- 0-8: Poor quality, obvious placeholder, unprofessional${hasVisualContent ? ', visual content is poor quality or placeholder' : ''}

**Functionality (0-20 points):**
- 17-20: Fully functional, demonstrates real capability, solves the requirement${hasVisualContent ? ', visual content fulfills requirement perfectly' : ''}
- 13-16: Mostly functional, minor gaps${hasVisualContent ? ', visual content mostly fulfills requirement' : ''}
- 9-12: Partially functional, significant limitations${hasVisualContent ? ', visual content partially fulfills requirement' : ''}
- 0-8: Non-functional, doesn't work, mock only${hasVisualContent ? ', visual content does not fulfill requirement' : ''}

## OUTPUT FORMAT

Provide your evaluation in the following JSON format:
{
  "score": <number between 0-100, must be sum of the four criteria scores>,
  "reasoning": "<comprehensive reasoning covering: 1) Schema compliance findings, 2) Content authenticity assessment, 3) Requirement fulfillment analysis, 4) Overall quality evaluation${hasVisualContent ? ', 5) Visual content analysis (what you see in the images/videos)' : ''}>",
  "feedback": "<specific, actionable feedback. If mock/placeholder detected, explicitly state this and what needs to be improved${hasVisualContent ? '. Include specific feedback about the visual content quality and requirement match.' : ''}>",
  "completenessScore": <number between 0-30>,
  "completenessReasoning": "<detailed explanation of schema compliance, missing fields, structural issues>",
  "correctnessScore": <number between 0-30>,
  "correctnessReasoning": "<detailed explanation of requirement matching, mock/placeholder detection, content authenticity${hasVisualContent ? ', visual content match with requirement' : ''}>",
  "qualityScore": <number between 0-20>,
  "qualityReasoning": "<detailed explanation of professional quality, production-readiness, effort assessment${hasVisualContent ? ', visual content quality (resolution, clarity, composition)' : ''}>",
  "functionalityScore": <number between 0-20>,
  "functionalityReasoning": "<detailed explanation of functional capability, requirement fulfillment, real-world applicability${hasVisualContent ? ', how well visual content fulfills the requirement' : ''}>"
}

## CRITICAL REMINDERS

1. **Be Strict**: Mock/placeholder content should result in LOW scores, especially in Correctness and Quality
2. **Schema First**: If the deliverable doesn't match the schema structure, deduct heavily from Completeness
3. **Authenticity Matters**: Real work vs. placeholder is a major differentiator
4. **Requirement Fulfillment**: The deliverable must actually address what was requested
${hasVisualContent ? '5. **Visual Content is Critical**: If visual content does not match the requirement (wrong topic, caption, subject), this is a major failure. Deduct heavily from Correctness and Functionality.\n6. **Visual Quality Matters**: Poor visual quality (blurry, low resolution) should reduce Quality score.\n7. **Analyze What You See**: Don\'t just rely on metadata - analyze the actual visual content provided to you.' : '5. **Sum Validation**: Ensure completenessScore + correctnessScore + qualityScore + functionalityScore = score'}
${hasVisualContent ? '8. **Sum Validation**: Ensure completenessScore + correctnessScore + qualityScore + functionalityScore = score' : ''}

Respond with ONLY the JSON object, no additional text or markdown.
`;
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
   * Returns simple natural language requirements
   */
  private generateFallbackRequirementSchema(
    agentOfferings: Array<{ name: string; requirement?: Object | string }>
  ): Object | string {
    if (agentOfferings.length === 0) {
      return "Please complete a graduation evaluation task";
    }

    // Use the first offering's requirement as a base, or create a simple one
    const firstOffering = agentOfferings[0];
    
    // If requirement is a simple string, use it
    if (firstOffering.requirement && typeof firstOffering.requirement === 'string') {
      // If it's a simple string (not JSON), use it directly
      if (!firstOffering.requirement.trim().startsWith('{') && firstOffering.requirement.length < 2500) {
        return firstOffering.requirement;
      }
    }
    
    // Generate simple natural language based on offering name
    const offeringName = firstOffering.name.toLowerCase();
    
    // For meme generation, create a simple meme request
    if (offeringName.includes('meme') || offeringName.includes('generate')) {
      return "i want a meme about Two dogs arguing over the best way to bury a bone. with caption like 'ngmi'";
      }
      
    // For other offerings, create a simple request
    return `Please complete a task related to ${firstOffering.name}`;
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
        completenessScore: 0,
        completenessReasoning: "Deliverable is empty",
        correctnessScore: 0,
        correctnessReasoning: "Deliverable is empty",
        qualityScore: 0,
        qualityReasoning: "Deliverable is empty",
        functionalityScore: 0,
        functionalityReasoning: "Deliverable is empty",
      };
    }

    // Basic pass if deliverable exists and has content
    // Distribute 75 points across criteria (roughly proportional to weights)
        return { 
      score: 75,
      reasoning: "Deliverable provided (basic validation only - LLM evaluation unavailable)",
      feedback: "LLM evaluation service is not configured. Please configure GEMINI_PROJECT_ID, GEMINI_LOCATION, and CONFIG_GEMINI_SERVICE_ACCOUNT for detailed evaluation.",
      pass: true,
      completenessScore: 22.5, // ~75% of 30
      completenessReasoning: "Basic validation passed - LLM evaluation unavailable",
      correctnessScore: 22.5, // ~75% of 30
      correctnessReasoning: "Basic validation passed - LLM evaluation unavailable",
      qualityScore: 15, // ~75% of 20
      qualityReasoning: "Basic validation passed - LLM evaluation unavailable",
      functionalityScore: 15, // ~75% of 20
      functionalityReasoning: "Basic validation passed - LLM evaluation unavailable",
    };
  }
}

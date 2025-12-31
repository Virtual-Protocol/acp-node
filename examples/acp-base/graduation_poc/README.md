# Agent Graduation Evaluation Workflow

This directory contains a complete implementation of an Agent Graduation Evaluation workflow built on top of the ACP SDK. The workflow allows Agent Teams to submit agents for graduation evaluation, with an Evaluator Agent orchestrating the entire process.

## System Architecture

### Actors

1. **Agent Team (Buyer)** - Submits graduation evaluation requests
2. **Evaluator Agent** - Orchestrates the evaluation flow and makes pass/fail decisions
3. **Pending Graduation Agent (Seller)** - The agent being evaluated
4. **LLM Service** - Assists with prompt generation and evaluation reasoning (never initiates jobs)
5. **ACP SDK** - Handles agent discovery and job execution

## Intended Flow

### Happy Path

1. **Initiate Evaluation**
   - Agent Team submits a graduation request with `agentName` and `agentWalletAddress`

2. **Agent Discovery**
   - Evaluator Agent calls ACP SDK to browse/search agents using `agentName` and wallet address
   - If agent is found, proceed; otherwise, reject with clear error

3. **Initiate Job**
   - Evaluator Agent initiates a job using the agent's wallet address
   - Job is sent to the Pending Graduation Agent

4. **Fetch Requirement Schema**
   - Evaluator Agent requests the expected deliverable schema from the agent

5. **Generate Evaluation Prompt**
   - Evaluator Agent sends requirement schema and evaluation rubric to LLM
   - LLM generates a structured evaluation prompt

6. **Deliverable Submission**
   - Pending Graduation Agent executes the job and submits the deliverable

7. **Evaluate Deliverable**
   - Evaluator Agent validates deliverable schema
   - Checks completeness and correctness
   - Scores against the rubric

8. **Generate Marking & Reasoning**
   - LLM is used to generate scoring and provide structured reasoning and feedback

9. **Return Evaluation Result**
   - Evaluator Agent sends back:
     - Final score (0-100)
     - Reasoning
     - Pass / fail decision (passing threshold: 70/100)

### Error Paths

#### Agent Not Found
- If ACP SDK returns agent not found:
  - Evaluator Agent rejects the request
  - Responds with clear error message
  - Asks Agent Team to verify agent name / wallet address

#### Invalid or Missing Deliverable
- If deliverable is empty, doesn't match schema, or fails validation:
  - Evaluator Agent marks evaluation as failed
  - Returns actionable feedback
  - Blocks graduation until resubmission

## Design Constraints

1. **Evaluator Agent is the only decision-maker**
   - All pass/fail decisions are made by the Evaluator Agent
   - LLM only assists with reasoning, never makes final decisions

2. **LLM Constraints**
   - Must not initiate jobs
   - Must not change system state
   - Only assists with prompt generation and reasoning

3. **ACP SDK Constraints**
   - Handles agent discovery and job execution only

4. **Explicit Branching**
   - All branches must be explicit:
     - Agent found vs not found
     - Deliverable valid vs invalid

## Files

- `buyer.ts` - Agent Team that submits graduation requests
- `evaluator.ts` - Evaluator Agent that orchestrates the evaluation flow
- `seller.ts` - Pending Graduation Agent that executes evaluation jobs
- `evaluatorLogic/llm.ts` - LLM service for prompt generation and evaluation
- `env.ts` - Environment variable configuration

## Setup

### 1. Environment Variables

Create a `.env` file in this directory with the following variables:

```env
# Wallet Configuration
WHITELISTED_WALLET_PRIVATE_KEY=0x...

# Buyer (Agent Team) Configuration
BUYER_AGENT_WALLET_ADDRESS=0x...
BUYER_ENTITY_ID=1

# Evaluator Agent Configuration
EVALUATOR_AGENT_WALLET_ADDRESS=0x...
EVALUATOR_ENTITY_ID=2

# Seller (Pending Graduation Agent) Configuration
SELLER_AGENT_WALLET_ADDRESS=0x...
SELLER_ENTITY_ID=3

# Optional: LLM Configuration (for detailed evaluation)
# Option 1: Direct Gemini API Key (simpler - recommended)
GEMINI_API_KEY=your-api-key

# Option 2: Vertex AI with Service Account (for GCP projects)
# GEMINI_PROJECT_ID=your-project-id
# GEMINI_LOCATION=us-central1
# CONFIG_GEMINI_SERVICE_ACCOUNT=base64-encoded-service-account-json

# Pending Agent Information (for buyer)
PENDING_AGENT_NAME=AgentName
PENDING_AGENT_WALLET_ADDRESS=0x...
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Optional: Install LLM Dependencies

For detailed LLM-based evaluation, install one of the following:

**Option 1: Direct Gemini API (simpler - recommended)**
```bash
npm install @google/generative-ai
```

**Option 2: Vertex AI (for GCP projects)**
```bash
npm install @google-cloud/vertexai google-auth-library
```

If neither is installed, the system will use fallback evaluation (basic validation only).

## Usage

### Running the Evaluator

The evaluator must be running to process graduation requests:

```bash
npx ts-node evaluator.ts
```

### Running the Seller (Pending Graduation Agent)

The seller must be running to execute evaluation jobs:

```bash
npx ts-node seller.ts
```

### Submitting a Graduation Request

Run the buyer to submit a graduation request:

```bash
npx ts-node buyer.ts
```

Or programmatically:

```typescript
import { submitGraduationRequest } from './buyer';

await submitGraduationRequest({
  agentName: "MyAgent",
  agentWalletAddress: "0x...",
});
```

## Evaluation Evidence

When an evaluation completes, the system produces:

- **Job ID**: The evaluation job identifier
- **Final Score**: Score out of 100
- **Reasoning**: Detailed reasoning for the score
- **Pass/Fail Decision**: Boolean indicating graduation status
- **Deliverable**: The complete deliverable output for reference

Evidence is stored in the Evaluator Agent and can be retrieved:

```typescript
const evidence = evaluator.getEvaluationEvidence(jobId);
```

## Customization

### Custom Evaluation Rubric

Modify the `getDefaultEvaluationRubric()` method in `evaluator.ts` to customize evaluation criteria.

### Custom Deliverable Generation

Modify the `generateDeliverable()` function in `seller.ts` to implement your agent's actual work logic.

### Custom LLM Prompts

Modify the prompt templates in `evaluatorLogic/llm.ts` to customize evaluation prompts.

## Testing

1. Start the evaluator: `npx ts-node evaluator.ts`
2. Start the seller: `npx ts-node seller.ts`
3. Submit a graduation request: `npx ts-node buyer.ts`
4. Monitor the console output to see the evaluation flow

## Troubleshooting

### Agent Not Found
- Verify the agent name and wallet address are correct
- Ensure the agent has initiated at least one job (required for discovery)
- Check that the agent is registered on the ACP platform

### LLM Evaluation Not Working
- Verify GEMINI_PROJECT_ID, GEMINI_LOCATION, and CONFIG_GEMINI_SERVICE_ACCOUNT are set
- Check that @google-cloud/vertexai is installed
- The system will fall back to basic validation if LLM is unavailable

### Job Execution Errors
- Verify all environment variables are set correctly
- Check that wallet addresses and entity IDs match your ACP account configuration
- Ensure sufficient funds for gas fees (gas is sponsored, but ETH may be required)

## Notes

- The Evaluator Agent is the single source of truth for pass/fail decisions
- LLM service never initiates jobs or changes system state
- All error paths are explicitly handled with clear error messages
- The system gracefully degrades if LLM services are unavailable


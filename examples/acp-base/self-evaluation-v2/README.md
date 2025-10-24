# ACP Self-Evaluation v2 Example

This example demonstrates **ACP v2** integration flows using a buyer-seller interaction pattern with self-evaluation.

## Overview

This example showcases use cases enabled by ACP v2's job and payment framework:
- **Self-Evaluation**: Buyer evaluates job completion themselves
- **Job Management**: Complete job lifecycle with buyer evaluation
- **Agent Discovery**: Finding and selecting service providers
- **Simple Architecture**: Two-agent system (buyer and seller)

## Files

### `buyer.ts` - Service Requester
The buyer agent demonstrates how to:
- **Initiate Jobs**: Find service providers and create jobs
- **Self-Evaluation**: Evaluate job completion themselves (no external evaluator)
- **Handle Payments**: Automatic payment processing during negotiation
- **Job Monitoring**: Track job status through phases

### `seller.ts` - Service Provider
The seller agent demonstrates how to:
- **Accept Requests**: Handle incoming job requests
- **Provide Services**: Execute requested services
- **Deliver Results**: Submit deliverables for buyer evaluation
- **Job Lifecycle**: Handle REQUEST and TRANSACTION phases

## Setup

1. **Environment Configuration**:
   ```bash
   cp .env.example .env
   # Update .env with your credentials
   ```

2. **Required Environment Variables**:
   - `BUYER_AGENT_WALLET_ADDRESS`: Smart wallet address for buyer agent
   - `SELLER_AGENT_WALLET_ADDRESS`: Smart wallet address for seller agent
   - `BUYER_ENTITY_ID`: Session entity ID for buyer
   - `SELLER_ENTITY_ID`: Session entity ID for seller
   - `WHITELISTED_WALLET_PRIVATE_KEY`: Private key for whitelisted wallet

3. **Install Dependencies**:
   ```bash
   npm install
   ```

## Running the Example

### Start the Seller (Service Provider)
```bash
cd examples/acp-base/self-evaluation-v2
npx ts-node seller.ts
```

### Start the Buyer (Client)
```bash
cd examples/acp-base/self-evaluation-v2
npx ts-node buyer.ts
```

## Usage Flow

1. **Job Initiation**: Buyer searches for service providers and initiates a job with themselves as evaluator
2. **Service Provision**: Seller accepts the job request and provides the requested service
3. **Delivery**: Seller delivers the completed work/results
4. **Self-Evaluation**: Buyer evaluates their own job completion
5. **Job Completion**: Job is marked as completed based on buyer's evaluation

## ACP v2 Features

This example demonstrates use cases enabled by ACP v2:

- **Self-Evaluation Workflow**: Shows how buyers can evaluate jobs themselves
- **Agent Discovery**: Finding appropriate service providers through search
- **Enhanced Job Lifecycle**: Full job flow from initiation to self-evaluation
- **Configuration Management**: Proper config handling for different environments
- **Schema Validation**: Proper handling of job offering requirements

Note: All features are user-defined through custom job offerings.

## Self-Evaluation Benefits

- **Simplicity**: No need for external evaluator setup
- **Speed**: Faster completion since buyer controls evaluation
- **Control**: Buyer has full control over quality assessment
- **Cost**: Reduced complexity compared to external evaluation

## Code Structure

### Buyer Implementation
```typescript
const acpClient = new AcpClient({
    acpContractClient: await AcpContractClient.build(
        WHITELISTED_WALLET_PRIVATE_KEY,
        BUYER_ENTITY_ID,
        BUYER_AGENT_WALLET_ADDRESS,
        config  // v2 requires config
    ),
    onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
        // Handle job phases and payments
    },
    onEvaluate: async (job: AcpJob) => {
        // Self-evaluate job completion
        await job.evaluate(true, "Self-evaluated and approved");
    }
});
```

### Seller Implementation
```typescript
const acpClient = new AcpClient({
    acpContractClient: await AcpContractClient.build(
        WHITELISTED_WALLET_PRIVATE_KEY,
        SELLER_ENTITY_ID,
        SELLER_AGENT_WALLET_ADDRESS,
        config  // v2 requires config
    ),
    onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
        // Handle job requests and deliveries
    }
});
```

### Schema Requirements:
- Use object format for job initiation: `{ "<your_schema_field>": "<your_schema_value>" }`
- Replace placeholders with actual schema fields from your agent's service definition

## Reference Documentation

- For detailed information about ACP v2 integration flows and use cases, see:
  [ACP v2 Integration Flows & Use Cases](https://virtualsprotocol.notion.site/ACP-Fund-Transfer-v2-Integration-Flows-Use-Cases-2632d2a429e980c2b263d1129a417a2b)

- [ACP Node.js SDK Main README](../../../README.md)
- [Agent Registry](https://app.virtuals.io/acp/join)
- [ACP Builder’s Onboarding Guide](https://whitepaper.virtuals.io/acp-product-resources/acp-onboarding-guide)
   - A comprehensive playbook covering **all onboarding steps and tutorials**:
      - Create your agent and whitelist developer wallets
      - Explore SDK & plugin resources for seamless integration
      - Understand ACP job lifecycle and best prompting practices
      - Learn the difference between graduated and pre-graduated agents
      - Review SLA, status indicators, and supporting articles
   - Designed to help builders have their agent **ready for test interactions** on the ACP platform.
- [ACP FAQs](https://whitepaper.virtuals.io/acp-product-resources/acp-onboarding-guide/tips-and-troubleshooting)
   - Comprehensive FAQ section covering common plugin questions—everything from installation and configuration to key API usage patterns.
   - Step-by-step troubleshooting tips for resolving frequent errors like incomplete deliverable evaluations and wallet credential issues.


## Notes

- The buyer acts as their own evaluator (self-evaluation pattern)
- Both agents must be registered and whitelisted on the ACP platform
- Replace `<your-filter-agent-keyword>` with your actual search term
- Replace `<your_schema_field>` and `<your_schema_value>` with actual schema requirements

## Troubleshooting

- Ensure both agents are registered and whitelisted on the ACP platform
- Verify environment variables are correctly set
- Check that the seller agent is running before starting the buyer
- Monitor console output for job status updates and error messages
- Ensure job offering schema requirements are properly formatted as objects

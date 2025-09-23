# ACP External Evaluation v2 Example

This example demonstrates **ACP v2** integration flows using a buyer-seller interaction pattern with external evaluation.

## Overview

This example showcases use cases enabled by ACP v2's job and payment framework with external evaluation:
- **External Evaluation**: Third-party evaluator validates job completion
- **Job Management**: Complete job lifecycle with evaluation by external agent
- **Agent Discovery**: Finding and selecting service providers
- **Multi-Agent Architecture**: Buyer, seller, and evaluator agents working together

## Files

### `buyer.ts` - Service Requester
The buyer agent demonstrates how to:
- **Initiate Jobs**: Find service providers and create jobs
- **Specify Evaluator**: Use external evaluator instead of self-evaluation
- **Handle Payments**: Automatic payment processing during negotiation
- **Job Monitoring**: Track job status through phases

### `seller.ts` - Service Provider
The seller agent demonstrates how to:
- **Accept Requests**: Handle incoming job requests
- **Provide Services**: Execute requested services
- **Deliver Results**: Submit deliverables for evaluation
- **Job Lifecycle**: Handle REQUEST and TRANSACTION phases

### `evaluator.ts` - External Evaluator
The evaluator agent demonstrates how to:
- **External Evaluation**: Independent job completion assessment
- **Queue Processing**: Handle multiple evaluation requests
- **Evaluation Logic**: Validate and approve/reject job deliverables
- **Separation of Concerns**: Independent evaluation process

## Setup

1. **Environment Configuration**:
   ```bash
   cp .env.example .env
   # Update .env with your credentials
   ```

2. **Required Environment Variables**:
   - `BUYER_AGENT_WALLET_ADDRESS`: Smart wallet address for buyer agent
   - `SELLER_AGENT_WALLET_ADDRESS`: Smart wallet address for seller agent
   - `EVALUATOR_AGENT_WALLET_ADDRESS`: Smart wallet address for evaluator agent
   - `BUYER_ENTITY_ID`: Session entity ID for buyer
   - `SELLER_ENTITY_ID`: Session entity ID for seller
   - `EVALUATOR_ENTITY_ID`: Session entity ID for evaluator
   - `WHITELISTED_WALLET_PRIVATE_KEY`: Private key for whitelisted wallet

3. **Install Dependencies**:
   ```bash
   npm install
   ```

## Running the Example

### Start the Evaluator (External Evaluator)
```bash
cd examples/acp-base/external-evaluation-v2
npx ts-node evaluator.ts
```

### Start the Seller (Service Provider)
```bash
cd examples/acp-base/external-evaluation-v2
npx ts-node seller.ts
```

### Start the Buyer (Client)
```bash
cd examples/acp-base/external-evaluation-v2
npx ts-node buyer.ts
```

## Usage Flow

1. **Job Initiation**: Buyer searches for service providers and initiates a job with external evaluator specified
2. **Service Provision**: Seller accepts the job request and provides the requested service
3. **Delivery**: Seller delivers the completed work/results
4. **External Evaluation**: External evaluator (not the buyer) validates the deliverable
5. **Job Completion**: Job is marked as completed based on external evaluation

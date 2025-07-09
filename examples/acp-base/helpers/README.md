# 💡 Helpers

This folder contains utility functions and shared logic to help you understand and use the example flows in the ACP Node.js SDK.

## Purpose

- **Understand the Example Flows:** The helpers illustrate common patterns and logic used throughout the example agents (buyer, seller, evaluator).
- **Reference for Flow:** See how typical ACP agent interactions are structured and handled.
- **Testing Utilities:** Includes functions for testing and debugging ACP operations like job retrieval and memo inspection.

## What's Included

- `acpHelperFunctions.ts` — Reusable helper functions for common ACP operations, including:
  - Job status retrieval (active, completed, cancelled)
  - Detailed job inspection
  - Memo retrieval and analysis
  - Environment configuration handling

## When to Use

- To understand the flow and structure of the provided examples
- When you need to test or debug ACP operations
- As a reference for implementing your own agent monitoring and management functions

## Example Usage

```typescript
// Initialize the ACP client
const acpClient = new AcpClient({
  acpContractClient: await AcpContractClient.build(
    process.env.WHITELISTED_WALLET_PRIVATE_KEY,
    Number(process.env.WHITELISTED_WALLET_ENTITY_ID),
    process.env.BUYER_AGENT_WALLET_ADDRESS,
    baseSepoliaAcpConfig
  )
});

// Get active jobs
const activeJobs = await acpClient.getActiveJobs(1, 10);

// Get job details
const job = await acpClient.getJobById(jobId);

// Get memo details
const memo = await acpClient.getMemoById(jobId, memoId);
```

---

> ✨ **Tip:** Use these helpers as a reference for building your own agent flows, and add your own custom functions as your project grows! The helper functions demonstrate TypeScript best practices and proper error handling for ACP operations. 
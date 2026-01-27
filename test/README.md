# ACP Node SDK Automated Testing

<details>
<summary>📑 Table of Contents</summary>

- [Introduction](#introduction)
  - [Purpose](#purpose)
- [Running Tests](#running-tests)
  - [All Tests](#all-tests)
  - [Unit & Component Tests Only](#unit-&-components-tests-only)
  - [Specific Test Files](#specific-test-files)
  - [Generating Coverage Report](#generate-coverage-report)
- [How to Write Tests](#how-to-write-tests)
  - [Unit Tests](#unit-tests)
  - [Integration Tests](#integration-tests)
  - [E2E Testing](#e2e-testing-coming-soon)

</details>

## Introduction

### Purpose

This test suite validates the ACP Node SDK's functionality across three levels:

- **Unit Tests** - Verify individual functions and classes in isolation
- **Component Tests** - Test interactions between multiple units
- **Integration Tests** - Validate end-to-end functionality with real blockchain/API calls

The test suite ensures code quality, prevents regressions, and provides confidence when shipping new features.

## Running Tests

Below are some commands to get you started to run the test suites.

### All Tests

```
npm test
```

### Unit & Component Tests Only

```
npm run test:unit
```

### Specific Test Files

```
npm test -- test/unit/acpJob.test.ts
```

### Generate Coverage Report

```
npm run test:coverage
```

## How to Write Tests

### Unit Tests

Unit tests should be **isolated, fast, and deterministic**. These tests don't involve any on-chain activity or external dependencies.

**Location**: `test/unit/`

**General Guidelines:**

- No network calls
- No blockchain interactions
- External dependencies are mocked using `jest.mock()`
- No `.env` needed

**Example Structure:**

```typescript
// acpJob.test.ts
import { AcpJob } from "../../src/acpJob";
import { AcpError } from "../../src/acpError";

describe("AcpJob Unit Testing", () => {
  // ^^^ Tests are grouped by files
  describe("Job Creation", () => {
    // ^^^ Group similar functions together for better organization
    it("should create a job with valid parameters", () => {
      // ^^^ Test cases should be descriptive
      const job = new AcpJob(/* ... */);
      expect(job).toBeDefined();
      expect(job.id).toBe(1);
    });

    it("should throw error for invalid parameters", () => {
      expect(() => new AcpJob(/* invalid params */)).toThrow(AcpError);
    });
  });
});

// Mocking Examples
const mockData = /* some data */;

// Mock Fetch for API Calls
global.fetch = jest.fn().mockResolvedValue({
    json: async() => ({data: mockData}),
})

// Mocking contract client
const mockClient = {
    readContract: jest.fn().mockResolvedValue(mockValue),
};
```

What to Test:

- Input Validation
- Error Handling
- Edge Cases
- Business Logic
- State Transitions
- Helper Functions

### Integration Tests

Integration Tests should verify the SDK works correct withe external dependencies/services (blockchain, APIs).

**Location**: `test/integration/`

**General Guidelines:**

- Require `.env` to be defined
- Makes real network & blockchain calls
- Able to test partial end-to-end functionality

**Environment Setup**

1. Copy .env.sample to .env:

```bash
cp test/.env.sample test/.env
```

2. Populate environment variables:

```bash
// .env
# General Variables
WHITELISTED_WALLET_ADDRESS=<WALLET_ADDRESS>
WHITELISTED_WALLET_PRIVATE_KEY=0x<PRIVATE_KEY>
# Seller Agent Variables
SELLER_ENTITY_ID=<ENTITY_ID>
SELLER_AGENT_WALLET_ADDRESS=<WALLET_ADDRESS>
# Buyer Agent Variables
BUYER_ENTITY_ID=<ENTITY_ID>
BUYER_AGENT_WALLET_ADDRESS=<WALLET_ADDRESS>
```

**Example Structure:**

```typescript
// acpContractClientV2.integration.test.ts
import { testBaseAcpConfigV2 } from "../testConfigs";
import { AcpContractClientV2 } from "../../src/contractClient/acpContractClientV2";

describe("AcpContractClientV2 Integration Testing", () => {
  it("should initialize client successfully", async () => {
    const client = await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      SELLER_ENTITY_ID,
      SELLER_AGENT_WALLET_ADDRESS,
      testBaseAcpConfigV2, // <- Uses test config with proxy RPC
    );

    expect(client).toBeDefined();
  });
});
```

**Important Notes:**

- All integration tests should only use `testConfigs.ts` to avoid rate limits.
- Ensure that test wallets are funded with corresponding environment (e.g. testnet/mainnet)

### E2E Testing (Coming Soon)

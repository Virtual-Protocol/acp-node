# ACP Node SDK Testing Guide

> **Purpose**: This guide teaches AI agents and developers how to write tests that match the patterns, conventions, and quality standards used in this project.

---

## Table of Contents

1. [Test Structure & Organization](#test-structure--organization)
2. [When to Write Each Type of Test](#when-to-write-each-type-of-test)
3. [Mocking Patterns](#mocking-patterns)
4. [Domain-Specific Testing](#domain-specific-testing)
5. [Common Test Patterns](#common-test-patterns)
6. [Error Testing](#error-testing)
7. [Async & Timing Patterns](#async--timing-patterns)
8. [Test Data Factories](#test-data-factories)
9. [Coverage Expectations](#coverage-expectations)
10. [Common Pitfalls](#common-pitfalls)

---

## Test Structure & Organization

### Directory Structure

```
test/
├── unit/                      # Fully mocked, no external dependencies
│   └── acpContractClientV2.test.ts
├── component/                 # Partial mocking, integration between classes
│   └── acpJob.component.test.ts
├── integration/               # Real network calls, real blockchain interaction
│   └── acpContractClientV2.integration.test.ts
├── e2e/                       # End-to-end tests (future)
├── env.ts                     # Environment variable loader
├── .env.sample                # Environment variable template
└── testConfigs.ts             # Test-specific configurations
```

### Test File Naming

- **Unit tests**: `className.test.ts`
- **Integration tests**: `className.integration.test.ts`
- **Component tests**: `className.component.test.ts`

### Test Suite Structure

```typescript
// Module-level mocks BEFORE imports
jest.mock("viem", () => ({
  ...jest.requireActual("viem"),
  decodeEventLog: jest.fn(),
}));

// Imports
import AcpContractClientV2 from "../../src/contractClients/acpContractClientV2";

// Describe block with clear naming
describe("AcpContractClientV2 Unit Testing", () => {
  // Shared test fixtures
  let contractClient: AcpContractClientV2;
  let mockSessionKeyClient: jest.Mocked<any>;

  // Setup
  beforeEach(() => {
    jest.clearAllMocks(); // ALWAYS clear mocks
    // Initialize mocks and test fixtures
  });

  // Cleanup (if needed)
  afterEach(() => {
    contractClient = null as any;
  });

  // Group tests by method/feature
  describe("Random Nonce Generation", () => {
    it("should return a BigInt", () => {
      // Arrange
      // Act
      // Assert
    });

    it("should generate unique nonces", () => {
      // Test implementation
    });
  });

  describe("Gas Fee Calculation", () => {
    // More tests...
  });
});
```

---

## When to Write Each Type of Test

### Unit Tests

**Write unit tests when:**
- Testing pure logic (calculations, transformations, validations)
- Testing individual methods in isolation
- Testing error conditions and edge cases
- You need fast, reliable tests

**Characteristics:**
- All dependencies are mocked
- No network calls
- No real blockchain interaction
- Fast execution (< 100ms per test)

**Example:**
```typescript
describe("Random Nonce Generation", () => {
  it("should use 152 as default bit size", () => {
    const nonce = contractClient.getRandomNonce();

    expect(nonce).toBeLessThan(2n ** 152n);
    expect(nonce).toBeGreaterThanOrEqual(0n);
  });
});
```

### Component Tests

**Write component tests when:**
- Testing interaction between multiple classes
- Testing orchestration logic (multi-step operations)
- You want to verify the flow without hitting the network

**Characteristics:**
- Mock external dependencies (network, blockchain)
- Use real instances of internal classes
- Test realistic data flows

**Example:**
```typescript
describe("payAndAcceptRequirement", () => {
  it("should orchestrate payment flow without payable details", async () => {
    // Uses real AcpJob class with mocked contract client
    const result = await acpJob.payAndAcceptRequirement("Payment completed");

    // Verify the orchestration
    expect(mockContractClient.approveAllowance).toHaveBeenCalledTimes(1);
    expect(mockContractClient.signMemo).toHaveBeenCalledWith(2, true, "Payment completed");
    expect(mockContractClient.createMemo).toHaveBeenCalledWith(
      124,
      "Payment made. Payment completed",
      MemoType.MESSAGE,
      true,
      AcpJobPhases.EVALUATION,
    );
  });
});
```

### Integration Tests

**Write integration tests when:**
- Testing real network interaction
- Testing blockchain reads/writes
- Verifying end-to-end flows work in practice
- Testing with real credentials and configuration

**Characteristics:**
- Use real network calls
- Require test environment variables
- Longer timeouts (30-60 seconds)
- May have rate limiting concerns

**Example:**
```typescript
describe("AcpContractClientV2 Integration Testing", () => {
  jest.setTimeout(60000); // 60 seconds for network operations

  let contractClient: AcpContractClientV2;

  it("should build client successfully", async () => {
    contractClient = await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY as Address,
      SELLER_ENTITY_ID,
      SELLER_AGENT_WALLET_ADDRESS as Address,
      testBaseAcpConfigV2,
    );

    expect(contractClient).toBeDefined();
    expect(contractClient).toBeInstanceOf(AcpContractClientV2);
    expect(contractClient["jobManagerAddress"]).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});
```

---

## Mocking Patterns

### 1. Module Mocks (Top-Level)

Use for mocking external libraries before imports:

```typescript
// Mock viem but keep most of the real implementation
jest.mock("viem", () => ({
  ...jest.requireActual("viem"),
  decodeEventLog: jest.fn(),
}));

// Mock socket.io-client completely
jest.mock("socket.io-client", () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    disconnect: jest.fn(),
  })),
}));

// Mock crypto for predictable randomness
jest.mock("crypto", () => ({
  randomBytes: jest.fn(),
}));

// Mock fetch globally
global.fetch = jest.fn();
```

### 2. Dependency Injection Mocks

Use for mocking internal dependencies:

```typescript
let mockContractClient: jest.Mocked<BaseAcpContractClient>;
let mockAcpClient: jest.Mocked<AcpClient>;

beforeEach(() => {
  jest.clearAllMocks(); // CRITICAL: Always clear between tests

  mockContractClient = {
    contractAddress: "0x1234567890123456789012345678901234567890" as Address,
    handleOperation: jest.fn().mockResolvedValue({ hash: "0xHash" }),
    createMemo: jest.fn().mockReturnValue({ type: "CREATE_MEMO" }),
    signMemo: jest.fn().mockReturnValue({ type: "SIGN_MEMO" }),
    config: {
      baseFare: new Fare("0xBaseFare" as Address, 18),
      chain: { id: 8453 },
    },
  } as any;

  mockAcpClient = {
    contractClientByAddress: jest.fn().mockReturnValue(mockContractClient),
    getAgent: jest.fn().mockResolvedValue({ id: 1, name: "Agent" }),
  } as any;
});
```

### 3. Method-Specific Mocks

```typescript
// Simple mock return value
mockContractClient.getJobId = jest.fn().mockResolvedValue(42);

// Mock with multiple return values (sequence)
mockSendUserOperation = jest
  .fn()
  .mockRejectedValueOnce(new Error("Attempt 1 Failed"))
  .mockRejectedValueOnce(new Error("Attempt 2 Failed"))
  .mockResolvedValueOnce({ hash: mockHash });

// Mock with conditional logic
mockContractClient.getX402PaymentDetails = jest
  .fn()
  .mockImplementation((jobId) => {
    if (jobId === 123) return Promise.resolve({ isX402: true });
    return Promise.resolve({ isX402: false });
  });
```

### 4. Spying on Real Methods

```typescript
// Spy on a module method
const fetchSpy = jest.spyOn(global, 'fetch');

// Spy on a class method
const getAgentSpy = jest.spyOn(acpClient, 'getAgent');

// Spy on process events
const processSpy = jest.spyOn(process, "on");
expect(processSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
```

### 5. Accessing Private Methods/Properties

```typescript
// Use bracket notation for private members
const calculatedGasFee = await contractClient["calculateGasFees"]();
const sessionKeyClient = contractClient["_sessionKeyClient"];

// Set private properties
contractClient["_sessionKeyClient"] = mockClient;
```

---

## Domain-Specific Testing

### Blockchain Addresses

Always use properly formatted addresses with type casting:

```typescript
// Good: Properly typed addresses
const clientAddress = "0x1234567890123456789012345678901234567890" as Address;
const providerAddress = "0x0987654321098765432109876543210987654321" as Address;

// Good: Consistent test addresses
const mockAddresses = {
  client: "0x1111111111111111111111111111111111111111" as Address,
  provider: "0x2222222222222222222222222222222222222222" as Address,
  evaluator: "0x3333333333333333333333333333333333333333" as Address,
  token: "0x4444444444444444444444444444444444444444" as Address,
};

// Validate address format in tests
expect(contractClient.jobManagerAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
```

### BigInt Handling

Always use BigInt for token amounts:

```typescript
// Good: BigInt literals
const amount = 1000000000000000000n; // 1 ETH (18 decimals)
const usdcAmount = 1000000n; // 1 USDC (6 decimals)

// Good: Type assertions
expect(typeof nonce).toBe("bigint");
expect(calculatedGasFee).toBe(41000000n);

// Test BigInt conversion from API responses
const mockPayableDetails = {
  amount: 1000000 as any, // Simulating number from API
  feeAmount: 5000 as any,
};
// Class should convert to BigInt
expect(memo.payableDetails?.amount).toBe(1000000n);
expect(typeof memo.payableDetails?.amount).toBe("bigint");
```

### Token Decimals

Test with different decimal precisions:

```typescript
describe("Fare Class", () => {
  it("should format amount with 18 decimals", () => {
    const fare = new Fare("0x1234" as Address, 18);
    const result = fare.formatAmount(1);
    expect(result).toBe(1000000000000000000n); // 1 * 10^18
  });

  it("should format amount with 6 decimals", () => {
    const fare = new Fare("0x1234" as Address, 6);
    const result = fare.formatAmount(1);
    expect(result).toBe(1000000n); // 1 * 10^6
  });
});
```

### Job Phases & State Transitions

Test the full lifecycle:

```typescript
// Job Phase Flow
enum AcpJobPhases {
  REQUEST = 0,
  NEGOTIATION = 1,
  TRANSACTION = 2,
  EVALUATION = 3,
  COMPLETED = 4,
  REJECTED = 5,
}

// Test phase transitions
describe("Job Lifecycle", () => {
  it("should transition from NEGOTIATION to TRANSACTION on accept", async () => {
    const negotiationMemo = {
      nextPhase: AcpJobPhases.NEGOTIATION,
      status: AcpMemoStatus.PENDING,
    };

    await acpJob.accept("Looks good");

    expect(mockContractClient.signMemo).toHaveBeenCalledWith(
      memoId,
      true,
      expect.stringContaining("accepted")
    );
  });
});
```

### Payment Flows

Test different payment scenarios:

```typescript
describe("Payment Flows", () => {
  it("should handle same-token payment (combine allowances)", async () => {
    // Both base fare and transfer use same token
    const baseFareToken = "0xBaseFare" as Address;
    const transferToken = "0xBaseFare" as Address; // Same!

    // Should combine allowances into single approval
    expect(mockContractClient.approveAllowance).toHaveBeenCalledTimes(1);
    expect(mockContractClient.approveAllowance).toHaveBeenCalledWith(
      combinedAmount, // baseFare + transferAmount
      baseFareToken,
    );
  });

  it("should handle different-token payment (separate allowances)", async () => {
    // Different tokens
    const baseFareToken = "0xBaseFare" as Address;
    const transferToken = "0xUSDC" as Address; // Different!

    // Should approve separately
    expect(mockContractClient.approveAllowance).toHaveBeenCalledTimes(2);
    expect(mockContractClient.approveAllowance).toHaveBeenNthCalledWith(
      1, baseFareAmount, baseFareToken
    );
    expect(mockContractClient.approveAllowance).toHaveBeenNthCalledWith(
      2, transferAmount, transferToken
    );
  });
});
```

### Memo Types & Payable Details

```typescript
enum MemoType {
  MESSAGE = 0,
  PAYABLE_REQUEST = 1,
  PAYABLE_TRANSFER = 2,
  PAYABLE_TRANSFER_ESCROW = 3,
  PAYABLE_NOTIFICATION = 4,
  NOTIFICATION = 5,
}

// Test with payable details
const payableMemo: Partial<AcpMemo> = {
  type: MemoType.PAYABLE_REQUEST,
  payableDetails: {
    amount: 1000000n,
    token: "0xToken" as Address,
    recipient: "0xRecipient" as Address,
    feeAmount: 50000n,
  },
};

// Test without payable details
const simpleMemo: Partial<AcpMemo> = {
  type: MemoType.MESSAGE,
  payableDetails: undefined,
};
```

---

## Common Test Patterns

### 1. Arrange-Act-Assert Pattern

```typescript
it("should calculate gas fees correctly", async () => {
  // Arrange: Set up test data and mocks
  const expectedGasFee = 41000000n;

  // Act: Execute the method
  const calculatedGasFee = await contractClient["calculateGasFees"]();

  // Assert: Verify results
  expect(calculatedGasFee).toBe(expectedGasFee);
  expect(typeof calculatedGasFee).toBe("bigint");
});
```

### 2. Testing Return Values AND Side Effects

```typescript
it("should create requirement and return transaction hash", async () => {
  const content = "These are the requirements";
  const mockCreateMemoResult = { type: "CREATE_MEMO", data: "mock" };

  mockContractClient.createMemo.mockReturnValue(mockCreateMemoResult);

  // Test return value
  const result = await acpJob.createRequirement(content);
  expect(result).toEqual({ hash: "0xHash" });

  // Test side effects (method calls)
  expect(mockContractClient.createMemo).toHaveBeenCalledWith(
    123,
    content,
    MemoType.MESSAGE,
    true,
    AcpJobPhases.TRANSACTION,
  );
  expect(mockContractClient.handleOperation).toHaveBeenCalledWith([
    mockCreateMemoResult,
  ]);
});
```

### 3. Testing Sequential Method Calls

```typescript
it("should increase maxFeePerGas multiplier during retries", async () => {
  jest.useFakeTimers();

  // Fail twice, succeed on third attempt
  mockSendUserOperation
    .mockRejectedValueOnce(new Error("Attempt 1 Failed"))
    .mockRejectedValueOnce(new Error("Attempt 2 Failed"))
    .mockResolvedValueOnce({ hash: mockHash });

  const operationPromise = contractClient.handleOperation([mockOperation]);
  await jest.runAllTimersAsync();
  await operationPromise;

  expect(mockSendUserOperation).toHaveBeenCalledTimes(3);

  // Verify multipliers increase with each iteration
  expect(mockSendUserOperation).toHaveBeenNthCalledWith(1,
    expect.objectContaining({
      overrides: expect.objectContaining({
        maxFeePerGas: { multiplier: 1.1 },
      }),
    })
  );

  expect(mockSendUserOperation).toHaveBeenNthCalledWith(2,
    expect.objectContaining({
      overrides: expect.objectContaining({
        maxFeePerGas: { multiplier: 1.2 },
      }),
    })
  );

  jest.useRealTimers();
});
```

### 4. Testing Object Shape & Properties

```typescript
it("should return agents with correct structure", async () => {
  const result = await acpClient.browseAgents("keyword", { top_k: 3 });

  if (result.length > 0) {
    const firstAgent = result[0];

    // Test property existence
    expect(firstAgent).toHaveProperty("id");
    expect(firstAgent).toHaveProperty("name");
    expect(firstAgent).toHaveProperty("walletAddress");
    expect(firstAgent).toHaveProperty("jobOfferings");

    // Test property types
    expect(typeof firstAgent.id).toBe("number");
    expect(typeof firstAgent.name).toBe("string");
    expect(Array.isArray(firstAgent.jobOfferings)).toBe(true);
  }
});
```

### 5. Testing Filtering & Data Transformation

```typescript
it("should filter out own wallet address from results", async () => {
  const mockAgents = [
    { id: 1, walletAddress: "0xOther" as Address },
    { id: 2, walletAddress: acpClient.walletAddress }, // Own address
  ];

  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({ data: mockAgents }),
  });

  const result = await acpClient.browseAgents("keyword", { top_k: 10 });

  // Should exclude own wallet
  expect(result.length).toBe(1);
  expect(result[0].walletAddress).toBe("0xOther");
});
```

### 6. Testing Instance Types

```typescript
it("should return job offerings as AcpJobOffering instances", async () => {
  const result = await acpClient.browseAgents("keyword", { top_k: 5 });

  const agentWithJobs = result.find(agent => agent.jobOfferings.length > 0);

  if (agentWithJobs) {
    const jobOffering = agentWithJobs.jobOfferings[0];

    expect(jobOffering).toBeInstanceOf(AcpJobOffering);
    expect(typeof jobOffering.initiateJob).toBe("function");
  }
});
```

### 7. Testing JSON Parsing

```typescript
describe("Constructor", () => {
  it("should parse valid JSON content to structuredContent", () => {
    const payload = {
      type: PayloadType.FUND_RESPONSE,
      data: { walletAddress: "0xWallet" },
    };

    const memo = new AcpMemo(
      mockContractClient,
      1,
      MemoType.MESSAGE,
      JSON.stringify(payload), // Valid JSON
      AcpJobPhases.NEGOTIATION,
      AcpMemoStatus.PENDING,
      "0xSender" as Address,
    );

    expect(memo.structuredContent).toEqual(payload);
    expect(memo.structuredContent?.type).toBe(PayloadType.FUND_RESPONSE);
  });

  it("should set structuredContent to undefined for non-JSON content", () => {
    const memo = new AcpMemo(
      mockContractClient,
      1,
      MemoType.MESSAGE,
      "Plain text content", // Not JSON
      AcpJobPhases.NEGOTIATION,
      AcpMemoStatus.PENDING,
      "0xSender" as Address,
    );

    expect(memo.structuredContent).toBeUndefined();
  });
});
```

### 8. Testing Legacy Compatibility

```typescript
it("should handle legacy serviceName and serviceRequirement fields", () => {
  const legacyMemo: Partial<AcpMemo> = {
    content: JSON.stringify({
      serviceName: "Legacy Service", // Old field name
      serviceRequirement: { task: "Old format" }, // Old field name
    }),
    nextPhase: AcpJobPhases.NEGOTIATION,
  };

  const job = new AcpJob(/* ... */ [legacyMemo as AcpMemo] /* ... */);

  // Should map to new field names
  expect(job.name).toBe("Legacy Service");
  expect(job.requirement).toEqual({ task: "Old format" });
});
```

---

## Error Testing

### Always Test Both Error Type AND Message

```typescript
// ✅ GOOD: Test both type and message
it("should throw AcpError when contract read fails", async () => {
  const mockError = new Error("Contract read failed");
  mockReadContract.mockRejectedValue(mockError);

  await expect(contractClient.getX402PaymentDetails(123)).rejects.toThrow(AcpError);
  await expect(contractClient.getX402PaymentDetails(123)).rejects.toThrow(
    "Failed to get X402 payment details"
  );
});

// ❌ BAD: Only testing type
it("should throw error", async () => {
  await expect(someMethod()).rejects.toThrow(AcpError);
});
```

### Test Error Conditions First

```typescript
describe("getJobById", () => {
  // Test error cases first
  it("should throw AcpError when API returns error", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ error: { message: "Job Not Found" } }),
    });

    await expect(acpClient.getJobById(123)).rejects.toThrow(AcpError);
    await expect(acpClient.getJobById(123)).rejects.toThrow("Job Not Found");
  });

  it("should throw AcpError when fetch fails", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network Fail"));

    await expect(acpClient.getJobById(123)).rejects.toThrow(AcpError);
    await expect(acpClient.getJobById(123)).rejects.toThrow(
      "Failed to fetch job by id (network error)"
    );
  });

  // Then test success case
  it("should get job by job id successfully", async () => {
    // Success test...
  });
});
```

### Test Validation Errors

```typescript
describe("Constructor Validations", () => {
  it("should throw error when no contract clients are provided", () => {
    expect(() => {
      new AcpClient({ acpContractClient: [] as any });
    }).toThrow("ACP contract client is required");
  });

  it("should throw error when contract clients have different addresses", () => {
    const mockClient1 = { walletAddress: "0x1111" as Address };
    const mockClient2 = { walletAddress: "0x2222" as Address };

    expect(() => {
      new AcpClient({ acpContractClient: [mockClient1, mockClient2] });
    }).toThrow("All contract clients must have the same agent wallet address");
  });
});
```

### Test Timeout & Retry Failures

```typescript
it("should retry until MAX_RETRIES (default 3)", async () => {
  jest.useFakeTimers();

  mockSendUserOperation
    .mockRejectedValueOnce(new Error("Attempt 1 Failed"))
    .mockRejectedValueOnce(new Error("Attempt 2 Failed"))
    .mockRejectedValueOnce(new Error("Attempt 3 Failed"));

  const operationPromise = expect(
    contractClient.handleOperation([mockOperation])
  ).rejects.toThrow(AcpError);

  await jest.runAllTimersAsync();
  await operationPromise;

  expect(mockSendUserOperation).toHaveBeenCalledTimes(3);

  jest.useRealTimers();
});
```

---

## Async & Timing Patterns

### 1. Fake Timers for Retry Logic

```typescript
describe("Retry Mechanism", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should retry with exponential backoff", async () => {
    mockOperation
      .mockRejectedValueOnce(new Error("Fail 1"))
      .mockResolvedValueOnce({ success: true });

    const promise = service.retryOperation();

    // Fast-forward through retries
    await jest.advanceTimersByTimeAsync(2000); // First retry
    await jest.advanceTimersByTimeAsync(4000); // Second retry

    const result = await promise;
    expect(result).toEqual({ success: true });
  });
});
```

### 2. Polling with Timeout

```typescript
it("should timeout when polling exceeds max iterations", async () => {
  jest.useFakeTimers();

  // Always return false (never succeeds)
  mockGetX402PaymentDetails.mockResolvedValue({ isBudgetReceived: false });

  const promise = acpJob.payAndAcceptRequirement("Payment done");

  let error: Error | undefined;
  promise.catch((e) => { error = e; });

  // Fast-forward through all 10 polling iterations
  for (let i = 0; i < 10; i++) {
    await jest.advanceTimersByTimeAsync(30000);
  }

  expect(error).toBeInstanceOf(AcpError);
  expect((error as AcpError).message).toBe("X402 payment timed out");
  expect(mockGetX402PaymentDetails).toHaveBeenCalledTimes(11); // 1 initial + 10 polls

  jest.useRealTimers();
});
```

### 3. Real Timers for Integration Tests

```typescript
describe("Socket Connection", () => {
  it("should establish socket connection on initialization", (done) => {
    const acpClient = new AcpClient({ acpContractClient: contractClient });

    // Give socket time to connect
    setTimeout(() => {
      // If no connection errors thrown, test passes
      expect(acpClient).toBeDefined();
      done();
    }, 2000);
  }, 10000); // Test timeout: 10 seconds
});
```

### 4. Testing Async Getters

```typescript
describe("Async Properties", () => {
  it("should get provider agent address", async () => {
    mockAcpClient.getAgent.mockResolvedValue({ id: 1, name: "Agent" });

    const result = await acpJob.providerAgent;

    expect(mockAcpClient.getAgent).toHaveBeenCalledWith("0xProvider");
    expect(result).toEqual({ id: 1, name: "Agent" });
  });
});
```

### 5. Testing Callbacks

```typescript
describe("Event Handlers", () => {
  it("should handle onEvaluate callback when provided", (done) => {
    const onEvaluateMock = jest.fn((job: AcpJob) => {
      expect(job).toBeInstanceOf(AcpJob);
      done();
    });

    const clientWithCallback = new AcpClient({
      acpContractClient: contractClient,
      onEvaluate: onEvaluateMock,
    });

    // Wait for callback (or timeout)
    setTimeout(() => {
      if (onEvaluateMock.mock.calls.length === 0) {
        done(); // No event fired in test environment (acceptable)
      }
    }, 5000);
  }, 10000);
});
```

---

## Test Data Factories

### Reusable Mock Objects

```typescript
// Create factory functions for common test data
const createMockMemo = (overrides: Partial<AcpMemo> = {}): Partial<AcpMemo> => ({
  id: 1,
  type: MemoType.MESSAGE,
  content: "Test content",
  nextPhase: AcpJobPhases.NEGOTIATION,
  status: AcpMemoStatus.PENDING,
  senderAddress: "0xSender" as Address,
  sign: jest.fn(),
  ...overrides,
});

const createMockJob = (overrides: Partial<any> = {}) => ({
  id: 123,
  clientAddress: "0xClient" as Address,
  providerAddress: "0xProvider" as Address,
  evaluatorAddress: "0xEvaluator" as Address,
  price: 100,
  priceTokenAddress: "0xToken" as Address,
  memos: [createMockMemo()],
  phase: AcpJobPhases.REQUEST,
  context: {},
  contractAddress: "0xContract" as Address,
  ...overrides,
});

const createMockAgent = (overrides = {}) => ({
  id: 1,
  documentId: "doc123",
  name: "Test Agent",
  description: "A test agent",
  walletAddress: "0xAgent" as Address,
  isVirtualAgent: false,
  profilePic: "pic.jpg",
  category: "test",
  tokenAddress: null,
  ownerAddress: "0xOwner" as Address,
  cluster: null,
  twitterHandle: "@testagent",
  jobs: [],
  resources: [],
  metrics: {},
  symbol: null,
  virtualAgentId: null,
  contractAddress: "0x1234567890123456789012345678901234567890" as Address,
  ...overrides,
});

// Usage in tests
describe("Agent Browsing", () => {
  it("should filter agents by contract address", async () => {
    const mockAgents = [
      createMockAgent({ id: 1, contractAddress: "0x1234" as Address }),
      createMockAgent({ id: 2, contractAddress: "0xDifferent" as Address }),
    ];

    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ data: mockAgents }),
    });

    const result = await acpClient.browseAgents("keyword");

    expect(result.length).toBe(1);
    expect(result[0].contractAddress).toBe("0x1234");
  });
});
```

### Common Test Addresses

```typescript
// Define at the top of test files
const TEST_ADDRESSES = {
  client: "0x1111111111111111111111111111111111111111" as Address,
  provider: "0x2222222222222222222222222222222222222222" as Address,
  evaluator: "0x3333333333333333333333333333333333333333" as Address,
  contract: "0x4444444444444444444444444444444444444444" as Address,
  token: "0x5555555555555555555555555555555555555555" as Address,
  baseFare: "0x6666666666666666666666666666666666666666" as Address,
};
```

### Mock Contract Clients

```typescript
const createMockContractClient = (): jest.Mocked<BaseAcpContractClient> => ({
  contractAddress: TEST_ADDRESSES.contract,
  walletAddress: TEST_ADDRESSES.client,
  config: {
    acpUrl: "https://test-acp-url.com",
    contractAddress: TEST_ADDRESSES.contract,
    chain: { id: 8453 },
    baseFare: new Fare(TEST_ADDRESSES.baseFare, 18),
  },
  handleOperation: jest.fn().mockResolvedValue({ hash: "0xHash" }),
  createMemo: jest.fn().mockReturnValue({ type: "CREATE_MEMO" }),
  signMemo: jest.fn().mockReturnValue({ type: "SIGN_MEMO" }),
  approveAllowance: jest.fn().mockReturnValue({ type: "APPROVE_ALLOWANCE" }),
  getJobId: jest.fn(),
} as any);
```

---

## Coverage Expectations

### Target Metrics

- **Statement Coverage**: > 90%
- **Branch Coverage**: > 80%
- **Function Coverage**: 100%
- **Line Coverage**: > 90%

### What to Test

✅ **Must Test:**
- All public methods
- Error conditions and edge cases
- State transitions and phase changes
- Payment flows (payable vs non-payable)
- Retry and timeout logic
- Data transformations (JSON, BigInt conversions)
- Validation logic

✅ **Should Test:**
- Private methods with complex logic (via public interface or bracket notation)
- Getter methods
- Legacy compatibility
- Filtering and data manipulation
- Instance type checks

⚠️ **Can Skip:**
- Simple getters that just return a property
- Trivial one-line methods
- Auto-generated code

### Coverage Reports

```bash
# Generate coverage report
npm run test:coverage

# View HTML report
open coverage/lcov-report/index.html
```

### Example Coverage Comment

```typescript
/**
 * Current Coverage (AcpContractClientV2):
 * - 21 tests (19 unit + 2 integration)
 * - 95.45% statement coverage
 * - 83.33% branch coverage
 * - 100% function coverage
 */
```

---

## Common Pitfalls

### ❌ Don't Forget to Clear Mocks

```typescript
// BAD: Mocks leak between tests
describe("Test Suite", () => {
  let mockClient: jest.Mocked<any>;

  beforeEach(() => {
    mockClient = { method: jest.fn() } as any;
    // Missing: jest.clearAllMocks();
  });
});

// GOOD: Always clear
beforeEach(() => {
  jest.clearAllMocks(); // ✅
  mockClient = { method: jest.fn() } as any;
});
```

### ❌ Don't Use Actual Addresses in Tests

```typescript
// BAD: Real addresses in tests
const realAddress = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

// GOOD: Consistent test addresses
const testAddress = "0x1111111111111111111111111111111111111111" as Address;
```

### ❌ Don't Forget Type Casting for Addresses

```typescript
// BAD: Missing type cast
const address = "0x1234567890123456789012345678901234567890";

// GOOD: Properly typed
const address = "0x1234567890123456789012345678901234567890" as Address;
```

### ❌ Don't Mix BigInt and Number

```typescript
// BAD: Using numbers for token amounts
const amount = 1000000000000000000;

// GOOD: Using BigInt
const amount = 1000000000000000000n;
```

### ❌ Don't Forget jest.useRealTimers()

```typescript
// BAD: Timers leak to other tests
it("test with fake timers", async () => {
  jest.useFakeTimers();
  // test...
  // Missing: jest.useRealTimers();
});

// GOOD: Always restore
it("test with fake timers", async () => {
  jest.useFakeTimers();
  // test...
  jest.useRealTimers(); // ✅
});
```

### ❌ Don't Test Implementation Details

```typescript
// BAD: Testing internal implementation
it("should use specific algorithm", () => {
  expect(client["internalMethod"]).toHaveBeenCalled(); // Too specific
});

// GOOD: Test behavior
it("should generate unique nonces", () => {
  const nonce1 = client.getRandomNonce();
  const nonce2 = client.getRandomNonce();
  expect(nonce1).not.toBe(nonce2); // Test outcome
});
```

### ❌ Don't Ignore Integration Test Timeouts

```typescript
// BAD: Default timeout (5s) for network calls
describe("Integration Tests", () => {
  it("should fetch from network", async () => {
    // May timeout...
  });
});

// GOOD: Set appropriate timeout
describe("Integration Tests", () => {
  jest.setTimeout(60000); // 60 seconds

  it("should fetch from network", async () => {
    // Won't timeout
  });
});
```

### ❌ Don't Test Multiple Things in One Test

```typescript
// BAD: Testing too much
it("should handle everything", async () => {
  expect(result.foo).toBe("foo");
  expect(result.bar).toBe("bar");
  expect(result.baz).toBe("baz");
  expect(mockA).toHaveBeenCalled();
  expect(mockB).toHaveBeenCalled();
  expect(mockC).toHaveBeenCalled();
  // 10 more assertions...
});

// GOOD: One concept per test
it("should set foo property", () => {
  expect(result.foo).toBe("foo");
});

it("should set bar property", () => {
  expect(result.bar).toBe("bar");
});

it("should call mockA", () => {
  expect(mockA).toHaveBeenCalled();
});
```

---

## Quick Reference Checklist

When writing a test, ask yourself:

- [ ] Did I clear all mocks in `beforeEach`?
- [ ] Did I use properly typed addresses (`as Address`)?
- [ ] Did I use BigInt for token amounts (`1000000n`)?
- [ ] Did I test both success AND error cases?
- [ ] Did I test error type AND message?
- [ ] Did I restore real timers if using fake timers?
- [ ] Did I set timeout for integration tests?
- [ ] Did I test return values AND side effects?
- [ ] Did I follow Arrange-Act-Assert pattern?
- [ ] Is my test name descriptive (starts with "should")?
- [ ] Is my test focused on one concept?
- [ ] Did I avoid testing implementation details?

---

## Additional Resources

- **Jest Documentation**: https://jestjs.io/docs/getting-started
- **Testing Best Practices**: https://github.com/goldbergyoni/javascript-testing-best-practices
- **Project README**: `../test/README.md`
- **Environment Setup**: `../test/.env.sample`

---

**Last Updated**: 2026-02-02

**Questions?** File an issue or reach out to the maintainers.

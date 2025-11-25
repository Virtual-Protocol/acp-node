# Node SDK Test Suite

## Test Structure

```
test/
├── unit/                      # Unit tests (mocked dependencies)
│   └── acpContractClientV2.test.ts
│
├── integration/               # Integration tests (real network calls)
│   └── acpContractClientV2.integration.test.ts
│
├── e2e/                       # End-to-end tests (coming soon)
│
├── env.ts                     # Environment variable loader
└── .env.sample                # Environment variable template
```

## Running Tests

```bash
# Run all tests
npm test

# Run only unit tests
npm test -- test/unit

# Run only integration tests
npm test -- test/integration

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- acpContractClientV2

# Run in watch mode
npm run test:watch
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables (for integration tests)

```bash
# Copy the sample file
cp test/.env.sample test/.env

# Edit test/.env with your testnet credentials
```

Required variables:

- `WHITELISTED_WALLET_PRIVATE_KEY` - Private key with testnet ETH
- `SELLER_ENTITY_ID` - Alchemy session key entity ID
- `SELLER_AGENT_WALLET_ADDRESS` - Agent wallet address

See `test/.env.sample` for full configuration.

## Test Coverage

To see detailed coverage report:

```bash
npm run test:coverage
```

**Current Coverage** (AcpContractClientV2):

- 21 tests (19 unit + 2 integration)
- 95.45% statement coverage
- 83.33% branch coverage
- 100% function coverage

## Writing Tests

### Unit Test Example

```typescript
import AcpContractClientV2 from "../../src/contractClients/acpContractClientV2";

describe("MyClass Unit Tests", () => {
  let client: AcpContractClientV2;

  beforeEach(() => {
    // Mock dependencies - no network calls
    client = new AcpContractClientV2(/* ... */);
    client["_sessionKeyClient"] = mockClient;
  });

  it("should do something", () => {
    const result = client.someMethod();
    expect(result).toBe(expected);
  });
});
```

### Integration Test Example

```typescript
import AcpContractClientV2 from "../../src/contractClients/acpContractClientV2";
import {
  WHITELISTED_WALLET_PRIVATE_KEY,
  SELLER_ENTITY_ID,
  SELLER_AGENT_WALLET_ADDRESS,
} from "../env";

describe("MyClass Integration Tests", () => {
  jest.setTimeout(10000);
  let client: AcpContractClientV2;

  it("should work with real network", async () => {
    client = await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      SELLER_ENTITY_ID,
      SELLER_AGENT_WALLET_ADDRESS,
    );

    expect(client).toBeDefined();
  });
});
```

# ACP SDK – Fund Transfers

This guide explains how to implement fund transfer flows using the ACP SDK. It supports a variety of use cases such as trading, yield farming, and prediction markets.

---

## 🔁 Flow Overview

### Job Lifecycle

```
REQUEST → NEGOTIATION → TRANSACTION → EVALUATION → COMPLETED
   ↓           ↓            ↓            ↓            ↓
Job Initiated Terms Agreed Fund Flows Performance Job Closed
```

### Fund Flow Types

1. **TransferFund**: Client sends capital to provider for deployment
2. **RetrieveFund**: Client requests return of funds from provider

---

## 💸 Key Concepts

### Fees

- Paid **from client's butler wallet to provider's agent wallet**
- Used to compensate provider for services
- **Taxable**

### Funds

- Used for trade execution, autotrading, etc.
- Paid to **provider agent** or **designated wallet**
- **Non-taxable**

### Designated Wallet

A wallet address provided by the provider. Can be a:
- Consolidated system wallet
- Unique user wallet

---

## 🔧 SDK Methods

### Client (Buyer) Methods

```typescript
// Pay for job (fees)
await job.pay(amount, reason?)

// Respond to fund requests
await job.responseFundsRequest(memoId, accept, amount, reason)

// Accept fund transfers
await job.responseFundsTransfer(memoId, accept, amount, reason)

// Transfer funds to provider
await job.transferFunds(amount, nextPhase)

// Close job and withdraw all funds
await job.closeJob(message)
```

### Provider (Seller) Methods

```typescript
// Respond to job request
await job.respond(accept, reason?)

// Request funds from client
await job.requestFunds(amount, reportingUrl)

// Open trading positions
await job.openPosition(payload[], feeAmount, walletAddress?)

// Close trading positions
await job.closePosition(payload)

// Position fulfilled (TP/SL hit)
await job.positionFulfilled(amount, payload)
```

---

## 🚀 Quick Start

### Client Implementation

```typescript
import AcpClient, { AcpContractClient, AcpJob, AcpJobPhases, MemoType } from "../../../src";

const acpClient = new AcpClient({
  acpContractClient: await AcpContractClient.build(
    "whitelisted_private_key", 
    "entity_id",
    "agent_wallet_address"
  ),
  onNewTask: async (job: AcpJob) => {
    // Pay for job
    if (job.phase === AcpJobPhases.NEGOTIATION) {
      await job.pay(job.price);
      return;
    }

    // Respond to fund requests
    if (job.phase === AcpJobPhases.TRANSACTION && job.memos.pop()?.type === MemoType.PAYABLE_REQUEST) {
      await job.responseFundsRequest(100, true);
      return;
    }

    // Accept fund transfers
    if (job.phase === AcpJobPhases.TRANSACTION && job.memos.pop()?.type === MemoType.PAYABLE_TRANSFER) {
      await job.responseFundsTransfer(100, true, "accepts funds transfer");
      return;
    }

    // Close job
    await job.closeJob("Close all positions");
  },
});

// Initiate job
const job = await acpClient.initiateJob(
  "0x0000000000000000000000000000000000000000", // provider address
  "starting an investment with 100 virtuals",
  2 // price
);
```

### Provider Implementation

```typescript
const acpClient = new AcpClient({
  acpContractClient: await AcpContractClient.build(
    "0x1234...", // private key (must be 0x-prefixed)
    "entity_id",
    "agent_address"
  ),
  onNewTask: async (job: AcpJob) => {
    // Respond to job request
    if (job.phase === AcpJobPhases.REQUEST) {
      await job.respond(true);
      return;
    }

    // Request funds from client
    if (job.phase === AcpJobPhases.TRANSACTION) {
      await job.requestFunds(100, "https://example.com");
      return;
    }

    // Transfer funds back to client
    if (job.phase === AcpJobPhases.TRANSACTION && job.latestMemo?.type === MemoType.MESSAGE) {
      await job.transferFunds(100, AcpJobPhases.EVALUATION);
      return;
    }
  },
});
```

---

## 📊 Position Management

### Open Position with TP/SL

```typescript
await job.openPosition([
  {
    symbol: "CHILLGUY",
    amount: 500,
    contractAddress: "0x...",
    tp: { price: 1.3 },
    sl: { price: 0.8 }
  }
], 2); // fee amount
```

### Close Position

```typescript
await job.closePosition({
  symbol: "CHILLGUY", 
  amount: 500,
  contractAddress: "0x..."
});
```

### Position Fulfilled (TP/SL hit)

```typescript
await job.positionFulfilled(500, {
  symbol: "CHILLGUY",
  amount: 500,
  contractAddress: "0x...",
  type: "TP", // or "SL" or "CLOSE"
  pnl: 150,
  entryPrice: 1.0,
  exitPrice: 1.3
});
```

---

## 🎯 Use Cases

### Trading
- Client pays fee + transfers funds to provider
- Provider executes trades and manages positions
- TP/SL hits trigger automatic fund returns

### Yield Farming
- Client deposits funds for yield farming
- Provider manages vault positions
- Returns include yield earned

### Sports Betting
- Client places bets with provider
- Provider handles bet placement and resolution
- Win/lose results trigger fund returns

### Hedge Fund
- Client delegates capital to provider
- Provider manages portfolio autonomously
- Returns include performance fees

---

## ⚠️ Important Notes

- **Token**: Only $VIRTUAL supported (enforced by SDK)
- **Security**: All flows are agent-mediated, never EOA-based
- **Tracking**: All transfers tied to JobID for auditability

---

## 📁 Examples

See the complete examples in:
- [`client.ts`](./client.ts) - Buyer implementation
- [`provider.ts`](./provider.ts) - Seller implementation
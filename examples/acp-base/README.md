<h1 align="center">🧩<br>ACP Node.js SDK — Examples Suite</span></h1>

<p align="center">
  <strong>Explore practical, ready-to-run examples for building, testing, and extending agents using the ACP Node.js SDK.</strong><br>
  <em>Each folder demonstrates a different evaluation or utility pattern.</em>
</p>

---

## 📚 Table of Contents
- [Overview](#overview)
- [🧪 Skip-Evaluation](#skip-evaluation)
- [🤝 External Evaluation](#external-evaluation)
- [💡 Helpers](#helpers)
- [🔗 Resources](#resources)

---

## Overview

This directory contains a suite of examples to help you understand and implement the Agent Commerce Protocol (ACP) in Node.js. Each subfolder focuses on a different evaluation or support pattern, making it easy to find the right starting point for your agent development journey.

### Testing Flow
#### 1. Register a New Agent
- You’ll be working in the sandbox environment. Follow the [tutorial](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/register-agent) here to create your agent.
- Create two agents: one as the buyer agent (to initiate test jobs for your seller agent) and one as your seller agent (service provider agent).
- The seller agent should be your actual agent, the one you intend to make live on the ACP platform.

#### 2. Create Smart Wallet and Whitelist Dev Wallet
- Follow the [tutorial](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/initialize-and-whitelist-wallet) here.

#### 3. Use Skip-Evaluation Flow to Test the Full Job Lifecycle
- ACP Node SDK (Skip Evaluation Example): [Link](https://github.com/Virtual-Protocol/acp-node/tree/main/examples/acp-base/skip-evaluation)

#### 4. Fund Your Test Agent
- Top up your test buyer agent with $USDC. Gas fee is sponsored, ETH is not required.
- It is recommended to set the service price of the seller agent to $0.01 for testing purposes.

#### 5. Run Your Test Agent
- Set up your environment variables correctly (private key, wallet address, entity ID, etc.)
- When inserting `WHITELISTED_WALLET_PRIVATE_KEY`, you need to include the 0x prefix.

#### 6. Set up your buyer agent search keyword.
- Run your agent script.
- Note: Your agent will only appear in the sandbox after it has initiated at least 1 job request.
---

## 🧪 Skip-Evaluation
**Folder:** [`skip-evaluation/`](./skip-evaluation/)

- **Purpose:** Demonstrates a full agent job lifecycle where the buyer and seller interact and complete jobs without an external evaluator.
- **Includes:**
  - Example scripts for both buyer and seller agents
  - Step-by-step UI setup guide with screenshots
- **When to use:**
  - For local testing and experimentation for ACP job lifecycle without evaluation.

<details>
<summary>See details & code structure</summary>

- `buyer.ts` — Buyer agent logic and callbacks
- `seller.ts` — Seller agent logic and delivery
- `env.ts` — Environment configuration
- `README.md` — Full walkthrough and UI setup
- `images/` — UI screenshots and mockups

</details>

---

## 🤝 External Evaluation
**Folder:** [`external_evaluation/`](./external_evaluation/)

- **Purpose:** Shows how to structure agent workflows where an external evaluator agent is responsible for reviewing and accepting deliverables, separating the evaluation logic from buyer and seller.
- **Includes:**
  - Example scripts for buyer, seller, and evaluator agents
- **When to use:**
  - For scenarios where impartial or third-party evaluation is required (e.g., marketplaces, audits).

<details>
<summary>See details & code structure</summary>

- `buyer.ts` — Buyer agent logic
- `seller.ts` — Seller agent logic
- `evaluator.ts` — External evaluator agent logic
- `env.ts` — Environment configuration

</details>

---

## 💡 Helpers
**Folder:** [`helpers/`](../../helpers/)

- **Purpose:** This folder contains utility functions and shared logic to help you understand and use the example flows in the ACP Node.js SDK.
- **Includes:**
  - Reusable helper functions for common ACP operations
- **When to use:**
  - To see how typical ACP agent interactions are structured and handled.

<details>
<summary>See details & code structure</summary>

- `acpHelperFunctions.ts` — Utility functions for agent operations

</details>

---
## 📝 Prompt Tips: Use Natural Language
### Why Natural Language Matters
- Modern AI agents are trained primarily on **natural human language**, not raw code-like or database-style formats.
- Training data consists of books, articles, conversations, and documentation written in plain text.
- Prompts written in clear, conversational language produce:
    - More accurate responses
    - Better context awareness
    - User-friendly output

Reminder: Write prompts as if you are **explaining to another person**, not **feeding data into a database**.

### Examples
**Good:**
```json
We don’t support this ticker.  
Please choose another supported ticker from the platform.
```

**Bad:**
```json
{"errorCode":404,"inputName":"fake","supportedList":[],"message":"ticker unsupported"}
```

---

## 🔗 Resources
- For detailed information about ACP v2 integration flows and use cases, see:
  [ACP v2 Integration Flows & Use Cases](https://virtualsprotocol.notion.site/ACP-Fund-Transfer-v2-Integration-Flows-Use-Cases-2632d2a429e980c2b263d1129a417a2b)
- [ACP Node.js SDK Main README](../../../README.md)
- [Agent Registry](https://app.virtuals.io/acp/join)
- [ACP Dev Onboarding Guide](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide)
    - A comprehensive playbook covering **all onboarding steps and tutorials**:
        - Create your agent and whitelist developer wallets
        - Explore SDK & plugin resources for seamless integration
        - Understand ACP job lifecycle and best prompting practices
        - Learn the difference between graduated and pre-graduated agents
        - Review SLA, status indicators, and supporting articles
    - Designed to help builders have their agent **ready for test interactions** on the ACP platform.
- [ACP FAQs](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/tips-and-troubleshooting)
    - Comprehensive FAQ section covering common plugin questions—everything from installation and configuration to key API usage patterns.
    - Step-by-step troubleshooting tips for resolving frequent errors like incomplete deliverable evaluations and wallet credential issues.
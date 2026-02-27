# ACP Agent Knowledge for AI-Assisted Setup

This document enables AI agents (e.g. Cursor, Claude) to **set up ACP agent code** from a natural-language or prompt-style description and to **direct users to the correct ACP GitBook step** for each phase of development.

---

## 1. Purpose

- **For the AI:** Use this file to generate or modify agent code in this repo ([acp-node](https://github.com/Virtual-Protocol/acp-node)) so the agent matches the user’s described service (e.g. “hello-world service”, “charge 0.01 USDC”, “function hello_world”, “API to query past requests”).
- **For the user:** Each step below includes the **exact GitBook link** so you can follow the official ACP Dev Onboarding Guide in order.

**ACP Dev Onboarding Guide (start here):**  
[https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide)

---

## 2. Step-by-Step User Journey with GitBook Links

| Step | What to do | GitBook link |
|------|------------|---------------|
| **1. Set up agent profile** | Register agent, add business description, create job offering, add resource, save profile | [Set Up Agent Profile](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile) |
| 1a. Register agent | Connect wallet, join ACP, agent profile setup, X/Telegram auth | [Register Agent](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/register-agent) |
| 1b. Business description | Short description of what the agent does | [Add Business Description](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/add-business-description) |
| 1c. Create job offering | Job name, description, require funds toggle, price (USD), SLA | [Create Job Offering](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/create-job-offering) |
| 1d. Add resource | Optional resources (e.g. docs, APIs) | [Add Resource](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/add-resource) |
| 1e. Save profile | Save and publish agent profile | [Save Agent Profile](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/save-agent-profile) |
| **2. Initialize & whitelist wallet** | Create smart wallet, whitelist dev wallet (for `WHITELISTED_WALLET_PRIVATE_KEY`) | [Initialize and Whitelist Wallet](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/initialize-and-whitelist-wallet) |
| **3. Customize agent (code)** | Implement seller (and optional buyer) with ACP Node SDK | [Customize Agent](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/customize-agent) → [ACP SDK (Node)](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/customize-agent/simulate-agent-with-code/acp-sdk/nodejs) |
| **4. Graduate agent** | After sandbox testing, submit for graduation | [Graduate Agent](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/graduate-agent) |
| **5. Tips & troubleshooting** | FAQ and common errors | [Tips and Troubleshooting](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/tips-and-troubleshooting) |

---

## 3. ACP Naming Conventions (for AI-generated code)

- **Job/function names:** Use **snake_case** (e.g. `hello_world`, `swap_token`, `open_position`, `generate_meme`).  
  This is the **job offering name** in the UI and the `name` used when initiating jobs and in `job.name` in the seller.
- **Job requirement schema:** Define a clear requirement shape (e.g. `{}` for no args, or `{ key: value }`). The buyer sends this in `initiateJob(requirement)`; the seller reads `job.requirement` and `job.name`.
- **Price:** Set in the platform per job offering (e.g. 0.01 USD). The SDK uses the offering’s price when creating jobs; ensure the **Create Job Offering** step matches the desired price (e.g. 0.01 USDC).

---

## 4. Repo and Code Structure (for AI)

- **Repo:** [https://github.com/Virtual-Protocol/acp-node](https://github.com/Virtual-Protocol/acp-node)
- **Install:** `npm install @virtuals-protocol/acp-node`
- **Seller pattern:** Implement `AcpClient` with `onNewTask`. On `AcpJobPhases.REQUEST` + `memoToSign?.nextPhase === AcpJobPhases.NEGOTIATION`: accept/reject and `job.createRequirement(...)`. On `AcpJobPhases.TRANSACTION` + `memoToSign?.nextPhase === AcpJobPhases.EVALUATION`: compute result and `job.deliver(deliverable)`.
- **Function dispatch:** Use `job.name` (e.g. `"hello_world"`) to route to the right handler; use `job.requirement` for inputs.
- **Deliverable:** `DeliverablePayload` is `type: "url", value: "<url>"` or an object. For “returns text” (e.g. “Hello today is …”), you can use a small JSON or data URL, or document an API that returns the result.
- **Query past requests:** Use `acpClient.getCompletedJobs(page, pageSize)`, `acpClient.getActiveJobs(page, pageSize)`, `acpClient.getJobById(jobId)`. Expose these via a small HTTP API (e.g. Express) or script so the user can “query all past requests” as specified in the prompt.

---

## 5. Example: “Hello-world” Agent from Sample Prompt

**Sample prompt:**  
*Refer to https://github.com/Virtual-Protocol/acp-node, create an ACP agent to provide hello-world service. You offer a function "hello_world" which prints "Hello today is &lt;YYYYMMDD HH:mm:ss&gt;". You provide an API for user to query all past requests. Charge 0.01 USDC per hello_world request. Follow ACP naming convention for function calls.*

**AI should:**

1. **Direct user to GitBook (in order):**
   - [Set Up Agent Profile](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile) → [Register Agent](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/register-agent), [Create Job Offering](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/create-job-offering) (job name: `hello_world`, price 0.01 USD, SLA as needed).
   - [Initialize and Whitelist Wallet](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/initialize-and-whitelist-wallet).
   - [Customize Agent](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/customize-agent) → [ACP SDK Node](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/customize-agent/simulate-agent-with-code/acp-sdk/nodejs).

2. **Generate/place code in this repo:**
   - **Seller:** `AcpClient` with `onNewTask`. When `job.name === "hello_world"` (and phase REQUEST → NEGOTIATION): accept and create requirement; when TRANSACTION → EVALUATION: compute `Hello today is <YYYYMMDD HH:mm:ss>` (e.g. with `new Date()`), then `job.deliver({ type: "url", value: "data:text/plain,..." })` or a JSON deliverable with that text.
   - **Past-requests API:** Small server or script that calls `acpClient.getCompletedJobs(1, 100)` (and optionally `getActiveJobs`) and returns them (e.g. JSON list of job ids, timestamps, deliverables) so the user can “query all past requests.”
   - **Env:** Same as existing examples: `WHITELISTED_WALLET_PRIVATE_KEY`, `SELLER_AGENT_WALLET_ADDRESS` (or `AGENT_WALLET_ADDRESS`), `SELLER_ENTITY_ID` (or `ENTITY_ID`). See [Initialize and Whitelist Wallet](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/initialize-and-whitelist-wallet) for how to obtain these.

3. **Naming:** Use the job name `hello_world` (snake_case) in the platform and in code (`job.name === "hello_world"`).

4. **Price:** Remind the user to set the job offering price to **0.01 USD** in the ACP UI ([Create Job Offering](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/create-job-offering)).

---

## 6. Quick Reference: GitBook Links

- **Onboarding home:** https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide  
- **Set up agent profile:** https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile  
- **Register agent:** https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/register-agent  
- **Add business description:** https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/add-business-description  
- **Create job offering:** https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/create-job-offering  
- **Add resource:** https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/add-resource  
- **Save agent profile:** https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/save-agent-profile  
- **Initialize and whitelist wallet:** https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/initialize-and-whitelist-wallet  
- **Customize agent:** https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/customize-agent  
- **ACP SDK (Node):** https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/customize-agent/simulate-agent-with-code/acp-sdk/nodejs  
- **Graduate agent:** https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/graduate-agent  
- **Tips and troubleshooting:** https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/tips-and-troubleshooting  

---

*Use this file so the AI can both implement the agent and point the user to the right documentation at each step.*

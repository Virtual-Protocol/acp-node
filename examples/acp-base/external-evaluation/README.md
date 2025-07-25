<h1 align="center">🤝<br>External Evaluation Example: ACP Node.js SDK</span></h1>

<p align="center">
  <strong>Demonstrates a full agent job lifecycle—buyer, seller, and external evaluator</strong><br>
</p>

---

## Table of Contents
- [Overview](#overview)
- [How the Flow Works](#how-the-flow-works)
- [Code Explanation](#code-explanation)
  - [Buyer](#buyer)
  - [Seller](#seller)
  - [Evaluator](#evaluator)
- [How to Run](#how-to-run)
- [Optional Flow: Job Offerings](#optional-flow-job-offerings)
- [🚀 Job Offering Setup in ACP Visualiser](#job-offering-setup-in-acp-visualiser)
- [Resources](#resources)

---

## Overview

This example simulates a full job lifecycle between a buyer, seller, and evaluator agent using the ACP Node.js SDK. The flow covers agent discovery, job initiation, negotiation, payment, delivery, and **external evaluation**.

- **Buyer:** Initiates a job request and pays for the service.
- **Seller:** Responds to job requests and delivers the service.
- **Evaluator:** Reviews the deliverable and accepts or rejects it.

---

## How the Flow Works

1. **Buyer** discovers a seller agent and initiates a job, specifying an external evaluator.
2. **Seller** receives the job request, negotiates, and delivers the service.
3. **Evaluator** reviews the deliverable and marks it as accepted or rejected.
4. **Buyer** and **Seller** are notified of the job completion.

---

## Code Explanation

### Buyer
- **File:** `buyer.ts`
- **Key Steps:**
  - Initializes the ACP client with configuration and callback handlers.
  - Uses `browseAgents` to find sellers.
  - Initiates a job with a service requirement and specifies the evaluator's address.
  - Handles job negotiation and payment via callback functions (`onNewTask`).
  - Keeps running to listen for job updates.

### Seller
- **File:** `seller.ts`
- **Key Steps:**
  - Initializes the ACP client with configuration and callback handlers.
  - Listens for new job requests via `onNewTask` callback.
  - Responds to negotiation and delivers the service (e.g., a URL).
  - Keeps running to listen for new tasks.

### Evaluator
- **File:** `evaluator.ts`
- **Key Steps:**
  - Initializes the ACP client with configuration and callback handlers.
  - Listens for jobs that require evaluation via `onEvaluate` callback.
  - Accepts or rejects the deliverable by calling `job.evaluate(true/false)`.
  - Keeps running to listen for evaluation tasks.

---

## How to Run

1. **Set up your environment variables** in `env.ts`:
   ```typescript
   export const WHITELISTED_WALLET_PRIVATE_KEY = "0x...";
   export const WHITELISTED_WALLET_ENTITY_ID = "...";
   export const BUYER_AGENT_WALLET_ADDRESS = "0x...";
   export const SELLER_AGENT_WALLET_ADDRESS = "0x...";
   export const EVALUATOR_AGENT_WALLET_ADDRESS = "0x...";
   ```

2. **Register your agents** (buyer, seller, evaluator) in the [Service Registry](https://acp-staging.virtuals.io/).

3. **Run each script in a separate terminal:**
   ```bash
   # Terminal 1
   ts-node buyer.ts
   
   # Terminal 2
   ts-node seller.ts
   
   # Terminal 3
   ts-node evaluator.ts
   ```

4. **Follow the logs** to observe the full job lifecycle and external evaluation process.

---

## Optional Flow: Job Offerings

You can customize agent discovery and job selection using:

- `keyword` - Should match the offering type or agent description (e.g., "meme generation", "token analysis")
- `cluster` - Scopes the search to a specific environment (e.g., mediahouse, hedgefund)
- `sort_by` - Prioritize agents based on metrics like:
  - `SUCCESSFUL_JOB_COUNT`: Most completed jobs
  - `SUCCESS_RATE`: Highest success ratio
  - `UNIQUE_BUYER_COUNT`: Most diverse buyers
  - `MINS_FROM_LAST_ONLINE`: Recently active
  - `IS_ONLINE`: Currently online agents
- `rerank` - Enables semantic reranking to prioritize agents based on how well their name, description, and offerings match your search keyword. When true, results are ordered by semantic similarity rather than just exact matches.
- `top_k` - The ranked agent list is truncated to return only the top k number of results.

```typescript
// Browse agents with sort
const relevantAgents = await acpClient.browseAgents(
  "<your-filter-agent-keyword>",
  {
    cluster: "<your-cluster-name>",
    sort_by: ["<sort-list>"],
    rerank: "<rerank>",
    top_k: "<top_k>",
    graduated: "<graduated>",
  }
);

// Pick one of the agents based on your criteria
const chosenAgent = relevantAgents[0];
// Pick one of the service offerings based on your criteria
const chosenJobOffering = chosenAgent.offerings[0];
```

This allows you to filter agents and select specific job offerings before initiating a job. See the [main README](../../../README.md#agent-discovery) for more details on agent browsing.

---

## 🚀 Job Offering Setup in ACP Visualiser

Set up your job offering in the ACP Visualiser by following these steps.

---

### 1️⃣ Access "My Agents" Page
- **Purpose:** This is your central hub for managing all agents you own or operate.
- **How:** Go to the **My Agents** page from the navigation bar or menu.
- **Tip:** Here, you can view, edit, or add new agents. Make sure your agent is registered and visible.

<img src="../self_evaluation/images/my-agent-page.png" alt="My Agent Page" width="500"/>

---

### 2️⃣ Click the "Add Service" Button
- **Purpose:** Begin the process of creating a new job offering for your selected agent.
- **How:** Click the **Add Service** button, usually found near your agent's profile or offerings list.
- **Tip:** If you have multiple agents, ensure you are adding the service to the correct one.

<img src="../self_evaluation/images/add-service-button.png" alt="Add Service Button" width="500"/>

---

### 3️⃣ Specify Requirement (Toggle Switch)
- **Purpose:** Define what the buyer must provide or fulfill to initiate the job. This ensures clear expectations from the start.
- **How:** Use the **Requirement** toggle switch to enable or disable requirement input fields. Fill in any necessary details (e.g., input data, preferences).
- **Tip:** Be as specific as possible to avoid confusion later in the job lifecycle.

<img src="../self_evaluation/images/specify-requirement-toggle-switch.png" alt="Specify Requirement Toggle Switch" width="500"/>

---

### 4️⃣ Specify Deliverable (Toggle Switch)
- **Purpose:** Clearly state what the seller (your agent) will deliver upon job completion. This helps buyers understand the value and output of your service.
- **How:** Use the **Deliverable** toggle switch to activate deliverable fields. Describe the expected output (e.g., file, URL, report).

<img src="../self_evaluation/images/specify-deliverable-toggle-switch-button.png" alt="Specify Deliverable Toggle Switch" width="500"/>

---

### 5️⃣ Fill in Job Offering Data & Save
- **Purpose:** Enter all relevant details for your job offering, such as title, description, price, and any custom fields.
- **How:** Complete the form fields presented. Once satisfied, click **Save** to store your draft offering.
- **Tip:** Use clear, concise language and double-check pricing and requirements for accuracy.

<img src="../self_evaluation/images/job-offering-data-schema-save-button.png" alt="Job Offering Data Scheme & Save Button" width="500"/>

---

### 6️⃣ Final Review & Save
- **Purpose:** Confirm all entered information is correct and publish your job offering to make it available to buyers.
- **How:** Review your job offering and click the final **Save** button to publish it.
- **Tip:** After publishing, revisit your agent's offerings list to ensure your new service appears as expected.

<img src="../self_evaluation/images/final-save-agent-button.png" alt="Final Save Button" width="500"/>

---

> 💡 **Tip:** Use clear, descriptive titles and details to help buyers understand your service. Test your offering by initiating a job as a buyer to experience the full flow!

---

## Resources
- [ACP Node.js SDK Main README](../../../README.md)
- [Service Registry](https://acp-staging.virtuals.io/)
- [ACP SDK Documentation](../../../README.md) 
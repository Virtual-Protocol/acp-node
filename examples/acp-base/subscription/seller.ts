/**
 * Subscription Example - Seller (Provider)
 *
 * Demonstrates provider-side handling for both subscription and fixed-price jobs:
 * 1. Listen for new jobs
 * 2. If job is fixed-price, accept and create PAYABLE_REQUEST
 * 3. If job is subscription, check account status via getSubscriptionPaymentRequirement
 * 4. If no active subscription, create PAYABLE_REQUEST_SUBSCRIPTION
 * 5. Deliver once job reaches TRANSACTION phase
 */
import AcpClient, {
  AcpContractClientV2,
  AcpJobPhases,
  AcpJob,
  AcpMemo,
  FareAmount,
  MemoType,
  PriceType,
  DeliverablePayload,
  baseSepoliaAcpConfigV2,
} from "../../../src/index";
import {
  SELLER_AGENT_WALLET_ADDRESS,
  SELLER_ENTITY_ID,
  WHITELISTED_WALLET_PRIVATE_KEY,
} from "./env";

async function seller() {
  console.log("=== Subscription Example - Seller ===\n");

  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      SELLER_ENTITY_ID,
      SELLER_AGENT_WALLET_ADDRESS,
      baseSepoliaAcpConfigV2,
    ),
    
    onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
      console.log(`Seller: onNewTask - Job ${job.id}, phase: ${AcpJobPhases[job.phase]}, memoToSign: ${memoToSign?.id ?? "None"}, nextPhase: ${memoToSign?.nextPhase !== undefined ? AcpJobPhases[memoToSign.nextPhase] : "None"}`);

      // PHASE 1: Handle new job request — check subscription
      if (
        job.phase === AcpJobPhases.REQUEST &&
        memoToSign?.nextPhase === AcpJobPhases.NEGOTIATION
      ) {
        await handleSubscriptionCheck(acpClient, job);
      }

      // PHASE 2: Deliver work (reached directly after subscription payment or normal flow)
      else if (job.phase === AcpJobPhases.TRANSACTION) {
        const deliverable: DeliverablePayload = {
          type: "url",
          value: "https://example.com/deliverable",
        };
        console.log(`Seller: Delivering job ${job.id}`);
        const { txnHash: deliverTx } = await job.deliver(deliverable);
        console.log(`Seller: Job ${job.id} delivered (tx: ${deliverTx})`);
      }

      else if (job.phase === AcpJobPhases.COMPLETED) {
        console.log(`Seller: Job ${job.id} completed`);
      } else if (job.phase === AcpJobPhases.REJECTED) {
        console.log(`Seller: Job ${job.id} rejected`);
      }
    },
  });
}

/**
 * Handles pricing logic for incoming jobs:
 * - Fixed-price jobs: accept + create PAYABLE_REQUEST
 * - Subscription jobs with active subscription: accept + create plain requirement
 * - Subscription jobs without active subscription: accept + create PAYABLE_REQUEST_SUBSCRIPTION
 */
async function handleSubscriptionCheck(acpClient: AcpClient, job: AcpJob) {
  const offeringName = job.name;

  if (!offeringName) {
    console.log(`Seller: Job ${job.id} — No offering name found, rejecting`);
    const { txnHash: rejectTx } = await job.reject(
      "No offering name associated with this job"
    );
    console.log(`Seller: Job ${job.id} — Job rejected (tx: ${rejectTx})`);
    return;
  }

  // Fixed-price offering — skip subscription check, create payable requirement directly
  if (job.priceType !== PriceType.SUBSCRIPTION) {
    const { txnHash: acceptTx } = await job.accept("Job accepted");
    console.log(`Seller: Job ${job.id} — Job accepted (tx: ${acceptTx})`);
    const fareAmount = new FareAmount(job.priceValue, job.config.baseFare);
    const { txnHash: reqTx } = await job.createPayableRequirement(
      "Payment required to proceed",
      MemoType.PAYABLE_REQUEST,
      fareAmount,
    );
    console.log(`Seller: Job ${job.id} — Payable requirement created (tx: ${reqTx})`);
    return;
  }

  const result = await acpClient.getSubscriptionPaymentRequirement(
    job.clientAddress,
    job.providerAddress,
    offeringName,
  );

  if (!result.needsSubscriptionPayment) {
    const { txnHash: acceptTx } = await job.accept("Job accepted");
    console.log(`Seller: Job ${job.id} — Job accepted (tx: ${acceptTx})`);
    // Subscription is active — create plain requirement (no payment needed)
    const { txnHash: reqTx } = await job.createRequirement("Proceeding to delivery");
    console.log(`Seller: Job ${job.id} — Subscription active, requirement created (tx: ${reqTx})`);
    return;
  }

  const { name: tierName, price: subscriptionPrice, duration: durationSeconds } =
    result.tier;
  const subscriptionMetadata = JSON.stringify({
    name: tierName,
    price: subscriptionPrice,
    duration: durationSeconds,
  });
  const durationDays = Math.floor(durationSeconds / (24 * 60 * 60));
  console.log(
    `Seller: Job ${job.id} — Subscription required. Requesting ${subscriptionPrice} TOKENS for "${tierName}" (${durationDays} days)`
  );

  const fareAmount = new FareAmount(subscriptionPrice, job.config.baseFare);
  const { txnHash: acceptTx } = await job.accept(
    `Subscription required for "${tierName}"`
  );
  console.log(`Seller: Job ${job.id} — Job accepted (tx: ${acceptTx})`);

  const { txnHash: subReqTx } = await job.createPayableRequirement(
    subscriptionMetadata,
    MemoType.PAYABLE_REQUEST_SUBSCRIPTION,
    fareAmount,
    undefined,
    { duration: durationSeconds },
  );
  console.log(
    `Seller: Job ${job.id} — Subscription payment request created (tx: ${subReqTx})`
  );
}


seller().catch((error) => {
  console.error("Seller error:", error);
  process.exit(1);
});

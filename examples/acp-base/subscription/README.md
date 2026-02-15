# ACP Subscription Example

This example demonstrates how to test subscription-backed jobs with ACP v2 using a buyer (client) and seller (provider).

## Overview

The flow covers:

- Assumes the selected agent has:
   - subscription offering at `jobOfferings[0]`
   - fixed-price offering at `jobOfferings[1]`
- Buyer runs one of two scenarios:
   - Scenario 1: subscription offering
   - Scenario 2: fixed-price offering
- Seller handles incoming jobs by price type.
- For subscription jobs, seller checks account subscription status.
- If no valid subscription exists, seller requests subscription payment.
- If subscription is active, seller proceeds without requesting subscription payment.

## Files

- buyer.ts: Runs scenario-based job initiation and handles subscription/fixed-price memo flows.
- seller.ts: Handles fixed-price and subscription paths, including subscription payment requirements.
- env.ts: Loads environment variables from .env.

## Setup

1. Create a .env file:
   - Place it in examples/acp-base/subscription/.env
   - Required variables:
     - BUYER_AGENT_WALLET_ADDRESS
     - SELLER_AGENT_WALLET_ADDRESS
     - BUYER_ENTITY_ID
     - SELLER_ENTITY_ID
     - WHITELISTED_WALLET_PRIVATE_KEY

2. Install dependencies (from repo root):
   - npm install

3. Ensure selected agent has at least:
   - One subscription offering at index `jobOfferings[0]`
   - One fixed-price offering at index `jobOfferings[1]`

## Run

1. Start the seller:
   - cd examples/acp-base/subscription
   - npx ts-node seller.ts

2. Start the buyer in another terminal:
   - cd examples/acp-base/subscription
   - npx ts-node buyer.ts --scenario 1 # Subscription offering
   - npx ts-node buyer.ts --scenario 2 # Fixed-price offering

## Expected Flow

- Scenario 1 (Subscription offering):
   - Buyer initiates a subscription job with tier metadata (for example `sub_premium`).
   - Seller checks subscription validity.
   - If missing/expired, seller creates `PAYABLE_REQUEST_SUBSCRIPTION`.
   - Buyer calls `paySubscription(...)`.
   - Seller moves forward and eventually delivers in `TRANSACTION` phase.
   - If you run scenario 1 again while subscription is active, seller skips subscription payment and sends a plain requirement.

- Scenario 2 (Fixed-price offering):
   - Buyer initiates a non-subscription job.
   - Seller accepts and creates `PAYABLE_REQUEST`.
   - Buyer pays with `payAndAcceptRequirement(...)`.
   - Seller delivers in `TRANSACTION` phase.

## Notes

- Both agents must be registered and whitelisted on ACP.
- Subscription tier name in buyer defaults to `sub_premium`; adjust to match seller offering config.
- If the buyer does not see the seller, make sure the seller has at least one job offering and is searchable by the buyer's keyword.

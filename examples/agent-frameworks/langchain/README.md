# ACP LangChain Integration Examples

This directory contains examples demonstrating how to integrate LangChain AI agents with the ACP (Autonomous Coordination Protocol) framework for running commerce transactions between buyers and sellers.

## Overview

These examples show how to create AI-powered buyers and sellers that can autonomously negotiate deals using natural language processing through LangChain's OpenAI integration.

## Files Structure

- `buyerLangchain.ts`: Example of a buyer agent using LangChain.
- `sellerLangchain.ts`: Example of a seller agent using LangChain.
- `env`: Environment variables for the examples.

## Prerequisites

### Dependencies
Install the required packages:
```bash
npm install @langchain/openai langchain langchain-core @langchain/core @langchain/core/prompts @langchain/core/tools
```

### Environment Setup
1. Copy the environment variables from the parent directory's `env.ts` file
2. Set your OpenAI API key:
```bash
export OPENAI_API_KEY=<your-openai-api-key>
```

## Components

### Buyer Agent (`buyerLangchain.ts`)

**Workflow:**
1. Initiates a job request for "Meme generator" service
2. Waits for seller responses during negotiation phase
3. Uses LangChain agent to analyze seller messages and respond intelligently
4. Automatically pays when negotiation is agreed upon
5. Evaluates completed work

### Seller Agent (`sellerLangchain.ts`)

**Workflow:**
1. Listens for incoming job requests
2. Responds to negotiation requests
3. Uses LangChain agent to handle buyer communications professionally
4. Delivers service upon transaction phase

## Usage

### Running the Examples

1. **Start the Seller:**
```bash
npx ts-node sellerLangchain.ts
```

2. **Start the Buyer:**
```bash
npx ts-node buyerLangchain.ts
```

## Notes
- Ensure your environment variables are correctly set in the `env` file.
- The buyer and seller agents are configured to use the same OpenAI API key.
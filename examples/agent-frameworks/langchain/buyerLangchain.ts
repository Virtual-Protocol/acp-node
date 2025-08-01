// TODO: Point the imports to acp-node after publishing

import AcpClient, {
  AcpContractClient,
  AcpJobPhases,
  AcpJob,
  baseSepoliaAcpConfig,
  AcpAgentSort,
  AcpGraduationStatus,
  AcpOnlineStatus,
} from "@virtuals-protocol/acp-node";
import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createOpenAIFunctionsAgent } from "langchain/agents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Tool } from "@langchain/core/tools";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Custom tool for evaluating jobs
class EvaluateJobTool extends Tool {
  name = "evaluate_job";
  description = "Evaluate a completed job and provide feedback";

  async _call(input: string): Promise<string> {
    console.log("LangChain Agent: Evaluating job");
    return "Job evaluated successfully";
  }
}

// Custom tools for the buyer agent
class PayJobTool extends Tool {
  name = "pay_job";
  description = "Pay for a job that has been negotiated";

  async _call(input: string): Promise<string> {
    console.log("LangChain Agent: Paying for job");
    return "Job payment processed";
  }
}

class BrowseAgentsTool extends Tool {
  name = "browse_agents";
  description = "Search for agents that provide the service you need";

  async _call(input: string): Promise<string> {
    console.log("LangChain Agent: Browsing for agents");
    return "Found relevant agents";
  }
}

class InitiateJobTool extends Tool {
  name = "initiate_job";
  description = "Start a new job with a chosen agent";

  async _call(input: string): Promise<string> {
    console.log("LangChain Agent: Initiating new job");
    return "Job initiated successfully";
  }
}

// Helper function to clean job data for JSON stringification
function cleanJobData(job: AcpJob) {
  return {
    id: job.id,
    phase: job.phase,
    price: job.price,
    memos: job.memos.map(memo => ({
      content: memo.content,
      nextPhase: memo.nextPhase
    }))
  };
}

// Helper function to create a clean version of agent data without circular references
function cleanAgentData(agents: any[]) {
  return agents.map(agent => ({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    twitterHandle: agent.twitterHandle,
    walletAddress: agent.walletAddress,
    offerings: agent.offerings.map((offering: any) => ({
      id: offering.id,
      price: offering.price,
      description: offering.description,
      requirements: offering.requirements
    }))
  }));
}

async function createBuyerAgent() {
  const model = new ChatOpenAI({
    modelName: "gpt-3.5-turbo",
    temperature: 0.7,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const tools = [
    new PayJobTool(),
    new BrowseAgentsTool(),
    new InitiateJobTool(),
    new EvaluateJobTool(),
  ];

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", `You are an autonomous buyer agent in the ACP (Agent Commerce Protocol) system.
    Your goal is to find and purchase meme generation services from other agents.
    
    You should:
    1. Search for agents that provide meme generation services
    2. Evaluate their offerings and choose the best one
    3. Initiate jobs with clear requirements
    4. Pay for jobs when they're ready
    5. Evaluate the delivered memes
    
    Be proactive in your decision-making and maintain professional communication.
    Always consider the quality and value of the service before making payments.`],
    ["human", "{input}"],
    ["placeholder", "{agent_scratchpad}"],
  ]);

  const agent = await createOpenAIFunctionsAgent({
    llm: model,
    tools,
    prompt,
  });

  return new AgentExecutor({
    agent,
    tools,
    verbose: true,
  });
}

async function buyer() {
  // Initialize LangChain agent
  const buyerAgent = await createBuyerAgent();
  let acpClient: AcpClient;

  try {
    acpClient = new AcpClient({
      acpContractClient: await AcpContractClient.build(
        process.env.WHITELISTED_WALLET_PRIVATE_KEY! as `0x${string}`,
        parseInt(process.env.WHITELISTED_WALLET_ENTITY_ID!),
        process.env.BUYER_WALLET_ADDRESS! as `0x${string}`,
      ),
      onNewTask: async (job: AcpJob) => {
        console.log("New task received:", job);
        try {
          const result = await buyerAgent.invoke({
            input: `New job update received: ${JSON.stringify(cleanJobData(job))}. 
                        Current phase: ${job.phase}. 
                        What action should we take?`,
          });

          if (job.phase === AcpJobPhases.NEGOTIATION &&
            job.memos.find((m) => m.nextPhase === AcpJobPhases.TRANSACTION)) {
            console.log("Agent decided to pay for job:", result.output);
            await job.pay(job.price);
            console.log(`Job ${job.id} paid`);
          } else if (job.phase === AcpJobPhases.COMPLETED) {
            console.log(`Job ${job.id} completed with agent's decision:`, result.output);
          }
        } catch (error) {
          console.error(error);
        }
      },
      onEvaluate: async (job: AcpJob) => {
        console.log("Evaluation function called", job);
        await job.evaluate(true, "Self-evaluated and approved");
        console.log(`Job ${job.id} evaluated`);
      },
    });

    // Let the agent decide how to proceed with finding and initiating a job
    const result = await buyerAgent.invoke({
      input: `We need to find a meme generator service. 
            Please help us search for agents and initiate a job with the best one.
            The job should be for generating a flower meme.`,
    });

    console.log("Agent's decision:", result.output);

    // Browse available agents based on the agent's decision
    const relevantAgents = await acpClient.browseAgents("meme generator", {
      cluster: "",
      sort_by: [AcpAgentSort.SUCCESSFUL_JOB_COUNT],
      top_k: 5,
      graduationStatus: AcpGraduationStatus.ALL,
      onlineStatus: AcpOnlineStatus.ALL,
    });
    console.log("Found agents:", relevantAgents);

    if (!relevantAgents || relevantAgents.length === 0) {
      console.error("No agents found matching the criteria");
      return;
    }

    // Let the agent evaluate and choose the best agent
    const cleanAgents = cleanAgentData(relevantAgents);
    const agentChoice = await buyerAgent.invoke({
      input: `Here are the available agents: ${JSON.stringify(cleanAgents)}. 
            Which one should we choose and why?`,
    });

    console.log("Agent's choice:", agentChoice.output);
    const chosenAgent = relevantAgents[0]; // Using first agent like in buyer.ts

    if (!chosenAgent || !chosenAgent.offerings || chosenAgent.offerings.length === 0) {
      console.error("No offerings available for the chosen agent");
      return;
    }

    const chosenJobOffering = chosenAgent.offerings[0];
    const jobId = await chosenJobOffering.initiateJob(
      { "meme_description": "Help me to generate a flower meme." },
      process.env.BUYER_WALLET_ADDRESS! as `0x${string}`,
      undefined
    );

    console.log(`Job ${jobId} initiated based on agent's decision`);
  } catch (error) {
    console.error(error);
  }
}

buyer();
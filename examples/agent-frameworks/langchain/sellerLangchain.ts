// TODO: Point the imports to acp-node after publishing

import AcpClient, { 
    AcpContractClient, 
    AcpJobPhases, 
    AcpJob, 
    baseSepoliaAcpConfig 
} from '@virtuals-protocol/acp-node';
import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createOpenAIFunctionsAgent } from "langchain/agents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Tool } from "@langchain/core/tools";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Helper function to create a clean version of job data without circular references
function cleanJobData(job: any) {
    return {
        id: job.id,
        phase: job.phase,
        price: job.price,
        clientAddress: job.clientAddress,
        providerAddress: job.providerAddress,
        memos: job.memos.map((memo: any) => ({
            id: memo.id,
            type: memo.type,
            content: memo.content,
            nextPhase: memo.nextPhase
        })),
        deliverables: job.deliverables ? job.deliverables.map((deliverable: any) => ({
            type: deliverable.type,
            value: deliverable.value
        })) : []
    };
}

// Custom tools for the seller agent
class RespondToJobTool extends Tool {
  name = "respond_to_job";
  description = "Evaluate and respond to incoming job requests";

  async _call(input: string): Promise<string> {
    console.log("LangChain Seller: Evaluating job request");
    return "Job request evaluated and decision made";
  }
}

class DeliverJobTool extends Tool {
  name = "deliver_job";
  description = "Generate and deliver the completed job results";

  async _call(input: string): Promise<string> {
    console.log("LangChain Seller: Preparing job delivery");
    return "Job delivery prepared";
  }
}

class GenerateMemeTool extends Tool {
  name = "generate_meme";
  description = "Generate a meme based on the job requirements";

  async _call(input: string): Promise<string> {
    console.log("LangChain Seller: Generating meme");
    // In a real implementation, this would integrate with a meme generation service
    return "Meme generated successfully";
  }
}

class NegotiatePriceTool extends Tool {
  name = "negotiate_price";
  description = "Evaluate and potentially negotiate the job price";

  async _call(input: string): Promise<string> {
    console.log("LangChain Seller: Evaluating price");
    return "Price evaluation completed";
  }
}

async function createSellerAgent() {
  const model = new ChatOpenAI({
    modelName: "gpt-3.5-turbo",
    temperature: 0.7,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const tools = [
    new RespondToJobTool(),
    new DeliverJobTool(),
    new GenerateMemeTool(),
    new NegotiatePriceTool()
  ];

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", `You are an autonomous seller agent in the ACP (Agent Commerce Protocol) system.
    Your role is to provide high-quality meme generation services.
    
    You should:
    1. Carefully evaluate incoming job requests
    2. Consider the requirements, price, and buyer's needs
    3. Make informed decisions about accepting or rejecting jobs
    4. Generate appropriate memes based on requirements
    5. Deliver high-quality results in a timely manner
    
    Guidelines for decision making:
    - Accept jobs that align with your capabilities and have reasonable requirements
    - Consider the offered price in relation to the work required
    - Ensure you can deliver quality results within the expected timeframe
    - Be professional in all communications
    - Maintain high standards for your meme generation service
    
    Always think carefully about each decision and explain your reasoning.`],
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

async function seller() {
    // Initialize LangChain agent
    const sellerAgent = await createSellerAgent();
    let acpClient: AcpClient;

    try {
        acpClient = new AcpClient({
            acpContractClient: await AcpContractClient.build(
                process.env.WHITELISTED_WALLET_PRIVATE_KEY! as `0x${string}`,
                parseInt(process.env.WHITELISTED_WALLET_ENTITY_ID!),
                process.env.SELLER_WALLET_ADDRESS! as `0x${string}`
            ),
            onNewTask: async (job: AcpJob) => {
                console.log("New task received:", job);
                try {
                    const result = await sellerAgent.invoke({
                        input: `New job update received: ${JSON.stringify(cleanJobData(job))}. 
                        Current phase: ${job.phase}. 
                        What action should we take?`,
                    });

                    if (job.phase === AcpJobPhases.REQUEST && 
                        job.memos.find((m) => m.nextPhase === AcpJobPhases.NEGOTIATION)) {
                        console.log("Responding to job:", result.output);
                        await job.respond(true);
                        console.log(`Job ${job.id} responded`);
                    } else if (job.phase === AcpJobPhases.TRANSACTION && 
                             job.memos.find((m) => m.nextPhase === AcpJobPhases.EVALUATION)) {
                        console.log("Delivering job:", result.output);
                        await job.deliver(
                            {
                                type: "url",
                                value: "https://example.com",
                            }
                        );
                        console.log(`Job ${job.id} delivered`);
                    }
                } catch (error) {
                    console.error(error);
                }
            }
        });

        // Let the agent know it's ready to accept jobs
        console.log("Seller agent is now listening for jobs...");

    } catch (error) {
        console.error(error);
    }
}

seller();

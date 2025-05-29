import { NegotiationAgent } from "./negotiationAgent";
import { AcpNegoStatus } from "../../../src/acpContractClient";
import AcpMessage from "../../../src/acpMessage";
import AcpJob from "../../../src/acpJob";
import { ExecutableGameFunctionResponse, ExecutableGameFunctionStatus, GameFunction } from "@virtuals-protocol/game";
import AcpClient from "../../../src/acpClient";

export interface NegotiationResult {
  success: boolean;
  finalPrice?: number;
  finalQuantity?: number;
  finalTerms?: string;
  transcript: Array<{
    from: string;
    message: string;
    timestamp: number;
  }>;
  reason: string;
  jobId: number;
}

export class SimpleNegotiationManager {
  private static chatAgents = new Map<string, NegotiationAgent>(); // address -> agent

  // Create GameFunction for accepting deals
  private static createAcceptDealFunction(): GameFunction<any> {
    return new GameFunction({
      name: "accept_deal",
      description: "Accept the current deal terms",
      args: [
        { name: "price", description: "Final agreed price" },
        { name: "terms", description: "Final agreed terms" }
      ],
      executable: async (args, logger) => {
        const price = args.price || 0;
        const terms = args.terms || "Standard terms";
        
        if (logger) {
          logger(`Deal accepted! Price: $${price}, Terms: ${terms}`);
        }
        
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Done, 
          `Deal accepted at $${price} with terms: ${terms}`
        );
      },
    });
  }

  // Create GameFunction for rejecting deals
  private static createRejectDealFunction(): GameFunction<any> {
    return new GameFunction({
      name: "reject_deal",
      description: "Reject the current deal",
      args: [
        { name: "reason", description: "Reason for rejection" }
      ],
      executable: async (args, logger) => {
        const reason = args.reason || "Terms not acceptable";
        
        if (logger) {
          logger(`Deal rejected! Reason: ${reason}`);
        }
        
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Done, 
          `Deal rejected: ${reason}`
        );
      },
    });
  }

  // Create GameFunction for making counter offers
  private static createCounterOfferFunction(): GameFunction<any> {
    return new GameFunction({
      name: "counter_offer",
      description: "Make a counter offer",
      args: [
        { name: "price", description: "Proposed price" },
        { name: "terms", description: "Proposed terms" },
        { name: "reasoning", description: "Reasoning for the offer" }
      ],
      executable: async (args, logger) => {
        const price = args.price || 0;
        const terms = args.terms || "Standard terms";
        const reasoning = args.reasoning || "Fair market value";
        
        if (logger) {
          logger(`💰 Counter offer: $${price} - ${reasoning}`);
        }
        
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Done, 
          `Counter offer: $${price} with terms: ${terms}. Reasoning: ${reasoning}`
        );
      },
    });
  }

  // Initialize a ChatAgent for this address/role
  static async initializeChatAgent(
    myAddress: string,
    role: 'buyer' | 'seller',
    serviceDescription: string,
    budget?: number,
    askingPrice?: number
  ) {
    const apiKey = process.env.GAME_API_KEY || "apt-e117491ca835429c897fc7e13faa84f8";
    
    const systemPrompt = role === 'buyer' 
      ? `You are a buyer negotiating for: ${serviceDescription}.${budget ? ` Your budget: $${budget}.` : ''} Negotiate naturally and try to get a good deal. Use the available functions when appropriate.`
      : `You are a seller offering: ${serviceDescription}.${askingPrice ? ` Your asking price: $${askingPrice}.` : ''} Negotiate naturally and try to get a fair price. Use the available functions when appropriate.`;

    // Create action space with GameFunctions
    const actionSpace: GameFunction<any>[] = [
      this.createAcceptDealFunction(),
      this.createRejectDealFunction()
    ];

    const agent = new NegotiationAgent(
      apiKey,
      systemPrompt,
      `${role}-${myAddress.slice(-6)}`,
      actionSpace,
      role === 'buyer' ? 'seller' : 'buyer' // Partner ID
    );

    await agent.initialize(actionSpace);
    this.chatAgents.set(myAddress, agent);
    
    console.log(`${role.toUpperCase()} ChatAgent ready for ${myAddress}`);
  }

  // Handle incoming message and generate response
  static async handleMessage(
    myAddress: string,
    incomingMessage: string,
    msg: AcpMessage,
    job: AcpJob
  ): Promise<boolean> {
    const agent = this.chatAgents.get(myAddress);
    if (!agent) {
      console.log(`No ChatAgent found for ${myAddress}`);
      return false;
    }

    console.log(`Received: ${incomingMessage}`);

    try {
      // Use ChatAgent's next method to process the message
      const response = await agent.sendMessage(incomingMessage);
      
      if (response.functionCall) {
        console.log(`Function call: ${response.functionCall.fn_name}`);
      }

      if (response.message) {
        console.log(`AI Response: ${response.message}`);
      }

      // Check what the agent decided to do
      if (response.functionCall?.fn_name === 'accept_deal') {
        console.log(`Deal accepted!`);
        return true;
      }
      
      if (response.functionCall?.fn_name === 'reject_deal') {
        console.log(`Deal rejected!`);
        return true;
      }

      // Send whatever the ChatAgent naturally said
      if (response.message) {
        const replyMessage = new AcpMessage(
          Date.now(),
          msg.messages,
          msg['socket'],
          job,
          myAddress as `0x${string}` // Cast address to expected format
        );
        
        replyMessage.initOrReply(response.message);
      }
      
      // Check if chat is finished
      if (response.isFinished) {
        console.log(`🏁 Chat finished for ${myAddress}`);
        return true;
      }
      
      return false; // Continue negotiation
      
    } catch (error: any) {
      console.error(`Error:`, error.message);
      return false;
    }
  }

  // Send initial message (buyer only) - with optional chat without socket mode
  static async sendInitialMessage(
    buyerAddress: string,
    serviceDescription: string,
    budget: number,
    acpClient?: AcpClient,
    job?: AcpJob,
    chatWithoutSocket: boolean = false
  ) {
    const agent = this.chatAgents.get(buyerAddress);
    if (!agent) {
      console.log(`No buyer agent found`);
      return;
    }

    setTimeout(async () => {
      try {
        // Let the ChatAgent generate the initial message naturally
        const response = await agent.sendMessage("Start the negotiation. Introduce yourself and what you need.");
        
        const content = response.message || `Hi! I need: ${serviceDescription}. My budget is $${budget}. Let's negotiate!`;
        
        if (chatWithoutSocket) {
          // Chat without socket mode - just log the message, no socket
          console.log(`🗣️ Buyer (${buyerAddress.slice(-6)}): ${content}`);
          return;
        }
        
        // Full mode with socket
        if (!acpClient || !job) {
          console.error("acpClient and job required for full mode");
          return;
        }
        
        const socket = (acpClient as any).socket || (acpClient as any)._socket;
        
        if (!socket) {
          console.error("No socket found in acpClient");
          return;
        }
        
        const initialMessage = new AcpMessage(
          Date.now(),
          [],
          socket,
          job,
          buyerAddress as `0x${string}`
        );
        
        initialMessage.initOrReply(content);
        console.log(`Buyer started: ${content}`);
        
      } catch (error: any) {
        console.error(`Error generating initial message:`, error.message);
        
        if (chatWithoutSocket) {
          // Chat without socket fallback
          const fallbackContent = `Hi! I need: ${serviceDescription}. My budget is $${budget}. Let's negotiate!`;
          console.log(`🗣️ Buyer (${buyerAddress.slice(-6)}): ${fallbackContent}`);
          return;
        }
        
        // Full mode fallback
      }
    }, 2000);
  }

  // Extract price from negotiation messages
  static extractPrice(message: string): number | null {
    const priceMatch = message.match(/\$(\d+)/);
    return priceMatch ? parseInt(priceMatch[1]) : null;
  }

  // Add chat without socket negotiation method
  static async negotiateChatWithoutSocket(
    buyerAddress: string,
    sellerAddress: string, 
    serviceDescription: string,
    budget: number = 1000,
    askingPrice: number = 800,
    maxRounds: number = 10
  ): Promise<NegotiationResult> {
    console.log("🚀 Starting chat without socket AI negotiation...");

    // 1. Create buyer ChatAgent
    await this.initializeChatAgent(buyerAddress, 'buyer', serviceDescription, budget);
    
    // 2. Create seller ChatAgent  
    await this.initializeChatAgent(sellerAddress, 'seller', serviceDescription, undefined, askingPrice);

    // 3. Start chat without socket negotiation
    await this.sendInitialMessage(buyerAddress, serviceDescription, budget, undefined, undefined, true);
    
    const transcript: Array<{ from: string; message: string; timestamp: number }> = [];
    let currentSpeaker = 'seller'; // Buyer just spoke, seller responds
    let round = 0;
    let dealAccepted = false;
    let finalPrice: number | undefined;
    let finalTerms: string | undefined;

    // Simulate back-and-forth conversation
    while (round < maxRounds && !dealAccepted) {
      round++;
      const currentAgent = this.chatAgents.get(
        currentSpeaker === 'buyer' ? buyerAddress : sellerAddress
      );
      
      if (!currentAgent) break;

      try {
        // Get the last message from transcript to respond to
        const lastMessage = transcript.length > 0 
          ? transcript[transcript.length - 1].message 
          : `Let's discuss ${serviceDescription}. I'm asking $${askingPrice}.`;

        const response = await currentAgent.sendMessage(lastMessage);
        
        const message = response.message || "I need to think about this.";
        const timestamp = Date.now();
        
        // Add to transcript
        transcript.push({
          from: currentSpeaker,
          message,
          timestamp
        });

        console.log(`🗣️ ${currentSpeaker.toUpperCase()} (${(currentSpeaker === 'buyer' ? buyerAddress : sellerAddress).slice(-6)}): ${message}`);

        // Check for deal acceptance/rejection
        if (response.functionCall?.fn_name === 'accept_deal') {
          dealAccepted = true;
          finalPrice = response.functionCall.arguments?.price || this.extractPrice(message);
          finalTerms = response.functionCall.arguments?.terms || "Standard terms";
          console.log(`Deal accepted! Price: $${finalPrice}, Terms: ${finalTerms}`);
          break;
        }

        if (response.functionCall?.fn_name === 'reject_deal') {
          console.log(`Deal rejected: ${response.functionCall.arguments?.reason || 'Terms not acceptable'}`);
          break;
        }

        // Switch speakers
        currentSpeaker = currentSpeaker === 'buyer' ? 'seller' : 'buyer';
        
        // Small delay between messages
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error: any) {
        console.error(`Error in round ${round}:`, error.message);
        break;
      }
    }

    return {
      success: dealAccepted,
      finalPrice,
      finalTerms,
      transcript,
      reason: dealAccepted ? 'Deal accepted' : round >= maxRounds ? 'Max rounds reached' : 'Negotiation failed',
      jobId: Math.floor(Math.random() * 10000) // Mock job ID for chat without socket mode
    };
  }

  // Update main negotiate function to support chat without socket mode
  static async negotiate(
    buyerAddress: string,
    sellerAddress: string, 
    serviceDescription: string,
    job?: AcpJob,
    acpClient?: AcpClient,
    budget: number = 1000,
    askingPrice: number = 800,
    chatWithoutSocket: boolean = false
  ) {
    if (chatWithoutSocket) {
      return await this.negotiateChatWithoutSocket(
        buyerAddress, 
        sellerAddress, 
        serviceDescription, 
        budget, 
        askingPrice
      );
    }

    // Original full mode
    if (!job || !acpClient) {
      throw new Error("job and acpClient required for full mode");
    }

    console.log("Starting AI negotiation...");

    // 1. Create buyer ChatAgent
    await this.initializeChatAgent(buyerAddress, 'buyer', serviceDescription, budget);
    
    // 2. Create seller ChatAgent  
    await this.initializeChatAgent(sellerAddress, 'seller', serviceDescription, undefined, askingPrice);

    // 3. Buyer starts the conversation
    await this.sendInitialMessage(buyerAddress, serviceDescription, budget, acpClient, job, false);
    
    console.log("Negotiation started - ChatAgents will handle the rest via socket messages");
  }
}
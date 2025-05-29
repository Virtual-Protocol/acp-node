import { ChatAgent } from "@virtuals-protocol/game";
import { GameFunction } from "@virtuals-protocol/game";
import { AcpNegoStatus } from "../../../src/acpContractClient";
import { NegotiationState } from "../newNegotiationAgent";

// Use ACP negotiation states instead of custom ones
export { AcpNegoStatus as NegotiationState } from "../../../src/acpContractClient";

export interface NegotiationTerms {
  quantity: number;
  pricePerUnit: number;
  requirements: string;
}

export interface AgentConfig {
  role: 'client' | 'provider';
  budget?: number;              // For buyers
  minPrice?: number;           // For sellers
  maxPrice?: number;           // For sellers
}

// Add helper type for external API
export type BuyerConfig = {
  budget?: number;
};

export type SellerConfig = {
  minPrice?: number;
  maxPrice?: number;
};

export class NegotiationAgent {
  private chatAgent: ChatAgent;
  private chat: any;
  private agentName: string;
  private partnerId: string;

  constructor(
    apiKey: string,
    systemPrompt: string,
    agentName: string,
    actionSpace: GameFunction<any>[],
    partnerId: string = "negotiation-partner"
  ) {
    this.chatAgent = new ChatAgent(apiKey, systemPrompt);
    this.agentName = agentName;
    this.partnerId = partnerId;
  }

  async initialize(actionSpace: GameFunction<any>[]) {
    // Create chat with the action space
    this.chat = await this.chatAgent.createChat({
      partnerId: this.partnerId,
      partnerName: this.partnerId,
      actionSpace: actionSpace,
    });
    
    console.log(`🤖 ${this.agentName} initialized with ChatAgent`);
  }

  async sendMessage(incomingMessage: string): Promise<{
    message?: string;
    functionCall?: {
      fn_name: string;
      arguments: any;
    };
    isFinished?: boolean;
  }> {
    try {
      // Use the ChatAgent's next method to process the message
      const response = await this.chat.next(incomingMessage);
      
      return {
        message: response.message,
        functionCall: response.functionCall ? {
          fn_name: response.functionCall.fn_name,
          arguments: response.functionCall.arguments
        } : undefined,
        isFinished: response.isFinished
      };
      
    } catch (error: any) {
      console.error(`${this.agentName} error:`, error.message);
      
      // Fallback response
      return {
        message: "I'm having trouble processing that. Could you rephrase?"
      };
    }
  }

  // Get conversation history for debugging
  getHistory(): any {
    return this.chat?.getHistory() || [];
  }
}
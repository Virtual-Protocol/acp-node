// TODO: Point the imports to acp-node after publishing

import AcpClient from "../../../src/acpClient";
import AcpContractClient, { AcpJobPhases } from "../../../src/acpContractClient";
import AcpJob from "../../../src/acpJob";
import AcpMessage from "../../../src/acpMessage";
import { baseSepoliaAcpConfig } from "../../../src";
import { SimpleNegotiationManager } from "./negotiationManager";
import dotenv from 'dotenv';
import { AcpNegoStatus } from "../../../src/acpContractClient";
dotenv.config();

const BUYER_WALLET_ADDRESS = process.env.BUYER_WALLET_ADDRESS!;
const SELLER_WALLET_ADDRESS = process.env.SELLER_WALLET_ADDRESS!;
const WHITELISTED_WALLET_ENTITY_ID = process.env.WHITELISTED_WALLET_ENTITY_ID!;
const WHITELISTED_WALLET_PRIVATE_KEY = process.env.WHITELISTED_WALLET_PRIVATE_KEY!;

async function seller() {
    const acpClient = new AcpClient({
        acpContractClient: await AcpContractClient.build(
            WHITELISTED_WALLET_PRIVATE_KEY as `0x${string}`,
            Number(WHITELISTED_WALLET_ENTITY_ID),
            SELLER_WALLET_ADDRESS as `0x${string}`,
            baseSepoliaAcpConfig
        ),
        onNewTask: async (job: AcpJob) => {
            console.log(`Seller received task: ${job.phase} - negoStatus: ${job.negoStatus}`);
            
            if (job.phase === AcpJobPhases.REQUEST) {
                console.log("Responding to job to start negotiation...");
                await job.respond(true);
                
                // Manually set negoStatus to PENDING
                job.negoStatus = AcpNegoStatus.PENDING;
                console.log(`Job ${job.id} responded and negoStatus set to PENDING`);
            } else if (job.phase === AcpJobPhases.NEGOTIATION) {
                console.log("Negotiation phase - setting up seller AI");
                
                // Ensure negoStatus is PENDING
                if (!job.negoStatus) {
                    job.negoStatus = AcpNegoStatus.PENDING;
                }
                
                await SimpleNegotiationManager.initializeChatAgent(
                    SELLER_WALLET_ADDRESS,
                    'seller',
                    'Meme generator service',
                    undefined,
                    800
                );
            }
        },
        onNewMsg: async (msg: AcpMessage, job: AcpJob) => {
            // Only respond if message is not from me
            if (msg.messages && msg.messages.length > 0) {
                const latestMessage = msg.messages[msg.messages.length - 1];
                
                if (latestMessage.sender !== SELLER_WALLET_ADDRESS) {
                    // This is from buyer, generate seller response
                    const isDone = await SimpleNegotiationManager.handleMessage(
                        SELLER_WALLET_ADDRESS,
                        latestMessage.content,
                        msg,
                        job
                    );
                    
                    if (isDone) {
                        console.log("Negotiation complete!");
                    }
                }
            }
        },
        onEvaluate: async (job: AcpJob) => {
            await job.evaluate(true, "AI seller approved");
        },
    });

    console.log("🎯 Seller ready and waiting...");
}

seller();

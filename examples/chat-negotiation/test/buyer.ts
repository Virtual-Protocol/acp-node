// TODO: Point the imports to acp-node after publishing

import AcpClient from "../../../src/acpClient";
import AcpContractClient, { AcpJobPhases, AcpNegoStatus } from "../../../src/acpContractClient";
import AcpJob from "../../../src/acpJob";
import AcpMessage from "../../../src/acpMessage";
import { baseSepoliaAcpConfig } from "../../../src";
import { SimpleNegotiationManager } from "./negotiationManager";
import dotenv from 'dotenv';

dotenv.config();

const BUYER_WALLET_ADDRESS = process.env.BUYER_WALLET_ADDRESS!;
const SELLER_WALLET_ADDRESS = process.env.SELLER_WALLET_ADDRESS!;
const WHITELISTED_WALLET_ENTITY_ID = process.env.WHITELISTED_WALLET_ENTITY_ID!;
const WHITELISTED_WALLET_PRIVATE_KEY = process.env.WHITELISTED_WALLET_PRIVATE_KEY!;

async function buyer() {
    console.log("Starting AI Buyer...");

    const acpClient = new AcpClient({
        acpContractClient: await AcpContractClient.build(
            WHITELISTED_WALLET_PRIVATE_KEY as `0x${string}`,
            Number(WHITELISTED_WALLET_ENTITY_ID),
            BUYER_WALLET_ADDRESS as `0x${string}`,
            baseSepoliaAcpConfig
        ),
        onNewTask: async (job: AcpJob) => {
            console.log(`BUYER received task: Job ${job.id}, Phase: ${job.phase}, NegoStatus: ${job.negoStatus}`);
            
            if (job.phase === AcpJobPhases.NEGOTIATION ) {
                console.log("Starting negotiation with REAL job object...");
                // Ensure negoStatus is PENDING before starting negotiation
                job.negoStatus = AcpNegoStatus.PENDING;
                console.log(`Set job ${job.id} negoStatus to PENDING`);
                
                await SimpleNegotiationManager.negotiateChatWithoutSocket(
                    BUYER_WALLET_ADDRESS,
                    SELLER_WALLET_ADDRESS,
                    'Meme generator service',
                    1,
                    2
                );
            }
        },
        onNewMsg: async (msg: AcpMessage, job: AcpJob) => {
            // Handle messages during negotiation
            if (msg.messages && msg.messages.length > 0) {
                const latestMessage = msg.messages[msg.messages.length - 1];
                
                if (latestMessage.sender !== BUYER_WALLET_ADDRESS) {
                    const isDone = await SimpleNegotiationManager.handleMessage(
                        BUYER_WALLET_ADDRESS,
                        latestMessage.content,
                        msg,
                        job
                    );
                    
                    if (isDone) {
                        console.log("Negotiation complete - paying...");
                        await job.pay(1000);
                    }
                }
            }
        },
        onEvaluate: async (job: AcpJob) => {
            await job.evaluate(true, "AI buyer approved");
        },
    });

    console.log("Starting job...");
    const jobId = await acpClient.initiateJob(SELLER_WALLET_ADDRESS as `0x${string}`, "Meme generator", undefined);
    console.log(`Job ${jobId} initiated - waiting for seller response...`);
}

buyer();

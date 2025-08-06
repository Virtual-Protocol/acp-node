import AcpClient, { 
    AcpContractClient, 
    AcpJobPhases, 
    AcpJob
} from '@virtuals-protocol/acp-node';
import AcpMemo from "@virtuals-protocol/acp-node/src/acpMemo";
import {
    SELLER_AGENT_WALLET_ADDRESS,
    SELLER_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY
} from "./env";

// Queue implementation using a simple array with mutex-like behavior
class JobQueue {
    private queue: Array<{ job: AcpJob; memoToSign?: AcpMemo }> = [];
    private eventListeners: Array<() => void> = [];

    enqueue(job: AcpJob, memoToSign?: AcpMemo) {
        console.log(`[JobQueue] Enqueueing job ${job.id}`);
        this.queue.push({ job, memoToSign });
        this.notifyListeners();
    }

    dequeue(): { job: AcpJob; memoToSign?: AcpMemo } | null {
        if (this.queue.length === 0) {
            return null;
        }
        const item = this.queue.shift()!;
        console.log(`[JobQueue] Dequeued job ${item.job.id}`);
        return item;
    }

    isEmpty(): boolean {
        return this.queue.length === 0;
    }

    get length(): number {
        return this.queue.length;
    }

    onItemAdded(callback: () => void) {
        this.eventListeners.push(callback);
    }

    private notifyListeners() {
        this.eventListeners.forEach(callback => callback());
    }
}

async function seller(useThreadLock: boolean = true) {
    const jobQueue = new JobQueue();

    // Job processing worker with delay
    const handleJobWithDelay = async (job: AcpJob, memoToSign?: AcpMemo) => {
        try {
            await processJob(job, memoToSign);
            // Add 2 second delay like in Python example
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.error(`❌ Error processing job ${job.id}:`, error);
        }
    };

    // Job processing logic
    const processJob = async (job: AcpJob, memoToSign?: AcpMemo) => {
        if (
            job.phase === AcpJobPhases.REQUEST &&
            memoToSign !== undefined &&
            memoToSign.nextPhase === AcpJobPhases.NEGOTIATION
        ) {
            console.log(`[processJob] Responding to job ${job.id}`);
            await job.respond(true);
            console.log(`[processJob] Job ${job.id} responded`);
        } else if (
            job.phase === AcpJobPhases.TRANSACTION &&
            memoToSign !== undefined &&
            memoToSign.nextPhase === AcpJobPhases.EVALUATION
        ) {
            console.log(`[processJob] Delivering job ${job.id}`);
            await job.deliver({
                type: "url",
                value: "https://example.com",
            });
            console.log(`[processJob] Job ${job.id} delivered`);
        } else if (job.phase === AcpJobPhases.COMPLETED) {
            console.log(`[processJob] Job ${job.id} completed`);
        } else if (job.phase === AcpJobPhases.REJECTED) {
            console.log(`[processJob] Job ${job.id} rejected`);
        }
    };

    // Job worker function
    const jobWorker = async () => {
        while (true) {
            // Wait for items to be added to queue
            await new Promise<void>((resolve) => {
                const checkQueue = () => {
                    if (!jobQueue.isEmpty()) {
                        resolve();
                    } else {
                        setTimeout(checkQueue, 100);
                    }
                };
                checkQueue();
            });

            // Process all items in queue
            while (true) {
                const item = jobQueue.dequeue();
                if (!item) break;
                
                // Process each job asynchronously to avoid blocking
                handleJobWithDelay(item.job, item.memoToSign);
            }
        }
    };

    // Start job worker
    jobWorker();

    const acpClient = new AcpClient({
        acpContractClient: await AcpContractClient.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            SELLER_ENTITY_ID,
            SELLER_AGENT_WALLET_ADDRESS
        ),
        onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
            console.log(`[onNewTask] Received job ${job.id} (phase: ${job.phase})`);
            jobQueue.enqueue(job, memoToSign);
        },
    });

    console.log("Waiting for new task...");
    
    // Keep the process alive
    await new Promise(() => {}); // This will keep the process running indefinitely
}

seller();

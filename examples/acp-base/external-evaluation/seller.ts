import AcpClient, {
    AcpContractClient,
    AcpJobPhases,
    AcpJob,
    AcpMemo
} from '@virtuals-protocol/acp-node';
import {
    SELLER_AGENT_WALLET_ADDRESS,
    SELLER_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY
} from "./env";

class JobQueue<T> {
    private queue: T[] = [];
    private resolvers: Array<(item: T) => void> = [];

    enqueue(item: T) {
        if (this.resolvers.length > 0) {
            const resolve = this.resolvers.shift()!;
            resolve(item);
        } else {
            this.queue.push(item);
        }
    }

    async dequeue(): Promise<T> {
        if (this.queue.length > 0) {
            return this.queue.shift()!;
        }
        return new Promise<T>(resolve => this.resolvers.push(resolve));
    }

    get length() {
        return this.queue.length;
    }
}

type JobItem = { job: AcpJob; memoToSign?: AcpMemo };

class JobProcessor {
    constructor(
        private queue: JobQueue<JobItem>,
        private delayBetweenJobsMs = 2000
    ) {}

    start() {
        this.run();
    }

    private async run() {
        while (true) {
            const { job, memoToSign } = await this.queue.dequeue();
            await this.handleJob(job, memoToSign);
            await this.sleep(this.delayBetweenJobsMs);
        }
    }

    private async handleJob(job: AcpJob, memoToSign?: AcpMemo) {
        try {
            console.log(`[processJob] Job ${job.id} - Phase: ${AcpJobPhases[job.phase]}`);

            if (
                job.phase === AcpJobPhases.REQUEST &&
                memoToSign?.nextPhase === AcpJobPhases.NEGOTIATION
            ) {
                console.log(`[processJob] Responding to job ${job.id}`);
                await job.respond(true);
                console.log(`[processJob] Job ${job.id} responded`);
            }

            else if (
                job.phase === AcpJobPhases.TRANSACTION &&
                memoToSign?.nextPhase === AcpJobPhases.EVALUATION
            ) {
                console.log(`[processJob] Delivering Job ${job.id}`);
                await job.deliver({
                    type: "url",
                    value: "https://example.com",
                });
                console.log(`[processJob] Job ${job.id} delivered`);
            }

            else {
                console.warn(`[processJob] Unknown or unhandled phase: ${job.phase}`);
            }
        } catch (error) {
            console.error(`❌ Error in job ${job.id}:`, error);
        }
    }

    private sleep(ms: number) {
        return new Promise(res => setTimeout(res, ms));
    }
}

async function seller() {
    const jobQueue = new JobQueue<{ job: AcpJob; memoToSign?: AcpMemo }>();
    const processor = new JobProcessor(jobQueue, 2000); // time-off = 2s
    processor.start();

    new AcpClient({
        acpContractClient: await AcpContractClient.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            SELLER_ENTITY_ID,
            SELLER_AGENT_WALLET_ADDRESS
        ),
        onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
            console.log(`[onNewTask] Received job ${job.id}`);
            jobQueue.enqueue({ job, memoToSign });
        }
    });

    console.log("[Seller] Listening for new jobs...");
}

seller();

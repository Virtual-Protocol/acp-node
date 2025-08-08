import AcpClient, {
    AcpContractClient,
    AcpJob
} from '@virtuals-protocol/acp-node';
import {
    EVALUATOR_AGENT_WALLET_ADDRESS,
    EVALUATOR_ENTITY_ID,
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

class JobProcessor {
    private isRunning = false;

    constructor(
        private queue: JobQueue<AcpJob>,
        private timeOffMs: number = 1000
    ) {}

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.loop();
    }

    private async loop() {
        while (true) {
            const job = await this.queue.dequeue();
            await this.process(job);
            await this.sleep(this.timeOffMs);
        }
    }

    private async process(job: AcpJob) {
        try {
            await job.evaluate(true, "Externally evaluated and approved");
            console.log(`[onEvaluate] Job ${job.id} evaluated`);
        } catch (err) {
            console.error(`[onEvaluate] Job ${job.id}:`, err);
        }
    }

    private sleep(ms: number) {
        return new Promise(res => setTimeout(res, ms));
    }
}

async function evaluator() {
    const jobQueue = new JobQueue<AcpJob>();
    const processor = new JobProcessor(jobQueue, 2000);
    processor.start();

    new AcpClient({
        acpContractClient: await AcpContractClient.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            EVALUATOR_ENTITY_ID,
            EVALUATOR_AGENT_WALLET_ADDRESS
        ),
        onEvaluate: async (job: AcpJob) => {
            console.log("[onEvaluate] Evaluation function called", job.memos);
            jobQueue.enqueue(job);
        }
    });

    console.log("[Evaluator] Listening for new jobs...");
}

evaluator();

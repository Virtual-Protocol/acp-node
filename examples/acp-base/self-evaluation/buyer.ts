import AcpClient, {
    AcpAgentSort,
    AcpContractClient,
    AcpGraduationStatus,
    AcpJob,
    AcpJobPhases,
    AcpMemo,
    AcpOnlineStatus
} from "@virtuals-protocol/acp-node";
import {
    BUYER_AGENT_WALLET_ADDRESS,
    BUYER_ENTITY_ID,
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
    private isRunning = false;

    constructor(
        private queue: JobQueue<JobItem>,
        private timeOffMs: number = 1000
    ) {}

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.loop();
    }

    private async loop() {
        while (true) {
            const { job, memoToSign } = await this.queue.dequeue();
            await this.process(job, memoToSign);
            await this.sleep(this.timeOffMs);
        }
    }

    private async process(job: AcpJob, memoToSign?: AcpMemo) {
        try {
            console.log(`[processJob] Job ${job.id} (phase: ${AcpJobPhases[job.phase]})`);

            if (
                job.phase === AcpJobPhases.NEGOTIATION &&
                memoToSign?.nextPhase === AcpJobPhases.TRANSACTION
            ) {
                await job.pay(job.price);
                console.log(`[processJob] Paid for job ${job.id}`);
            }

            else if (
                job.phase === AcpJobPhases.EVALUATION
            ) {
                await job.evaluate(true, "Self-evaluated and approved");
                console.log(`[onEvaluate] Job ${job.id} evaluated`);
            }

            else if (job.phase === AcpJobPhases.COMPLETED) {
                console.log(`[processJob] Job ${job.id} completed`);
            }

            else if (job.phase === AcpJobPhases.REJECTED) {
                console.log(`[processJob] Job ${job.id} rejected`);
            }

            else {
                console.warn(`[processJob] Unknown or unhandled phase: ${job.phase}`);
            }
        } catch (err) {
            console.error(`[processJob] Job ${job.id}:`, err);
        }
    }

    private sleep(ms: number) {
        return new Promise(res => setTimeout(res, ms));
    }
}

async function buyer() {
    const jobQueue = new JobQueue<{ job: AcpJob; memoToSign?: AcpMemo }>();
    const processor = new JobProcessor(jobQueue, 2000);
    processor.start();

    const acpClient = new AcpClient({
        acpContractClient: await AcpContractClient.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            BUYER_ENTITY_ID,
            BUYER_AGENT_WALLET_ADDRESS
        ),
        onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
            console.log(`[onNewTask] Job ${job.id} received`);
            jobQueue.enqueue({ job, memoToSign });
        },
        onEvaluate: async (job: AcpJob) => {
            console.log("[onEvaluate] Evaluation function called", job.memos);
            jobQueue.enqueue({ job });
        }
    });

    const relevantAgents = await acpClient.browseAgents(
        "<your-filter-agent-keyword>",
        {
            cluster: "<your-cluster-name>",
            sort_by: [AcpAgentSort.SUCCESSFUL_JOB_COUNT],
            top_k: 5,
            graduationStatus: AcpGraduationStatus.ALL,
            onlineStatus: AcpOnlineStatus.ALL,
        }
    );
    console.log("Relevant agents:", relevantAgents);

    const chosenAgent = relevantAgents[0];
    const offering = chosenAgent.offerings[0];

    const jobId = await offering.initiateJob(
        { "<your_schema_field>": "Help me to generate a flower meme." },
        BUYER_AGENT_WALLET_ADDRESS,
        new Date(Date.now() + 1000 * 60 * 60 * 24)
    );

    console.log(`Job ${jobId} initiated`);
    console.log(`[Buyer] Listening for next steps...`)
}

buyer();

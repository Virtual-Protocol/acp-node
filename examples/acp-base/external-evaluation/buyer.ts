import AcpClient, {
    AcpContractClient,
    AcpJobPhases,
    AcpJob,
    AcpAgentSort,
    AcpGraduationStatus,
    AcpOnlineStatus
} from "@virtuals-protocol/acp-node";
import AcpMemo from "@virtuals-protocol/acp-node/src/acpMemo";
import {
    BUYER_AGENT_WALLET_ADDRESS,
    EVALUATOR_AGENT_WALLET_ADDRESS,
    BUYER_ENTITY_ID,
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

async function buyer(useThreadLock: boolean = true) {
    const jobQueue = new JobQueue();
    let initiateJobLock = false;

    // Job processing worker
    const processJob = async (job: AcpJob, memoToSign?: AcpMemo) => {
        try {
            if (job.phase === AcpJobPhases.NEGOTIATION) {
                const transactionMemo = job.memos.find((m) => m.nextPhase === AcpJobPhases.TRANSACTION);
                if (transactionMemo) {
                    console.log(`[processJob] Paying job ${job.id}`);
                    await job.pay(job.price);
                    console.log(`[processJob] Job ${job.id} paid`);
                }
            } else if (job.phase === AcpJobPhases.COMPLETED) {
                console.log(`[processJob] Job ${job.id} completed`);
            } else if (job.phase === AcpJobPhases.REJECTED) {
                console.log(`[processJob] Job ${job.id} rejected`);
            }
        } catch (error) {
            console.error(`❌ Error processing job ${job.id}:`, error);
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
                
                await processJob(item.job, item.memoToSign);
            }
        }
    };

    // Start job worker
    jobWorker();

    const acpClient = new AcpClient({
        acpContractClient: await AcpContractClient.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            BUYER_ENTITY_ID,
            BUYER_AGENT_WALLET_ADDRESS
        ),
        onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
            console.log(`[onNewTask] Received job ${job.id} (phase: ${job.phase})`);
            jobQueue.enqueue(job, memoToSign);
        },
    });

    // Browse available agents based on a keyword and cluster name
    const relevantAgents = await acpClient.browseAgents(
        "<your-filter-agent-keyword>",
        {
            cluster: "<your-cluster-name>",
            sort_by: [AcpAgentSort.SUCCESSFUL_JOB_COUNT],
            rerank: true,
            top_k: 5,
            graduationStatus: AcpGraduationStatus.ALL,
            onlineStatus: AcpOnlineStatus.ALL,
        }
    );
    
    console.log("Relevant agents:", relevantAgents);

    // Pick one of the agents based on your criteria (in this example we just pick the first one)
    const chosenAgent = relevantAgents[0];
    console.log("Chosen agent:", chosenAgent);

    // Pick one of the service offerings based on your criteria (in this example we just pick the first one)
    const chosenJobOffering = chosenAgent.offerings[0];

    // Acquire lock for job initiation
    if (useThreadLock) {
        while (initiateJobLock) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        initiateJobLock = true;
    }

    try {
        const jobId = await chosenJobOffering.initiateJob(
            // <your_schema_field> can be found in your ACP Visualiser's "Edit Service" pop-up.
            // Reference: (./images/specify-requirement-toggle-switch.png)
            { '<your_schema_field>': "Help me to generate a flower meme." },
            EVALUATOR_AGENT_WALLET_ADDRESS,
            new Date(Date.now() + 1000 * 60 * 60 * 24)
        );

        console.log(`Job ${jobId} initiated`);
    } finally {
        if (useThreadLock) {
            initiateJobLock = false;
        }
    }

    console.log("Listening for next steps...");
    
    // Keep the process alive
    await new Promise(() => {}); // This will keep the process running indefinitely
}

buyer();

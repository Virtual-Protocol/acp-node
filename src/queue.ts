import AcpClient from './acpClient';

enum QueueJobStatus {
    PENDING = 'pending',
    PROCESSING = 'processing',
    COMPLETED = 'completed',
    FAILED = 'failed'
}

export interface QueueJob {
    id: string;
    createdAt: Date;
    status: QueueJobStatus;
    method: string;
    payload: any;
}

// need to handle memories"local" or redis quene system
export class Queue {
    private queue: QueueJob[] = [];
    private processing: Set<string> = new Set();
    private maxConcurrent: number;
    private acpClient: AcpClient;

    constructor(maxConcurrent: number = 1, acpClient: AcpClient) {
        this.maxConcurrent = maxConcurrent;
        this.acpClient = acpClient;
        this.startProcessing();
    }

    addJob(method: string, ...args: any[]): string {
        const queueJob: QueueJob = {
            id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
            createdAt: new Date(),
            status: QueueJobStatus.PENDING,
            method,
            payload: args
        };

        this.queue.push(queueJob);
        return queueJob.id;
    }

    private startProcessing(): void {
        const processNext = async () => {
            if (this.processing.size >= this.maxConcurrent) {
                setTimeout(processNext, 100);
                return;
            }

            // Look for the next pending job
            const nextJob = this.queue.find(job => job.status === QueueJobStatus.PENDING);
            if (!nextJob) {
                setTimeout(processNext, 1000);
                return;
            }

            // Process the job
            await this.processJob(nextJob);
            setTimeout(processNext, 100);
        };

        processNext(); // Start the loop
    }

    private async processJob(queueJob: QueueJob): Promise<void> {
        queueJob.status = QueueJobStatus.PROCESSING;
        this.processing.add(queueJob.id);

        try {
            await new Promise(resolve => setTimeout(resolve, 1000));

            if (!queueJob.payload) throw new Error('No payload provided');

            switch (queueJob.method) {
                case 'respondJob': {
                    const { jobId, memoId, accept, reason } = queueJob.payload;
                    await this.acpClient.respondJob(jobId, memoId, accept, reason);
                    break;
                }
                case 'payJob': {
                    const { jobId, amount, memoId, reason } = queueJob.payload;
                    await this.acpClient.payJob(jobId, amount, memoId, reason);
                    break;
                }
                case 'deliverJob': {
                    const { jobId, deliverable } = queueJob.payload;
                    await this.acpClient.deliverJob(jobId, deliverable);
                    break;
                }
                case 'evaluateJob': {
                    const { jobId, accept, reason } = queueJob.payload;
                    await this.acpClient.acpContractClient.signMemo(jobId, accept, reason);
                    break;
                }
                default:
                    throw new Error(`Unknown method: ${queueJob.method}`);
            }

            queueJob.status = QueueJobStatus.COMPLETED;
        } catch (error) {
            queueJob.status = QueueJobStatus.FAILED;
        } finally {
            this.processing.delete(queueJob.id);
        }
    }
}

export default Queue;

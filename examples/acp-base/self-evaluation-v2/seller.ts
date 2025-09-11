import dotenv from "dotenv";
import AcpClient, {
    AcpContractClient,
    AcpJob,
    AcpJobPhases,
    AcpMemo,
    baseSepoliaAcpConfig,
    FareAmount,
    MemoType,
} from "../../../src";
import { Address } from "viem";
import {
    SELLER_AGENT_WALLET_ADDRESS,
    SELLER_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY
} from "./env";

dotenv.config();

const config = baseSepoliaAcpConfig;

enum TaskType {
    OPEN_POSITION = "open_position",
    CLOSE_POSITION = "close_position",
    SWAP_TOKEN = "swap_token",
    WITHDRAW = "withdraw",
}

interface IPosition {
    symbol: string;
    amount: number;
}

interface IClientWallet {
    address: Address;
    assets: FareAmount[];
    positions: IPosition[];
}

const client: Record<Address, IClientWallet> = {};

const onNewTask = async (job: AcpJob, memoToSign?: AcpMemo) => {
    if (!client[job.clientAddress]) {
        client[job.clientAddress] = {
            address: job.clientAddress,
            assets: [],
            positions: [],
        };
    }

    if (job.phase === AcpJobPhases.REQUEST) {
        return await handleTaskRequest(job, memoToSign);
    }

    if (job.phase === AcpJobPhases.TRANSACTION) {
        return await handleTaskTransaction(job, memoToSign);
    }

    console.error("Job is not in request or transaction phase", job.phase);
    return;
};

const handleTaskRequest = async (job: AcpJob, memoToSign?: AcpMemo) => {
    const task = memoToSign?.payloadType;
    if (!task) {
        console.error("Task not found", memoToSign?.payloadType);
        return;
    }

    if (task === TaskType.OPEN_POSITION.toString()) {
        await memoToSign.sign(true, "accepts open position");
        return await job.createRequirementPayableMemo(
            "Send me 1 USDC to open position",
            MemoType.PAYABLE_REQUEST,
            new FareAmount(1, config.baseFare),
            job.providerAddress
        );
    }

    if (task === TaskType.CLOSE_POSITION.toString()) {
        await memoToSign.sign(true, "accepts close position");
        return await job.createRequirementMemo("Closing a random position");
    }

    if (task === TaskType.SWAP_TOKEN.toString()) {
        await memoToSign.sign(true, "accepts swap token");
        return await job.createRequirementPayableMemo(
        "Send me 1 USDC to swap to 1 USD",
        MemoType.PAYABLE_REQUEST,
        new FareAmount(1, config.baseFare),
        job.providerAddress
        );
    }

    if (task === TaskType.WITHDRAW.toString()) {
        await memoToSign.sign(true, "accepts withdraw");
        return await job.createRequirementPayableMemo(
            "Withdrawing a random amount",
            MemoType.PAYABLE_TRANSFER_ESCROW,
            new FareAmount(1, config.baseFare),
            job.providerAddress
        );
    }

    console.error("Task not supported", task);
    return;
};

const handleTaskTransaction = async (job: AcpJob, memoToSign?: AcpMemo) => {
    const task = memoToSign?.payloadType;
    if (!task) {
        console.error("Task not found", memoToSign?.payloadType);
        return;
    }

    if (task === TaskType.OPEN_POSITION.toString()) {
        client[job.clientAddress].positions.push({
            symbol: "USDC",
            amount: 1,
        });

        await job.deliver({
            type: "message",
            value: "Opened position with hash 0x1234567890",
        });
        return;
    }

    if (task === TaskType.CLOSE_POSITION.toString()) {
        client[job.clientAddress].positions = client[
        job.clientAddress
        ].positions.filter((p) => p.symbol !== "USDC");

        await job.deliver({
        type: "message",
        value: "Closed position with hash 0x1234567890",
        });
        return;
    }

    if (task === TaskType.SWAP_TOKEN.toString()) {
        client[job.clientAddress].assets.push(new FareAmount(1, config.baseFare));

        await job.deliver({
            type: "message",
            value: "Swapped token with hash 0x1234567890",
        });
        return;
    }

    if (task === TaskType.WITHDRAW.toString()) {
            await job.deliver({
            type: "message",
            value: "Withdrawn amount with hash 0x1234567890",
        });
        return;
    }

    console.error("Task not supported", task);
    return;
};

async function main() {
    const acpClient = new AcpClient({
        acpContractClient: await AcpContractClient.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            SELLER_ENTITY_ID,
            SELLER_AGENT_WALLET_ADDRESS,
            config
        ),
        onNewTask,
    });
}

main();

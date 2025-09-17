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
import { createHash } from "crypto";
import {
    SELLER_AGENT_WALLET_ADDRESS,
    SELLER_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY
} from "./env";

dotenv.config();

const config = baseSepoliaAcpConfig;

enum JobName {
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
    clientAddress: Address;
    assets: FareAmount[];
    positions: IPosition[];
}

const client: Record<Address, IClientWallet> = {};

const getClientWallet = (address: Address): IClientWallet => {
    const hash = createHash("sha256").update(address).digest("hex");
    const walletAddress = `0x${hash}` as Address;

    if (!client[walletAddress]) {
        client[walletAddress] = {
            clientAddress: walletAddress,
            assets: [],
            positions: [],
        };
    }

    return client[walletAddress];
};

const onNewTask = async (job: AcpJob, memoToSign?: AcpMemo) => {
    const wallet = getClientWallet(job.clientAddress);

    if (job.phase === AcpJobPhases.REQUEST) {
        console.log("New job request", job.id, memoToSign?.id, wallet);
        return await handleTaskRequest(job, memoToSign);
    }

    if (job.phase === AcpJobPhases.TRANSACTION) {
        console.log("Job in transaction phase", job.id, memoToSign?.id, wallet);
        return await handleTaskTransaction(job, memoToSign);
    }

    console.error("Job is not in request or transaction phase", job.phase);
    return;
};

const handleTaskRequest = async (job: AcpJob, memoToSign?: AcpMemo) => {
    if (!memoToSign) {
        console.error("Memo to sign not found", memoToSign);
        return;
    }

    const jobName = job.name;
    if (!jobName) {
        console.error("job name not found", job);
        return;
    }

    if (jobName === JobName.OPEN_POSITION.toString()) {
        await memoToSign.sign(true, "accepts open position");
        return await job.createRequirementPayableMemo(
            "Send me 1 USDC to open position",
            MemoType.PAYABLE_REQUEST,
            new FareAmount(1, config.baseFare),
            job.providerAddress
        );
    }

    if (jobName === JobName.CLOSE_POSITION.toString()) {
        await memoToSign.sign(true, "accepts close position");
        return await job.createRequirementMemo("Closing a random position");
    }

    if (jobName === JobName.SWAP_TOKEN.toString()) {
        await memoToSign.sign(true, "accepts swap token");
        return await job.createRequirementPayableMemo(
            "Send me 1 USDC to swap to 1 USD",
            MemoType.PAYABLE_REQUEST,
            new FareAmount(1, config.baseFare),
            job.providerAddress
        );
    }

    if (jobName === JobName.WITHDRAW.toString()) {
        await memoToSign.sign(true, "accepts withdraw");
        return await job.createRequirementPayableMemo(
            "Withdrawing a random amount",
            MemoType.PAYABLE_TRANSFER_ESCROW,
            new FareAmount(1, config.baseFare),
            job.providerAddress
        );
    }

    console.error("Job name not supported", jobName);
    return;
};

const handleTaskTransaction = async (job: AcpJob, memoToSign?: AcpMemo) => {
    const jobName = job.name;
    if (!jobName) {
        console.error("job name not found", job);
        return;
    }

    if (jobName === JobName.OPEN_POSITION.toString()) {
        const wallet = getClientWallet(job.clientAddress);
        
        const position = wallet.positions.find((p) => p.symbol === "USDC");
        
        if (position) {
            position.amount += 1;
        } else {
            wallet.positions.push({
                symbol: "USDC",
                amount: 1,
            });
        }

        await job.deliver({
            type: "message",
            value: "Opened position with hash 0x1234567890",
        });
        return;
    }

    if (jobName === JobName.CLOSE_POSITION.toString()) {
        const wallet = getClientWallet(job.clientAddress);
        const position = wallet.positions.find((p) => p.symbol === "USDC");
        wallet.positions = wallet.positions.filter((p) => p.symbol !== "USDC");
        
        const asset = wallet.assets.find(
            (a) => a.fare.contractAddress === config.baseFare.contractAddress
        );
        if (!asset) {
            wallet.assets.push(
                new FareAmount(position?.amount || 0, config.baseFare)
            );
        } else {
            asset.amount += BigInt(position?.amount || 0);
        }

        await job.deliver({
            type: "message",
            value: "Closed position with hash 0x1234567890",
        });
        return;
    }

    if (jobName === JobName.SWAP_TOKEN.toString()) {
        const wallet = getClientWallet(job.clientAddress);
        const asset = wallet.assets.find(
            (a) => a.fare.contractAddress === config.baseFare.contractAddress
        );
        if (!asset) {
            wallet.assets.push(new FareAmount(1, config.baseFare));
        } else {
            asset.amount += BigInt(1);
        }

        await job.deliver({
            type: "message",
            value: "Swapped token with hash 0x1234567890",
        });
        return;
    }

    if (jobName === JobName.WITHDRAW.toString()) {
        await job.deliver({
            type: "message",
            value: "Withdrawn amount with hash 0x1234567890",
        });
        return;
    }

    console.error("Job name not supported", jobName);
    return;
};

async function main() {
    new AcpClient({
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

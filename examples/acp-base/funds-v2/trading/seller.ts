import dotenv from "dotenv";
import AcpClient, {
    AcpContractClientV2,
    AcpJob,
    AcpJobPhases,
    AcpMemo,
    baseSepoliaAcpConfigV2,
    Fare,
    FareAmount,
    MemoType,
} from "../../../../src";
import { Address } from "viem";
import { createHash } from "crypto";
import {
    SELLER_AGENT_WALLET_ADDRESS,
    SELLER_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY
} from "./env";
import {
    V2DemoClosePositionPayload,
    V2DemoOpenPositionPayload,
    V2DemoSwapTokenPayload
} from "./jobTypes";

dotenv.config();

const config = baseSepoliaAcpConfigV2;

enum JobName {
    OPEN_POSITION = "open_position",
    CLOSE_POSITION = "close_position",
    SWAP_TOKEN = "swap_token",
}

interface IPosition {
    symbol: string;
    amount: number;
}

interface IClientWallet {
    clientAddress: Address;
    positions: IPosition[];
}

const client: Record<Address, IClientWallet> = {};

const getClientWallet = (address: Address): IClientWallet => {
    const hash = createHash("sha256").update(address).digest("hex");
    const walletAddress = `0x${hash}` as Address;

    if (!client[walletAddress]) {
        client[walletAddress] = {
            clientAddress: walletAddress,
            positions: [],
        };
    }

    return client[walletAddress];
};

const onNewTask = async (job: AcpJob, memoToSign?: AcpMemo) => {
    const { id: jobId, phase: jobPhase, name: jobName } = job;
    if (!memoToSign) {
        console.log("[onNewTask] No memo to sign", { jobId });
        return;
    }
    const memoId = memoToSign.id;

    console.info("[onNewTask] Received job", { jobId, phase: AcpJobPhases[jobPhase], jobName, memoId });

    if (jobPhase === AcpJobPhases.REQUEST) {
        return await handleTaskRequest(job, memoToSign);
    } else if (jobPhase === AcpJobPhases.TRANSACTION) {
        return await handleTaskTransaction(job);
    }
};

const handleTaskRequest = async (job: AcpJob, memoToSign?: AcpMemo) => {
    const { id: jobId, name: jobName } = job;
    const memoId = memoToSign?.id;

    if (!memoToSign || !jobName) {
        console.error("[handleTaskRequest] Missing data", { jobId, memoId, jobName });
        return;
    }

    switch (jobName) {
        case JobName.OPEN_POSITION:
            console.log("Accepts position opening request", job.requirement);
            await memoToSign.sign(true, "Accepts position opening");
            const openPositionPayload = job.requirement as V2DemoOpenPositionPayload;
            return job.createRequirementPayableMemo(
                "Send me USDC to open position",
                MemoType.PAYABLE_REQUEST,
                new FareAmount(
                    openPositionPayload.amount,
                    config.baseFare // Open position against ACP Base Currency: USDC
                ),
                job.providerAddress
            );

        case JobName.CLOSE_POSITION:
            const wallet = getClientWallet(job.clientAddress);
            const closePositionPayload = job.requirement as V2DemoClosePositionPayload;

            const symbol = closePositionPayload.symbol
            const position = wallet.positions.find((p) => p.symbol === symbol);
            const positionIsValid = !!position && position.amount > 0
            console.log(`${positionIsValid ? "Accepts" : "Rejects"} position closing request`, job.requirement);
            await memoToSign.sign(positionIsValid, `${positionIsValid ? "Accepts" : "Rejects"} position closing`);
            if (positionIsValid) {
                return job.createRequirementMemo(`Please make payment to close ${symbol}`);
            }
            break;

        case JobName.SWAP_TOKEN:
            console.log("Accepts token swapping request", job.requirement);
            await memoToSign.sign(true, "Accepts token swapping request");

            const swapTokenPayload = job.requirement as V2DemoSwapTokenPayload;

            return job.createRequirementPayableMemo(
                "Send me USDC to swap to VIRTUAL",
                MemoType.PAYABLE_REQUEST,
                new FareAmount(
                    swapTokenPayload.amount,
                    await Fare.fromContractAddress( // Constructing Fare for the token to swap from
                        swapTokenPayload.fromContractAddress,
                        config
                    )
                ),
                job.providerAddress
            );

        default:
            console.warn("[handleTaskRequest] Unsupported job name", { jobId, jobName });
    }
};

const handleTaskTransaction = async (job: AcpJob) => {
    const { id: jobId, name: jobName } = job;
    const wallet = getClientWallet(job.clientAddress);

    if (!jobName) {
        console.error("[handleTaskTransaction] Missing job name", { jobId });
        return;
    }

    switch (jobName) {
        case JobName.OPEN_POSITION:
            const openPositionPayload = job.requirement as V2DemoOpenPositionPayload;
            adjustPosition(
                wallet,
                openPositionPayload.symbol,
                openPositionPayload.amount
            );
            console.log(wallet);
            return job.deliver({ type: "message", value: "Opened position with txn 0x71c038a47fd90069f133e991c4f19093e37bef26ca5c78398b9c99687395a97a" });

        case JobName.CLOSE_POSITION:
            const closePositionPayload = job.requirement as V2DemoClosePositionPayload;
            const closingAmount = closePosition(wallet, closePositionPayload.symbol) || 0;
            console.log(wallet);
            await job.createRequirementPayableMemo(
                `Close ${closePositionPayload.symbol} position as per requested`,
                MemoType.PAYABLE_TRANSFER_ESCROW,
                new FareAmount(
                    closingAmount,
                    config.baseFare
                ),
                job.clientAddress,
            )
            return job.deliver({ type: "message", value: "Closed position with txn hash 0x0f60a30d66f1f3d21bad63e4e53e59d94ae286104fe8ea98f28425821edbca1b" });

        case JobName.SWAP_TOKEN:
            await job.createRequirementPayableMemo(
                `Return swapped token ${(job.requirement as V2DemoSwapTokenPayload)?.toSymbol}`,
                MemoType.PAYABLE_TRANSFER_ESCROW,
                new FareAmount(
                    1,
                    await Fare.fromContractAddress( // Constructing Fare for the token to swap to
                        (job.requirement as V2DemoSwapTokenPayload)?.toContractAddress,
                        config
                    )
                ),
                job.clientAddress,
            )
            return job.deliver({ type: "message", value: "Swapped token with txn hash 0x89996a3858db6708a3041b17b701637977f9548284afa1a4ef0a02ab04aa04ba" });

        default:
            console.warn("[handleTaskTransaction] Unsupported job name", { jobId, jobName });
    }
};

function adjustPosition(wallet: IClientWallet, symbol: string, delta: number) {
    const pos = wallet.positions.find((p) => p.symbol === symbol);
    if (pos) pos.amount += delta;
    else wallet.positions.push({ symbol, amount: delta });
}

function closePosition(wallet: IClientWallet, symbol: string): number | undefined {
    const pos = wallet.positions.find((p) => p.symbol === symbol);
    // remove the position from wallet
    wallet.positions = wallet.positions.filter((p) => p.symbol !== symbol);
    return pos?.amount;
}

async function main() {
    new AcpClient({
        acpContractClient: await AcpContractClientV2.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            SELLER_ENTITY_ID,
            SELLER_AGENT_WALLET_ADDRESS,
            config
        ),
        onNewTask,
    });
}

main();

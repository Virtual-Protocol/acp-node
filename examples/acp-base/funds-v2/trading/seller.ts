import dotenv from "dotenv";
import AcpClient, {
    AcpContractClientV2,
    AcpJob,
    AcpJobPhases,
    AcpMemo,
    baseAcpConfigV2,
    Fare,
    FareAmount,
    MemoType,
} from "@virtuals-protocol/acp-node";
import { Address } from "viem";
import { createHash } from "crypto";
import {
    SELLER_AGENT_WALLET_ADDRESS,
    SELLER_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY,
} from "./env";
import {
    TpSlConfig,
    V2DemoClosePositionPayload,
    V2DemoOpenPositionPayload,
    V2DemoSwapTokenPayload
} from "./jobTypes";
import readline from "readline";

dotenv.config();

const config = baseAcpConfigV2;

enum JobName {
    OPEN_POSITION = "open_position",
    CLOSE_POSITION = "close_position",
    SWAP_TOKEN = "swap_token",
}

interface IPosition {
    symbol: string;
    amount: number;
    tp: TpSlConfig;
    sl: TpSlConfig;
}

interface IClientWallet {
    clientAddress: Address;
    positions: IPosition[];
}

const client: Record<Address, IClientWallet> = {};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            resolve(answer.trim());
        });
    });
};

const promptTpSlAction = async (job: AcpJob, wallet: IClientWallet) => {
    console.log("Wallet:", wallet);
    const positions = wallet.positions.filter((p) => p.amount > 0);
    if (positions.length === 0) {
        return;
    }

    let selectedAction: "TP" | "SL" | null = null;
    while (!selectedAction) {
        console.log("\nAvailable actions:");
        console.log("1. Hit TP");
        console.log("2. Hit SL\n");
        const tpSlAnswer = await question("Select an action (enter the number): ");
        const selectedIndex = parseInt(tpSlAnswer, 10);

        if (selectedIndex === 1) {
            selectedAction = "TP";
        } else if (selectedIndex === 2) {
            selectedAction = "SL";
        } else {
            console.log("Invalid selection. Please try again.\n");
        }
    }

    let position: IPosition | undefined;
    while (!position) {
        const tokenSymbolAnswer = await question("Token symbol to close: ");
        position = wallet.positions.find(
            (p) => p.symbol.toLowerCase() === tokenSymbolAnswer.toLowerCase()
        );

        if (!position || position.amount <= 0) {
            console.log("Invalid token symbol. Please Try again.\n");
            position = undefined;
        }
    }

    console.log(`${position.symbol} position hits ${selectedAction}, sending remaining funds back to buyer`);
    const closingAmount = closePosition(wallet, position.symbol);

    await job.createPayableNotification(
        `${position.symbol} position has hit ${selectedAction}. Closed ${position.symbol} position with txn hash 0x0f60a30d66f1f3d21bad63e4e53e59d94ae286104fe8ea98f28425821edbca1b`,
        new FareAmount(
            closingAmount * (
                selectedAction === "TP"
                    ? 1 + ((position.tp?.percentage || 0) / 100)
                    : 1 - ((position.sl?.percentage || 0) / 100)
            ),
            config.baseFare
        ),
    );

    console.log(`${position.symbol} position funds sent back to buyer`);
    console.log("Wallet:", wallet);
};

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
        case JobName.OPEN_POSITION: {
            console.log("Accepts position opening request", job.requirement);
            await job.accept("Accepts position opening");
            const openPositionPayload = job.requirement as V2DemoOpenPositionPayload;
            return await job.createPayableRequirement(
                "Send me USDC to open position",
                MemoType.PAYABLE_REQUEST,
                new FareAmount(
                    openPositionPayload.amount,
                    config.baseFare // Open position against ACP Base Currency: USDC
                ),
                job.providerAddress
            );
        }

        case JobName.CLOSE_POSITION: {
            const wallet = getClientWallet(job.clientAddress);
            const closePositionPayload = job.requirement as V2DemoClosePositionPayload;

            const symbol = closePositionPayload.symbol;
            const position = wallet.positions.find((p) => p.symbol === symbol);
            const positionIsValid = !!position && position.amount > 0
            console.log(`${positionIsValid ? "Accepts" : "Rejects"} position closing`);
            const response = positionIsValid
                ? `Accepts position closing. Please make payment to close ${symbol} position.`
                : "Rejects position closing. Position is invalid.";
            if (!positionIsValid) {
                return await job.reject(response);
            }
            await job.accept(response);
            return await job.createRequirement(response);
        }

        case JobName.SWAP_TOKEN: {
            console.log("Accepts token swapping request", job.requirement);
            await job.accept("Accepts token swapping request");

            const swapTokenPayload = job.requirement as V2DemoSwapTokenPayload;

            return await job.createPayableRequirement(
                `Send me ${swapTokenPayload.fromSymbol} to swap to ${swapTokenPayload.toSymbol}`,
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
        }

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
        case JobName.OPEN_POSITION: {
            const openPositionPayload = job.requirement as V2DemoOpenPositionPayload;
            openPosition(wallet, openPositionPayload);
            console.log("Opening position", openPositionPayload);
            await job.deliver("Opened position with txn 0x71c038a47fd90069f133e991c4f19093e37bef26ca5c78398b9c99687395a97a");
            console.log("Position opened");
            return await promptTpSlAction(job, wallet);
        }

        case JobName.CLOSE_POSITION: {
            const closePositionPayload = job.requirement as V2DemoClosePositionPayload;
            const closingAmount = closePosition(wallet, closePositionPayload.symbol);
            console.log(`Returning closing amount: ${closingAmount} USDC`);
            await job.deliverPayable(
                `Closed ${closePositionPayload.symbol} position with txn hash 0x0f60a30d66f1f3d21bad63e4e53e59d94ae286104fe8ea98f28425821edbca1b`,
                new FareAmount(
                    closingAmount,
                    config.baseFare
                )
            );
            console.log("Closing amount returned");
            console.log("Wallet:", wallet);
            break;
        }

        case JobName.SWAP_TOKEN: {
            const swapTokenPayload = job.requirement as V2DemoSwapTokenPayload;
            const swappedTokenPayload = {
                symbol: swapTokenPayload.toSymbol,
                amount: new FareAmount(
                    0.00088,
                    await Fare.fromContractAddress( // Constructing Fare for the token to swap to
                        swapTokenPayload.toContractAddress,
                        config
                    )
                )
            }
            console.log("Returning swapped token", swappedTokenPayload);
            await job.deliverPayable(
                `Return swapped token ${swappedTokenPayload.symbol}`,
                swappedTokenPayload.amount
            );
            console.log("Swapped token returned");
            break;
        }

        default:
            console.warn("[handleTaskTransaction] Unsupported job name", { jobId, jobName });
    }
};

function openPosition(wallet: IClientWallet, payload: V2DemoOpenPositionPayload) {
    const { symbol, amount, tp, sl } = payload;
    const pos = wallet.positions.find((p) => p.symbol === symbol);
    if (pos) pos.amount += payload.amount;
    else wallet.positions.push({ symbol, amount, tp, sl });
}

function closePosition(wallet: IClientWallet, symbol: string): number {
    const pos = wallet.positions.find((p) => p.symbol === symbol);
    // remove the position from wallet
    wallet.positions = wallet.positions.filter((p) => p.symbol !== symbol);
    return pos?.amount || 0;
}

async function main() {
    new AcpClient({
        acpContractClient: await AcpContractClientV2.build(
            WHITELISTED_WALLET_PRIVATE_KEY,
            SELLER_ENTITY_ID,
            SELLER_AGENT_WALLET_ADDRESS
        ),
        onNewTask,
    });
}

main();

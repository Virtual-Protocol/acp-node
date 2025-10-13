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
    TpSlConfig,
    V2DemoClosePositionPayload,
    V2DemoOpenPositionPayload,
    V2DemoSwapTokenPayload
} from "./jobTypes";
import readline from "readline";

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
    console.log("\nClient wallet:\n", wallet);
    const positions = wallet.positions.filter((p) => p.amount > 0);
    if (positions.length) {
        console.log("\nAvailable actions:");
        console.log("1. Hit TP");
        console.log("2. Hit SL\n")
        const tpSlAnswer = await question("Select an action (enter the number): ");
        const selectedIndex = parseInt(tpSlAnswer, 10);
        let selectedAction: string | null = null;
        if (selectedIndex === 1) {
            selectedAction = "TP";
        } else if (selectedIndex === 2) {
            selectedAction = "SL";
        }

        if (selectedAction) {
            let validTokenSymbol: boolean = false;
            let position: IPosition | undefined;
            while (!validTokenSymbol) {
                const tokenSymbolAnswer = await question("Token symbol to close: ");
                position = wallet.positions.find((p) => p.symbol.toLowerCase() === tokenSymbolAnswer.toLowerCase());
                validTokenSymbol = !!position && position.amount > 0
            }
            if (position) {
                console.log(`${position.symbol} position hits ${selectedAction}, sending remaining funds back to buyer`);
                closePosition(wallet, position.symbol);
                await job.createPayableNotification(
                    `${position.symbol} position has hit ${selectedAction}. Closed ${position.symbol} position with txn hash 0x0f60a30d66f1f3d21bad63e4e53e59d94ae286104fe8ea98f28425821edbca1b`,
                    new FareAmount(
                        position.amount * (
                            selectedAction === "TP"
                                ? 1 + ((position.tp?.percentage || 0) / 100)
                                : 1 - ((position.sl?.percentage || 0) / 100)
                        ),
                        config.baseFare
                    ),
                );
                console.log(`${position.symbol} position funds sent back to buyer`);
                console.log(wallet);
            }
        } else {
            console.log("Invalid selection. Please try again.");
        }
    }
}

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
            await memoToSign.sign(true, "Accepts position opening");
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
            console.log(`${positionIsValid ? "Accepts" : "Rejects"} position closing request`, job.requirement);
            const response = positionIsValid
                ? `Accepts position closing. Please make payment to close ${symbol} position.`
                : "Rejects position closing. Position is invalid.";
            return await job.respond(positionIsValid, response);
        }

        case JobName.SWAP_TOKEN: {
            console.log("Accepts token swapping request", job.requirement);
            await memoToSign.sign(true, "Accepts token swapping request");

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
            await job.deliver({
                type: "message",
                value: "Opened position with txn 0x71c038a47fd90069f133e991c4f19093e37bef26ca5c78398b9c99687395a97a"
            });
            return await promptTpSlAction(job, wallet);
        }

        case JobName.CLOSE_POSITION: {
            const closePositionPayload = job.requirement as V2DemoClosePositionPayload;
            const closingAmount = closePosition(wallet, closePositionPayload.symbol) || 0;
            console.log(wallet);
            return await job.deliverPayable(
                `Closed ${closePositionPayload.symbol} position with txn hash 0x0f60a30d66f1f3d21bad63e4e53e59d94ae286104fe8ea98f28425821edbca1b`,
                new FareAmount(
                    closingAmount,
                    config.baseFare
                )
            );
        }

        case JobName.SWAP_TOKEN: {
            return await job.deliverPayable(
                `Return swapped token ${(job.requirement as V2DemoSwapTokenPayload)?.toSymbol}`,
                new FareAmount(
                    1,
                    await Fare.fromContractAddress( // Constructing Fare for the token to swap to
                        (job.requirement as V2DemoSwapTokenPayload)?.toContractAddress,
                        config
                    )
                )
            );
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

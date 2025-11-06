import dotenv from "dotenv";
import AcpClient, {
    AcpContractClientV2,
    AcpJob,
    AcpJobPhases,
    AcpMemo,
    baseAcpConfigV2,
    FareAmount,
    MemoType
} from "@virtuals-protocol/acp-node";
import { createHash } from "crypto";
import {
    SELLER_AGENT_WALLET_ADDRESS,
    SELLER_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY,
} from "./env";
import {
    CloseBetPayload,
    CreateMarketPayload,
    PlaceBetPayload,
} from "./jobTypes";
import readline from "readline";
import { Address } from "viem";

dotenv.config();

const config = baseAcpConfigV2;
const REJECT_AND_REFUND: boolean = false; // flag to trigger job.rejectPayable use cases

enum JobName {
    CREATE_MARKET = "create_market",
    PLACE_BET = "place_bet",
    CLOSE_BET = "close_bet",
}

interface Bet {
    bettor: string;
    outcome: string;
    amount: number;
}

interface Market {
    marketId: string;
    question: string;
    outcomes: string[];
    endTime: string;
    liquidity: number;
    bets: Bet[];
    outcomePools: Record<string, number>;
    resolvedOutcome?: string;
}

const markets: Record<string, Market> = {};

const deriveMarketId = (question: string): string => {
    const h = createHash("sha256").update(question).digest("hex");
    return `0x${h.slice(0, 8)}`;
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, (answer) => resolve(answer.trim())));

const promptResolveMarket = async (job: AcpJob) => {
    let market: Market | undefined;
    while (!market) {
        const marketIdAnswer = await question("Enter market ID to resolve: ");
        market = markets[marketIdAnswer];
        if (!market) {
            console.log("Invalid market ID. Please try again.");
        }
    }

    console.log("\nAvailable resolution actions:");
    const outcomes = market.outcomes.map((outcome, idx) => {
        return {
            index: idx + 1,
            name: outcome,
        }
    })
    outcomes.forEach((outcome) => {
        console.log(`${outcome.index}. ${outcome.name}`);
    })

    let selectedAction: string | undefined;
    while (!selectedAction) {
        const resolutionAnswer = await question("\nSelect a resolution (enter the number): ");
        const selectedIndex = parseInt(resolutionAnswer, 10);

        selectedAction = (outcomes.find(
            (outcome) => outcome.index === selectedIndex
        ))?.name;

        if (!selectedAction) {
            console.log("Invalid selection. Please try again.");
        }
    }

    console.log(`\nMarket ${market.marketId} resolved as ${selectedAction}. Calculating payouts...`);

    const totalDistributed = resolveMarket(market, selectedAction);

    await job.createPayableNotification(
        `Market ${market.marketId} resolved as ${selectedAction}. Payouts distributed with txn hash 0x0f60a30d66f1f3d21bad63e4e53e59d94ae286104fe8ea98f28425821edbca1b`,
        new FareAmount(
            totalDistributed,
            config.baseFare
        )
    );

    console.log(`Payout distribution for market ${market.marketId} completed successfully.`);
    delete markets[market.marketId];
    console.log("Markets: ", markets);
};

function resolveMarket(market: Market, resolvedOutcome: string): number {
    market.resolvedOutcome = resolvedOutcome;
    const totalPool = Object.values(market.outcomePools).reduce((a, b) => a + b, 0);
    const winningPool = market.outcomePools[resolvedOutcome] || 0;

    if (winningPool === 0) {
        console.log(`No bets placed on ${resolvedOutcome}. Liquidity returned to creator.`);
        return 0;
    }

    const payoutRatio = totalPool / winningPool;
    console.log(`Payout ratio for ${resolvedOutcome}: ${payoutRatio.toFixed(2)}x`);

    const winningBets = market.bets.filter((b) => b.outcome === resolvedOutcome);
    const payouts: Record<string, number> = {};

    for (const bet of winningBets) {
        payouts[bet.bettor] = (payouts[bet.bettor] || 0) + bet.amount * payoutRatio;
    }

    console.log(`Simulated payouts for ${Object.keys(payouts).length} winning bettors:`);
    Object.entries(payouts).forEach(([bettor, payout], idx) => {
        console.log(`[${idx + 1}] ${bettor} receives ${payout.toFixed(2)}`);
    });

    console.log(`Total distributed: ${totalPool.toFixed(2)} (liquidity + all bets)`);
    return totalPool;
}

function closeBet(clientAddress: Address, marketId: string): number {
    const market = markets[marketId];
    if (!market) return 0;

    // Collect all bets by this client in the market
    const bets = market.bets.filter((b) => b.bettor === clientAddress);
    if (bets.length === 0) return 0;

    let totalPayout = 0;

    // Process each bet one-by-one, recomputing the quote each time for fairness
    for (const bet of bets) {
        const totalPool = Object.values(market.outcomePools).reduce((a, b) => a + b, 0);
        const outcomePool = market.outcomePools[bet.outcome] ?? 0;

        // if pool is empty or the outcome has no liquidity, just refund stake
        const price = (totalPool > 0 && outcomePool > 0) ? (outcomePool / totalPool) : 1.0;

        const payout = bet.amount * price;
        totalPayout += payout;

        // Remove this bet from ledger and pools
        market.bets = market.bets.filter((b) => b !== bet);
        market.outcomePools[bet.outcome] = Math.max(0, outcomePool - bet.amount);
    }

    return totalPayout;
}

const onNewTask = async (job: AcpJob, memoToSign?: AcpMemo) => {
    const { id: jobId, phase: jobPhase, name: jobName } = job;

    if (!memoToSign) {
        console.log("[onNewTask] No memo to sign", { jobId });
        return;
    }

    console.info("[onNewTask] Received job", {
        jobId,
        phase: AcpJobPhases[jobPhase],
        jobName,
        memoId: memoToSign.id,
    });

    if (jobPhase === AcpJobPhases.REQUEST) {
        return await handleTaskRequest(job, memoToSign);
    } else if (jobPhase === AcpJobPhases.TRANSACTION) {
        return await handleTaskTransaction(job);
    }
};

const handleTaskRequest = async (job: AcpJob, memoToSign: AcpMemo) => {
    const { name: jobName } = job;

    if (!memoToSign || !jobName) {
        console.error("[handleTaskRequest] Missing data", { jobName });
        return;
    }

    switch (jobName) {
        case JobName.CREATE_MARKET: {
            const createMarketPayload = job.requirement as CreateMarketPayload;
            console.log("Accepts market creation request", createMarketPayload);

            await job.accept("Accepts market creation");

            return job.createPayableRequirement(
                "Send USDC to setup initial liquidity to create market",
                MemoType.PAYABLE_REQUEST,
                new FareAmount(
                    createMarketPayload.liquidity,
                    config.baseFare // ACP Base Currency: USDC
                ),
                job.providerAddress // funds receiving address, can be any address on Base
            );
        }

        case JobName.PLACE_BET: {
            const payload = job.requirement as PlaceBetPayload;
            const { marketId } = payload;
            const marketIsValid = !!markets[marketId];
            const response = marketIsValid
                ? `Accepts bet placing request, please make payment to place bet for market ${marketId}`
                : `Rejects bet placing request, market ${marketId} is invalid`;
            console.log(response);
            if (marketIsValid) {
                await job.accept(response);
            } else {
                await job.reject(response);
            }

            if (!marketIsValid) {
                return;
            }

            return await job.createPayableRequirement(
                `Send ${payload.amount} ${payload.token || "USDC"} to place bet`,
                MemoType.PAYABLE_REQUEST,
                new FareAmount(
                    payload.amount,
                    config.baseFare // ACP Base Currency: USDC
                ),
                job.providerAddress // funds receiving address, can be any address on Base
            );
        }

        case JobName.CLOSE_BET: {
            const payload = job.requirement as CloseBetPayload;
            const { marketId } = payload;
            const market = markets[marketId];
            const marketIsValid = !!market;
            let betIsValid = false;
            if (marketIsValid) {
                betIsValid = !!(market.bets.find((bet) => bet.bettor === job.clientAddress));
            }
            const response = marketIsValid && betIsValid
                ? `Accepts bet closing request, please make payment to close bet for market ${marketId}`
                : `Rejects bet closing request, ${marketIsValid ? `client address ${job.clientAddress} does not have bet placed in market ${marketId}`: `market ${marketId} is invalid`}`;
            console.log(response);
            if (!betIsValid) {
                return await job.reject(response);
            }
            await job.accept(response);
            return await job.createRequirement(response);
        }

        default:
            console.warn("[handleTaskRequest] Unsupported job name", { jobName });
    }
};

const handleTaskTransaction = async (job: AcpJob) => {
    const { name: jobName } = job;

    switch (jobName) {
        case JobName.CREATE_MARKET: {
            const createMarketPayload = job.requirement as CreateMarketPayload;
            if (REJECT_AND_REFUND) { // to cater cases where a reject and refund is needed (ie: internal server error)
                const reason = `Internal server error handling market creation for ${createMarketPayload.question}`
                console.log(`Rejecting and refunding job ${job.id} with reason: ${reason}`);
                await job.rejectPayable(
                    `${reason}. Refunded ${createMarketPayload.liquidity} $USDC liquidity.`,
                    new FareAmount(
                        createMarketPayload.liquidity,
                        config.baseFare
                    )
                )
                console.log(`Job ${job.id} rejected and refunded.`);
                return;
            }

            const { question, outcomes, liquidity, endTime } = createMarketPayload;
            const marketId = deriveMarketId(question);

            if (outcomes.length < 2) {
                return job.reject("Market creation failed: need >= 2 outcomes");
            }

            const perOutcomeLiquidity = outcomes.length > 0 ? (liquidity / outcomes.length) : 0;
            const outcomePools = outcomes.reduce((acc, o) => {
                acc[o] = perOutcomeLiquidity;
                return acc;
            }, {} as Record<string, number>);

            markets[marketId] = {
                marketId,
                question,
                outcomes,
                endTime,
                liquidity,
                bets: [],
                outcomePools,
            };

            console.log(`Market created: ${markets[marketId].question} | id=${marketId}`);
            await job.deliver(`Market created with id ${marketId}`);
            console.log("Markets: ", markets);
            break;
        }

        case JobName.PLACE_BET: {
            const placeBetPayload = job.requirement as PlaceBetPayload;
            if (REJECT_AND_REFUND) { // to cater cases where a reject and refund is needed (ie: internal server error)
                const reason = `Internal server error handling bet placement for market ${placeBetPayload.marketId}`
                console.log(`Rejecting and refunding job ${job.id} with reason: ${reason}`);
                await job.rejectPayable(
                    `${reason}. Refunded ${placeBetPayload.amount} ${placeBetPayload.token || "USDC"} bet amount.`,
                    new FareAmount(
                        placeBetPayload.amount,
                        config.baseFare
                    )
                )
                console.log(`Job ${job.id} rejected and refunded.`);
                return;
            }

            const { marketId, outcome, amount } = placeBetPayload;
            const market = markets[marketId];

            market.bets.push({
                bettor: job.clientAddress,
                outcome,
                amount,
            });
            market.outcomePools[outcome] += amount;

            console.log(`${amount} $USDC bet placed on ${outcome} in ${marketId} by ${job.clientAddress}`);
            await job.deliver("Bet recorded");
            console.log("Markets: ", markets);

            await promptResolveMarket(job);
            break;
        }

        case JobName.CLOSE_BET: {
            const closeBetPayload = job.requirement as CloseBetPayload;
            const { marketId } = closeBetPayload;
            if (REJECT_AND_REFUND) { // to cater cases where a reject and refund is needed (ie: internal server error)
                const reason = `Internal server error handling bet closure for market ${marketId}`
                console.log(`Rejecting and refunding job ${job.id} with reason: ${reason}`);
                // Get the original bet amount before closing (closeBet removes bets from market)
                const market = markets[marketId];
                const bets = market?.bets.filter((b) => b.bettor === job.clientAddress) || [];
                const originalBetAmount = bets.reduce((sum, bet) => sum + bet.amount, 0);
                await job.rejectPayable(
                    `${reason}. Refunded ${originalBetAmount} $USDC original bet amount.`,
                    new FareAmount(
                        originalBetAmount,
                        config.baseFare
                    )
                )
                console.log(`Job ${job.id} rejected and refunded.`);
                return;
            }
            const closingAmount = closeBet(job.clientAddress, marketId);
            console.log(`Bet closed for ${job.clientAddress} in market ${marketId}`);
            await job.deliverPayable(
                `Bet closed in market ${marketId}, returning ${closingAmount} USDC`,
                new FareAmount(
                    closingAmount,
                    config.baseFare
                )
            );
            console.log("Markets: ", markets);
            break;
        }

        default:
            console.warn("[handleTaskTransaction] Unsupported job name", { jobName });
            return;
    }
};

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

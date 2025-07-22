// TODO: Update import to @virtuals-protocol/acp-node after package update

import AcpClient, {
  AcpContractClient,
  AcpJob,
  AcpJobPhases,
  AcpMemo,
  baseSepoliaAcpConfig,
  MemoType,
} from "../../../src";
import {
    SELLER_AGENT_WALLET_ADDRESS,
    SELLER_ENTITY_ID,
    WHITELISTED_WALLET_PRIVATE_KEY
} from "./env";
import { FundResponsePayload, PayloadType } from "../../../src/interfaces";

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function seller() {
  // for simulation only
  let positionFulFilledCount = 0;

  new AcpClient({
    acpContractClient: await AcpContractClient.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      SELLER_ENTITY_ID,
      SELLER_AGENT_WALLET_ADDRESS,
      baseSepoliaAcpConfig
    ),
    onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
      if (
        job.phase === AcpJobPhases.REQUEST &&
        memoToSign?.nextPhase === AcpJobPhases.NEGOTIATION
      ) {
        console.log("Responding to job", job, "with memo", memoToSign.id);
        await job.respond<FundResponsePayload>(
            true,
            {
              type: PayloadType.FUND_RESPONSE,
              data: {
                reportingApiEndpoint: "https://example-reporting-api-endpoint/positions"
              }
            }
        );
        console.log(`Job ${job.id} responded`);
        return;
      }

      if (
        job.phase === AcpJobPhases.TRANSACTION &&
        memoToSign?.nextPhase === AcpJobPhases.TRANSACTION &&
        memoToSign.type !== MemoType.MESSAGE
      ) {
        // opening positions for client
        if (memoToSign?.type === MemoType.PAYABLE_TRANSFER) {
          console.log("Accepting positions opening", job, "with memo", memoToSign.id);
          await job.responseOpenPosition(memoToSign?.id, true, "accepts position opening");
          console.log(`Job ${job.id} position opening accepted`);

          if (positionFulFilledCount === 0) {
              positionFulFilledCount += 1;
              // Seller starts closing positions on TP/SL hit (Delay for simulation, real world scenario should be triggered when real tp/sl hit)
              await delay(50000);
              await job.positionFulfilled(
                  {
                      symbol: "VIRTUAL",
                      amount: 99,
                      contractAddress: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
                      type: "TP",
                      pnl: 96,
                      entryPrice: 1.8,
                      exitPrice: 59.4
                  }
              )
              console.log(`Job ${job.id} VIRTUAL TP fulfilled`);

              // Transfer unfulfilled amount back to buyer
              await delay(40000);
              await job.unfulfilledPosition(
                  {
                      symbol: "ETH",
                      amount: 1.5,
                      contractAddress: "0xd449119E89773693D573ED217981659028C7662E",
                      type: "PARTIAL"
                  }
              )
              console.log(`Job ${job.id} ETH position partially fulfilled, returning the remainders`);
          }
          return;
        }

        // closing positions for client
        if (memoToSign?.type === MemoType.PAYABLE_REQUEST) {
          console.log("Accepting positions closing", job, "with memo", memoToSign.id);
          await job.responseClosePartialPosition(memoToSign?.id, true, "accepts position closing");
          console.log(`Job ${job.id} position closing accepted`);

          return;
        }
        return;
      }

      // closing the job
      if (
        job.phase === AcpJobPhases.TRANSACTION &&
        memoToSign?.type === MemoType.MESSAGE
      ) {
        if (job.memos.length > 3) {
          console.log("Closing job", job, "with memo", memoToSign.id);
          // close job with remaining positions (not TP/SL nor closed by buyer)
          await job.responseCloseJob(
              memoToSign?.id,
              true,
              [
                  {
                      symbol: "ETH",
                      amount: 0.5,
                      contractAddress: "0xd449119E89773693D573ED217981659028C7662E",
                      type: "CLOSE",
                      pnl: 0,
                      entryPrice: 3000,
                      exitPrice: 3000
                  }
              ]
          ); // transfer amount to client (closing the job)
          console.log(`Job ${job.id} closed`);

          return;
        }
      }
    },
  });
}

seller();

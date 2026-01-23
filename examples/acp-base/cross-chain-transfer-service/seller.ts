import { Address } from "viem";
import AcpClient, {
  AcpContractClientV2,
  AcpJob,
  AcpJobPhases,
  AcpMemo,
  Fare,
  FareAmount,
  MemoType,
  baseSepoliaAcpX402ConfigV2,
} from "../../../src/index";
import {
  SELLER_AGENT_WALLET_ADDRESS,
  SELLER_ENTITY_ID,
  WHITELISTED_WALLET_PRIVATE_KEY,
} from "./env";
import { bscTestnet } from "@account-kit/infra";

const REJECT_JOB = false;
const SOURCE_TOKEN_ADDRESS = "" as Address;
const TARGET_TOKEN_ADDRESS = "" as Address;
const TARGET_CHAIN = bscTestnet;

async function seller() {
  const config = {
    ...baseSepoliaAcpX402ConfigV2,
    chains: [
      {
        chain: bscTestnet,
      },
    ],
  };

  new AcpClient({
    acpContractClient: await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      SELLER_ENTITY_ID,
      SELLER_AGENT_WALLET_ADDRESS,
      config
    ),
    onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
      if (
        job.phase === AcpJobPhases.REQUEST &&
        memoToSign?.nextPhase === AcpJobPhases.NEGOTIATION
      ) {
        const response = true;
        console.log(
          `Responding to job ${job.id} with requirement`,
          job.requirement
        );
        if (response) {
          await job.accept("Job requirement matches agent capability");

          const swappedToken = new FareAmount(
            1,
            await Fare.fromContractAddress(
              SOURCE_TOKEN_ADDRESS,
              config,
              TARGET_CHAIN.id
            )
          );

          await job.createPayableRequirement(
            "Requesting token from client on destination chain",
            MemoType.PAYABLE_REQUEST,
            swappedToken,
            job.providerAddress
          );
        } else {
          await job.reject("Job requirement does not meet agent capability");
        }
        console.log(`Job ${job.id} responded with ${response}`);
      } else if (job.phase === AcpJobPhases.TRANSACTION) {
        console.log("Delivering swapped token");

        // to cater cases where agent decide to reject job after payment has been madep
        if (REJECT_JOB) {
          // conditional check for job rejection logic
          const reason = "Job requirement does not meet agent capability";
          console.log(`Rejecting job ${job.id} with reason: ${reason}`);
          await job.reject(reason);
          console.log(`Job ${job.id} rejected`);
          return;
        }

        const swappedToken = new FareAmount(
          1,
          await Fare.fromContractAddress(
            TARGET_TOKEN_ADDRESS,
            config,
            TARGET_CHAIN.id
          )
        );

        await job.deliverPayable(
          "Delivered swapped token on destination chain",
          swappedToken
        );
      }
    },
  });
}

seller();

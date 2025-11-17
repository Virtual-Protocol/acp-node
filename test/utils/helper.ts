import AcpContractClientV2 from "../../src/contractClients/acpContractClientV2";
import type { Address } from "viem";

const MOCK_WHITELISTED_WALLET_ADDRESS =
  "0x123456000000000000000000000000000000000000000000000000000000abcd";
const MOCK_SELLER_ENTITY_ID = "1";
const MOCK_SELLER_AGENT_WALLET_ADDRESS =
  "0x123456000000000000000000000000000000abcd";

export {
  MOCK_WHITELISTED_WALLET_ADDRESS,
  MOCK_SELLER_ENTITY_ID,
  MOCK_SELLER_AGENT_WALLET_ADDRESS,
};

export async function createContractClientV2(): Promise<AcpContractClientV2> {
  const contractClient = await AcpContractClientV2.build(
    process.env.WHITELISTED_WALLET_PRIVATE_KEY! as Address,
    parseInt(process.env.SELLER_ENTITY_ID!),
    process.env.SELLER_AGENT_WALLET_ADDRESS! as Address,
  );

  return contractClient;
}

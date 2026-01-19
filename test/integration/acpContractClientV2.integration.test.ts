import { Address } from "viem";
import AcpContractClientV2 from "../../src/contractClients/acpContractClientV2";
import {
  WHITELISTED_WALLET_PRIVATE_KEY,
  SELLER_ENTITY_ID,
  SELLER_AGENT_WALLET_ADDRESS,
} from "../env";
import { testBaseAcpConfigV2 } from "../testConfigs";

describe("AcpContractClientV2 Integration Testing", () => {
  jest.setTimeout(60000); // 60 seconds for network operations

  let contractClient: AcpContractClientV2;

  afterEach(() => {
    contractClient = null as any;
  });

  it("should build client successfully", async () => {
    contractClient = await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY as Address,
      SELLER_ENTITY_ID,
      SELLER_AGENT_WALLET_ADDRESS as Address,
      testBaseAcpConfigV2,
    );

    expect(contractClient).toBeDefined();
    expect(contractClient).toBeInstanceOf(AcpContractClientV2);
    expect(contractClient.getAcpVersion()).toBe("2");

    expect(contractClient["jobManagerAddress"]).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(contractClient["memoManagerAddress"]).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(contractClient["accountManagerAddress"]).toMatch(
      /^0x[a-fA-F0-9]{40}$/,
    );
  });

  it("should initialize client successfully", async () => {
    contractClient = await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY as Address,
      SELLER_ENTITY_ID,
      SELLER_AGENT_WALLET_ADDRESS as Address,
      testBaseAcpConfigV2,
    );

    await contractClient.init(
      WHITELISTED_WALLET_PRIVATE_KEY as Address,
      SELLER_ENTITY_ID,
    );

    expect(contractClient.sessionKeyClient).toBeDefined();
    expect(contractClient.acpX402).toBeDefined();

    expect(typeof contractClient.sessionKeyClient).toBe("object");
    expect(typeof contractClient.acpX402).toBe("object");
  });
});

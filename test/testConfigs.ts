import { AcpContractConfig } from "../src/configs/acpConfigs";
import {
  baseAcpConfig,
  baseAcpX402Config,
  baseAcpConfigV2,
  baseAcpX402ConfigV2,
} from "../src/configs/acpConfigs";

/**
 * Test-specific configs that use the Alchemy proxy RPC endpoint
 * to avoid rate limiting issues when running the full test suite.
 *
 * IMPORTANT: These should ONLY be used in tests, never in production code.
 * The proxy is internal infrastructure and not meant for public SDK users.
 */

// Create test configs by cloning production configs and overriding rpcEndpoint
export const testBaseAcpConfig = new AcpContractConfig(
  baseAcpConfig.chain,
  baseAcpConfig.contractAddress,
  baseAcpConfig.baseFare,
  baseAcpConfig.alchemyRpcUrl,
  baseAcpConfig.acpUrl,
  baseAcpConfig.abi,
  baseAcpConfig.maxRetries,
  baseAcpConfig.alchemyRpcUrl, // Use proxy for tests
  baseAcpConfig.x402Config,
);

export const testBaseAcpX402Config = new AcpContractConfig(
  baseAcpX402Config.chain,
  baseAcpX402Config.contractAddress,
  baseAcpX402Config.baseFare,
  baseAcpX402Config.alchemyRpcUrl,
  baseAcpX402Config.acpUrl,
  baseAcpX402Config.abi,
  baseAcpX402Config.maxRetries,
  baseAcpX402Config.alchemyRpcUrl, // Use proxy for tests
  baseAcpX402Config.x402Config,
);

export const testBaseAcpConfigV2 = new AcpContractConfig(
  baseAcpConfigV2.chain,
  baseAcpConfigV2.contractAddress,
  baseAcpConfigV2.baseFare,
  baseAcpConfigV2.alchemyRpcUrl,
  baseAcpConfigV2.acpUrl,
  baseAcpConfigV2.abi,
  baseAcpConfigV2.maxRetries,
  baseAcpConfigV2.alchemyRpcUrl, // Use proxy for tests
  baseAcpConfigV2.x402Config,
);

export const testBaseAcpX402ConfigV2 = new AcpContractConfig(
  baseAcpX402ConfigV2.chain,
  baseAcpX402ConfigV2.contractAddress,
  baseAcpX402ConfigV2.baseFare,
  baseAcpX402ConfigV2.alchemyRpcUrl,
  baseAcpX402ConfigV2.acpUrl,
  baseAcpX402ConfigV2.abi,
  baseAcpX402ConfigV2.maxRetries,
  baseAcpX402ConfigV2.alchemyRpcUrl, // Use proxy for tests
  baseAcpX402ConfigV2.x402Config,
);

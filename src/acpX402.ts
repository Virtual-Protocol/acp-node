import { ModularAccountV2Client } from "@account-kit/smart-contracts";
import AcpError from "./acpError";
import { AcpContractConfig } from "./configs/acpConfigs";
import {
  OffChainJob,
  X402PayableRequest,
  X402PayableRequirements,
  X402Payment,
} from "./interfaces";
import { createPublicClient, erc20Abi } from "viem";
import FIAT_TOKEN_V2_ABI from "./abis/fiatTokenV2Abi";
import { randomBytes } from "crypto";
import { HTTP_STATUS_CODES, X402AuthorizationTypes } from "./constants";
import { safeBase64Encode } from "./utils";

export class AcpX402 {
  constructor(
    private config: AcpContractConfig,
    private sessionKeyClient: ModularAccountV2Client,
    private publicClient: ReturnType<typeof createPublicClient>
  ) {
    this.config = config;
    this.sessionKeyClient = sessionKeyClient;
    this.publicClient = publicClient;
  }

  async signUpdateJobNonceMessage(
    jobId: number,
    nonce: string
  ): Promise<`0x${string}`> {
    const message = `${jobId}-${nonce}`;
    const signature = await this.sessionKeyClient.signMessage({
      account: this.sessionKeyClient.account,
      message,
    });
    return signature;
  }

  async updateJobNonce(jobId: number, nonce: string): Promise<OffChainJob> {
    try {
      const apiUrl = `${this.config.acpUrl}/api/jobs/${jobId}/x402-nonce`;
      const signature = await this.signUpdateJobNonceMessage(jobId, nonce);

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "x-signature": signature,
          "x-nonce": nonce,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: {
            nonce,
          },
        }),
      });

      if (!response.ok) {
        throw new AcpError(
          "Failed to update job X402 nonce",
          response.statusText
        );
      }

      const acpJob = await response.json();

      return acpJob;
    } catch (error) {
      throw new AcpError("Failed to update job X402 nonce", error);
    }
  }

  async generatePayment(
    payableRequest: X402PayableRequest,
    requirements: X402PayableRequirements
  ): Promise<X402Payment> {
    try {
      const USDC_CONTRACT = this.config.baseFare.contractAddress;
      const timeNow = Math.floor(Date.now() / 1000);
      const validAfter = timeNow.toString();
      const validBefore = (
        timeNow + requirements.accepts[0].maxTimeoutSeconds
      ).toString();

      const [tokenName, tokenVersion] = await this.publicClient.multicall({
        contracts: [
          {
            address: USDC_CONTRACT,
            abi: erc20Abi,
            functionName: "name",
          },
          {
            address: USDC_CONTRACT,
            abi: FIAT_TOKEN_V2_ABI,
            functionName: "version",
          },
        ],
      });

      const nonce = `0x${randomBytes(32).toString("hex")}`;

      const message = {
        from: this.sessionKeyClient.account.address,
        to: payableRequest.to,
        value: payableRequest.value.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      };

      const typedData = {
        types: {
          TransferWithAuthorization: X402AuthorizationTypes,
        },
        domain: {
          name: tokenName.result as string,
          version: tokenVersion.result as string,
          chainId: this.config.chain.id,
          verifyingContract: USDC_CONTRACT,
        },
        primaryType: "TransferWithAuthorization",
        message,
      };

      const signature = await this.sessionKeyClient.signTypedData({
        typedData: typedData as any,
      });

      const payload = {
        x402Version: requirements.x402Version,
        scheme: requirements.accepts[0].scheme,
        network: requirements.accepts[0].network,
        payload: {
          signature,
          authorization: message,
        },
      };

      const encodedPayment = safeBase64Encode(JSON.stringify(payload));

      return {
        encodedPayment,
        nonce,
      };
    } catch (error) {
      throw new AcpError("Failed to generate X402 payment", error);
    }
  }

  async performRequest(url: string, budget?: string, signature?: string) {
    const baseUrl = this.config.x402Config?.url;
    if (!baseUrl) throw new AcpError("X402 URL not configured");

    try {
      const headers: Record<string, string> = {};
      if (signature) headers["x-payment"] = signature;
      if (budget) headers["x-budget"] = budget.toString();

      const res = await fetch(`${baseUrl}${url}`, { method: "GET", headers });

      const data = await res.json();

      if (!res.ok && res.status !== HTTP_STATUS_CODES.PAYMENT_REQUIRED) {
        throw new AcpError(
          "Invalid response status code for X402 request",
          data
        );
      }

      return {
        isPaymentRequired: res.status === HTTP_STATUS_CODES.PAYMENT_REQUIRED,
        data,
      };
    } catch (error) {
      throw new AcpError("Failed to perform X402 request", error);
    }
  }
}

import {
  Address,
  createPublicClient,
  erc20Abi,
  ethAddress,
  http,
  parseUnits,
} from "viem";
import AcpError from "./acpError";
import { AcpContractConfig, baseAcpConfig } from "./configs/acpConfigs";

class Fare {
  constructor(
    public contractAddress: Address,
    public decimals: number,
    public chainId?: number
  ) {}

  formatAmount(amount: number) {
    return parseUnits(amount.toString(), this.decimals);
  }

  static async fromContractAddress(
    contractAddress: Address,
    config: AcpContractConfig = baseAcpConfig,
    chainId: number = config.chain.id
  ) {
    if (contractAddress === config.baseFare.contractAddress) {
      return config.baseFare;
    }

    let chainConfig = config.chain;
    let rpcUrl = config.rpcEndpoint;

    if (chainId !== config.chain.id) {
      const selectedChainConfig = config.chains.find(
        (chain) => chain.id === chainId
      );

      if (!selectedChainConfig) {
        throw new AcpError(
          `Chain configuration for chainId ${chainId} not found.`
        );
      }

      chainConfig = selectedChainConfig;
      rpcUrl = `${config.alchemyRpcUrl}?chainId=${chainId}`;
    }

    const publicClient = createPublicClient({
      chain: chainConfig,
      transport: http(rpcUrl),
    });

    const decimals = await publicClient.readContract({
      address: contractAddress,
      abi: erc20Abi,
      functionName: "decimals",
    });

    return new Fare(contractAddress, decimals as number, chainId);
  }
}

abstract class FareAmountBase {
  amount: bigint;
  fare: Fare;

  constructor(amount: bigint, fare: Fare) {
    this.amount = amount;
    this.fare = fare;
  }

  abstract add(other: FareAmountBase): FareAmountBase;

  static async fromContractAddress(
    amount: number | bigint,
    contractAddress: Address,
    config: AcpContractConfig = baseAcpConfig
  ): Promise<FareAmountBase> {
    const fare = await Fare.fromContractAddress(contractAddress, config);

    if (typeof amount === "number") {
      return new FareAmount(amount, fare);
    }

    return new FareBigInt(amount, fare);
  }
}

class FareAmount extends FareAmountBase {
  constructor(fareAmount: number, fare: Fare) {
    const truncateTo6Decimals = (input: string): number => {
      const [intPart, decPart = ""] = input.split(".");

      if (decPart === "") {
        return parseFloat(intPart);
      }

      const truncated = decPart.slice(0, 6).padEnd(6, "0");

      return parseFloat(`${intPart}.${truncated}`);
    };

    super(fare.formatAmount(truncateTo6Decimals(fareAmount.toString())), fare);
  }

  add(other: FareAmountBase) {
    if (
      this.fare.contractAddress.toLowerCase() !==
      other.fare.contractAddress.toLowerCase()
    ) {
      throw new Error("Token addresses do not match");
    }

    return new FareBigInt(this.amount + other.amount, this.fare);
  }
}

class FareBigInt implements FareAmountBase {
  amount: bigint;
  fare: Fare;

  constructor(amount: bigint, fare: Fare) {
    this.amount = amount;
    this.fare = fare;
  }

  add(other: FareAmountBase): FareAmountBase {
    if (this.fare.contractAddress !== other.fare.contractAddress) {
      throw new AcpError("Token addresses do not match");
    }

    return new FareBigInt(this.amount + other.amount, this.fare);
  }
}

const wethFare = new Fare("0x4200000000000000000000000000000000000006", 18);
const ethFare = new Fare(ethAddress, 18);

export { Fare, FareAmountBase, FareAmount, FareBigInt, wethFare, ethFare };

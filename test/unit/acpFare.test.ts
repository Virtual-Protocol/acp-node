jest.mock("../../src/configs/acpConfigs", () => ({
  baseAcpConfig: {
    baseFare: {
      contractAddress: "0xMockedBaseFare",
      decimals: 18,
    },
  },
  AcpContractConfig: {},
}));

jest.mock("viem", () => ({
  ...jest.requireActual("viem"),
  createPublicClient: jest.fn(),
}));

import { Address, createPublicClient } from "viem";
import {
  Fare,
  FareAmount,
  FareBigInt,
  FareAmountBase,
  wethFare,
  ethFare,
} from "../../src/acpFare";
import AcpError from "../../src/acpError";

describe("AcpFare Unit Testing", () => {
  // Create mock config to avoid circular dependency
  const mockBaseAcpConfig = {
    baseFare: new Fare("0xBaseFare" as Address, 18),
    chain: { id: 8453 },
    rpcUrl: "https://test.rpc",
  };

  describe("Fare Class", () => {
    describe("Constructor", () => {
      it("should initialize with correct parameters", () => {
        const fare = new Fare("0x1234" as Address, 18);

        expect(fare.contractAddress).toBe("0x1234");
        expect(fare.decimals).toBe(18);
      });
    });

    describe("formatAmount", () => {
      it("should format amount with 18 decimals", () => {
        const fare = new Fare("0x1234" as Address, 18);
        const result = fare.formatAmount(1);

        expect(result).toBe(1000000000000000000n); // 1 * 10^18
      });

      it("should format amount with 6 decimals", () => {
        const fare = new Fare("0x1234" as Address, 6);
        const result = fare.formatAmount(1);

        expect(result).toBe(1000000n); // 1 * 10^6
      });

      it("should format decimal amounts", () => {
        const fare = new Fare("0x1234" as Address, 18);
        const result = fare.formatAmount(1.5);

        expect(result).toBe(1500000000000000000n); // 1.5 * 10^18
      });
    });

    describe("fromContractAddress", () => {
      it("should return baseFare when address matches config", async () => {
        const result = await Fare.fromContractAddress(
          mockBaseAcpConfig.baseFare.contractAddress,
          mockBaseAcpConfig as any,
        );
        expect(result).toBe(mockBaseAcpConfig.baseFare);
      });

      it("should create new Fare by reading decimals from contract", async () => {
        const mockAddress = "0xCustomAddress" as Address;

        const mockDecimals = 6;

        const mockReadContract = jest.fn().mockResolvedValue(mockDecimals);
        (createPublicClient as jest.Mock).mockReturnValue({
          readContract: mockReadContract,
        });

        const result = await Fare.fromContractAddress(
          mockAddress,
          mockBaseAcpConfig as any,
        );

        expect(result).toBeInstanceOf(Fare);
        expect(result.contractAddress).toBe(mockAddress);
        expect(result.decimals).toBe(mockDecimals);
        expect(mockReadContract).toHaveBeenCalledWith({
          address: mockAddress,
          abi: expect.any(Array),
          functionName: "decimals",
        });
      });
    });
  });

  describe("FareAmount Class", () => {
    let fare: Fare;

    beforeEach(() => {
      fare = new Fare("0xToken" as Address, 18);
    });

    describe("Constructor", () => {
      it("should create FareAmount with whole number", () => {
        const fareAmount = new FareAmount(100, fare);

        expect(fareAmount.amount).toBe(100000000000000000000n);
        expect(fareAmount.fare).toBe(fare);
      });

      it("should truncate to 6 decimals", () => {
        const fareAmount = new FareAmount(1.123456789, fare);

        expect(fareAmount.amount).toBe(1123456000000000000n);
      });

      it("should handle numbers with less than 6 decimals", () => {
        const fareAmount = new FareAmount(5, fare);

        expect(fareAmount.amount).toBe(5000000000000000000n);
      });

      it("should handle numbers without decimals", () => {
        const fareAmount = new FareAmount(5, fare);

        expect(fareAmount.amount).toBe(5000000000000000000n);
      });
    });

    describe("add", () => {
      it("should add two FareAmounts with same token", () => {
        const fareAmount1 = new FareAmount(10, fare);
        const fareAmount2 = new FareAmount(5, fare);

        const result = fareAmount1.add(fareAmount2);

        expect(result.fare).toBe(fare);
      });

      it("should throw error when adding FareAmounts with different tokens", () => {
        const fare1 = new Fare("0xToken1" as Address, 18);
        const fare2 = new Fare("0xToken2" as Address, 18);

        const fareAmount1 = new FareAmount(10, fare1);
        const fareAmount2 = new FareAmount(5, fare2);

        expect(() => fareAmount1.add(fareAmount2)).toThrow(
          "Token addresses do not match",
        );
      });

      it("should add FareAmount with FareBigInt", () => {
        const fareAmount = new FareAmount(10, fare);
        const fareBigInt = new FareBigInt(5000000000000000000n, fare);

        const result = fareAmount.add(fareBigInt);

        expect(result).toBeInstanceOf(FareBigInt);
        expect(result.amount).toBe(15000000000000000000n);
      });
    });
  });

  describe("FareBigInt Class", () => {
    let fare: Fare;

    beforeEach(() => {
      fare = new Fare("0xToken" as Address, 18);
    });

    describe("Constructor", () => {
      it("should create FareBigInt with bigint amount", () => {
        const fareBigInt = new FareBigInt(1000000000000000000n, fare);

        expect(fareBigInt.amount).toBe(1000000000000000000n);

        expect(fareBigInt.fare).toBe(fare);
      });
    });

    describe("add", () => {
      it("should add two FareBigInts with same token", () => {
        const fareBigInt1 = new FareBigInt(10000000000000000000n, fare);
        const fareBigInt2 = new FareBigInt(5000000000000000000n, fare);

        const result = fareBigInt1.add(fareBigInt2);

        expect(result).toBeInstanceOf(FareBigInt);
        expect(result.amount).toBe(15000000000000000000n);
        expect(result.fare).toBe(fare);
      });

      it("should throw AcpError when adding FareBigInts with different tokens", () => {
        const fare1 = new Fare("0xToken1" as Address, 18);
        const fare2 = new Fare("0xToken2" as Address, 18);
        const fareBigInt1 = new FareBigInt(10000000000000000000n, fare1);
        const fareBigInt2 = new FareBigInt(5000000000000000000n, fare2);

        expect(() => fareBigInt1.add(fareBigInt2)).toThrow(AcpError);
        expect(() => fareBigInt1.add(fareBigInt2)).toThrow(
          "Token addresses do not match",
        );
      });

      it("should add FareBigInt with FareAmount", () => {
        const fareBigInt = new FareBigInt(10000000000000000000n, fare);
        const fareAmount = new FareAmount(5, fare);
        const result = fareBigInt.add(fareAmount);

        expect(result).toBeInstanceOf(FareBigInt);
        expect(result.amount).toBe(15000000000000000000n);
      });
    });
  });

  describe("FareAmountBase Class", () => {
    describe("fromContractAddress", () => {
      it("should create FareAmount when amount is number", async () => {
        const mockAddress = "0xToken" as Address;
        const mockDecimals = 18;

        const mockReadContract = jest.fn().mockResolvedValue(mockDecimals);
        (createPublicClient as jest.Mock).mockReturnValue({
          readContract: mockReadContract,
        });

        const result = await FareAmountBase.fromContractAddress(
          100,
          mockAddress,
          mockBaseAcpConfig,
        );

        expect(result).toBeInstanceOf(FareAmount);
        expect(result.amount).toBe(100000000000000000000n);
      });

      it("should create FareBigInt when amount is bigint", async () => {
        const mockAddress = "0xToken" as Address;
        const mockDecimals = 18;

        const mockReadContract = jest.fn().mockResolvedValue(mockDecimals);
        (createPublicClient as jest.Mock).mockReturnValue({
          readContract: mockReadContract,
        });

        const result = await FareAmountBase.fromContractAddress(
          100000000000000000000n,
          mockAddress,
          mockBaseAcpConfig,
        );

        expect(result).toBeInstanceOf(FareBigInt);
        expect(result.amount).toBe(100000000000000000000n);
      });

      it("should use baseFare when address matches config", async () => {
        const result = await FareAmountBase.fromContractAddress(
          10,
          mockBaseAcpConfig.baseFare.contractAddress,
          mockBaseAcpConfig,
        );

        expect(result.fare).toBe(mockBaseAcpConfig.baseFare);
      });
    });
  });

  describe("Exported Constants", () => {
    it("should export wethFare with correct address and decimals", () => {
      expect(wethFare).toBeInstanceOf(Fare);
      expect(wethFare.contractAddress).toBe(
        "0x4200000000000000000000000000000000000006",
      );
      expect(wethFare.decimals).toBe(18);
    });

    it("should export ethFare with correct address and decimals", () => {
      expect(ethFare).toBeInstanceOf(Fare);
      expect(ethFare.decimals).toBe(18);
    });
  });
});

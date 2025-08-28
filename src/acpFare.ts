import { Address, ethAddress, parseUnits } from "viem";
import AcpError from "./acpError";

class Fare {
  constructor(public contractAddress: Address, public decimals: number) {}

  formatAmount(amount: number) {
    return parseUnits(amount.toString(), this.decimals);
  }
}

interface IFareAmount {
  amount: bigint;
  fare: Fare;
  add(other: IFareAmount): IFareAmount;
}

class FareAmount implements IFareAmount {
  amount: bigint;
  fare: Fare;

  constructor(fareAmount: number, fare: Fare) {
    this.amount = fare.formatAmount(
      this.truncateTo6Decimals(fareAmount.toString())
    );
    this.fare = fare;
  }

  truncateTo6Decimals(input: string): number {
    const [intPart, decPart = ""] = input.split(".");

    if (decPart === "") {
      return parseFloat(intPart);
    }

    const truncated = decPart.slice(0, 6).padEnd(6, "0");

    return parseFloat(`${intPart}.${truncated}`);
  }

  add(other: IFareAmount) {
    if (this.fare.contractAddress !== other.fare.contractAddress) {
      throw new AcpError("Token addresses do not match");
    }

    return new FareAmount(Number(this.amount + other.amount), this.fare);
  }
}

class FareBigInt implements IFareAmount {
  amount: bigint;
  fare: Fare;

  constructor(amount: bigint, fare: Fare) {
    this.amount = amount;
    this.fare = fare;
  }

  add(other: IFareAmount): IFareAmount {
    if (this.fare.contractAddress !== other.fare.contractAddress) {
      throw new AcpError("Token addresses do not match");
    }

    return new FareBigInt(this.amount + other.amount, this.fare);
  }
}

const wethFare = new Fare("0x4200000000000000000000000000000000000006", 18);
const ethFare = new Fare(ethAddress, 18);

export { Fare, IFareAmount, FareAmount, FareBigInt, wethFare, ethFare };

import { Address, parseUnits } from "viem";

class Fare {
  constructor(public contractAddress: Address, public decimals: number) {}

  formatAmount(amount: number) {
    return parseUnits(amount.toString(), this.decimals);
  }
}

class FareAmount {
  constructor(public amount: number, public fare: Fare) {}

  format() {
    return this.fare.formatAmount(this.amount);
  }

  add(other: FareAmount) {
    if (this.fare.contractAddress !== other.fare.contractAddress) {
      throw new Error("Token addresses do not match");
    }

    return new FareAmount(this.amount + other.amount, this.fare);
  }
}

export { Fare, FareAmount };

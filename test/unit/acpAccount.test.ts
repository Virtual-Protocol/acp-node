import { Address } from "viem";
import { AcpAccount } from "../../src/acpAccount";
import BaseAcpContractClient from "../../src/contractClients/baseAcpContractClient";

describe("AcpAccount", () => {
  let mockContractClient: jest.Mocked<BaseAcpContractClient>;
  let acpAccount: AcpAccount;

  beforeEach(() => {
    mockContractClient = {
      updateAccountMetadata: jest
        .fn()
        .mockReturnValue({ type: "UPDATE_METADATA" }),
    } as any;

    acpAccount = new AcpAccount(
      mockContractClient,
      123,
      "0xClient" as Address,
      "0xProvider" as Address,
      { status: "active" },
    );
  });

  describe("Constructor", () => {
    it("should initialize with correct properties", () => {
      expect(acpAccount.id).toBe(123);
      expect(acpAccount.clientAddress).toBe("0xClient");
      expect(acpAccount.providerAddress).toBe("0xProvider");
      expect(acpAccount.metadata).toEqual({ status: "active" });
      expect(acpAccount.contractClient).toBe(mockContractClient);
    });
  });

  describe("updateMetadata", () => {
    it("should call contractClient.updateAccountMetadata with stringified metadata", async () => {
      const newMetadata = { status: "completed", amount: 100 };
      const mockPayload = { type: "UPDATE_METADATA", data: "test" };

      (mockContractClient.updateAccountMetadata as jest.Mock).mockReturnValue(
        mockPayload,
      );

      const result = await acpAccount.updateMetadata(newMetadata);

      expect(mockContractClient.updateAccountMetadata).toHaveBeenCalledWith(
        123,
        JSON.stringify(newMetadata),
      );
      expect(result).toBe(mockPayload);
    });

    it("should return operation payload from updateAccountMetadata", async () => {
      const mockPayload = { type: "UPDATE", data: "payload" };
      (mockContractClient.updateAccountMetadata as jest.Mock).mockReturnValue(
        mockPayload,
      );

      const result = await acpAccount.updateMetadata({ updated: true });

      expect(result).toBe(mockPayload);
    });
  });
});

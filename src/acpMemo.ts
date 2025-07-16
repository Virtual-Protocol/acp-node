import AcpClient from "./acpClient";
import { AcpJobPhases, MemoType } from "./acpContractClient";
import { GenericPayload, PayloadType } from "./interfaces";
import { tryParseJson } from "./utils";

class AcpMemo {
  structuredContent: GenericPayload | undefined;

  constructor(
    private acpClient: AcpClient,
    public id: number,
    public type: MemoType,
    public content: string,
    public nextPhase: AcpJobPhases
  ) {
    this.structuredContent =
      tryParseJson<GenericPayload>(this.content) || undefined;
  }

  get payloadType(): PayloadType | undefined {
    return this.structuredContent?.type;
  }

  getStructuredContent<T>(): T | undefined {
    return this.structuredContent as T | undefined;
  }

  async create(jobId: number, isSecured: boolean = true) {
    return await this.acpClient.acpContractClient.createMemo(
      jobId,
      this.content,
      this.type,
      isSecured,
      this.nextPhase
    );
  }

  async sign(approved: boolean, reason?: string) {
    return await this.acpClient.acpContractClient.signMemo(
      this.id,
      approved,
      reason
    );
  }
}

export default AcpMemo;

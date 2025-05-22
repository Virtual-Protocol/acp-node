import { Socket } from "socket.io-client";
import { SocketEvents } from "./acpClient";
import AcpJob from "./acpJob";
import { AcpJobPhases, AcpNegoStatus } from "./acpContractClient";
import { Address } from "viem";

interface Message {
  id: number;
  sender: Address;
  recipient: Address;
  content: string;
  timestamp: number;
}

class AcpMessage {
  constructor(
    public id: number,
    public messages: Message[],
    public socket: Socket,
    public acpJob: AcpJob | null,
    public walletAddress: Address
  ) {}

  initOrReply(message: string) {
    if (!this.acpJob) {
      throw new Error("Cannot initiate or reply conversation without job");
    }

    if (this.acpJob.negoStatus !== AcpNegoStatus.PENDING) {
      throw new Error(
        "Cannot initiate or reply conversation in non-negotiation phase"
      );
    }

    if (
      this.messages.length > 0 &&
      this.messages[this.messages.length - 1].sender === this.walletAddress
    ) {
      throw new Error("Cannot reply to own message");
    }

    this.socket.timeout(5000).emit(
      SocketEvents.ON_CREATE_MSG,
      {
        jobId: this.acpJob.id,
        content: message,
        sender: this.walletAddress,
        recipient:
          this.messages.length > 0
            ? this.messages[this.messages.length - 1].sender
            : this.acpJob.providerAddress,
      },
      (err: any, response: any) => {
        if (err || !response) {
          console.log(`Message not received`, err);
        } else {
          console.log(`Message received`);
        }
      }
    );
  }
}

export default AcpMessage;

import { JsonRpcError, type JsonRpcPayload } from "@ckb-ccc/core";
import type { PeerId } from "@libp2p/interface";

type Handler = (payload: JsonRpcPayload) => unknown;

export class KhieConnectionAuthorizer {
  private readonly states = new Map<
    string,
    { status: "connected" } | { status: "connecting" }
  >();

  async handle(peerId: PeerId, payload: JsonRpcPayload, handler: Handler) {
    const peer = peerId.toString();
    if (payload.method === "get_info") {
      return handler(payload);
    }
    if (payload.method !== "connect") {
      if (this.states.get(peer)?.status !== "connected") {
        throw new JsonRpcError({
          code: -32001,
          message: "Connect must be approved before this request",
        });
      }
      return handler(payload);
    }

    const connecting = { status: "connecting" } as const;
    this.states.set(peer, connecting);
    try {
      const result = await handler(payload);
      if (this.states.get(peer) === connecting) {
        this.states.set(peer, { status: "connected" });
      }
      return result;
    } finally {
      if (this.states.get(peer) === connecting) {
        this.states.delete(peer);
      }
    }
  }

  unpair(peerId: PeerId): void {
    this.states.delete(peerId.toString());
  }
}

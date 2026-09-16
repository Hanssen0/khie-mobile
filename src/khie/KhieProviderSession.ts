import { ccc } from "@ckb-ccc/core";
import { Libp2p } from "@ckb-ccc/libp2p";
import type { Identify, IdentifyPush } from "@libp2p/identify";
import {
  StreamStateError,
  type Connection,
  type IdentifyResult,
  type Peer,
  type PeerId,
} from "@libp2p/interface";
import { multiaddr } from "@multiformats/multiaddr";

import { KhieConnectionAuthorizer } from "./connectionAuthorizer";
import {
  decodePairingEndpointMobile,
  encodePairingEndpointMobile,
  PairingEndpointError,
} from "./pairingEndpointCodec";
import {
  DEFAULT_KHIE_RELAY_ADDRESS,
  DEFAULT_PAIRED_PEER_TIMEOUT_MS,
  JSON_RPC_MAX_MESSAGE_LENGTH,
  JSON_RPC_TIMEOUT_MS,
  KHIE_JSON_RPC_PROTOCOL,
  KHIE_PAIRING_PROTOCOL,
} from "./protocol";
import { khieTrace } from "../runtime/khieTrace";

type ProviderJsonRpcComponents = Libp2p.JsonRpcServiceComponents & {
  pairing: Libp2p.PairingService;
};

type ProviderServices = {
  identify: Identify;
  identifyPush: IdentifyPush;
  jsonRpc: Libp2p.JsonRpcService<ProviderJsonRpcComponents>;
  pairing: Libp2p.PairingService;
};

type ProviderNode = Awaited<ReturnType<typeof createProviderNode>>;

export type KhieRequestContext = {
  readonly signal: AbortSignal;
  cancel: (cause: Error) => void;
};

type Handler = (
  payload: ccc.JsonRpcPayload,
  context: KhieRequestContext,
) => unknown;

export type KhieRemotePeer = {
  active: boolean;
  agentVersion?: string;
  direct?: boolean;
  id: string;
  lastSeenAt?: number;
  name?: string;
};

export type KhieProviderSessionState = {
  endpoint: string;
  error?: KhieProviderSessionError;
  paired: boolean;
  ready: boolean;
  relayAddress: string;
  relayConnected: boolean;
  relayConnecting: boolean;
  remotePeer?: KhieRemotePeer;
};

export type KhieProviderSessionError = {
  kind: "incompatible-pairing-code" | "runtime";
  message: string;
};

export type KhieProviderSessionConfig = {
  endpointUrl: string;
  handler: Handler;
  onStateChange?: (state: KhieProviderSessionState) => void;
  pairedPeerTimeoutMs?: number;
  relayAddress?: string;
};

export class KhieProviderSession {
  private readonly abortController = new AbortController();
  private readonly subscriptions: Array<() => void> = [];
  private node?: ProviderNode;
  private relayConnection?: Connection;
  private pairedPeer?: PeerId;
  private pairedPeerName?: string;
  private pairingController?: AbortController;
  private endpointUpdateId = 0;
  private remotePeerUpdateId = 0;
  private disconnectedAt?: number;
  private relayAddress: string;
  private state: KhieProviderSessionState;

  constructor(private readonly config: KhieProviderSessionConfig) {
    this.relayAddress = (
      config.relayAddress ?? DEFAULT_KHIE_RELAY_ADDRESS
    ).trim();
    this.state = {
      endpoint: "",
      paired: false,
      ready: false,
      relayAddress: this.relayAddress,
      relayConnected: false,
      relayConnecting: false,
    };
  }

  get snapshot(): KhieProviderSessionState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.node || this.abortController.signal.aborted) {
      return;
    }
    khieTrace("session.start.begin");
    try {
      const node = await createProviderNode(
        () => !this.abortController.signal.aborted && !this.pairedPeer,
        (peerId) => this.pairedPeer?.equals(peerId) === true,
        this.config.handler,
        this.config.pairedPeerTimeoutMs ?? DEFAULT_PAIRED_PEER_TIMEOUT_MS,
        this.abortController.signal,
      );
      this.node = node;
      khieTrace("session.start.ready", { peerId: node.peerId.toString() });
      this.observe(node);
      this.patchState({ ready: true });
      await this.connectRelay();
    } catch (cause) {
      if (this.abortController.signal.aborted) {
        return;
      }
      this.reportError(cause);
      throw cause;
    }
  }

  async connectRelay(relayAddress = this.relayAddress): Promise<boolean> {
    const node = this.node;
    const address = relayAddress.trim();
    if (
      !node ||
      !address ||
      this.abortController.signal.aborted ||
      this.state.relayConnecting
    ) {
      return false;
    }
    this.relayAddress = address;
    const startedAt = Date.now();
    khieTrace("relay.connect.begin", { address });
    this.patchState({ relayAddress: address, relayConnecting: true });
    const previous = this.relayConnection;
    this.relayConnection = undefined;
    let connection: Connection | undefined;
    try {
      await previous?.close();
      connection = await node.dial(multiaddr(address), {
        signal: this.abortController.signal,
      });
      this.abortController.signal.throwIfAborted();
      this.relayConnection = connection;
      khieTrace("relay.connect.success", {
        durationMs: Date.now() - startedAt,
        ...connectionDetails(connection),
      });
      this.patchState({ error: undefined, relayConnected: true });
      await this.syncEndpoint(node);
      return true;
    } catch (cause) {
      khieTrace("relay.connect.failure", {
        durationMs: Date.now() - startedAt,
        error: errorDetails(cause),
      });
      await connection?.close();
      this.patchState({ relayConnected: false });
      this.reportError(cause);
      return false;
    } finally {
      this.patchState({ relayConnecting: false });
    }
  }

  async pair(endpoint: string): Promise<boolean> {
    const node = this.node;
    if (!node || this.pairedPeer || this.pairingController) {
      return false;
    }
    const controller = new AbortController();
    this.pairingController = controller;
    const signal = ccc.abortSignalAny([
      this.abortController.signal,
      controller.signal,
    ]);
    this.patchState({ error: undefined });
    const startedAt = Date.now();
    try {
      const target = await decodePairingEndpointMobile(endpoint, "connector");
      khieTrace("pair.begin", {
        addresses: target.addresses.map(String),
      });
      await node.services.pairing.pair(target, { signal });
      khieTrace("pair.success", { durationMs: Date.now() - startedAt });
      this.patchState({ error: undefined });
      return true;
    } catch (cause) {
      khieTrace("pair.failure", {
        durationMs: Date.now() - startedAt,
        error: errorDetails(cause),
      });
      if (!controller.signal.aborted) {
        this.reportError(cause);
      }
      return false;
    } finally {
      if (this.pairingController === controller) {
        this.pairingController = undefined;
      }
    }
  }

  cancelPairing(): void {
    const error = new Error("Pairing canceled");
    error.name = "AbortError";
    this.pairingController?.abort(error);
  }

  async unpair(): Promise<void> {
    if (this.node && this.pairedPeer) {
      await this.node.services.pairing.unpair(this.pairedPeer);
    }
  }

  async resume(): Promise<void> {
    const node = this.node;
    if (!node || this.abortController.signal.aborted) {
      return;
    }
    const hasRelay = this.relayConnection?.status === "open";
    if (!hasRelay) {
      await this.connectRelay();
    }
    if (!this.pairedPeer) {
      return;
    }
    try {
      await Libp2p.dialKnownAddresses(node, this.pairedPeer, this.abortController.signal);
    } catch {
      // A relay connection remains a valid session when a direct upgrade fails.
    }
    await this.syncRemotePeer(node, this.pairedPeer);
  }

  async close(): Promise<void> {
    if (this.abortController.signal.aborted) {
      return;
    }
    this.abortController.abort();
    this.cancelPairing();
    this.subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
    try {
      if (this.node && this.pairedPeer) {
        await this.node.services.pairing.unpair(this.pairedPeer);
      }
    } finally {
      try {
        await this.relayConnection?.close();
      } finally {
        await this.node?.stop();
      }
    }
  }

  private observe(node: ProviderNode): void {
    const syncEndpoint = () => void this.syncEndpoint(node).catch((cause) => this.reportError(cause));
    const syncIdentified = (event: CustomEvent<IdentifyResult>) => {
      if (this.pairedPeer?.equals(event.detail.peerId)) {
        void this.syncRemotePeer(node, event.detail.peerId, event.detail);
      }
    };
    const refreshPeer = (event: CustomEvent<PeerId>) => {
      if (!this.pairedPeer?.equals(event.detail)) {
        return;
      }
      node.services.pairing.refresh(event.detail);
      khieTrace(event.type, { peerId: event.detail.toString() });
      this.disconnectedAt = event.type === "peer:connect" ? undefined : Date.now();
      void this.syncRemotePeer(node, event.detail);
    };
    const syncConnection = (event: CustomEvent<Connection>) => {
      khieTrace(event.type, connectionDetails(event.detail));
      if (event.type === "connection:close" && event.detail === this.relayConnection) {
        this.relayConnection = undefined;
        this.patchState({ relayConnected: false });
      }
      if (this.pairedPeer?.equals(event.detail.remotePeer)) {
        void this.syncRemotePeer(node, event.detail.remotePeer);
      }
    };

    node.addEventListener("self:peer:update", syncEndpoint);
    node.addEventListener("peer:identify", syncIdentified);
    node.addEventListener("peer:connect", refreshPeer);
    node.addEventListener("peer:disconnect", refreshPeer);
    node.addEventListener("connection:open", syncConnection);
    node.addEventListener("connection:close", syncConnection);
    this.subscriptions.push(
      () => node.removeEventListener("self:peer:update", syncEndpoint),
      () => node.removeEventListener("peer:identify", syncIdentified),
      () => node.removeEventListener("peer:connect", refreshPeer),
      () => node.removeEventListener("peer:disconnect", refreshPeer),
      () => node.removeEventListener("connection:open", syncConnection),
      () => node.removeEventListener("connection:close", syncConnection),
      node.services.pairing.onSecretChanged(syncEndpoint),
      node.services.pairing.onError((error) => this.reportError(error)),
      node.services.jsonRpc.onError((error) => this.reportError(error)),
      node.services.pairing.onPaired((peerId, name) => {
        if (this.pairedPeer) {
          return;
        }
        this.pairedPeer = peerId;
        this.pairedPeerName = name;
        khieTrace("pair.event.paired", { peerId: peerId.toString(), name });
        this.disconnectedAt = undefined;
        this.patchState({ paired: true });
        void this.syncRemotePeer(node, peerId);
      }),
      node.services.pairing.onUnpaired((peerId) => {
        if (!this.pairedPeer?.equals(peerId)) {
          return;
        }
        this.pairedPeer = undefined;
        khieTrace("pair.event.unpaired", { peerId: peerId.toString() });
        this.pairedPeerName = undefined;
        this.disconnectedAt = undefined;
        this.remotePeerUpdateId += 1;
        this.patchState({ paired: false, remotePeer: undefined });
      }),
    );
    syncEndpoint();
  }

  private async syncEndpoint(node: ProviderNode): Promise<void> {
    const updateId = ++this.endpointUpdateId;
    const addresses = node.getMultiaddrs();
    const endpoint = addresses.length
      ? await encodePairingEndpointMobile(
          this.config.endpointUrl,
          addresses,
          node.services.pairing.secret,
          "provider",
        )
      : "";
    if (updateId === this.endpointUpdateId) {
      this.patchState({ endpoint });
    }
  }

  private async syncRemotePeer(
    node: ProviderNode,
    peerId: PeerId,
    identified?: IdentifyResult,
  ): Promise<void> {
    const updateId = ++this.remotePeerUpdateId;
    let peer: Peer | undefined;
    try {
      peer = await node.peerStore.get(peerId);
    } catch {
      // Identify may not have populated the peer store yet.
    }
    if (updateId !== this.remotePeerUpdateId || !this.pairedPeer?.equals(peerId)) {
      return;
    }
    const connections = node.getConnections(peerId).filter(({ status }) => status === "open");
    const active = connections.length > 0;
    this.disconnectedAt = active ? undefined : (this.disconnectedAt ?? Date.now());
    const metadata = (key: string) => {
      const value = peer?.metadata.get(key);
      return value ? ccc.bytesTo(value, "utf8") : undefined;
    };
    this.patchState({
      remotePeer: {
        active,
        agentVersion: identified?.agentVersion ?? metadata("AgentVersion"),
        direct: active ? connections.some(({ direct }) => direct) : undefined,
        id: peerId.toString(),
        lastSeenAt: active ? undefined : this.disconnectedAt,
        name: this.pairedPeerName,
      },
    });
  }

  private patchState(patch: Partial<KhieProviderSessionState>): void {
    this.state = { ...this.state, ...patch };
    this.config.onStateChange?.(this.state);
  }

  private reportError(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error("Khie session failed");
    // Connection listeners own recovery when a peer closes a stream mid-write.
    if (error instanceof StreamStateError) {
      return;
    }
    if (!(error instanceof PairingEndpointError) && error.name !== "AbortError") {
      console.error("Khie provider session error", error.stack ?? error.message);
    }
    this.patchState({
      error: {
        kind:
          error instanceof PairingEndpointError ||
          error.name === "UnsupportedProtocolError"
            ? "incompatible-pairing-code"
            : "runtime",
        message: error.message,
      },
    });
  }
}

async function createProviderNode(
  canPair: Libp2p.PairingGuard,
  isSelectedPeer: (peerId: PeerId) => boolean,
  handler: Handler,
  pairedPeerTimeoutMs: number,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const authorizer = new KhieConnectionAuthorizer();
  const [
    { noise },
    { yamux },
    { circuitRelayTransport },
    { identify, identifyPush },
    { webRTC },
    { webSockets },
    { createLibp2p },
  ] = await Promise.all([
    import("@chainsafe/libp2p-noise"),
    import("@chainsafe/libp2p-yamux"),
    import("@libp2p/circuit-relay-v2"),
    import("@libp2p/identify"),
    import("@libp2p/webrtc"),
    import("@libp2p/websockets"),
    import("libp2p"),
  ]);
  signal.throwIfAborted();

  let node: Awaited<ReturnType<typeof createLibp2p<ProviderServices>>> | undefined;
  try {
    node = await createLibp2p<ProviderServices>({
      addresses: { listen: ["/p2p-circuit", "/webrtc"] },
      peerStore: { maxAddressAge: Infinity },
      transports: [webSockets(), webRTC(), circuitRelayTransport()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      services: {
        identify: identify(),
        identifyPush: identifyPush(),
        pairing: Libp2p.pairingService(
          { name: "Khie Wallet", protocol: KHIE_PAIRING_PROTOCOL, pairedPeerTimeoutMs },
          canPair,
        ),
        jsonRpc: Libp2p.jsonRpcService<ProviderJsonRpcComponents>(
          { protocol: KHIE_JSON_RPC_PROTOCOL, maxMessageLength: JSON_RPC_MAX_MESSAGE_LENGTH },
          function (request) {
            const { pairing } = this.components;
            const startedAt = Date.now();
            const rpc = rpcDetails(request.payload);
            khieTrace("rpc.request.received", {
              peerId: request.peerId.toString(),
              ...connectionDetails(request.connection),
              ...rpc,
            });
            if (!pairing.isPaired(request.peerId) || !isSelectedPeer(request.peerId)) {
              khieTrace("rpc.request.rejected", {
                peerId: request.peerId.toString(),
                ...rpc,
              });
              throw new ccc.JsonRpcError({
                code: -32000,
                message: "Peer is not paired for Khie access",
              });
            }
            pairing.refresh(request.peerId);
            const controller = new AbortController();
            const context: KhieRequestContext = {
              signal: ccc.abortSignalAny([signal, controller.signal]),
              cancel: (cause) => controller.abort(cause),
            };
            return withTimeout(
              Promise.resolve(
                authorizer.handle(request.peerId, request.payload, (payload) =>
                  handler(payload, context),
                ),
              ),
              JSON_RPC_TIMEOUT_MS,
              context.cancel,
            ).then(
              (result) => {
                khieTrace("rpc.request.completed", {
                  durationMs: Date.now() - startedAt,
                  peerId: request.peerId.toString(),
                  ...connectionDetails(request.connection),
                  ...rpc,
                });
                return result;
              },
              (cause) => {
                khieTrace("rpc.request.failure", {
                  durationMs: Date.now() - startedAt,
                  peerId: request.peerId.toString(),
                  ...connectionDetails(request.connection),
                  ...rpc,
                  error: errorDetails(cause),
                });
                throw cause;
              },
            );
          },
        ),
      },
    });
    node.services.pairing.onUnpaired((peerId) => authorizer.unpair(peerId));
    signal.throwIfAborted();
    return node;
  } catch (cause) {
    await node?.stop();
    throw cause;
  }
}

function connectionDetails(connection: Connection): Record<string, unknown> {
  return {
    connectionId: connection.id,
    direct: connection.direct,
    direction: connection.direction,
    remoteAddr: connection.remoteAddr?.toString(),
    remotePeer: connection.remotePeer?.toString(),
    status: connection.status,
    streamCount: connection.streams?.length,
    openedAt: connection.timeline?.open,
    closedAt: connection.timeline?.close,
  };
}

function rpcDetails(payload: ccc.JsonRpcPayload): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null) return {};
  const value = payload as { id?: unknown; method?: unknown };
  return {
    rpcId: value.id,
    rpcMethod: typeof value.method === "string" ? value.method : undefined,
  };
}

function errorDetails(cause: unknown): Record<string, unknown> {
  if (!(cause instanceof Error)) return { value: String(cause) };
  return { name: cause.name, message: cause.message };
}

function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  cancel: (cause: Error) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const error = new Error("Khie request timed out");
      error.name = "TimeoutError";
      cancel(error);
      reject(error);
    }, milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timeout);
        reject(cause);
      },
    );
  });
}

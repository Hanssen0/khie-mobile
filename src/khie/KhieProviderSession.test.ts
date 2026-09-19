import { afterEach, describe, expect, it, vi } from "vitest";
import type { PeerId } from "@libp2p/interface";
import { multiaddr } from "@multiformats/multiaddr";

import { KhieProviderSession } from "./KhieProviderSession";
import { DEFAULT_KHIE_RELAY_ADDRESS } from "./protocol";

const createRelayConnection = (id: string) => ({
  close: vi.fn(async () => {}),
  id,
  status: "open",
});

const createRelayNode = (...connections: ReturnType<typeof createRelayConnection>[]) => {
  const node = new EventTarget();
  const dial = vi.fn(async () => {
    const connection = connections.shift();
    if (!connection) throw new Error("No relay connection available");
    return connection;
  });
  Object.assign(node, {
    dial,
    getMultiaddrs: () => [],
  });
  return { dial, node };
};

const createSession = (relayAddress?: string) =>
  new KhieProviderSession({
    endpointUrl: "https://example.com/khie",
    handler: () => undefined,
    relayAddress,
  });

describe("KhieProviderSession relay address", () => {
  afterEach(() => vi.useRealTimers());

  it("starts with the default relay address", () => {
    expect(createSession().snapshot).toMatchObject({
      relayAddress: DEFAULT_KHIE_RELAY_ADDRESS,
      relayConnected: false,
      relayConnecting: false,
    });
  });

  it("normalizes a configured relay address", () => {
    expect(createSession("  /dns4/relay.example/tcp/443/wss  ").snapshot.relayAddress)
      .toBe("/dns4/relay.example/tcp/443/wss");
  });

  it("keeps a runtime relay address for reconnects", async () => {
    const states: Array<{ relayAddress: string; relayConnecting: boolean }> = [];
    const session = new KhieProviderSession({
      endpointUrl: "https://example.com/khie",
      handler: () => undefined,
      onStateChange: ({ relayAddress, relayConnecting }) => {
        states.push({ relayAddress, relayConnecting });
      },
    });
    const { dial, node } = createRelayNode(createRelayConnection("relay-1"));
    Object.assign(session, { node });

    await expect(
      session.connectRelay("  /dns4/custom.example/tcp/443/wss  "),
    ).resolves.toBe(true);

    expect(dial).toHaveBeenCalledOnce();
    expect(session.snapshot).toMatchObject({
      relayAddress: "/dns4/custom.example/tcp/443/wss",
      relayConnected: true,
      relayConnecting: false,
    });
    expect(states).toContainEqual({
      relayAddress: "/dns4/custom.example/tcp/443/wss",
      relayConnecting: true,
    });
  });

  it("reconnects automatically after the relay connection closes", async () => {
    const first = createRelayConnection("relay-1");
    const second = createRelayConnection("relay-2");
    const { dial, node } = createRelayNode(first, second);
    const states: Array<{ relayConnected: boolean; relayConnecting: boolean }> = [];
    const session = new KhieProviderSession({
      endpointUrl: "https://example.com/khie",
      handler: () => undefined,
      onStateChange: ({ relayConnected, relayConnecting }) => {
        states.push({ relayConnected, relayConnecting });
      },
    });
    Object.assign(session, { node });

    await session.connectRelay();
    node.dispatchEvent(
      new CustomEvent("connection:close", { detail: first }),
    );

    await vi.waitFor(() => expect(dial).toHaveBeenCalledTimes(2));
    expect(states).toContainEqual({
      relayConnected: false,
      relayConnecting: true,
    });
    expect(session.snapshot).toMatchObject({
      relayConnected: true,
      relayConnecting: false,
    });
  });

  it("retries when the initial relay dial fails", async () => {
    vi.useFakeTimers();
    const connection = createRelayConnection("relay-1");
    const dial = vi
      .fn()
      .mockRejectedValueOnce(new Error("relay unavailable"))
      .mockResolvedValueOnce(connection);
    const node = new EventTarget();
    Object.assign(node, { dial, getMultiaddrs: () => [] });
    const session = createSession();
    Object.assign(session, { node });

    const connecting = session.connectRelay();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(connecting).resolves.toBe(true);
    expect(dial).toHaveBeenCalledTimes(2);
    expect(session.snapshot).toMatchObject({
      relayConnected: true,
      relayConnecting: false,
    });
  });

  it("stops the previous relay owner when changing addresses", async () => {
    const first = createRelayConnection("relay-1");
    const second = createRelayConnection("relay-2");
    const { node } = createRelayNode(first, second);
    const session = createSession();
    Object.assign(session, { node });

    await session.connectRelay();
    await session.connectRelay("/dns4/other.example/tcp/443/wss");

    expect(first.close).toHaveBeenCalledOnce();
    expect(session.snapshot).toMatchObject({
      relayAddress: "/dns4/other.example/tcp/443/wss",
      relayConnected: true,
      relayConnecting: false,
    });
  });

  it("keeps the current relay when a replacement address is invalid", async () => {
    const connection = createRelayConnection("relay-1");
    const { node } = createRelayNode(connection);
    const session = createSession();
    Object.assign(session, { node });
    await session.connectRelay();

    await expect(session.connectRelay("not-a-multiaddr")).resolves.toBe(false);

    expect(connection.close).not.toHaveBeenCalled();
    expect(session.snapshot).toMatchObject({
      relayAddress: DEFAULT_KHIE_RELAY_ADDRESS,
      relayConnected: true,
      relayConnecting: false,
    });
  });

  it("stops relay retries before stopping the node", async () => {
    const connection = createRelayConnection("relay-1");
    const { node } = createRelayNode(connection);
    const stop = vi.fn(async () => {});
    Object.assign(node, { stop });
    const session = createSession();
    Object.assign(session, { node });

    await session.connectRelay();
    await session.close();

    expect(connection.close).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(connection.close.mock.invocationCallOrder[0]!).toBeLessThan(
      stop.mock.invocationCallOrder[0]!,
    );
  });
});

describe("KhieProviderSession pairing lifetime", () => {
  it("cancels an active pairing attempt when pairing is disabled", () => {
    const session = createSession();
    const controller = new AbortController();
    Object.assign(session, { pairingController: controller });

    session.setPairingEnabled(false);

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toMatchObject({ name: "AbortError" });
  });

  it("classifies malformed endpoints as incompatible pairing codes", async () => {
    const session = createSession();
    Object.assign(session, { node: {} });

    await expect(session.pair("not a pairing endpoint")).resolves.toBe(false);

    expect(session.snapshot.error).toEqual({
      kind: "incompatible-pairing-code",
      message: "Pairing endpoint is not a valid URL",
    });
  });

  it("redials without unpairing after a transport interruption", async () => {
    const id = "12D3KooWEUcGkHCFDcU5HucKpknW8iLt36UdGoxD2sGNkXQ8U8db";
    const peerId = {
      equals: (other: PeerId) => other.toString() === id,
      toString: () => id,
    } as PeerId;
    const address = multiaddr(`/dns4/peer.example/tcp/443/wss/p2p/${id}`);
    const dial = vi.fn(async () => ({ status: "open" }));
    const unpair = vi.fn(async () => {});
    const peerStore = {
      get: vi.fn(async () => ({
        addresses: [{ multiaddr: address }],
        metadata: new Map(),
      })),
    };
    const session = createSession();
    Object.assign(session, {
      node: {
        dial,
        getConnections: () => [],
        peerStore,
        services: { pairing: { unpair } },
      },
      pairedPeer: peerId,
      relayController: {},
      state: { ...session.snapshot, paired: true },
    });

    await session.resume();

    expect(dial).toHaveBeenCalledOnce();
    expect(unpair).not.toHaveBeenCalled();
    expect(session.snapshot).toMatchObject({
      paired: true,
      remotePeer: { active: false, id },
    });
  });

  it("only sends unpair for an explicit unpair action", async () => {
    const id = "12D3KooWEUcGkHCFDcU5HucKpknW8iLt36UdGoxD2sGNkXQ8U8db";
    const peerId = {
      equals: (other: PeerId) => other.toString() === id,
      toString: () => id,
    } as PeerId;
    const unpair = vi.fn(async () => {});
    const session = createSession();
    Object.assign(session, {
      node: { services: { pairing: { unpair } } },
      pairedPeer: peerId,
    });

    await session.unpair();

    expect(unpair).toHaveBeenCalledWith(peerId);
  });
});

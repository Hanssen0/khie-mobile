import { describe, expect, it, vi } from "vitest";
import type { PeerId } from "@libp2p/interface";
import { multiaddr } from "@multiformats/multiaddr";

import { KhieProviderSession } from "./KhieProviderSession";
import { DEFAULT_KHIE_RELAY_ADDRESS } from "./protocol";

const createSession = (relayAddress?: string) =>
  new KhieProviderSession({
    endpointUrl: "https://example.com/khie",
    handler: () => undefined,
    relayAddress,
  });

describe("KhieProviderSession relay address", () => {
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
    const dial = vi.fn(async () => ({ close: vi.fn(async () => {}), status: "open" }));
    Object.assign(session, {
      node: {
        dial,
        getMultiaddrs: () => [],
      },
    });

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
      relayConnection: { status: "open" },
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

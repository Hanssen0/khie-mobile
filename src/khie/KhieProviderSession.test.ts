import { describe, expect, it, vi } from "vitest";

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

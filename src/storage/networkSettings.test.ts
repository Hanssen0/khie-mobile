import { beforeEach, describe, expect, it, vi } from "vitest";

const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(async () => {}),
}));

vi.mock("expo-secure-store", () => secureStore);

import { DEFAULT_NETWORK_RPC_URLS } from "../wallet/network";
import { SecureStoreNetworkSettings } from "./networkSettings";

describe("SecureStoreNetworkSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the CCC public endpoints when no setting is stored", async () => {
    secureStore.getItemAsync.mockResolvedValueOnce(null);

    await expect(new SecureStoreNetworkSettings().load()).resolves.toEqual(
      DEFAULT_NETWORK_RPC_URLS,
    );
  });

  it("loads valid custom endpoints", async () => {
    secureStore.getItemAsync.mockResolvedValueOnce(
      JSON.stringify({
        testnet: "https://testnet.example/rpc",
        mainnet: "wss://mainnet.example/ws",
      }),
    );

    await expect(new SecureStoreNetworkSettings().load()).resolves.toEqual({
      testnet: "https://testnet.example/rpc",
      mainnet: "wss://mainnet.example/ws",
    });
  });

  it("falls back to defaults when stored data is malformed", async () => {
    secureStore.getItemAsync.mockResolvedValueOnce(
      JSON.stringify({ testnet: "file:///tmp/ckb", mainnet: "broken" }),
    );

    await expect(new SecureStoreNetworkSettings().load()).resolves.toEqual(
      DEFAULT_NETWORK_RPC_URLS,
    );
  });

  it("trims and saves both endpoints", async () => {
    const settings = new SecureStoreNetworkSettings();

    await expect(
      settings.save({
        testnet: "  https://testnet.example/rpc  ",
        mainnet: "  wss://mainnet.example/ws  ",
      }),
    ).resolves.toEqual({
      testnet: "https://testnet.example/rpc",
      mainnet: "wss://mainnet.example/ws",
    });
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      "khie.network.rpc-urls.v1",
      JSON.stringify({
        testnet: "https://testnet.example/rpc",
        mainnet: "wss://mainnet.example/ws",
      }),
    );
  });
});

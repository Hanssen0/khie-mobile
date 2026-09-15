import { ClientPublicMainnet, ClientPublicTestnet } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_NETWORK_RPC_URLS,
  clientForNetwork,
  isRpcUrl,
  networkFromId,
} from "./network";

describe("wallet network selection", () => {
  it("maps explicit Khie network identifiers", () => {
    expect(networkFromId("ckb-testnet")).toBe("testnet");
    expect(networkFromId("ckb-mainnet")).toBe("mainnet");
    expect(() => networkFromId("ckb-devnet")).toThrow("Unsupported network");
  });

  it("creates the matching CCC client", () => {
    expect(clientForNetwork("testnet")).toBeInstanceOf(ClientPublicTestnet);
    expect(clientForNetwork("mainnet")).toBeInstanceOf(ClientPublicMainnet);
  });

  it("uses a custom RPC URL without default fallbacks", () => {
    const testnet = clientForNetwork("testnet", "https://testnet.example/rpc");
    const mainnet = clientForNetwork("mainnet", "wss://mainnet.example/ws");

    expect(testnet).toBeInstanceOf(ClientPublicTestnet);
    expect(testnet.url).toBe("https://testnet.example/rpc");
    expect(mainnet).toBeInstanceOf(ClientPublicMainnet);
    expect(mainnet.url).toBe("wss://mainnet.example/ws");
  });

  it("accepts secure JSON-RPC transport URLs and rejects unsupported schemes", () => {
    expect(isRpcUrl(DEFAULT_NETWORK_RPC_URLS.testnet)).toBe(true);
    expect(isRpcUrl("https://node.example/rpc")).toBe(true);
    expect(isRpcUrl("http://192.168.1.2:8114")).toBe(false);
    expect(isRpcUrl("ws://192.168.1.2:8114")).toBe(false);
    expect(isRpcUrl("file:///tmp/ckb.sock")).toBe(false);
    expect(isRpcUrl("not a url")).toBe(false);
    expect(() => clientForNetwork("mainnet", "not a url")).toThrow(
      "Invalid mainnet RPC URL",
    );
  });
});

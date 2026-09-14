import { ClientPublicMainnet, ClientPublicTestnet } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";

import { clientForNetwork, networkFromId } from "./network";

describe("wallet network selection", () => {
  it("maps explicit Khie network identifiers", () => {
    expect(networkFromId("ckb-testnet")).toBe("testnet");
    expect(networkFromId("ckb-mainnet")).toBe("mainnet");
    expect(() => networkFromId("ckb-devnet")).toThrow("不支持的网络");
  });

  it("creates the matching CCC client", () => {
    expect(clientForNetwork("testnet")).toBeInstanceOf(ClientPublicTestnet);
    expect(clientForNetwork("mainnet")).toBeInstanceOf(ClientPublicMainnet);
  });
});

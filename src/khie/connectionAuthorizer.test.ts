import { describe, expect, it, vi } from "vitest";

import { KhieConnectionAuthorizer } from "./connectionAuthorizer";

const peer = { toString: () => "peer-a" } as never;

describe("KhieConnectionAuthorizer", () => {
  it("allows metadata before connect but rejects other methods", async () => {
    const authorizer = new KhieConnectionAuthorizer();
    const handler = vi.fn(() => "ok");
    await expect(
      authorizer.handle(peer, { jsonrpc: "2.0", id: 1, method: "get_info", params: [] }, handler),
    ).resolves.toBe("ok");
    await expect(
      authorizer.handle(peer, { jsonrpc: "2.0", id: 2, method: "get_identity", params: [] }, handler),
    ).rejects.toMatchObject({ code: -32001 });
  });

  it("authorizes after an approved connect and revokes on unpair", async () => {
    const authorizer = new KhieConnectionAuthorizer();
    const handler = vi.fn(() => "ok");
    await authorizer.handle(
      peer,
      { jsonrpc: "2.0", id: 1, method: "connect", params: ["ckb-testnet"] },
      handler,
    );
    await expect(
      authorizer.handle(peer, { jsonrpc: "2.0", id: 2, method: "get_identity", params: [] }, handler),
    ).resolves.toBe("ok");
    authorizer.unpair(peer);
    await expect(
      authorizer.handle(peer, { jsonrpc: "2.0", id: 3, method: "get_identity", params: [] }, handler),
    ).rejects.toMatchObject({ code: -32001 });
  });
});

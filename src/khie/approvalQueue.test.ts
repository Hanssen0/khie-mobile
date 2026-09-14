import type { SignerJsonRpcConfirmation } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApprovalQueue } from "./approvalQueue";

const request = (networkId: string): SignerJsonRpcConfirmation => ({
  method: "connect",
  networkId,
});

describe("ApprovalQueue", () => {
  afterEach(() => vi.useRealTimers());

  it("presents requests serially", async () => {
    const queue = new ApprovalQueue(10_000);
    const first = queue.enqueue(request("ckb-testnet"));
    const second = queue.enqueue(request("ckb-mainnet"));
    expect(queue.current?.request).toEqual(request("ckb-testnet"));
    queue.respond(queue.current!.id, true);
    await expect(first).resolves.toBe(true);
    expect(queue.current?.request).toEqual(request("ckb-mainnet"));
    queue.respond(queue.current!.id, false);
    await expect(second).resolves.toBe(false);
  });

  it("rejects all pending work when backgrounded or unpaired", async () => {
    const queue = new ApprovalQueue();
    const first = queue.enqueue(request("ckb-testnet"));
    const second = queue.enqueue(request("ckb-mainnet"));
    queue.cancelAll("background");
    await expect(first).rejects.toThrow("background");
    await expect(second).rejects.toThrow("background");
    expect(queue.current).toBeUndefined();
  });

  it("times out a request and advances the queue", async () => {
    vi.useFakeTimers();
    const queue = new ApprovalQueue(120_000);
    const pending = queue.enqueue(request("ckb-testnet"));
    const rejection = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(120_000);
    await rejection;
    expect(queue.current).toBeUndefined();
  });
});

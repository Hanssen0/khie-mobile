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
    const firstController = new AbortController();
    const firstContext = {
      signal: firstController.signal,
      cancel: (cause: Error) => firstController.abort(cause),
    };
    const first = queue.enqueue(request("ckb-testnet"), firstContext);
    const second = queue.enqueue(request("ckb-mainnet"));
    expect(queue.current?.request).toEqual(request("ckb-testnet"));
    queue.respond(queue.current!.id, true);
    await expect(first).resolves.toBe(true);
    expect(queue.current).toBeUndefined();
    queue.complete(firstContext);
    expect(queue.current?.request).toEqual(request("ckb-mainnet"));
    queue.respond(queue.current!.id, false);
    await expect(second).resolves.toBe(false);
  });

  it("cancels an approved request that is still executing", async () => {
    const queue = new ApprovalQueue(10_000);
    const controller = new AbortController();
    const context = {
      signal: controller.signal,
      cancel: (cause: Error) => controller.abort(cause),
    };
    const approved = queue.enqueue(request("ckb-testnet"), context);
    queue.respond(queue.current!.id, true);
    await expect(approved).resolves.toBe(true);

    queue.cancelAll("peer unpaired");

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toMatchObject({ message: "peer unpaired" });
  });

  it("keeps the timeout active after approval", async () => {
    vi.useFakeTimers();
    const queue = new ApprovalQueue(120_000);
    const controller = new AbortController();
    const context = {
      signal: controller.signal,
      cancel: (cause: Error) => controller.abort(cause),
    };
    const approved = queue.enqueue(request("ckb-testnet"), context);
    queue.respond(queue.current!.id, true);
    await expect(approved).resolves.toBe(true);

    await vi.advanceTimersByTimeAsync(120_000);

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toMatchObject({ name: "TimeoutError" });
  });

  it("rejects all pending work when explicitly invalidated", async () => {
    const queue = new ApprovalQueue();
    const first = queue.enqueue(request("ckb-testnet"));
    const second = queue.enqueue(request("ckb-mainnet"));
    queue.cancelAll("session closed");
    await expect(first).rejects.toThrow("session closed");
    await expect(second).rejects.toThrow("session closed");
    expect(queue.current).toBeUndefined();
  });

  it("does not expire approvals unless a timeout is configured", async () => {
    vi.useFakeTimers();
    const queue = new ApprovalQueue();
    const pending = queue.enqueue(request("ckb-testnet"));

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(queue.current?.request).toEqual(request("ckb-testnet"));
    queue.respond(queue.current!.id, false);
    await expect(pending).resolves.toBe(false);
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

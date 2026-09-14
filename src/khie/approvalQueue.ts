import type { SignerJsonRpcConfirmation } from "@ckb-ccc/core";

import { JSON_RPC_TIMEOUT_MS } from "./protocol";

export type ApprovalItem = {
  id: number;
  request: SignerJsonRpcConfirmation;
};

type PendingItem = ApprovalItem & {
  resolve: (approved: boolean) => void;
  reject: (cause: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export class ApprovalQueue {
  private nextId = 1;
  private active?: PendingItem;
  private readonly waiting: PendingItem[] = [];
  private readonly listeners = new Set<(item?: ApprovalItem) => void>();

  constructor(private readonly timeoutMs = JSON_RPC_TIMEOUT_MS) {}

  get current(): ApprovalItem | undefined {
    return this.active && { id: this.active.id, request: this.active.request };
  }

  subscribe(listener: (item?: ApprovalItem) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  enqueue(request: SignerJsonRpcConfirmation): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const item: PendingItem = {
        id: this.nextId++,
        request,
        resolve,
        reject,
        timeout: setTimeout(() => {
          const error = new Error("Khie request timed out");
          error.name = "TimeoutError";
          this.remove(item);
          reject(error);
        }, this.timeoutMs),
      };
      this.waiting.push(item);
      this.advance();
    });
  }

  respond(id: number, approved: boolean): void {
    if (!this.active || this.active.id !== id) {
      return;
    }
    const item = this.active;
    this.active = undefined;
    clearTimeout(item.timeout);
    item.resolve(approved);
    this.advance();
  }

  cancelAll(message = "Khie request canceled"): void {
    const error = new Error(message);
    error.name = "AbortError";
    const items = [...(this.active ? [this.active] : []), ...this.waiting];
    this.active = undefined;
    this.waiting.length = 0;
    for (const item of items) {
      clearTimeout(item.timeout);
      item.reject(error);
    }
    this.notify();
  }

  private remove(item: PendingItem): void {
    if (this.active === item) {
      this.active = undefined;
    } else {
      const index = this.waiting.indexOf(item);
      if (index >= 0) {
        this.waiting.splice(index, 1);
      }
    }
    clearTimeout(item.timeout);
    this.advance();
  }

  private advance(): void {
    this.active ??= this.waiting.shift();
    this.notify();
  }

  private notify(): void {
    const current = this.current;
    this.listeners.forEach((listener) => listener(current));
  }
}

import type { SignerJsonRpcConfirmation } from "@ckb-ccc/core";

export type ApprovalItem = {
  id: number;
  request: SignerJsonRpcConfirmation;
};

export type ApprovalRequestContext = {
  readonly signal: AbortSignal;
  cancel: (cause: Error) => void;
};

type PendingItem = ApprovalItem & {
  context?: ApprovalRequestContext;
  settled: boolean;
  resolve: (approved: boolean) => void;
  reject: (cause: unknown) => void;
  removeAbortListener?: () => void;
  timeout?: ReturnType<typeof setTimeout>;
};

export class ApprovalQueue {
  private nextId = 1;
  private active?: PendingItem;
  private readonly waiting: PendingItem[] = [];
  private readonly approved = new Set<PendingItem>();
  private readonly listeners = new Set<(item?: ApprovalItem) => void>();

  constructor(private readonly timeoutMs?: number) {}

  get current(): ApprovalItem | undefined {
    return this.active && { id: this.active.id, request: this.active.request };
  }

  get queuedCount(): number {
    return this.waiting.length;
  }

  subscribe(listener: (item?: ApprovalItem) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  enqueue(
    request: SignerJsonRpcConfirmation,
    context?: ApprovalRequestContext,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      if (context?.signal.aborted) {
        reject(abortReason(context.signal));
        return;
      }
      const item: PendingItem = {
        context,
        id: this.nextId++,
        request,
        resolve,
        reject,
        settled: false,
        timeout:
          this.timeoutMs === undefined
            ? undefined
            : setTimeout(() => {
                const error = new Error("Khie request timed out");
                error.name = "TimeoutError";
                context?.cancel(error);
                this.cancel(item, error);
              }, this.timeoutMs),
      };
      if (context) {
        const onAbort = () => this.cancel(item, abortReason(context.signal));
        context.signal.addEventListener("abort", onAbort, { once: true });
        item.removeAbortListener = () =>
          context.signal.removeEventListener("abort", onAbort);
      }
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
    item.settled = true;
    item.resolve(approved);
    if (approved) {
      this.approved.add(item);
      this.notify();
      return;
    }
    this.cleanup(item);
    this.advance();
  }

  complete(context: ApprovalRequestContext): void {
    for (const item of this.approved) {
      if (item.context !== context) continue;
      this.approved.delete(item);
      this.cleanup(item);
    }
    this.advance();
  }

  cancelAll(message = "Khie request canceled"): void {
    const error = new Error(message);
    error.name = "AbortError";
    const items = [
      ...(this.active ? [this.active] : []),
      ...this.waiting,
      ...this.approved,
    ];
    this.active = undefined;
    this.waiting.length = 0;
    this.approved.clear();
    for (const item of items) {
      this.cleanup(item);
      item.context?.cancel(error);
      if (!item.settled) {
        item.settled = true;
        item.reject(error);
      }
    }
    this.notify();
  }

  private cancel(item: PendingItem, cause: unknown): void {
    if (this.active === item) {
      this.active = undefined;
    } else if (this.approved.delete(item)) {
      // Approved requests remain owned by the queue until their RPC finishes.
    } else {
      const index = this.waiting.indexOf(item);
      if (index >= 0) {
        this.waiting.splice(index, 1);
      }
    }
    this.cleanup(item);
    if (!item.settled) {
      item.settled = true;
      item.reject(cause);
    }
    this.advance();
  }

  private advance(): void {
    if (this.approved.size > 0) {
      this.notify();
      return;
    }
    this.active ??= this.waiting.shift();
    this.notify();
  }

  private cleanup(item: PendingItem): void {
    if (item.timeout !== undefined) clearTimeout(item.timeout);
    item.removeAbortListener?.();
  }

  private notify(): void {
    const current = this.current;
    this.listeners.forEach((listener) => listener(current));
  }
}

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("Khie request canceled");
  error.name = "AbortError";
  return error;
}

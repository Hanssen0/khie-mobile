import { Buffer } from "@craftzdog/react-native-buffer";
import { getRandomValues } from "expo-crypto";
import process from "process";
import "react-native-url-polyfill/auto";

const eventTargetShim = require("event-target-shim") as {
  Event: typeof globalThis.Event;
  EventTarget: typeof globalThis.EventTarget;
};
const { Event, EventTarget } = eventTargetShim;

const runtime = globalThis as unknown as Record<string, unknown>;

runtime.Buffer ??= Buffer;
runtime.process ??= process;
runtime.EventTarget ??= EventTarget;
runtime.Event ??= Event;

if (runtime.CustomEvent == null) {
  class CustomEventPolyfill<T = unknown> extends Event {
    readonly detail: T;

    constructor(type: string, init: { detail?: T } = {}) {
      super(type);
      this.detail = init.detail as T;
    }
  }
  runtime.CustomEvent = CustomEventPolyfill;
}

const cryptoValue = (runtime.crypto ?? {}) as Crypto;
if (cryptoValue.getRandomValues == null) {
  Object.defineProperty(cryptoValue, "getRandomValues", {
    value: getRandomValues,
    configurable: true,
  });
}
runtime.crypto = cryptoValue;

// React Native's WebSocket implementation does not expose bufferedAmount.
// libp2p-websockets uses it for optional send backpressure and otherwise sees
// `undefined < limit` as false, waiting forever for a drain event RN cannot
// emit. Native WebSocket.send queues the bytes itself, so zero is the correct
// fallback when the property is absent.
if (
  typeof WebSocket !== "undefined" &&
  !("bufferedAmount" in WebSocket.prototype)
) {
  Object.defineProperty(WebSocket.prototype, "bufferedAmount", {
    configurable: true,
    get: () => 0,
  });
}

if (AbortSignal.prototype.throwIfAborted == null) {
  AbortSignal.prototype.throwIfAborted = function throwIfAborted() {
    if (this.aborted) {
      throw this.reason ?? new DOMException("The operation was aborted", "AbortError");
    }
  };
}

if (AbortSignal.timeout == null) {
  AbortSignal.timeout = (milliseconds: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("The operation timed out", "TimeoutError")), milliseconds);
    return controller.signal;
  };
}

if (Promise.withResolvers == null) {
  Promise.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    return { promise, resolve, reject };
  };
}

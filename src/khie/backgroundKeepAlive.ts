import { AppRegistry } from "react-native";

const KHIE_HEADLESS_TASK = "KhieConnectionKeepAlive";
const KEEP_ALIVE_INTERVAL_MS = 15_000;

type KeepAliveHandler = () => Promise<void> | void;

let keepAliveHandler: KeepAliveHandler | undefined;
let finishActiveTask: (() => void) | undefined;

export function setKhieKeepAliveHandler(
  handler?: KeepAliveHandler,
): void {
  keepAliveHandler = handler;
}

export function registerKhieHeadlessTask(): void {
  AppRegistry.registerHeadlessTask(KHIE_HEADLESS_TASK, () => runKeepAliveTask);
}

export function finishKhieHeadlessTask(): void {
  finishActiveTask?.();
}

async function tick(): Promise<void> {
  await keepAliveHandler?.();
}

async function runKeepAliveTask(): Promise<void> {
  void tick().catch(() => undefined);
  return new Promise<void>((resolve) => {
    const interval = setInterval(
      () => void tick().catch(() => undefined),
      KEEP_ALIVE_INTERVAL_MS,
    );
    finishActiveTask = () => {
      clearInterval(interval);
      finishActiveTask = undefined;
      resolve();
    };
  });
}

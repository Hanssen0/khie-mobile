import { afterEach, describe, expect, it, vi } from "vitest";

const { registerHeadlessTask } = vi.hoisted(() => ({
  registerHeadlessTask: vi.fn(),
}));

vi.mock("react-native", () => ({
  AppRegistry: { registerHeadlessTask },
}));

import {
  finishKhieHeadlessTask,
  registerKhieHeadlessTask,
  setKhieKeepAliveHandler,
} from "./backgroundKeepAlive";

describe("Khie Headless JS keep-alive", () => {
  afterEach(() => {
    finishKhieHeadlessTask();
    setKhieKeepAliveHandler();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("resumes immediately and periodically until the service stops", async () => {
    vi.useFakeTimers();
    const resume = vi.fn(async () => undefined);
    setKhieKeepAliveHandler(resume);
    registerKhieHeadlessTask();

    const taskProvider = registerHeadlessTask.mock.calls[0]?.[1];
    const task = taskProvider();
    const running = task();
    await vi.advanceTimersByTimeAsync(0);
    expect(resume).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(resume).toHaveBeenCalledTimes(3);

    finishKhieHeadlessTask();
    await expect(running).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(resume).toHaveBeenCalledTimes(3);
  });
});

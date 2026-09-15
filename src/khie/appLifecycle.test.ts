import { describe, expect, it, vi } from "vitest";

import { ApprovalQueue } from "./approvalQueue";
import { resumeKhieSessionWhenActive } from "./appLifecycle";

describe("Khie app lifecycle", () => {
  it.each(["background", "inactive"] as const)(
    "preserves the session and pending approval while %s",
    (state) => {
      const resume = vi.fn(async () => {});
      const queue = new ApprovalQueue();
      const pending = queue.enqueue({ method: "connect", networkId: "ckb-testnet" });

      expect(resumeKhieSessionWhenActive(state, { resume })).toBeUndefined();
      expect(resume).not.toHaveBeenCalled();
      expect(queue.current?.request).toEqual({
        method: "connect",
        networkId: "ckb-testnet",
      });

      queue.respond(queue.current!.id, false);
      return expect(pending).resolves.toBe(false);
    },
  );

  it("resumes the existing session when the app becomes active", async () => {
    const resume = vi.fn(async () => {});

    await resumeKhieSessionWhenActive("active", { resume });

    expect(resume).toHaveBeenCalledOnce();
  });
});

import type { AppStateStatus } from "react-native";

export type ResumableKhieSession = {
  resume: () => Promise<void>;
};

export function resumeKhieSessionWhenActive(
  state: AppStateStatus,
  session?: ResumableKhieSession,
): Promise<void> | undefined {
  if (state === "active") {
    return session?.resume();
  }
}

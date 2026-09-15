import { describe, expect, it, vi } from "vitest";

vi.mock("expo-notifications", () => ({
  AndroidImportance: { HIGH: 6, LOW: 4 },
  AndroidNotificationPriority: { HIGH: "high", LOW: "low" },
  AndroidNotificationVisibility: { PRIVATE: 2 },
  DEFAULT_ACTION_IDENTIFIER: "default",
  setNotificationHandler: vi.fn(),
}));

import {
  KHIE_NOTIFICATION_ACTION_ALLOW,
  KHIE_NOTIFICATION_ACTION_DENY,
  KHIE_NOTIFICATION_ACTION_UNPAIR,
  parseKhieNotificationResponse,
} from "./notifications";

describe("parseKhieNotificationResponse", () => {
  it("opens Khie for a regular notification tap", () => {
    expect(parseKhieNotificationResponse(response("connection", "default"))).toEqual({
      type: "open",
    });
    expect(parseKhieNotificationResponse(response("request", "default", 4))).toEqual({
      type: "open",
    });
  });

  it("handles connection and request actions", () => {
    expect(
      parseKhieNotificationResponse(
        response("connection", KHIE_NOTIFICATION_ACTION_UNPAIR),
      ),
    ).toEqual({ type: "unpair" });
    expect(
      parseKhieNotificationResponse(response("request", KHIE_NOTIFICATION_ACTION_ALLOW, 7)),
    ).toEqual({ type: "respond", approvalId: 7, approved: true });
    expect(
      parseKhieNotificationResponse(response("request", KHIE_NOTIFICATION_ACTION_DENY, 8)),
    ).toEqual({ type: "respond", approvalId: 8, approved: false });
  });

  it("ignores malformed or unrelated notification actions", () => {
    expect(parseKhieNotificationResponse(response("other", "default"))).toBeUndefined();
    expect(
      parseKhieNotificationResponse(response("request", KHIE_NOTIFICATION_ACTION_ALLOW)),
    ).toBeUndefined();
    expect(
      parseKhieNotificationResponse(response("connection", KHIE_NOTIFICATION_ACTION_ALLOW, 1)),
    ).toBeUndefined();
  });
});

function response(kind: string, actionIdentifier: string, approvalId?: number) {
  return {
    actionIdentifier,
    notification: {
      request: {
        content: {
          data: { approvalId, khieNotification: kind },
        },
      },
    },
  } as unknown as Parameters<typeof parseKhieNotificationResponse>[0];
}

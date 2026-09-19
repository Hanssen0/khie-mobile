import { beforeEach, describe, expect, it, vi } from "vitest";

const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(async () => {}),
}));

vi.mock("expo-secure-store", () => secureStore);

import {
  AUTO_UPDATE_CHECK_INTERVAL_MS,
  SecureStoreUpdateSettings,
  shouldAutomaticallyCheckForUpdates,
} from "./updateSettings";

describe("SecureStoreUpdateSettings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults automatic checks to on", async () => {
    secureStore.getItemAsync.mockResolvedValueOnce(null);
    await expect(new SecureStoreUpdateSettings().load()).resolves.toEqual({
      automaticChecks: true,
    });
  });

  it("preserves an explicit opt-out", async () => {
    secureStore.getItemAsync.mockResolvedValueOnce(
      JSON.stringify({ automaticChecks: false }),
    );
    await expect(new SecureStoreUpdateSettings().load()).resolves.toEqual({
      automaticChecks: false,
    });
  });

  it("loads and saves valid settings", async () => {
    const settings = {
      automaticChecks: true,
      lastAutomaticCheckAt: 123,
      lastCheckedAt: 456,
    };
    secureStore.getItemAsync.mockResolvedValueOnce(JSON.stringify(settings));
    await expect(new SecureStoreUpdateSettings().load()).resolves.toEqual(settings);
    await new SecureStoreUpdateSettings().save(settings);
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      "khie.update.settings.v1",
      JSON.stringify(settings),
    );
  });

  it("checks no more than once in 24 hours", () => {
    const now = 1_000_000_000;
    expect(
      shouldAutomaticallyCheckForUpdates({ automaticChecks: true }, now),
    ).toBe(true);
    expect(
      shouldAutomaticallyCheckForUpdates(
        { automaticChecks: true, lastAutomaticCheckAt: now - 1_000 },
        now,
      ),
    ).toBe(false);
    expect(
      shouldAutomaticallyCheckForUpdates(
        {
          automaticChecks: true,
          lastAutomaticCheckAt: now - AUTO_UPDATE_CHECK_INTERVAL_MS,
        },
        now,
      ),
    ).toBe(true);
  });
});

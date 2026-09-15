import * as SecureStore from "expo-secure-store";

import type { AppRelease } from "../update/githubRelease";

const UPDATE_SETTINGS_KEY = "khie.update.settings.v1";

export const AUTO_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export type UpdateSettings = {
  automaticChecks: boolean;
  lastAutomaticCheckAt?: number;
  lastCheckedAt?: number;
  latestRelease?: AppRelease;
};

export function defaultUpdateSettings(): UpdateSettings {
  return { automaticChecks: false };
}

function isRelease(value: unknown): value is AppRelease {
  if (!value || typeof value !== "object") return false;
  const release = value as Partial<AppRelease>;
  return (
    typeof release.tagName === "string" &&
    typeof release.version === "string" &&
    typeof release.pageUrl === "string" &&
    Array.isArray(release.assets) &&
    release.assets.every(
      (asset) =>
        Boolean(asset) &&
        typeof asset.name === "string" &&
        typeof asset.downloadUrl === "string" &&
        typeof asset.size === "number",
    )
  );
}

function parseUpdateSettings(value: string | null): UpdateSettings {
  if (!value) return defaultUpdateSettings();
  try {
    const parsed = JSON.parse(value) as Partial<UpdateSettings>;
    return {
      automaticChecks: parsed.automaticChecks === true,
      lastAutomaticCheckAt:
        typeof parsed.lastAutomaticCheckAt === "number"
          ? parsed.lastAutomaticCheckAt
          : undefined,
      lastCheckedAt:
        typeof parsed.lastCheckedAt === "number" ? parsed.lastCheckedAt : undefined,
      latestRelease: isRelease(parsed.latestRelease)
        ? parsed.latestRelease
        : undefined,
    };
  } catch {
    return defaultUpdateSettings();
  }
}

export function shouldAutomaticallyCheckForUpdates(
  settings: UpdateSettings,
  now = Date.now(),
): boolean {
  return (
    settings.automaticChecks &&
    (settings.lastAutomaticCheckAt === undefined ||
      now - settings.lastAutomaticCheckAt >= AUTO_UPDATE_CHECK_INTERVAL_MS)
  );
}

export class SecureStoreUpdateSettings {
  async load(): Promise<UpdateSettings> {
    return parseUpdateSettings(await SecureStore.getItemAsync(UPDATE_SETTINGS_KEY));
  }

  async save(settings: UpdateSettings): Promise<UpdateSettings> {
    await SecureStore.setItemAsync(UPDATE_SETTINGS_KEY, JSON.stringify(settings));
    return settings;
  }
}

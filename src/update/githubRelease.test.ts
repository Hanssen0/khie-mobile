import { describe, expect, it, vi } from "vitest";

import {
  compareVersions,
  fetchLatestRelease,
  isVersionNewer,
  isRetryableUpdateError,
  selectAndroidApk,
  type AppRelease,
} from "./githubRelease";

const release: AppRelease = {
  tagName: "v0.4.0",
  version: "0.4.0",
  pageUrl: "https://github.com/Hanssen0/khie-mobile/releases/tag/v0.4.0",
  assets: [
    {
      name: "khie-mobile-v0.4.0-arm64-v8a.apk",
      downloadUrl: "https://example.com/arm64.apk",
      size: 12,
    },
    {
      name: "khie-mobile-v0.4.0-universal.apk",
      downloadUrl: "https://example.com/universal.apk",
      size: 42,
    },
  ],
};

describe("GitHub releases", () => {
  it("reads the latest release and its APK assets", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          tag_name: "v0.4.0",
          html_url: release.pageUrl,
          published_at: "2026-09-15T00:00:00Z",
          assets: [
            {
              name: release.assets[0]?.name,
              browser_download_url: release.assets[0]?.downloadUrl,
              size: 12,
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(fetchLatestRelease(fetcher)).resolves.toMatchObject({
      tagName: "v0.4.0",
      version: "0.4.0",
      assets: [release.assets[0]],
    });
  });

  it("rejects unsuccessful and malformed responses", async () => {
    await expect(
      fetchLatestRelease(async () => new Response("", { status: 503 })),
    ).rejects.toThrow("HTTP 503");
    await expect(
      fetchLatestRelease(
        async () => new Response(JSON.stringify({ tag_name: "v0.4.0" })),
      ),
    ).rejects.toThrow("invalid release");
  });

  it("only treats network and temporary server failures as retryable", async () => {
    await expect(
      fetchLatestRelease(async () => {
        throw new TypeError("Network request failed");
      }),
    ).rejects.toSatisfy(isRetryableUpdateError);
    await expect(
      fetchLatestRelease(async () => new Response("", { status: 503 })),
    ).rejects.toSatisfy(isRetryableUpdateError);
    await expect(
      fetchLatestRelease(async () => new Response("", { status: 404 })),
    ).rejects.not.toSatisfy(isRetryableUpdateError);
  });

  it("compares release versions, including prereleases", () => {
    expect(compareVersions("v0.4.0", "0.3.9")).toBeGreaterThan(0);
    expect(compareVersions("0.4.0", "0.4")).toBe(0);
    expect(compareVersions("0.4.0-beta.2", "0.4.0-beta.1")).toBeGreaterThan(0);
    expect(compareVersions("0.4.0", "0.4.0-beta.2")).toBeGreaterThan(0);
    expect(isVersionNewer("v0.3.0", "0.3.0")).toBe(false);
  });

  it("selects the first compatible ABI and falls back to universal", () => {
    expect(selectAndroidApk(release, ["arm64-v8a"])?.name).toContain(
      "arm64-v8a",
    );
    expect(selectAndroidApk(release, ["x86_64"])?.name).toContain("universal");
  });
});

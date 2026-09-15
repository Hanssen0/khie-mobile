export const GITHUB_REPOSITORY_URL =
  "https://github.com/Hanssen0/khie-mobile";
export const GITHUB_RELEASES_URL = `${GITHUB_REPOSITORY_URL}/releases/latest`;

const LATEST_RELEASE_URL =
  "https://api.github.com/repos/Hanssen0/khie-mobile/releases/latest";

const ANDROID_ABIS = [
  "arm64-v8a",
  "armeabi-v7a",
  "x86_64",
  "x86",
] as const;

export type AndroidAbi = (typeof ANDROID_ABIS)[number];

export type ReleaseAsset = {
  name: string;
  downloadUrl: string;
  size: number;
};

export type AppRelease = {
  tagName: string;
  version: string;
  pageUrl: string;
  publishedAt?: string;
  assets: ReleaseAsset[];
};

type GitHubReleaseResponse = {
  tag_name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  assets?: unknown;
};

type Fetcher = typeof fetch;

export class UpdateRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "UpdateRequestError";
  }
}

export function isRetryableUpdateError(cause: unknown): boolean {
  return cause instanceof UpdateRequestError && cause.retryable;
}

export async function fetchLatestRelease(
  fetcher: Fetcher = fetch,
): Promise<AppRelease> {
  let response: Response;
  try {
    response = await fetcher(LATEST_RELEASE_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (cause) {
    throw new UpdateRequestError("Unable to reach GitHub", true, { cause });
  }
  if (!response.ok) {
    throw new UpdateRequestError(
      `GitHub returned HTTP ${response.status}`,
      response.status === 408 || response.status >= 500,
    );
  }

  const value = (await response.json()) as GitHubReleaseResponse;
  if (typeof value.tag_name !== "string" || typeof value.html_url !== "string") {
    throw new UpdateRequestError("GitHub returned an invalid release", false);
  }

  const assets = Array.isArray(value.assets)
    ? value.assets.flatMap((asset): ReleaseAsset[] => {
        if (
          !asset ||
          typeof asset !== "object" ||
          !("name" in asset) ||
          !("browser_download_url" in asset) ||
          typeof asset.name !== "string" ||
          typeof asset.browser_download_url !== "string"
        ) {
          return [];
        }
        return [
          {
            name: asset.name,
            downloadUrl: asset.browser_download_url,
            size:
              "size" in asset && typeof asset.size === "number" ? asset.size : 0,
          },
        ];
      })
    : [];

  return {
    tagName: value.tag_name,
    version: normalizeVersion(value.tag_name),
    pageUrl: value.html_url,
    publishedAt:
      typeof value.published_at === "string" ? value.published_at : undefined,
    assets,
  };
}

export function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, "");
}

type ParsedVersion = {
  numbers: number[];
  prerelease?: string[];
};

function parseVersion(value: string): ParsedVersion | undefined {
  const match = normalizeVersion(value).match(
    /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match?.[1]) return undefined;
  return {
    numbers: match[1].split(".").map(Number),
    prerelease: match[2]?.split("."),
  };
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : undefined;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : undefined;
  if (leftNumber !== undefined && rightNumber !== undefined) {
    return Math.sign(leftNumber - rightNumber);
  }
  if (leftNumber !== undefined) return -1;
  if (rightNumber !== undefined) return 1;
  return left.localeCompare(right);
}

export function compareVersions(left: string, right: string): number {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) {
    return normalizeVersion(left).localeCompare(normalizeVersion(right), undefined, {
      numeric: true,
    });
  }

  const length = Math.max(parsedLeft.numbers.length, parsedRight.numbers.length);
  for (let index = 0; index < length; index += 1) {
    const difference =
      (parsedLeft.numbers[index] ?? 0) - (parsedRight.numbers[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }

  if (!parsedLeft.prerelease && !parsedRight.prerelease) return 0;
  if (!parsedLeft.prerelease) return 1;
  if (!parsedRight.prerelease) return -1;

  const prereleaseLength = Math.max(
    parsedLeft.prerelease.length,
    parsedRight.prerelease.length,
  );
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftIdentifier = parsedLeft.prerelease[index];
    const rightIdentifier = parsedRight.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const comparison = compareIdentifiers(leftIdentifier, rightIdentifier);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

export function isVersionNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

function normalizeArchitecture(value: string): AndroidAbi | undefined {
  const normalized = value.trim().toLowerCase().replaceAll(" ", "-");
  if (normalized === "arm64" || normalized === "aarch64") return "arm64-v8a";
  if (normalized === "arm-v7a" || normalized === "armv7") {
    return "armeabi-v7a";
  }
  return ANDROID_ABIS.find((abi) => abi === normalized);
}

export function selectAndroidApk(
  release: AppRelease,
  supportedArchitectures: readonly string[] | null | undefined,
): ReleaseAsset | undefined {
  for (const architecture of supportedArchitectures ?? []) {
    const abi = normalizeArchitecture(architecture);
    if (!abi) continue;
    const asset = release.assets.find((candidate) =>
      candidate.name.toLowerCase().endsWith(`-${abi}.apk`),
    );
    if (asset) return asset;
  }
  return release.assets.find((candidate) =>
    candidate.name.toLowerCase().endsWith("-universal.apk"),
  );
}

import { execFileSync } from "node:child_process";
import type { ConfigContext, ExpoConfig } from "expo/config";

import packageJson from "./package.json";
import walletColors from "./src/colors.json";

function buildCommit(): string {
  const configured = process.env.KHIE_BUILD_COMMIT?.trim();
  if (configured) return configured.slice(0, 12);

  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "Khie Wallet",
  slug: config.slug ?? "khie-wallet",
  version: packageJson.version,
  android: {
    ...config.android,
    adaptiveIcon: {
      ...config.android?.adaptiveIcon,
      backgroundColor: walletColors.appIconBackground,
    },
  },
  extra: {
    ...config.extra,
    buildCommit: buildCommit(),
  },
  plugins: (config.plugins ?? []).map((plugin) => {
    if (!Array.isArray(plugin) || plugin[0] !== "expo-notifications") {
      return plugin;
    }
    return [
      plugin[0],
      {
        ...plugin[1],
        color: walletColors.light.primary,
      },
    ];
  }),
});

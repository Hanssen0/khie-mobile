import type { ConfigContext, ExpoConfig } from "expo/config";

import walletColors from "./src/colors.json";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "Khie Wallet",
  slug: config.slug ?? "khie-wallet",
  android: {
    ...config.android,
    adaptiveIcon: {
      ...config.android?.adaptiveIcon,
      backgroundColor: walletColors.appIconBackground,
    },
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

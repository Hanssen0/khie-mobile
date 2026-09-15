const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ["react-native", "browser", "import"];

// libp2p 3.x mixes package exports with legacy browser replacement maps.
// Metro resolves the exports but does not apply the nested file replacements,
// so route the handful of platform files explicitly.
const platformFiles = new Map([
  ["@chainsafe/libp2p-noise/dist/src/crypto/index.js", "@chainsafe/libp2p-noise/dist/src/crypto/index.browser.js"],
  ["@libp2p/websockets/dist/src/listener.js", "@libp2p/websockets/dist/src/listener.browser.js"],
  ["libp2p/dist/src/connection-manager/constants.js", "libp2p/dist/src/connection-manager/constants.browser.js"],
  ["libp2p/dist/src/config/connection-gater.js", "libp2p/dist/src/config/connection-gater.browser.js"],
  ["libp2p/dist/src/user-agent.js", "libp2p/dist/src/user-agent.react-native.js"],
  ["@libp2p/webrtc/dist/src/webrtc/index.js", "@libp2p/webrtc/dist/src/webrtc/index.react-native.js"],
]);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "progress-events") {
    return context.resolveRequest(
      context,
      path.join(__dirname, "src/runtime/shims/progress-events.ts"),
      platform,
    );
  }
  if (moduleName === "node:os") {
    return context.resolveRequest(
      context,
      path.join(__dirname, "src/runtime/shims/os.ts"),
      platform,
    );
  }
  if (moduleName === "node:process") {
    return context.resolveRequest(context, "process/browser", platform);
  }
  if (moduleName === "ieee754") {
    return context.resolveRequest(
      context,
      path.join(__dirname, "node_modules/ieee754"),
      platform,
    );
  }

  if (moduleName.startsWith(".")) {
    const target = path.resolve(path.dirname(context.originModulePath), moduleName);
    for (const [sourceSuffix, replacementSuffix] of platformFiles) {
      if (target.endsWith(sourceSuffix)) {
        const packageRoot = target.slice(0, -sourceSuffix.length);
        return context.resolveRequest(
          context,
          path.join(packageRoot, replacementSuffix),
          platform,
        );
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

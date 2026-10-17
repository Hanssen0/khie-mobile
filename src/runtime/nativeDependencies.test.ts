import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import packageJson from "../../package.json";
import bundledNativeModules from "expo/bundledNativeModules.json";

const require = createRequire(import.meta.url);
const webRtcRoot = dirname(require.resolve("react-native-webrtc/package.json"));

function installedVersion(name: string): string {
  return JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8"))
    .version;
}

describe("native dependency compatibility", () => {
  it("keeps React, React Native and worklet packages on the SDK-tested versions", () => {
    for (const name of [
      "react",
      "react-native",
      "react-native-reanimated",
      "react-native-worklets",
    ] as const) {
      expect(packageJson.dependencies[name], name).toBe(bundledNativeModules[name]);
      expect(installedVersion(name), name).toBe(bundledNativeModules[name]);
    }
  });

  it("resolves Metro config from the same React Native release", () => {
    const reactNativeRequire = createRequire(require.resolve("react-native/package.json"));
    const metroConfig = JSON.parse(
      readFileSync(reactNativeRequire.resolve("@react-native/metro-config/package.json"), "utf8"),
    );
    expect(metroConfig.version).toBe(installedVersion("react-native"));
  });

  it("keeps direct Expo modules on the installed SDK major", () => {
    // Expo Doctor remains responsible for exact supported patch versions.
    const sdkMajor = installedVersion("expo").split(".")[0];
    for (const name of Object.keys(packageJson.dependencies)) {
      if (name.startsWith("expo-")) {
        expect(installedVersion(name).split(".")[0], name).toBe(sdkMajor);
      }
    }
  });

  it("resolves the same native WebRTC package from the app and libp2p", () => {
    const adapterRequire = createRequire(require.resolve("@libp2p/webrtc"));
    expect(
      realpathSync(adapterRequire.resolve("react-native-webrtc/package.json")),
    ).toBe(realpathSync(require.resolve("react-native-webrtc/package.json")));
  });

  it("announces remote channels before the native observer can flush messages", () => {
    // Inspect the installed source, so a missing or version-mismatched pnpm
    // patch fails even when JavaScript-only application tests still pass.
    const observer = readFileSync(
      join(webRtcRoot, "android/src/main/java/com/oney/WebRTCModule/PeerConnectionObserver.java"),
      "utf8",
    );
    const onDataChannel = observer
      .slice(observer.indexOf("public void onDataChannel("))
      .split("\n    @Override")[0]!;
    const announce = onDataChannel.indexOf('"peerConnectionDidOpenDataChannel"');
    const register = onDataChannel.indexOf("dataChannel.registerObserver(dcw)");
    expect(announce).toBeGreaterThanOrEqual(0);
    expect(register).toBeGreaterThan(announce);
  });
});

<p align="center">
  <img alt="Khie Logo" src="assets/khie.svg" width="160" />
</p>

<h1 align="center">Khie Wallet</h1>

<p align="center">
  <a href="https://github.com/Hanssen0/khie-mobile/actions/workflows/test.yml"><img
    alt="Tests" src="https://github.com/Hanssen0/khie-mobile/actions/workflows/test.yml/badge.svg?branch=master"
  /></a>
  <a href="https://github.com/Hanssen0/khie-mobile/actions/workflows/release-android.yml"><img
    alt="Android APK" src="https://github.com/Hanssen0/khie-mobile/actions/workflows/release-android.yml/badge.svg?branch=master"
  /></a>
  <a href="https://github.com/Hanssen0/khie-mobile/releases/latest"><img
    alt="Latest Release" src="https://img.shields.io/github/v/release/Hanssen0/khie-mobile?display_name=tag"
  /></a>
  <img alt="GitHub commit activity" src="https://img.shields.io/github/commit-activity/m/Hanssen0/khie-mobile" />
  <img alt="GitHub last commit" src="https://img.shields.io/github/last-commit/Hanssen0/khie-mobile/master" />
</p>

> [!WARNING]
> This application and its source code were generated entirely by AI. It has not been independently reviewed or proven secure. Before using it, especially with real assets, you must understand the security, private-key management, transaction-signing and operational risks. Use it at your own risk.

Android-first Expo Development Build wallet MVP for CKB and the standard CCC Khie `SignerJsonRpc` protocol.

![Khie Wallet account, Khie, Cryptape Trust and settings screens](assets/khie-wallet-preview.png)

## Included

- Create and manage multiple BIP-39 wallets, or restore 12/24-word English mnemonics, protected by one required master password and an Argon2id/AES-256-GCM master-key envelope.
- Connect a Cryptape Trust/NKey hardware wallet over Android Bluetooth LE and use it as the active CKB signer.
- Derive one CKB account at `m/44'/309'/0'/0/0` for each wallet.
- Testnet/mainnet address, balance, in-app CKB transfer (Send flow) with fee estimation, receive QR, password-authenticated mnemonic/private-key export, optional biometric unlock, and transactional master-password changes.
- Khie provider and connector QR directions, WSS relay fallback, WebRTC direct upgrade, single-peer authorization and per-request approval.
- System-aware and manually selectable UI languages: English, 简体中文, 正體中文 and 客家語.
- A deliberately small React Native Paper MD3 presentation layer, with wallet-specific theme tokens and replaceable wrapper components.
- Replaceable internal `SigningBackend`; Khie never reads or exposes a private-key field.

This MVP intentionally excludes tokens, transaction history and persistent dapp authorization.

## Cryptape Trust

![Cryptape Trust hardware wallet](assets/cryptape-trust-device-banner.jpg)

As a small hardware-wallet easter egg, the Android app can connect to the experimental Cryptape Trust over Bluetooth LE and use it as a CKB signer. The device and its [original app](https://github.com/cryptape/trust-android) have been unmaintained for years and the protocol has known security weaknesses, so this integration is intended for testnet experiments—not mainnet assets.

## Android development build

Prerequisites: Node.js 24, pnpm 12, JDK 17 or newer, Android Studio/SDK, and an emulator or USB device. Biometric authentication is optional.

Make sure Gradle can find the SDK through `ANDROID_HOME`/`ANDROID_SDK_ROOT`, or set `sdk.dir` in `android/local.properties` after prebuild.

```sh
pnpm install
pnpm prebuild --platform android
pnpm android
```

Expo Go cannot run this app because `react-native-webrtc` requires native modules. The generated `android/` directory is intentionally ignored and should be regenerated from `app.json` and `app.config.ts`.

For a local development APK after prebuild:

```sh
cd android
./gradlew assembleDebug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

## Automated APK releases

Each push to `master` runs the Android release workflow. It runs checks and tests,
generates the Android project, and publishes standalone Hermes APKs plus their
file checksums and signing-certificate fingerprint to GitHub Releases. It
provides individual `arm64-v8a`, `armeabi-v7a`, `x86` and `x86_64` APKs, plus a
universal APK containing all four Android architectures.

The release job pauses for the protected `production-android-release`
environment before it can access signing material. See
[Android release signing](docs/release-signing.md) for key generation, encrypted
backup, GitHub Environment secrets, approval policy, and the debug-to-release
migration warning.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm doctor:expo
```

Golden tests verify the mobile zlib pairing endpoint codec in both directions against `@ckb-ccc/libp2p`.
The Trust/NKey bridge is adapted from the MIT-licensed [`cryptape/trust-android`](https://github.com/cryptape/trust-android) reference implementation; its license is included with the local Expo module.

## Khie behavior

- Default relay: `/dns4/relay.ckbccc.com/tcp/443/wss`
- Pairing protocol: `/nervos-ckb/khie/pairing/0.0.1`
- RPC protocol: `/nervos-ckb/khie/json-rpc/0.0.1`
- 1 MiB request limit. Pending approvals remain queued without an automated TTL until explicitly answered or canceled.
- Pairings are process-scoped. Restarting the app requires pairing again.
- Entering the background preserves the logical pairing and pending approvals (surfaced via Android background notifications). Returning to the foreground resumes the transport session; the connector's retry and inbound dialing remain the main recovery path.

## Limitations and risk

This is a development MVP, not a production wallet. It has not received a security audit, release hardening or Play Store review. Testnet is the default. Mainnet use and asset risk are the user's responsibility. Real-device acceptance still requires testing both QR directions, relay-only operation and an observed `direct === true` WebRTC connection against the current CCC Connector page.

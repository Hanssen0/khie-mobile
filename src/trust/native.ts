import {
  connectTrustDevice,
  disconnectTrustDevice,
  generateTrustDeviceKey,
  getTrustBluetoothState,
  importTrustDeviceKey,
  isTrustWalletAvailable,
  resetTrustDeviceKey,
  resetTrustDevicePin,
  scanTrustDevices,
  signWithTrustDevice,
  type ConnectedTrustDevice,
  type TrustDevice,
} from "@khie/trust-wallet";
import { PermissionsAndroid, Platform } from "react-native";

import { LocalizedError } from "../errors";

export type { ConnectedTrustDevice, TrustDevice };

export function isTrustSupported(): boolean {
  return Platform.OS === "android" && isTrustWalletAvailable();
}

export type TrustBluetoothSetupIssue =
  | "bluetoothUnavailable"
  | "bluetoothDisabled"
  | "locationDisabled"
  | "permissionDenied";

export class TrustBluetoothSetupError extends Error {
  constructor(
    readonly issue: TrustBluetoothSetupIssue,
    readonly settings: "app" | "bluetooth" | "location",
  ) {
    super(issue);
    this.name = "TrustBluetoothSetupError";
  }
}

type TrustOperation = "scan" | "connect" | "sign" | "keyManagement" | "resetPin";

function trustOperationError(cause: unknown, operation: TrustOperation): Error {
  if (cause instanceof LocalizedError || cause instanceof TrustBluetoothSetupError) {
    return cause;
  }
  const message = cause instanceof Error ? cause.message : "";
  const normalized = message.toLowerCase();

  if (normalized.includes("pin verification failed")) {
    return new LocalizedError(
      "trustPinRejected",
      "Cryptape Trust rejected the PIN",
      undefined,
      cause instanceof Error ? { cause } : undefined,
    );
  }
  if (operation === "resetPin" && normalized.includes("pin reset failed")) {
    return new LocalizedError(
      "trustPinResetOperationFailed",
      "Cryptape Trust could not reset the PIN",
      undefined,
      cause instanceof Error ? { cause } : undefined,
    );
  }
  if (
    operation === "connect" ||
    normalized.includes("connection timed out") ||
    normalized.includes("unable to connect")
  ) {
    return new LocalizedError(
      "trustDeviceUnavailable",
      "Cryptape Trust could not be reached",
      undefined,
      cause instanceof Error ? { cause } : undefined,
    );
  }
  if (
    normalized.includes("gatt") ||
    normalized.includes("response") ||
    normalized.includes("wallet is not connected") ||
    normalized.includes("wallet is not verified") ||
    normalized.includes("disconnected") ||
    normalized.includes("write failed") ||
    normalized.includes("timed out")
  ) {
    return new LocalizedError(
      "trustCommunicationFailed",
      "Communication with Cryptape Trust was interrupted",
      undefined,
      cause instanceof Error ? { cause } : undefined,
    );
  }

  const translationKey =
    operation === "scan"
      ? "trustScanFailed"
      : operation === "sign"
        ? "trustSigningFailed"
        : operation === "resetPin"
          ? "trustPinResetOperationFailed"
          : "trustKeyOperationFailedDescription";
  return new LocalizedError(
    translationKey,
    "Cryptape Trust operation failed",
    undefined,
    cause instanceof Error ? { cause } : undefined,
  );
}

async function runTrustOperation<T>(
  operation: TrustOperation,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    throw trustOperationError(cause, operation);
  }
}

async function requestTrustPermissions(purpose: "scan" | "connect"): Promise<void> {
  const androidVersion = Number(Platform.Version);
  const permissions =
    androidVersion >= 31
      ? purpose === "scan"
        ? [
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          ]
        : [PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : purpose === "scan"
        ? [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]
        : [];
  if (!permissions.length) return;

  const result = await PermissionsAndroid.requestMultiple(permissions);
  if (permissions.some((permission) => result[permission] !== "granted")) {
    throw new TrustBluetoothSetupError("permissionDenied", "app");
  }
}

export async function ensureTrustBluetoothReady(
  purpose: "scan" | "connect",
): Promise<void> {
  if (Platform.OS !== "android") {
    throw new TrustBluetoothSetupError("bluetoothUnavailable", "app");
  }

  await requestTrustPermissions(purpose);
  const state = getTrustBluetoothState();
  if (!state.available) {
    throw new TrustBluetoothSetupError("bluetoothUnavailable", "app");
  }
  if (!state.enabled) {
    throw new TrustBluetoothSetupError("bluetoothDisabled", "bluetooth");
  }
  if (
    purpose === "scan" &&
    Number(Platform.Version) <= 30 &&
    !state.locationServicesEnabled
  ) {
    throw new TrustBluetoothSetupError("locationDisabled", "location");
  }
}

export async function scanForTrustDevices(): Promise<TrustDevice[]> {
  await ensureTrustBluetoothReady("scan");
  return runTrustOperation("scan", () => scanTrustDevices());
}

export async function connectTrustWallet(
  deviceId: string,
  pin: string,
  cachedName?: string,
): Promise<ConnectedTrustDevice> {
  await ensureTrustBluetoothReady("connect");
  const device = await runTrustOperation("connect", () =>
    connectTrustDevice(deviceId, pin),
  );
  return cachedName ? { ...device, name: cachedName } : device;
}

export async function resetTrustWalletPin(
  deviceId: string,
  puk: string,
  newPin: string,
): Promise<void> {
  await ensureTrustBluetoothReady("connect");
  return runTrustOperation("resetPin", () =>
    resetTrustDevicePin(deviceId, puk, newPin),
  );
}

export function generateTrustWalletKey(pin: string): Promise<string> {
  return runTrustOperation("keyManagement", () => generateTrustDeviceKey(pin));
}

export function resetTrustWalletKey(pin: string): Promise<void> {
  return runTrustOperation("keyManagement", () => resetTrustDeviceKey(pin));
}

export function importTrustWalletKey(
  privateKey: string,
  publicKey: string,
  pin: string,
): Promise<string> {
  return runTrustOperation("keyManagement", () =>
    importTrustDeviceKey(privateKey, publicKey, pin),
  );
}

export const disconnectTrustWallet = disconnectTrustDevice;

export function signWithTrustWallet(digest: string, pin: string): Promise<string> {
  return runTrustOperation("sign", () => signWithTrustDevice(digest, pin));
}

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
  return scanTrustDevices();
}

export async function connectTrustWallet(
  deviceId: string,
  pin: string,
  cachedName?: string,
): Promise<ConnectedTrustDevice> {
  await ensureTrustBluetoothReady("connect");
  const device = await connectTrustDevice(deviceId, pin);
  return cachedName ? { ...device, name: cachedName } : device;
}

export async function resetTrustWalletPin(
  deviceId: string,
  puk: string,
  newPin: string,
): Promise<void> {
  await ensureTrustBluetoothReady("connect");
  return resetTrustDevicePin(deviceId, puk, newPin);
}
export const generateTrustWalletKey = generateTrustDeviceKey;
export const resetTrustWalletKey = resetTrustDeviceKey;
export const importTrustWalletKey = importTrustDeviceKey;
export const disconnectTrustWallet = disconnectTrustDevice;
export const signWithTrustWallet = signWithTrustDevice;

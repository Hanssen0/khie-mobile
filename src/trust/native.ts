import {
  connectTrustDevice,
  disconnectTrustDevice,
  generateTrustDeviceKey,
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

export async function scanForTrustDevices(): Promise<TrustDevice[]> {
  if (Platform.OS !== "android") {
    throw new Error("Trust hardware wallets are only supported on Android");
  }

  const permissions =
    Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          // Some Android vendor stacks still gate BLE scan results behind
          // location permission on Android 12+, even with BLUETOOTH_SCAN.
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(permissions);
  if (permissions.some((permission) => result[permission] !== "granted")) {
    throw new Error("Bluetooth permission is required to find Cryptape Trust devices");
  }
  return scanTrustDevices();
}

export const connectTrustWallet = connectTrustDevice;
export const resetTrustWalletPin = resetTrustDevicePin;
export const generateTrustWalletKey = generateTrustDeviceKey;
export const resetTrustWalletKey = resetTrustDeviceKey;
export const importTrustWalletKey = importTrustDeviceKey;
export const disconnectTrustWallet = disconnectTrustDevice;
export const signWithTrustWallet = signWithTrustDevice;

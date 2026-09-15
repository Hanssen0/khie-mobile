import { requireOptionalNativeModule } from "expo";

export type TrustDevice = {
  id: string;
  name: string;
  rssi: number;
};

export type ConnectedTrustDevice = {
  id: string;
  name: string;
  publicKey?: string;
};

type TrustWalletNativeModule = {
  isAvailable(): boolean;
  scan(durationMs: number): Promise<TrustDevice[]>;
  connect(deviceId: string, pin: string): Promise<ConnectedTrustDevice>;
  resetPin(deviceId: string, puk: string, newPin: string): Promise<void>;
  generateKey(pin: string): Promise<string>;
  resetKey(pin: string): Promise<void>;
  importKey(privateKey: string, publicKey: string, pin: string): Promise<string>;
  disconnect(): Promise<void>;
  sign(digest: string, pin: string): Promise<string>;
};

const nativeModule = requireOptionalNativeModule<TrustWalletNativeModule>(
  "KhieTrustWallet",
);

function requireModule(): TrustWalletNativeModule {
  if (!nativeModule) {
    throw new Error("Trust hardware wallets are only available in an Android development build");
  }
  return nativeModule;
}

export function isTrustWalletAvailable(): boolean {
  return nativeModule?.isAvailable() === true;
}

export function scanTrustDevices(durationMs = 8_000): Promise<TrustDevice[]> {
  return requireModule().scan(durationMs);
}

export function connectTrustDevice(deviceId: string, pin: string): Promise<ConnectedTrustDevice> {
  return requireModule().connect(deviceId, pin);
}

export function resetTrustDevicePin(
  deviceId: string,
  puk: string,
  newPin: string,
): Promise<void> {
  return requireModule().resetPin(deviceId, puk, newPin);
}

export function generateTrustDeviceKey(pin: string): Promise<string> {
  return requireModule().generateKey(pin);
}

export function resetTrustDeviceKey(pin: string): Promise<void> {
  return requireModule().resetKey(pin);
}

export function importTrustDeviceKey(
  privateKey: string,
  publicKey: string,
  pin: string,
): Promise<string> {
  return requireModule().importKey(privateKey, publicKey, pin);
}

export function disconnectTrustDevice(): Promise<void> {
  return requireModule().disconnect();
}

export function signWithTrustDevice(digest: string, pin: string): Promise<string> {
  return requireModule().sign(digest, pin);
}

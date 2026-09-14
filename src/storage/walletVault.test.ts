import { beforeEach, describe, expect, it, vi } from "vitest";

const secureStore = vi.hoisted(() => ({
  canUseBiometricAuthentication: vi.fn(() => true),
  deleteItemAsync: vi.fn(async () => {}),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(async () => {}),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
}));

vi.mock("expo-secure-store", () => secureStore);

import { SecureStoreWalletVault, WalletSecretUnavailableError } from "./walletVault";

describe("SecureStoreWalletVault", () => {
  beforeEach(() => {
    secureStore.getItemAsync.mockReset();
  });

  it("classifies invalidated authenticated entries as recovery-required", async () => {
    secureStore.getItemAsync.mockRejectedValueOnce(new Error("KeyPermanentlyInvalidatedException"));
    await expect(new SecureStoreWalletVault().readMnemonic()).rejects.toBeInstanceOf(
      WalletSecretUnavailableError,
    );
  });

  it("treats a missing protected value as recovery-required", async () => {
    secureStore.getItemAsync.mockResolvedValueOnce(null);
    await expect(new SecureStoreWalletVault().readMnemonic()).rejects.toBeInstanceOf(
      WalletSecretUnavailableError,
    );
  });
});

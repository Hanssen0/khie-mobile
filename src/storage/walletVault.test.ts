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
    vi.clearAllMocks();
  });

  it("uses the current localized prompt for each protected read", async () => {
    secureStore.getItemAsync.mockResolvedValue("test mnemonic");
    let localizedPrompt = "Authenticate to sign the message";
    const prompt = vi.fn(() => localizedPrompt);
    const vault = new SecureStoreWalletVault(prompt);

    await vault.readMnemonic("signMessage");

    localizedPrompt = "验证身份以签名消息";
    await vault.readMnemonic("signMessage");

    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt).toHaveBeenNthCalledWith(2, "signMessage");
    expect(secureStore.getItemAsync).toHaveBeenNthCalledWith(
      2,
      "khie.wallet.mnemonic.v1",
      expect.objectContaining({
        authenticationPrompt: "验证身份以签名消息",
        requireAuthentication: true,
      }),
    );
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

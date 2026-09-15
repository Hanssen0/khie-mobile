import { beforeEach, describe, expect, it, vi } from "vitest";

const secureStore = vi.hoisted(() => ({
  canUseBiometricAuthentication: vi.fn(() => true),
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
}));

vi.mock("expo-secure-store", () => secureStore);

import { CKB_DERIVATION_PATH } from "../wallet/types";
import { SecureStoreWalletVault, WalletSecretUnavailableError } from "./walletVault";

const publicKey =
  "0x0371e69290d7de7de8f8c3619f300ad27fdb96f4aa903e81e0d75a8dfcfaf285b4";
const secondPublicKey = `0x02${"11".repeat(32)}`;
const walletId = publicKey.slice(2);
const stateKey = "khie.wallet.state.v2";
const mnemonicKey = `khie.wallet.mnemonic.v2.${walletId}`;

describe("SecureStoreWalletVault", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    vi.clearAllMocks();
    values.clear();
    secureStore.getItemAsync.mockImplementation(async (key: string) => values.get(key) ?? null);
    secureStore.setItemAsync.mockImplementation(async (key: string, value: string) => {
      values.set(key, value);
    });
    secureStore.deleteItemAsync.mockImplementation(async (key: string) => {
      values.delete(key);
    });
  });

  it("uses the current localized prompt for each protected wallet read", async () => {
    values.set(stateKey, JSON.stringify(walletState()));
    values.set(mnemonicKey, "test mnemonic");
    let localizedPrompt = "Authenticate to sign the message";
    const prompt = vi.fn(() => localizedPrompt);
    const vault = new SecureStoreWalletVault(prompt);

    await vault.readMnemonic(walletId, "signMessage");
    localizedPrompt = "验证身份以签名消息";
    await vault.readMnemonic(walletId, "signMessage");

    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt).toHaveBeenNthCalledWith(2, "signMessage");
    expect(secureStore.getItemAsync).toHaveBeenCalledWith(
      mnemonicKey,
      expect.objectContaining({
        authenticationPrompt: "验证身份以签名消息",
        requireAuthentication: true,
      }),
    );
  });

  it("migrates the legacy profile without reading its protected mnemonic", async () => {
    values.set(
      "khie.wallet.profile.v1",
      JSON.stringify({
        createdAt: "2026-01-01T00:00:00.000Z",
        derivationPath: CKB_DERIVATION_PATH,
        publicKey,
        version: 1,
      }),
    );
    values.set("khie.wallet.mnemonic.v1", "legacy mnemonic");
    const vault = new SecureStoreWalletVault();

    const state = await vault.loadWallets();

    expect(state.selectedWalletId).toBe(walletId);
    expect(state.wallets[0]).toMatchObject({
      id: walletId,
      mnemonicStorageVersion: 1,
      publicKey,
      version: 2,
    });
    expect(values.has(stateKey)).toBe(true);
    expect(await vault.readMnemonic(walletId)).toBe("legacy mnemonic");
  });

  it("stores, selects and removes independent wallets", async () => {
    const vault = new SecureStoreWalletVault();
    await vault.save(
      { derivationPath: CKB_DERIVATION_PATH, publicKey },
      "first mnemonic",
    );
    const added = await vault.save(
      { derivationPath: CKB_DERIVATION_PATH, publicKey: secondPublicKey },
      "second mnemonic",
    );

    expect(added.wallets).toHaveLength(2);
    expect(added.selectedWalletId).toBe(secondPublicKey.slice(2));
    expect(await vault.readMnemonic(walletId)).toBe("first mnemonic");
    expect(await vault.readMnemonic(secondPublicKey.slice(2))).toBe("second mnemonic");

    const selected = await vault.select(walletId);
    expect(selected.selectedWalletId).toBe(walletId);

    const duplicate = await vault.save(
      { derivationPath: CKB_DERIVATION_PATH, publicKey },
      "updated first mnemonic",
    );
    expect(duplicate.wallets).toHaveLength(2);
    expect(duplicate.selectedWalletId).toBe(walletId);
    expect(await vault.readMnemonic(walletId)).toBe("updated first mnemonic");

    const removed = await vault.remove(walletId);
    expect(removed.wallets).toHaveLength(1);
    expect(removed.selectedWalletId).toBe(secondPublicKey.slice(2));
    expect(values.has(mnemonicKey)).toBe(false);
  });

  it("classifies invalidated authenticated entries as recovery-required", async () => {
    values.set(stateKey, JSON.stringify(walletState()));
    secureStore.getItemAsync.mockImplementation(async (key: string) => {
      if (key === mnemonicKey) throw new Error("KeyPermanentlyInvalidatedException");
      return values.get(key) ?? null;
    });
    await expect(
      new SecureStoreWalletVault().readMnemonic(walletId),
    ).rejects.toBeInstanceOf(WalletSecretUnavailableError);
  });

  it("treats a missing protected value as recovery-required", async () => {
    values.set(stateKey, JSON.stringify(walletState()));
    await expect(
      new SecureStoreWalletVault().readMnemonic(walletId),
    ).rejects.toBeInstanceOf(WalletSecretUnavailableError);
  });
});

function walletState() {
  return {
    selectedWalletId: walletId,
    version: 2,
    wallets: [
      {
        createdAt: "2026-01-01T00:00:00.000Z",
        derivationPath: CKB_DERIVATION_PATH,
        id: walletId,
        mnemonicStorageVersion: 2,
        publicKey,
        version: 2,
      },
    ],
  };
}

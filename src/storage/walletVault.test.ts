import { beforeEach, describe, expect, it, vi } from "vitest";

const secureStore = vi.hoisted(() => ({
  canUseBiometricAuthentication: vi.fn(() => true),
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
}));

const mnemonicKeystore = vi.hoisted(() => ({
  encryptMnemonicKeystore: vi.fn(async (mnemonic: string, credential: string) =>
    JSON.stringify({ credential, mnemonic }),
  ),
  decryptMnemonicKeystore: vi.fn(async (serialized: string, credential: string) => {
    const value = JSON.parse(serialized) as { credential: string; mnemonic: string };
    if (value.credential !== credential) throw new Error("Invalid password");
    return value.mnemonic;
  }),
}));

const masterPasswordVerifier = vi.hoisted(() => ({
  createMasterPasswordVerifier: vi.fn(async (credential: string) =>
    JSON.stringify({ credential }),
  ),
  verifyMasterPasswordCredential: vi.fn(
    async (serialized: string, credential: string) =>
      (JSON.parse(serialized) as { credential: string }).credential === credential,
  ),
}));

vi.mock("expo-secure-store", () => secureStore);
vi.mock("../wallet/mnemonicKeystore", () => mnemonicKeystore);
vi.mock("../wallet/masterPasswordVerifier", () => masterPasswordVerifier);

import { CKB_DERIVATION_PATH } from "../wallet/types";
import {
  SecureStoreWalletVault,
  WalletSecretUnavailableError,
  cryptapeTrustWalletId,
} from "./walletVault";

const publicKey =
  "0x0371e69290d7de7de8f8c3619f300ad27fdb96f4aa903e81e0d75a8dfcfaf285b4";
const secondPublicKey = `0x02${"11".repeat(32)}`;
const walletId = publicKey.slice(2);
const stateKey = "khie.wallet.state.v4";
const keystoreKey = `khie.wallet.keystore.v4.${walletId}`;
const biometricKey = "khie.wallet.master.biometric.v4";
const verifierKey = "khie.wallet.master.verifier.v4";

describe("SecureStoreWalletVault", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    vi.clearAllMocks();
    values.clear();
    secureStore.canUseBiometricAuthentication.mockReturnValue(true);
    secureStore.getItemAsync.mockImplementation(
      async (key: string) => values.get(key) ?? null,
    );
    secureStore.setItemAsync.mockImplementation(async (key: string, value: string) => {
      values.set(key, value);
    });
    secureStore.deleteItemAsync.mockImplementation(async (key: string) => {
      values.delete(key);
    });
  });

  it("stores an encrypted mnemonic and optional biometric credential", async () => {
    const prompt = vi.fn(() => "Authenticate");
    const vault = new SecureStoreWalletVault(prompt);
    await vault.save(account(publicKey), "first mnemonic", "credential-1", {
      biometricUnlock: true,
    });

    expect(mnemonicKeystore.encryptMnemonicKeystore).toHaveBeenCalledWith(
      "first mnemonic",
      "credential-1",
    );
    expect(await vault.readMnemonic(walletId, "credential-1")).toBe("first mnemonic");
    expect(await vault.readBiometricCredential("signMessage")).toBe(
      "credential-1",
    );
    expect(await vault.verifyMasterCredential("credential-1")).toBe(true);
    expect(prompt).toHaveBeenCalledWith("signMessage");
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      biometricKey,
      "credential-1",
      expect.objectContaining({ requireAuthentication: true }),
    );
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      keystoreKey,
      expect.any(String),
    );
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      verifierKey,
      expect.any(String),
    );
  });

  it("stores, selects and removes independent wallets", async () => {
    const vault = new SecureStoreWalletVault();
    await vault.save(account(publicKey), "first mnemonic", "credential-1", {
      biometricUnlock: false,
    });
    const added = await vault.save(
      account(secondPublicKey),
      "second mnemonic",
      "credential-1",
    );

    expect(added.wallets).toHaveLength(2);
    expect(added.selectedWalletId).toBe(secondPublicKey.slice(2));
    expect(await vault.readMnemonic(walletId, "credential-1")).toBe("first mnemonic");
    expect(await vault.readBiometricCredential()).toBeNull();
    await expect(
      vault.save(account(`0x03${"22".repeat(32)}`), "third mnemonic", "wrong"),
    ).rejects.toThrow("Invalid password");

    const selected = await vault.select(walletId);
    expect(selected.selectedWalletId).toBe(walletId);

    const removed = await vault.remove(walletId);
    expect(removed.wallets).toHaveLength(1);
    expect(removed.selectedWalletId).toBe(secondPublicKey.slice(2));
    expect(values.has(keystoreKey)).toBe(false);
  });

  it("enables and disables biometric unlock independently of the keystore", async () => {
    const vault = new SecureStoreWalletVault();
    await vault.save(account(publicKey), "first mnemonic", "credential-1", {
      biometricUnlock: false,
    });

    const enabled = await vault.setBiometricUnlock("credential-1");
    expect(enabled.biometricUnlock).toBe(true);
    expect(values.get(biometricKey)).toBe("credential-1");

    const disabled = await vault.setBiometricUnlock();
    expect(disabled.biometricUnlock).toBe(false);
    expect(values.has(biometricKey)).toBe(false);
    expect(await vault.readMnemonic(walletId, "credential-1")).toBe("first mnemonic");
  });

  it("rejects biometric opt-in when system authentication is unavailable", async () => {
    secureStore.canUseBiometricAuthentication.mockReturnValue(false);
    await expect(
      new SecureStoreWalletVault().save(
        account(publicKey),
        "first mnemonic",
        "credential-1",
        { biometricUnlock: true },
      ),
    ).rejects.toThrow("Enable biometric authentication");
  });

  it("stores Cryptape Trust wallets by normalized MAC address", async () => {
    const vault = new SecureStoreWalletVault();
    const added = await vault.saveCryptapeTrust({
      id: "80:ea:d3:5b:db:11",
      name: "NKeyD35BDB11",
      publicKey: `0x${"22".repeat(64)}`,
    });
    const trustId = cryptapeTrustWalletId("80EAD35BDB11");

    expect(added.selectedWalletId).toBe(trustId);
    expect(added.wallets).toContainEqual({
      createdAt: expect.any(String),
      deviceId: "80:EA:D3:5B:DB:11",
      id: trustId,
      kind: "cryptape-trust",
      name: "NKeyD35BDB11",
      publicKey: `0x${"22".repeat(64)}`,
      version: 4,
    });
  });

  it("reports a missing encrypted keystore", async () => {
    values.set(stateKey, JSON.stringify(walletState()));
    await expect(
      new SecureStoreWalletVault().readMnemonic(walletId, "credential-1"),
    ).rejects.toBeInstanceOf(WalletSecretUnavailableError);
  });

  it("retains the master-password verifier after the last mnemonic is removed", async () => {
    const vault = new SecureStoreWalletVault();
    await vault.save(account(publicKey), "first mnemonic", "credential-1", {
      biometricUnlock: true,
    });

    const removed = await vault.remove(walletId);

    expect(removed.wallets).toHaveLength(0);
    expect(removed.masterPasswordSet).toBe(true);
    expect(removed.biometricUnlock).toBe(true);
    expect(values.has(verifierKey)).toBe(true);
    expect(values.has(biometricKey)).toBe(true);
    expect(await vault.verifyMasterCredential("credential-1")).toBe(true);
  });

  it("re-encrypts every mnemonic and the biometric credential when changing password", async () => {
    const vault = new SecureStoreWalletVault();
    await vault.save(account(publicKey), "first mnemonic", "credential-1", {
      biometricUnlock: true,
    });
    await vault.save(
      account(secondPublicKey),
      "second mnemonic",
      "credential-1",
    );

    const changed = await vault.changeMasterPassword(
      "credential-1",
      "credential-2",
    );

    expect(changed.biometricUnlock).toBe(true);
    expect(await vault.verifyMasterCredential("credential-2")).toBe(true);
    expect(await vault.readMnemonic(walletId, "credential-2")).toBe("first mnemonic");
    expect(
      await vault.readMnemonic(secondPublicKey.slice(2), "credential-2"),
    ).toBe("second mnemonic");
    await expect(vault.readMnemonic(walletId, "credential-1")).rejects.toThrow(
      "Invalid password",
    );
    expect(values.get(biometricKey)).toBe("credential-2");
  });
});

function account(key: string) {
  return { derivationPath: CKB_DERIVATION_PATH, publicKey: key } as const;
}

function walletState() {
  return {
    biometricUnlock: false,
    masterPasswordSet: true,
    selectedWalletId: walletId,
    version: 4,
    wallets: [
      {
        createdAt: "2026-01-01T00:00:00.000Z",
        derivationPath: CKB_DERIVATION_PATH,
        id: walletId,
        kind: "mnemonic",
        publicKey,
        version: 4,
      },
    ],
  };
}

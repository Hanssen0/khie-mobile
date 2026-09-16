import { beforeEach, describe, expect, it, vi } from "vitest";

const secureStore = vi.hoisted(() => ({
  canUseBiometricAuthentication: vi.fn(() => true),
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
}));

const masterKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const masterKeyHex = `0x${Array.from(masterKey, (value) =>
  value.toString(16).padStart(2, "0"),
).join("")}`;

const masterKeyEnvelope = vi.hoisted(() => ({
  decryptMasterKey: vi.fn(async (serialized: string, credential: string) => {
    const value = JSON.parse(serialized) as {
      credential: string;
      masterKey: number[];
    };
    if (value.credential !== credential) throw new Error("Invalid password");
    return Uint8Array.from(value.masterKey);
  }),
  encryptMasterKey: vi.fn(async (key: Uint8Array, credential: string) =>
    JSON.stringify({ credential, masterKey: Array.from(key) }),
  ),
  generateMasterKey: vi.fn(async () => Uint8Array.from(masterKey)),
}));

const mnemonicKeystore = vi.hoisted(() => ({
  encryptMnemonicKeystore: vi.fn(
    async (mnemonic: string, key: Uint8Array, walletId: string) =>
      JSON.stringify({ key: Array.from(key), mnemonic, walletId }),
  ),
  decryptMnemonicKeystore: vi.fn(
    async (serialized: string, key: Uint8Array, walletId: string) => {
      const value = JSON.parse(serialized) as {
        key: number[];
        mnemonic: string;
        walletId: string;
      };
      if (
        value.walletId !== walletId ||
        value.key.join(",") !== Array.from(key).join(",")
      ) {
        throw new Error("Invalid mnemonic keystore");
      }
      return value.mnemonic;
    },
  ),
}));

vi.mock("expo-secure-store", () => secureStore);
vi.mock("../wallet/masterKeyEnvelope", () => masterKeyEnvelope);
vi.mock("../wallet/mnemonicKeystore", () => mnemonicKeystore);

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
const stateKey = "khie.wallet.state.v5";
const keystoreKey = `khie.wallet.keystore.v5.${walletId}`;
const biometricKey = "khie.wallet.master.biometric.v5";
const envelopeKey = "khie.wallet.master-key.v5";
const passwordCredential = (value: string) => ({
  kind: "password" as const,
  value,
});
const biometricCredential = () => ({
  kind: "masterKey" as const,
  value: masterKeyHex,
});

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

  it("creates one master key and stores its biometric copy", async () => {
    const prompt = vi.fn(() => "Authenticate");
    const vault = new SecureStoreWalletVault(prompt);
    await vault.save(
      account(publicKey),
      "first mnemonic",
      passwordCredential("credential-1"),
      { biometricUnlock: true },
    );

    expect(masterKeyEnvelope.encryptMasterKey).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "credential-1",
    );
    expect(mnemonicKeystore.encryptMnemonicKeystore).toHaveBeenCalledWith(
      "first mnemonic",
      expect.any(Uint8Array),
      walletId,
    );
    expect(
      await vault.readMnemonic(walletId, passwordCredential("credential-1")),
    ).toBe("first mnemonic");
    expect(await vault.readBiometricMasterKey("signMessage")).toBe(masterKeyHex);
    expect(await vault.verifyMasterCredential(passwordCredential("credential-1"))).toBe(
      true,
    );
    expect(prompt).toHaveBeenCalledWith("signMessage");
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      biometricKey,
      masterKeyHex,
      expect.objectContaining({ requireAuthentication: true }),
    );
    expect(values.has(keystoreKey)).toBe(true);
    expect(values.has(envelopeKey)).toBe(true);
  });

  it("reuses the master key for independent mnemonic wallets", async () => {
    const vault = new SecureStoreWalletVault();
    await vault.save(
      account(publicKey),
      "first mnemonic",
      passwordCredential("credential-1"),
      { biometricUnlock: false },
    );
    const added = await vault.save(
      account(secondPublicKey),
      "second mnemonic",
      passwordCredential("credential-1"),
    );

    expect(added.wallets).toHaveLength(2);
    expect(masterKeyEnvelope.generateMasterKey).toHaveBeenCalledTimes(1);
    expect(masterKeyEnvelope.encryptMasterKey).toHaveBeenCalledTimes(1);
    expect(
      await vault.readMnemonic(walletId, passwordCredential("credential-1")),
    ).toBe("first mnemonic");
    await expect(
      vault.save(
        account(`0x03${"22".repeat(32)}`),
        "third mnemonic",
        passwordCredential("wrong"),
      ),
    ).rejects.toThrow("Invalid password");

    const selected = await vault.select(walletId);
    expect(selected.selectedWalletId).toBe(walletId);
    const removed = await vault.remove(walletId);
    expect(removed.wallets).toHaveLength(1);
    expect(values.has(keystoreKey)).toBe(false);
  });

  it("enables and disables biometric unlock without changing a mnemonic", async () => {
    const vault = new SecureStoreWalletVault();
    await vault.save(
      account(publicKey),
      "first mnemonic",
      passwordCredential("credential-1"),
      { biometricUnlock: false },
    );
    const serializedKeystore = values.get(keystoreKey);

    const enabled = await vault.setBiometricUnlock(
      passwordCredential("credential-1"),
    );
    expect(enabled.biometricUnlock).toBe(true);
    expect(values.get(biometricKey)).toBe(masterKeyHex);
    expect(values.get(keystoreKey)).toBe(serializedKeystore);

    const disabled = await vault.setBiometricUnlock();
    expect(disabled.biometricUnlock).toBe(false);
    expect(values.has(biometricKey)).toBe(false);
    expect(
      await vault.readMnemonic(walletId, passwordCredential("credential-1")),
    ).toBe("first mnemonic");
  });

  it("rejects biometric opt-in when system authentication is unavailable", async () => {
    secureStore.canUseBiometricAuthentication.mockReturnValue(false);
    await expect(
      new SecureStoreWalletVault().save(
        account(publicKey),
        "first mnemonic",
        passwordCredential("credential-1"),
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
      version: 5,
    });
  });

  it("reports a missing encrypted mnemonic", async () => {
    values.set(stateKey, JSON.stringify(walletState()));
    values.set(
      envelopeKey,
      JSON.stringify({ credential: "credential-1", masterKey: Array.from(masterKey) }),
    );
    await expect(
      new SecureStoreWalletVault().readMnemonic(
        walletId,
        passwordCredential("credential-1"),
      ),
    ).rejects.toBeInstanceOf(WalletSecretUnavailableError);
  });

  it("keeps the master-key envelope after the last mnemonic is removed", async () => {
    const vault = new SecureStoreWalletVault();
    await vault.save(
      account(publicKey),
      "first mnemonic",
      passwordCredential("credential-1"),
      { biometricUnlock: true },
    );

    const removed = await vault.remove(walletId);

    expect(removed.wallets).toHaveLength(0);
    expect(removed.masterPasswordSet).toBe(true);
    expect(removed.biometricUnlock).toBe(true);
    expect(values.has(envelopeKey)).toBe(true);
    expect(values.has(biometricKey)).toBe(true);
    expect(await vault.verifyMasterCredential(passwordCredential("credential-1"))).toBe(
      true,
    );
  });

  it("changes password by rewrapping only the master key", async () => {
    const vault = new SecureStoreWalletVault();
    await vault.save(
      account(publicKey),
      "first mnemonic",
      passwordCredential("credential-1"),
      { biometricUnlock: true },
    );
    await vault.save(
      account(secondPublicKey),
      "second mnemonic",
      passwordCredential("credential-1"),
    );
    const firstKeystore = values.get(keystoreKey);
    const secondKeystore = values.get(
      `khie.wallet.keystore.v5.${secondPublicKey.slice(2)}`,
    );
    mnemonicKeystore.encryptMnemonicKeystore.mockClear();

    const changed = await vault.changeMasterPassword("credential-1", "credential-2");

    expect(changed.biometricUnlock).toBe(true);
    expect(mnemonicKeystore.encryptMnemonicKeystore).not.toHaveBeenCalled();
    expect(values.get(keystoreKey)).toBe(firstKeystore);
    expect(values.get(`khie.wallet.keystore.v5.${secondPublicKey.slice(2)}`)).toBe(
      secondKeystore,
    );
    expect(values.get(biometricKey)).toBe(masterKeyHex);
    expect(await vault.verifyMasterCredential(passwordCredential("credential-2"))).toBe(
      true,
    );
    expect(await vault.readMnemonic(walletId, biometricCredential())).toBe(
      "first mnemonic",
    );
    expect(await vault.verifyMasterCredential(passwordCredential("credential-1"))).toBe(
      false,
    );
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
    version: 5,
    wallets: [
      {
        createdAt: "2026-01-01T00:00:00.000Z",
        derivationPath: CKB_DERIVATION_PATH,
        id: walletId,
        kind: "mnemonic",
        publicKey,
        version: 5,
      },
    ],
  };
}

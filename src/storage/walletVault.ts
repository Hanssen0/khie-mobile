import * as SecureStore from "expo-secure-store";
import { bytesFrom, hexFrom } from "@ckb-ccc/core";

import { LocalizedError } from "../errors";
import {
  decryptMnemonicKeystore,
  encryptMnemonicKeystore,
} from "../wallet/mnemonicKeystore";
import {
  decryptMasterKey,
  encryptMasterKey,
  generateMasterKey,
} from "../wallet/masterKeyEnvelope";
import type {
  AccountDescriptor,
  CryptapeTrustWalletProfile,
  MnemonicWalletProfile,
  WalletProfile,
  WalletState,
} from "../wallet/types";

const WALLET_STATE_KEY = "khie.wallet.state.v5";
const KEYSTORE_KEY_PREFIX = "khie.wallet.keystore.v5.";
const BIOMETRIC_MASTER_KEY = "khie.wallet.master.biometric.v5";
const MASTER_KEY_ENVELOPE_KEY = "khie.wallet.master-key.v5";

export type MasterPasswordInitialization = {
  biometricUnlock: boolean;
};

export type WalletCredential =
  | { kind: "password"; value: string }
  | { kind: "masterKey"; value: string };

export type WalletAuthenticationPurpose =
  | "useWallet"
  | "signMessage"
  | "signTransaction"
  | "viewMnemonic"
  | "viewPrivateKey"
  | "enableBiometrics";

export type WalletAuthenticationPrompt = (
  purpose: WalletAuthenticationPurpose,
) => string;

const defaultAuthenticationPrompt: WalletAuthenticationPrompt = () =>
  "Authenticate to use Khie Wallet";

export class WalletSecretUnavailableError extends LocalizedError {
  constructor(
    translationKey: "walletSecretUnavailable" | "walletDataCorrupted" =
      "walletSecretUnavailable",
    options?: ErrorOptions,
  ) {
    const fallbackMessages = {
      walletSecretUnavailable: "Wallet secret is unavailable",
      walletDataCorrupted: "Wallet data is corrupted",
    } as const;
    super(translationKey, fallbackMessages[translationKey], undefined, options);
    this.name = "WalletSecretUnavailableError";
  }
}

export interface WalletVault {
  canUseBiometrics(): boolean;
  loadWallets(): Promise<WalletState>;
  save(
    account: AccountDescriptor,
    mnemonic: string,
    credential: WalletCredential,
    initialization?: MasterPasswordInitialization,
  ): Promise<WalletState>;
  saveCryptapeTrust(device: {
    id: string;
    name: string;
    publicKey?: string;
  }): Promise<WalletState>;
  select(walletId: string): Promise<WalletState>;
  readMnemonic(walletId: string, credential: WalletCredential): Promise<string>;
  verifyMasterCredential(credential: WalletCredential): Promise<boolean>;
  changeMasterPassword(
    oldPassword: string,
    newPassword: string,
  ): Promise<WalletState>;
  readBiometricMasterKey(
    purpose?: WalletAuthenticationPurpose,
  ): Promise<string | null>;
  setBiometricUnlock(
    credential?: WalletCredential,
  ): Promise<WalletState>;
  remove(walletId: string): Promise<WalletState>;
  clear(): Promise<void>;
}

export class SecureStoreWalletVault implements WalletVault {
  constructor(private readonly authenticationPrompt = defaultAuthenticationPrompt) {}

  canUseBiometrics(): boolean {
    return SecureStore.canUseBiometricAuthentication();
  }

  private authenticatedOptions(
    purpose: WalletAuthenticationPurpose,
  ): SecureStore.SecureStoreOptions {
    return {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      requireAuthentication: true,
      authenticationPrompt: this.authenticationPrompt(purpose),
    };
  }

  async loadWallets(): Promise<WalletState> {
    const value = await SecureStore.getItemAsync(WALLET_STATE_KEY);
    return value ? parseWalletState(value) : emptyWalletState();
  }

  async save(
    account: AccountDescriptor,
    mnemonic: string,
    credential: WalletCredential,
    initialization?: MasterPasswordInitialization,
  ): Promise<WalletState> {
    if (initialization?.biometricUnlock && !this.canUseBiometrics()) {
      throw new LocalizedError(
        "biometricRequired",
        "Enable biometric authentication in Android first",
      );
    }
    const current = await this.loadWallets();
    if (current.masterPasswordSet === Boolean(initialization)) {
      throw new LocalizedError(
        initialization ? "masterPasswordAlreadySet" : "masterPasswordRequired",
        initialization
          ? "The master password is already set"
          : "Set the master password first",
      );
    }
    if (initialization && credential.kind !== "password") {
      throw new LocalizedError("masterPasswordRequired", "Set the master password first");
    }
    const id = walletIdFromPublicKey(account.publicKey);
    const existing = current.wallets.find((wallet) => wallet.id === id);
    const profile: MnemonicWalletProfile = {
      ...account,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      id,
      kind: "mnemonic",
      version: 5,
    };
    const keystoreKey = mnemonicKeystoreKey(id);
    const masterKey = initialization
      ? await generateMasterKey()
      : await this.resolveMasterKey(credential);
    let serializedMasterKey: string | undefined;
    let serializedKeystore: string;
    let biometricMasterKey: string | undefined;
    try {
      serializedMasterKey = initialization
        ? await encryptMasterKey(masterKey, credential.value)
        : undefined;
      serializedKeystore = await encryptMnemonicKeystore(mnemonic, masterKey, id);
      biometricMasterKey = initialization?.biometricUnlock
        ? hexFrom(masterKey)
        : undefined;
    } finally {
      masterKey.fill(0);
    }

    await SecureStore.setItemAsync(keystoreKey, serializedKeystore);
    try {
      if (serializedMasterKey) {
        await SecureStore.setItemAsync(
          MASTER_KEY_ENVELOPE_KEY,
          serializedMasterKey,
        );
      }
      if (initialization?.biometricUnlock) {
        await SecureStore.setItemAsync(
          BIOMETRIC_MASTER_KEY,
          biometricMasterKey!,
          this.authenticatedOptions("enableBiometrics"),
        );
      } else if (initialization) {
        await SecureStore.deleteItemAsync(BIOMETRIC_MASTER_KEY);
      }
      const state: WalletState = {
        biometricUnlock:
          initialization?.biometricUnlock ?? current.biometricUnlock,
        masterPasswordSet: current.masterPasswordSet || Boolean(initialization),
        selectedWalletId: id,
        version: 5,
        wallets: existing
          ? current.wallets.map((wallet) => (wallet.id === id ? profile : wallet))
          : [...current.wallets, profile],
      };
      await this.writeState(state);
      return state;
    } catch (cause) {
      if (!existing) {
        await Promise.all([
          SecureStore.deleteItemAsync(keystoreKey).catch(() => undefined),
          ...(initialization?.biometricUnlock
            ? [SecureStore.deleteItemAsync(BIOMETRIC_MASTER_KEY).catch(() => undefined)]
            : []),
          ...(serializedMasterKey
            ? [SecureStore.deleteItemAsync(MASTER_KEY_ENVELOPE_KEY).catch(() => undefined)]
            : []),
        ]);
      }
      throw cause;
    }
  }

  async saveCryptapeTrust(device: {
    id: string;
    name: string;
    publicKey?: string;
  }): Promise<WalletState> {
    const current = await this.loadWallets();
    const id = cryptapeTrustWalletId(device.id);
    const existing = current.wallets.find((wallet) => wallet.id === id);
    const profile: CryptapeTrustWalletProfile = {
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      deviceId: normalizeCryptapeTrustDeviceId(device.id),
      id,
      kind: "cryptape-trust",
      name: device.name,
      ...(device.publicKey ? { publicKey: device.publicKey } : {}),
      version: 5,
    };
    const state: WalletState = {
      biometricUnlock: current.biometricUnlock,
      masterPasswordSet: current.masterPasswordSet,
      selectedWalletId: id,
      version: 5,
      wallets: existing
        ? current.wallets.map((wallet) => (wallet.id === id ? profile : wallet))
        : [...current.wallets, profile],
    };
    await this.writeState(state);
    return state;
  }

  async select(walletId: string): Promise<WalletState> {
    const state = await this.loadWallets();
    if (!state.wallets.some((wallet) => wallet.id === walletId)) {
      throw new LocalizedError("walletUnavailable", "Wallet is unavailable");
    }
    const next = { ...state, selectedWalletId: walletId };
    await this.writeState(next);
    return next;
  }

  async readMnemonic(
    walletId: string,
    credential: WalletCredential,
  ): Promise<string> {
    const state = await this.loadWallets();
    const wallet = state.wallets.find((profile) => profile.id === walletId);
    if (!wallet || wallet.kind !== "mnemonic") {
      throw new WalletSecretUnavailableError();
    }
    const serializedKeystore = await SecureStore.getItemAsync(
      mnemonicKeystoreKey(walletId),
    );
    if (!serializedKeystore) {
      throw new WalletSecretUnavailableError();
    }
    const masterKey = await this.resolveMasterKey(credential);
    try {
      return await decryptMnemonicKeystore(serializedKeystore, masterKey, walletId);
    } finally {
      masterKey.fill(0);
    }
  }

  async verifyMasterCredential(credential: WalletCredential): Promise<boolean> {
    const state = await this.loadWallets();
    if (!state.masterPasswordSet) return false;
    try {
      const masterKey = await this.resolveMasterKey(credential);
      masterKey.fill(0);
      return true;
    } catch (cause) {
      if (cause instanceof WalletSecretUnavailableError) throw cause;
      return false;
    }
  }

  async changeMasterPassword(
    oldPassword: string,
    newPassword: string,
  ): Promise<WalletState> {
    const state = await this.loadWallets();
    if (!state.masterPasswordSet) throw new WalletSecretUnavailableError();
    const previousEnvelope = await SecureStore.getItemAsync(MASTER_KEY_ENVELOPE_KEY);
    if (!previousEnvelope) throw new WalletSecretUnavailableError();
    let masterKey: Uint8Array;
    try {
      masterKey = await decryptMasterKey(previousEnvelope, oldPassword);
    } catch {
      throw new LocalizedError("invalidWalletPassword", "Invalid password");
    }
    if (oldPassword === newPassword) {
      masterKey.fill(0);
      return state;
    }
    let nextEnvelope: string;
    try {
      nextEnvelope = await encryptMasterKey(masterKey, newPassword);
    } finally {
      masterKey.fill(0);
    }
    try {
      await SecureStore.setItemAsync(
        MASTER_KEY_ENVELOPE_KEY,
        nextEnvelope,
      );
      return state;
    } catch (cause) {
      await SecureStore.setItemAsync(MASTER_KEY_ENVELOPE_KEY, previousEnvelope).catch(
        () => undefined,
      );
      throw cause;
    }
  }

  async readBiometricMasterKey(
    purpose: WalletAuthenticationPurpose = "useWallet",
  ): Promise<string | null> {
    const state = await this.loadWallets();
    if (!state.biometricUnlock) {
      return null;
    }
    return SecureStore.getItemAsync(
      BIOMETRIC_MASTER_KEY,
      this.authenticatedOptions(purpose),
    );
  }

  async setBiometricUnlock(
    credential?: WalletCredential,
  ): Promise<WalletState> {
    const state = await this.loadWallets();
    if (!state.masterPasswordSet) {
      throw new WalletSecretUnavailableError();
    }
    if (credential && !this.canUseBiometrics()) {
      throw new LocalizedError(
        "biometricRequired",
        "Enable biometric authentication in Android first",
      );
    }
    const biometricUnlock = Boolean(credential);
    const next: WalletState = {
      ...state,
      biometricUnlock,
    };
    if (credential) {
      let masterKey: Uint8Array;
      try {
        masterKey = await this.resolveMasterKey(credential);
      } catch (cause) {
        if (credential.kind === "password") {
          throw new LocalizedError("invalidWalletPassword", "Invalid password", undefined, {
            cause,
          });
        }
        throw cause;
      }
      let serializedMasterKey: string;
      try {
        serializedMasterKey = hexFrom(masterKey);
      } finally {
        masterKey.fill(0);
      }
      await SecureStore.setItemAsync(
        BIOMETRIC_MASTER_KEY,
        serializedMasterKey,
        this.authenticatedOptions("enableBiometrics"),
      );
      try {
        await this.writeState(next);
      } catch (cause) {
        await SecureStore.deleteItemAsync(BIOMETRIC_MASTER_KEY).catch(() => undefined);
        throw cause;
      }
    } else {
      await this.writeState(next);
      await SecureStore.deleteItemAsync(BIOMETRIC_MASTER_KEY).catch(() => undefined);
    }
    return next;
  }

  async remove(walletId: string): Promise<WalletState> {
    const state = await this.loadWallets();
    const wallet = state.wallets.find((profile) => profile.id === walletId);
    if (!wallet) return state;
    const wallets = state.wallets.filter((profile) => profile.id !== walletId);
    const next: WalletState = {
      biometricUnlock: state.biometricUnlock,
      masterPasswordSet: state.masterPasswordSet,
      selectedWalletId:
        state.selectedWalletId === walletId ? wallets[0]?.id : state.selectedWalletId,
      version: 5,
      wallets,
    };
    await this.writeState(next);
    if (wallet.kind === "mnemonic") {
      await SecureStore.deleteItemAsync(mnemonicKeystoreKey(walletId));
    }
    return next;
  }

  async clear(): Promise<void> {
    const state = await this.loadWallets();
    await Promise.all([
      ...state.wallets.flatMap((wallet) =>
        wallet.kind === "mnemonic"
          ? [
              SecureStore.deleteItemAsync(mnemonicKeystoreKey(wallet.id)),
            ]
          : [],
      ),
      SecureStore.deleteItemAsync(WALLET_STATE_KEY),
      SecureStore.deleteItemAsync(BIOMETRIC_MASTER_KEY),
      SecureStore.deleteItemAsync(MASTER_KEY_ENVELOPE_KEY),
    ]);
  }

  private writeState(state: WalletState): Promise<void> {
    return SecureStore.setItemAsync(WALLET_STATE_KEY, JSON.stringify(state));
  }

  private async resolveMasterKey(credential: WalletCredential) {
    if (credential.kind === "masterKey") {
      try {
        const masterKey = bytesFrom(credential.value);
        if (masterKey.length !== 32) throw new Error("Invalid wallet master key");
        return Uint8Array.from(masterKey);
      } catch (cause) {
        throw new WalletSecretUnavailableError("walletDataCorrupted", { cause });
      }
    }
    const serialized = await SecureStore.getItemAsync(MASTER_KEY_ENVELOPE_KEY);
    if (!serialized) throw new WalletSecretUnavailableError();
    return decryptMasterKey(serialized, credential.value);
  }
}

function emptyWalletState(): WalletState {
  return {
    biometricUnlock: false,
    masterPasswordSet: false,
    version: 5,
    wallets: [],
  };
}

function mnemonicKeystoreKey(walletId: string): string {
  return `${KEYSTORE_KEY_PREFIX}${walletId}`;
}

export function walletIdFromPublicKey(publicKey: string): string {
  const id = publicKey.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{66}$/.test(id)) {
    throw new LocalizedError("invalidProfile", "Invalid wallet profile");
  }
  return id;
}

export function cryptapeTrustWalletId(deviceId: string): string {
  return `cryptape-trust:${normalizeCryptapeTrustDeviceId(deviceId).replaceAll(":", "").toLowerCase()}`;
}

function normalizeCryptapeTrustDeviceId(deviceId: string): string {
  const hex = deviceId.replace(/[^0-9a-f]/gi, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(hex)) {
    throw new LocalizedError(
      "invalidTrustDeviceAddress",
      "Invalid Cryptape Trust device address",
    );
  }
  return hex.match(/../g)!.join(":");
}

function parseWalletState(value: string): WalletState {
  try {
    const state = JSON.parse(value) as WalletState;
    if (
      state.version !== 5 ||
      typeof state.biometricUnlock !== "boolean" ||
      typeof state.masterPasswordSet !== "boolean" ||
      (state.biometricUnlock && !state.masterPasswordSet) ||
      !Array.isArray(state.wallets) ||
      (state.wallets.some((wallet) => wallet.kind === "mnemonic") &&
        !state.masterPasswordSet) ||
      !state.wallets.every(isWalletProfile) ||
      new Set(state.wallets.map((wallet) => wallet.id)).size !== state.wallets.length ||
      (state.selectedWalletId !== undefined &&
        !state.wallets.some((wallet) => wallet.id === state.selectedWalletId))
    ) {
      throw new Error("Invalid wallet state");
    }
    return state;
  } catch (cause) {
    throw new WalletSecretUnavailableError("walletDataCorrupted", { cause });
  }
}

function isWalletProfile(value: unknown): value is WalletProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<WalletProfile>;
  if (
    profile.version !== 5 ||
    typeof profile.id !== "string" ||
    typeof profile.createdAt !== "string"
  ) return false;
  if (profile.kind === "cryptape-trust") {
    try {
      return (
        typeof profile.deviceId === "string" &&
        profile.id === cryptapeTrustWalletId(profile.deviceId) &&
        typeof profile.name === "string" &&
        (profile.publicKey === undefined || typeof profile.publicKey === "string")
      );
    } catch {
      return false;
    }
  }
  if (profile.kind !== "mnemonic") return false;
  return (
    profile.id === walletIdFromPublicKey(profile.publicKey ?? "") &&
    typeof profile.publicKey === "string" &&
    typeof profile.derivationPath === "string"
  );
}

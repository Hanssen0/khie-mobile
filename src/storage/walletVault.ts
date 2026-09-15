import * as SecureStore from "expo-secure-store";

import { LocalizedError } from "../errors";
import {
  decryptMnemonicKeystore,
  encryptMnemonicKeystore,
} from "../wallet/mnemonicKeystore";
import {
  createMasterPasswordVerifier,
  verifyMasterPasswordCredential,
} from "../wallet/masterPasswordVerifier";
import type {
  AccountDescriptor,
  CryptapeTrustWalletProfile,
  MnemonicWalletProfile,
  WalletProfile,
  WalletState,
} from "../wallet/types";

const WALLET_STATE_KEY = "khie.wallet.state.v4";
const KEYSTORE_KEY_PREFIX = "khie.wallet.keystore.v4.";
const BIOMETRIC_CREDENTIAL_KEY = "khie.wallet.master.biometric.v4";
const MASTER_PASSWORD_VERIFIER_KEY = "khie.wallet.master.verifier.v4";
const PASSWORD_CHANGE_JOURNAL_KEY = "khie.wallet.master.change-journal.v4";

export type MasterPasswordInitialization = {
  biometricUnlock: boolean;
};

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
    translationKey: "walletSecretUnavailable" | "passwordChangeRecoveryFailed" |
      "passwordChangeDataCorrupted" | "walletDataCorrupted" =
        "walletSecretUnavailable",
    options?: ErrorOptions,
  ) {
    const fallbackMessages = {
      walletSecretUnavailable: "Wallet secret is unavailable",
      passwordChangeRecoveryFailed:
        "The interrupted password change could not be recovered",
      passwordChangeDataCorrupted: "Password change recovery data is corrupted",
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
    passwordCredential: string,
    initialization?: MasterPasswordInitialization,
  ): Promise<WalletState>;
  saveCryptapeTrust(device: {
    id: string;
    name: string;
    publicKey?: string;
  }): Promise<WalletState>;
  select(walletId: string): Promise<WalletState>;
  readMnemonic(walletId: string, passwordCredential: string): Promise<string>;
  verifyMasterCredential(passwordCredential: string): Promise<boolean>;
  changeMasterPassword(
    oldPasswordCredential: string,
    newPasswordCredential: string,
  ): Promise<WalletState>;
  readBiometricCredential(
    purpose?: WalletAuthenticationPurpose,
  ): Promise<string | null>;
  setBiometricUnlock(
    passwordCredential?: string,
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
    await this.recoverInterruptedPasswordChange();
    const value = await SecureStore.getItemAsync(WALLET_STATE_KEY);
    return value ? parseWalletState(value) : emptyWalletState();
  }

  async save(
    account: AccountDescriptor,
    mnemonic: string,
    passwordCredential: string,
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
    if (
      current.masterPasswordSet &&
      !(await this.verifyMasterCredential(passwordCredential))
    ) {
      throw new LocalizedError("invalidWalletPassword", "Invalid password");
    }
    const id = walletIdFromPublicKey(account.publicKey);
    const existing = current.wallets.find((wallet) => wallet.id === id);
    const profile: MnemonicWalletProfile = {
      ...account,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      id,
      kind: "mnemonic",
      version: 4,
    };
    const keystoreKey = mnemonicKeystoreKey(id);
    const serializedKeystore = await encryptMnemonicKeystore(
      mnemonic,
      passwordCredential,
    );
    const serializedVerifier = initialization
      ? await createMasterPasswordVerifier(passwordCredential)
      : undefined;

    await SecureStore.setItemAsync(keystoreKey, serializedKeystore);
    try {
      if (serializedVerifier) {
        await SecureStore.setItemAsync(
          MASTER_PASSWORD_VERIFIER_KEY,
          serializedVerifier,
        );
      }
      if (initialization?.biometricUnlock) {
        await SecureStore.setItemAsync(
          BIOMETRIC_CREDENTIAL_KEY,
          passwordCredential,
          this.authenticatedOptions("enableBiometrics"),
        );
      } else if (initialization) {
        await SecureStore.deleteItemAsync(BIOMETRIC_CREDENTIAL_KEY);
      }
      const state: WalletState = {
        biometricUnlock:
          initialization?.biometricUnlock ?? current.biometricUnlock,
        masterPasswordSet: current.masterPasswordSet || Boolean(initialization),
        selectedWalletId: id,
        version: 4,
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
            ? [SecureStore.deleteItemAsync(BIOMETRIC_CREDENTIAL_KEY).catch(() => undefined)]
            : []),
          ...(serializedVerifier
            ? [SecureStore.deleteItemAsync(MASTER_PASSWORD_VERIFIER_KEY).catch(() => undefined)]
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
      version: 4,
    };
    const state: WalletState = {
      biometricUnlock: current.biometricUnlock,
      masterPasswordSet: current.masterPasswordSet,
      selectedWalletId: id,
      version: 4,
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
    passwordCredential: string,
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
    return decryptMnemonicKeystore(serializedKeystore, passwordCredential);
  }

  async verifyMasterCredential(passwordCredential: string): Promise<boolean> {
    const state = await this.loadWallets();
    if (!state.masterPasswordSet) return false;
    const verifier = await SecureStore.getItemAsync(MASTER_PASSWORD_VERIFIER_KEY);
    if (!verifier) throw new WalletSecretUnavailableError();
    return verifyMasterPasswordCredential(verifier, passwordCredential);
  }

  async changeMasterPassword(
    oldPasswordCredential: string,
    newPasswordCredential: string,
  ): Promise<WalletState> {
    const state = await this.loadWallets();
    if (!state.masterPasswordSet) throw new WalletSecretUnavailableError();
    if (!(await this.verifyMasterCredential(oldPasswordCredential))) {
      throw new LocalizedError("invalidWalletPassword", "Invalid password");
    }
    if (oldPasswordCredential === newPasswordCredential) return state;

    const verifier = await SecureStore.getItemAsync(MASTER_PASSWORD_VERIFIER_KEY);
    if (!verifier) throw new WalletSecretUnavailableError();
    const keystores: Record<string, string> = {};
    const nextKeystores: Record<string, string> = {};
    for (const wallet of state.wallets) {
      if (wallet.kind !== "mnemonic") continue;
      const key = mnemonicKeystoreKey(wallet.id);
      const serialized = await SecureStore.getItemAsync(key);
      if (!serialized) throw new WalletSecretUnavailableError();
      keystores[key] = serialized;
      const mnemonic = await decryptMnemonicKeystore(
        serialized,
        oldPasswordCredential,
      );
      nextKeystores[key] = await encryptMnemonicKeystore(
        mnemonic,
        newPasswordCredential,
      );
    }
    const nextVerifier = await createMasterPasswordVerifier(
      newPasswordCredential,
    );
    const journal: PasswordChangeJournal = { keystores, state, verifier };
    await SecureStore.setItemAsync(
      PASSWORD_CHANGE_JOURNAL_KEY,
      JSON.stringify(journal),
    );
    try {
      for (const [key, value] of Object.entries(nextKeystores)) {
        await SecureStore.setItemAsync(key, value);
      }
      await SecureStore.setItemAsync(
        MASTER_PASSWORD_VERIFIER_KEY,
        nextVerifier,
      );
      if (state.biometricUnlock) {
        await SecureStore.setItemAsync(
          BIOMETRIC_CREDENTIAL_KEY,
          newPasswordCredential,
          this.authenticatedOptions("enableBiometrics"),
        );
      }
      await SecureStore.deleteItemAsync(PASSWORD_CHANGE_JOURNAL_KEY);
      return state;
    } catch (cause) {
      try {
        await this.recoverInterruptedPasswordChange();
      } catch (recoveryCause) {
        throw new WalletSecretUnavailableError("passwordChangeRecoveryFailed", {
          cause: recoveryCause,
        });
      }
      throw cause;
    }
  }

  async readBiometricCredential(
    purpose: WalletAuthenticationPurpose = "useWallet",
  ): Promise<string | null> {
    const state = await this.loadWallets();
    if (!state.biometricUnlock) {
      return null;
    }
    return SecureStore.getItemAsync(
      BIOMETRIC_CREDENTIAL_KEY,
      this.authenticatedOptions(purpose),
    );
  }

  async setBiometricUnlock(
    passwordCredential?: string,
  ): Promise<WalletState> {
    const state = await this.loadWallets();
    if (!state.masterPasswordSet) {
      throw new WalletSecretUnavailableError();
    }
    if (passwordCredential && !this.canUseBiometrics()) {
      throw new LocalizedError(
        "biometricRequired",
        "Enable biometric authentication in Android first",
      );
    }
    const biometricUnlock = Boolean(passwordCredential);
    const next: WalletState = {
      ...state,
      biometricUnlock,
    };
    if (passwordCredential) {
      await SecureStore.setItemAsync(
        BIOMETRIC_CREDENTIAL_KEY,
        passwordCredential,
        this.authenticatedOptions("enableBiometrics"),
      );
      try {
        await this.writeState(next);
      } catch (cause) {
        await SecureStore.deleteItemAsync(BIOMETRIC_CREDENTIAL_KEY).catch(() => undefined);
        throw cause;
      }
    } else {
      await this.writeState(next);
      await SecureStore.deleteItemAsync(BIOMETRIC_CREDENTIAL_KEY).catch(() => undefined);
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
      version: 4,
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
      SecureStore.deleteItemAsync(BIOMETRIC_CREDENTIAL_KEY),
      SecureStore.deleteItemAsync(MASTER_PASSWORD_VERIFIER_KEY),
      SecureStore.deleteItemAsync(PASSWORD_CHANGE_JOURNAL_KEY),
    ]);
  }

  private writeState(state: WalletState): Promise<void> {
    return SecureStore.setItemAsync(WALLET_STATE_KEY, JSON.stringify(state));
  }

  private async recoverInterruptedPasswordChange(): Promise<void> {
    const serialized = await SecureStore.getItemAsync(PASSWORD_CHANGE_JOURNAL_KEY);
    if (!serialized) return;
    let journal: PasswordChangeJournal;
    try {
      journal = JSON.parse(serialized) as PasswordChangeJournal;
      const recoveredState = parseWalletState(JSON.stringify(journal.state));
      const expectedKeys = new Set(
        recoveredState.wallets.flatMap((wallet) =>
          wallet.kind === "mnemonic" ? [mnemonicKeystoreKey(wallet.id)] : [],
        ),
      );
      if (
        !journal ||
        typeof journal.verifier !== "string" ||
        !journal.keystores ||
        typeof journal.keystores !== "object" ||
        Object.keys(journal.keystores).length !== expectedKeys.size ||
        !Object.keys(journal.keystores).every((key) => expectedKeys.has(key))
      ) {
        throw new Error("Invalid password change journal");
      }
    } catch (cause) {
      throw new WalletSecretUnavailableError("passwordChangeDataCorrupted", {
        cause,
      });
    }
    for (const [key, value] of Object.entries(journal.keystores)) {
      if (!key.startsWith(KEYSTORE_KEY_PREFIX) || typeof value !== "string") {
        throw new WalletSecretUnavailableError("passwordChangeDataCorrupted");
      }
      await SecureStore.setItemAsync(key, value);
    }
    await SecureStore.setItemAsync(
      MASTER_PASSWORD_VERIFIER_KEY,
      journal.verifier,
    );
    await SecureStore.setItemAsync(
      WALLET_STATE_KEY,
      JSON.stringify({ ...journal.state, biometricUnlock: false }),
    );
    await SecureStore.deleteItemAsync(BIOMETRIC_CREDENTIAL_KEY);
    await SecureStore.deleteItemAsync(PASSWORD_CHANGE_JOURNAL_KEY);
  }
}

type PasswordChangeJournal = {
  keystores: Record<string, string>;
  state: WalletState;
  verifier: string;
};

function emptyWalletState(): WalletState {
  return {
    biometricUnlock: false,
    masterPasswordSet: false,
    version: 4,
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
      state.version !== 4 ||
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
    profile.version !== 4 ||
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

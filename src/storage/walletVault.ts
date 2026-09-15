import * as SecureStore from "expo-secure-store";

import type { AccountDescriptor, WalletProfile, WalletState } from "../wallet/types";

const LEGACY_MNEMONIC_KEY = "khie.wallet.mnemonic.v1";
const LEGACY_PROFILE_KEY = "khie.wallet.profile.v1";
const WALLET_STATE_KEY = "khie.wallet.state.v2";
const MNEMONIC_KEY_PREFIX = "khie.wallet.mnemonic.v2.";

export type WalletAuthenticationPurpose =
  | "useWallet"
  | "signMessage"
  | "signTransaction"
  | "viewMnemonic"
  | "viewPrivateKey";

export type WalletAuthenticationPrompt = (purpose: WalletAuthenticationPurpose) => string;

const defaultAuthenticationPrompt: WalletAuthenticationPrompt = () =>
  "Authenticate to use Khie Wallet";

export class WalletSecretUnavailableError extends Error {
  constructor(message = "钱包密钥不可用，请使用助记词恢复钱包", options?: ErrorOptions) {
    super(message, options);
    this.name = "WalletSecretUnavailableError";
  }
}

export interface WalletVault {
  loadWallets(): Promise<WalletState>;
  save(account: AccountDescriptor, mnemonic: string): Promise<WalletState>;
  select(walletId: string): Promise<WalletState>;
  readMnemonic(walletId: string, purpose?: WalletAuthenticationPurpose): Promise<string>;
  remove(walletId: string): Promise<WalletState>;
  clear(): Promise<void>;
}

export class SecureStoreWalletVault implements WalletVault {
  constructor(private readonly authenticationPrompt = defaultAuthenticationPrompt) {}

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
    if (value) {
      return parseWalletState(value);
    }

    const legacyValue = await SecureStore.getItemAsync(LEGACY_PROFILE_KEY);
    if (!legacyValue) {
      return emptyWalletState();
    }

    try {
      const profile = JSON.parse(legacyValue) as {
        version?: number;
        publicKey?: string;
        derivationPath?: string;
        createdAt?: string;
      };
      if (
        profile.version !== 1 ||
        typeof profile.publicKey !== "string" ||
        typeof profile.derivationPath !== "string" ||
        typeof profile.createdAt !== "string"
      ) {
        throw new Error("Invalid profile");
      }
      const migrated: WalletProfile = {
        createdAt: profile.createdAt,
        derivationPath: profile.derivationPath as AccountDescriptor["derivationPath"],
        id: walletIdFromPublicKey(profile.publicKey),
        mnemonicStorageVersion: 1,
        publicKey: profile.publicKey,
        version: 2,
      };
      const state: WalletState = {
        selectedWalletId: migrated.id,
        version: 2,
        wallets: [migrated],
      };
      await this.writeState(state);
      return state;
    } catch (cause) {
      throw new WalletSecretUnavailableError("钱包资料已损坏，请使用助记词恢复钱包", {
        cause,
      });
    }
  }

  async save(account: AccountDescriptor, mnemonic: string): Promise<WalletState> {
    if (!SecureStore.canUseBiometricAuthentication()) {
      throw new Error("请先在 Android 系统中启用生物识别认证");
    }
    const current = await this.loadWallets();
    const id = walletIdFromPublicKey(account.publicKey);
    const existing = current.wallets.find((wallet) => wallet.id === id);
    const profile: WalletProfile = existing
      ? { ...existing, mnemonicStorageVersion: 2 }
      : {
          ...account,
          createdAt: new Date().toISOString(),
          id,
          mnemonicStorageVersion: 2,
          version: 2,
        };
    const secretKey = mnemonicKey(id);
    await SecureStore.setItemAsync(
      secretKey,
      mnemonic,
      this.authenticatedOptions("useWallet"),
    );
    try {
      const state: WalletState = {
        selectedWalletId: id,
        version: 2,
        wallets: existing
          ? current.wallets.map((wallet) => (wallet.id === id ? profile : wallet))
          : [...current.wallets, profile],
      };
      await this.writeState(state);
      if (existing?.mnemonicStorageVersion === 1) {
        await Promise.all([
          SecureStore.deleteItemAsync(
            LEGACY_MNEMONIC_KEY,
            this.authenticatedOptions("useWallet"),
          ),
          SecureStore.deleteItemAsync(LEGACY_PROFILE_KEY),
        ]).catch(() => undefined);
      }
      return state;
    } catch (cause) {
      if (!existing) {
        await SecureStore.deleteItemAsync(secretKey, this.authenticatedOptions("useWallet"));
      }
      throw cause;
    }
  }

  async select(walletId: string): Promise<WalletState> {
    const state = await this.loadWallets();
    if (!state.wallets.some((wallet) => wallet.id === walletId)) {
      throw new Error("Unknown wallet");
    }
    const next = { ...state, selectedWalletId: walletId };
    await this.writeState(next);
    return next;
  }

  async readMnemonic(
    walletId: string,
    purpose: WalletAuthenticationPurpose = "useWallet",
  ): Promise<string> {
    const state = await this.loadWallets();
    const wallet = state.wallets.find((profile) => profile.id === walletId);
    if (!wallet) {
      throw new WalletSecretUnavailableError();
    }
    let value: string | null;
    try {
      value = await SecureStore.getItemAsync(
        wallet.mnemonicStorageVersion === 1 ? LEGACY_MNEMONIC_KEY : mnemonicKey(walletId),
        this.authenticatedOptions(purpose),
      );
    } catch (cause) {
      throw new WalletSecretUnavailableError(undefined, { cause });
    }
    if (!value) {
      throw new WalletSecretUnavailableError();
    }
    return value;
  }

  async remove(walletId: string): Promise<WalletState> {
    const state = await this.loadWallets();
    const wallet = state.wallets.find((profile) => profile.id === walletId);
    if (!wallet) {
      return state;
    }
    const wallets = state.wallets.filter((profile) => profile.id !== walletId);
    const next: WalletState = {
      selectedWalletId:
        state.selectedWalletId === walletId ? wallets[0]?.id : state.selectedWalletId,
      version: 2,
      wallets,
    };
    await this.writeState(next);
    await SecureStore.deleteItemAsync(
      wallet.mnemonicStorageVersion === 1 ? LEGACY_MNEMONIC_KEY : mnemonicKey(walletId),
      this.authenticatedOptions("useWallet"),
    ).catch(() => undefined);
    if (wallet.mnemonicStorageVersion === 1) {
      await SecureStore.deleteItemAsync(LEGACY_PROFILE_KEY).catch(() => undefined);
    }
    return next;
  }

  async clear(): Promise<void> {
    const state = await this.loadWallets();
    await Promise.all([
      ...state.wallets.map((wallet) =>
        SecureStore.deleteItemAsync(
          wallet.mnemonicStorageVersion === 1
            ? LEGACY_MNEMONIC_KEY
            : mnemonicKey(wallet.id),
          this.authenticatedOptions("useWallet"),
        ),
      ),
      SecureStore.deleteItemAsync(LEGACY_PROFILE_KEY),
      SecureStore.deleteItemAsync(WALLET_STATE_KEY),
    ]);
  }

  private writeState(state: WalletState): Promise<void> {
    return SecureStore.setItemAsync(WALLET_STATE_KEY, JSON.stringify(state));
  }
}

function emptyWalletState(): WalletState {
  return { version: 2, wallets: [] };
}

function mnemonicKey(walletId: string): string {
  return `${MNEMONIC_KEY_PREFIX}${walletId}`;
}

export function walletIdFromPublicKey(publicKey: string): string {
  const id = publicKey.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{66}$/.test(id)) {
    throw new Error("Invalid profile");
  }
  return id;
}

function parseWalletState(value: string): WalletState {
  try {
    const state = JSON.parse(value) as WalletState;
    if (
      state.version !== 2 ||
      !Array.isArray(state.wallets) ||
      !state.wallets.every(isWalletProfile) ||
      new Set(state.wallets.map((wallet) => wallet.id)).size !== state.wallets.length ||
      (state.selectedWalletId !== undefined &&
        !state.wallets.some((wallet) => wallet.id === state.selectedWalletId))
    ) {
      throw new Error("Invalid wallet state");
    }
    return state;
  } catch (cause) {
    throw new WalletSecretUnavailableError("钱包资料已损坏，请使用助记词恢复钱包", {
      cause,
    });
  }
}

function isWalletProfile(value: unknown): value is WalletProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<WalletProfile>;
  return (
    profile.version === 2 &&
    typeof profile.id === "string" &&
    profile.id === walletIdFromPublicKey(profile.publicKey ?? "") &&
    typeof profile.publicKey === "string" &&
    typeof profile.derivationPath === "string" &&
    typeof profile.createdAt === "string" &&
    (profile.mnemonicStorageVersion === 1 || profile.mnemonicStorageVersion === 2)
  );
}

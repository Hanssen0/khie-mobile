import * as SecureStore from "expo-secure-store";

import type {
  AccountDescriptor,
  MnemonicWalletProfile,
  CryptapeTrustWalletProfile,
  WalletProfile,
  WalletState,
} from "../wallet/types";

const WALLET_STATE_KEY = "khie.wallet.state.v3";
const MNEMONIC_KEY_PREFIX = "khie.wallet.mnemonic.v3.";

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
  saveCryptapeTrust(device: {
    id: string;
    name: string;
    publicKey?: string;
  }): Promise<WalletState>;
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
    return emptyWalletState();
  }

  async save(account: AccountDescriptor, mnemonic: string): Promise<WalletState> {
    if (!SecureStore.canUseBiometricAuthentication()) {
      throw new Error("请先在 Android 系统中启用生物识别认证");
    }
    const current = await this.loadWallets();
    const id = walletIdFromPublicKey(account.publicKey);
    const existing = current.wallets.find((wallet) => wallet.id === id);
    const profile: MnemonicWalletProfile = existing?.kind === "mnemonic"
      ? existing
      : {
          ...account,
          createdAt: new Date().toISOString(),
          id,
          kind: "mnemonic",
          version: 3,
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
        version: 3,
        wallets: existing
          ? current.wallets.map((wallet) => (wallet.id === id ? profile : wallet))
          : [...current.wallets, profile],
      };
      await this.writeState(state);
      return state;
    } catch (cause) {
      if (!existing) {
        await SecureStore.deleteItemAsync(secretKey, this.authenticatedOptions("useWallet"));
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
      version: 3,
    };
    const state: WalletState = {
      selectedWalletId: id,
      version: 3,
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
    if (!wallet || wallet.kind !== "mnemonic") {
      throw new WalletSecretUnavailableError();
    }
    let value: string | null;
    try {
      value = await SecureStore.getItemAsync(
        mnemonicKey(walletId),
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
      version: 3,
      wallets,
    };
    await this.writeState(next);
    if (wallet.kind === "mnemonic") {
      await SecureStore.deleteItemAsync(
        mnemonicKey(walletId),
        this.authenticatedOptions("useWallet"),
      ).catch(() => undefined);
    }
    return next;
  }

  async clear(): Promise<void> {
    const state = await this.loadWallets();
    await Promise.all([
      ...state.wallets.filter((wallet) => wallet.kind === "mnemonic").map((wallet) =>
        SecureStore.deleteItemAsync(
          mnemonicKey(wallet.id),
          this.authenticatedOptions("useWallet"),
        ),
      ),
      SecureStore.deleteItemAsync(WALLET_STATE_KEY),
    ]);
  }

  private writeState(state: WalletState): Promise<void> {
    return SecureStore.setItemAsync(WALLET_STATE_KEY, JSON.stringify(state));
  }
}

function emptyWalletState(): WalletState {
  return { version: 3, wallets: [] };
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

export function cryptapeTrustWalletId(deviceId: string): string {
  return `cryptape-trust:${normalizeCryptapeTrustDeviceId(deviceId).replaceAll(":", "").toLowerCase()}`;
}

function normalizeCryptapeTrustDeviceId(deviceId: string): string {
  const hex = deviceId.replace(/[^0-9a-f]/gi, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(hex)) {
    throw new Error("Invalid Cryptape Trust device address");
  }
  return hex.match(/../g)!.join(":");
}

function parseWalletState(value: string): WalletState {
  try {
    const state = JSON.parse(value) as WalletState;
    if (
      state.version !== 3 ||
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
  if (
    profile.version !== 3 ||
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

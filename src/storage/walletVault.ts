import * as SecureStore from "expo-secure-store";

import type { WalletProfile } from "../wallet/types";

const MNEMONIC_KEY = "khie.wallet.mnemonic.v1";
const PROFILE_KEY = "khie.wallet.profile.v1";

const authenticatedOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: true,
  authenticationPrompt: "验证身份以使用 Khie Wallet",
};

export class WalletSecretUnavailableError extends Error {
  constructor(message = "钱包密钥不可用，请使用助记词恢复钱包", options?: ErrorOptions) {
    super(message, options);
    this.name = "WalletSecretUnavailableError";
  }
}

export interface WalletVault {
  loadProfile(): Promise<WalletProfile | undefined>;
  save(profile: WalletProfile, mnemonic: string): Promise<void>;
  readMnemonic(prompt?: string): Promise<string>;
  clear(): Promise<void>;
}

export class SecureStoreWalletVault implements WalletVault {
  async loadProfile(): Promise<WalletProfile | undefined> {
    const value = await SecureStore.getItemAsync(PROFILE_KEY);
    if (!value) {
      return undefined;
    }
    try {
      const profile = JSON.parse(value) as WalletProfile;
      if (
        profile.version !== 1 ||
        typeof profile.publicKey !== "string" ||
        typeof profile.derivationPath !== "string"
      ) {
        throw new Error("Invalid profile");
      }
      return profile;
    } catch (cause) {
      throw new WalletSecretUnavailableError("钱包资料已损坏，请使用助记词恢复钱包", {
        cause,
      });
    }
  }

  async save(profile: WalletProfile, mnemonic: string): Promise<void> {
    if (!SecureStore.canUseBiometricAuthentication()) {
      throw new Error("请先在 Android 系统中启用生物识别认证");
    }
    await SecureStore.setItemAsync(MNEMONIC_KEY, mnemonic, authenticatedOptions);
    try {
      await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(profile));
    } catch (cause) {
      await SecureStore.deleteItemAsync(MNEMONIC_KEY, authenticatedOptions);
      throw cause;
    }
  }

  async readMnemonic(prompt = "验证身份以使用钱包"): Promise<string> {
    let value: string | null;
    try {
      value = await SecureStore.getItemAsync(MNEMONIC_KEY, {
        ...authenticatedOptions,
        authenticationPrompt: prompt,
      });
    } catch (cause) {
      throw new WalletSecretUnavailableError(undefined, { cause });
    }
    if (!value) {
      throw new WalletSecretUnavailableError();
    }
    return value;
  }

  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(MNEMONIC_KEY, authenticatedOptions),
      SecureStore.deleteItemAsync(PROFILE_KEY),
    ]);
  }
}

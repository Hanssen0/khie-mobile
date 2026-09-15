import * as Crypto from "expo-crypto";

import type { WalletVault } from "../storage/walletVault";
import { assertValidMnemonic, deriveAccount, mnemonicFromEntropy } from "./derivation";
import type { WalletProfile, WalletState } from "./types";

export async function generateMnemonic(): Promise<string> {
  return mnemonicFromEntropy(await Crypto.getRandomBytesAsync(16));
}

export async function persistWallet(
  vault: WalletVault,
  mnemonicValue: string,
): Promise<WalletState> {
  const mnemonic = assertValidMnemonic(mnemonicValue);
  const { account, privateKey } = deriveAccount(mnemonic);
  privateKey.fill(0);
  return vault.save(account, mnemonic);
}

export async function recoverWallet(
  vault: WalletVault,
  profile: WalletProfile,
  mnemonicValue: string,
): Promise<WalletState> {
  const mnemonic = assertValidMnemonic(mnemonicValue);
  const { account, privateKey } = deriveAccount(mnemonic);
  privateKey.fill(0);
  if (account.publicKey !== profile.publicKey) {
    throw new Error("助记词与当前账户不匹配");
  }
  return vault.save(account, mnemonic);
}

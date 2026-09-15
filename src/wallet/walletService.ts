import * as Crypto from "expo-crypto";

import type { WalletVault } from "../storage/walletVault";
import { assertValidMnemonic, deriveAccount, mnemonicFromEntropy } from "./derivation";
import {
  assertWalletPassword,
  deriveWalletPasswordCredential,
} from "./password";
import type { WalletState } from "./types";

export async function generateMnemonic(): Promise<string> {
  return mnemonicFromEntropy(await Crypto.getRandomBytesAsync(16));
}

export async function persistWallet(
  vault: WalletVault,
  mnemonicValue: string,
  passwordCredential: string,
): Promise<WalletState> {
  const mnemonic = assertValidMnemonic(mnemonicValue);
  const { account, privateKey } = deriveAccount(mnemonic);
  privateKey.fill(0);
  return vault.save(account, mnemonic, passwordCredential);
}

export async function persistFirstMnemonicWallet(
  vault: WalletVault,
  mnemonicValue: string,
  passwordValue: string,
  biometricUnlock: boolean,
): Promise<WalletState> {
  const mnemonic = assertValidMnemonic(mnemonicValue);
  const password = assertWalletPassword(passwordValue);
  const passwordCredential = await deriveWalletPasswordCredential(password);
  const { account, privateKey } = deriveAccount(mnemonic);
  privateKey.fill(0);
  return vault.save(account, mnemonic, passwordCredential, { biometricUnlock });
}

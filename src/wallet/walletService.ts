import * as Crypto from "expo-crypto";

import type { WalletVault } from "../storage/walletVault";
import { assertValidMnemonic, deriveAccount, mnemonicFromEntropy } from "./derivation";
import type { WalletProfile } from "./types";

export async function generateMnemonic(): Promise<string> {
  return mnemonicFromEntropy(await Crypto.getRandomBytesAsync(16));
}

export async function persistWallet(
  vault: WalletVault,
  mnemonicValue: string,
): Promise<WalletProfile> {
  const mnemonic = assertValidMnemonic(mnemonicValue);
  const { account, privateKey } = deriveAccount(mnemonic);
  privateKey.fill(0);
  const profile: WalletProfile = {
    ...account,
    createdAt: new Date().toISOString(),
    version: 1,
  };
  await vault.save(profile, mnemonic);
  return profile;
}

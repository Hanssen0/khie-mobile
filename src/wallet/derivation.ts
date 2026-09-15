import { hexFrom } from "@ckb-ccc/core";
import { HDKey } from "@scure/bip32";
import {
  entropyToMnemonic,
  mnemonicToSeedSync,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import { LocalizedError } from "../errors";
import { CKB_DERIVATION_PATH, type AccountDescriptor } from "./types";

export function normalizeMnemonic(value: string): string {
  return value.trim().toLowerCase().split(/\s+/u).join(" ");
}

export function assertValidMnemonic(value: string): string {
  const normalized = normalizeMnemonic(value);
  const count = normalized ? normalized.split(" ").length : 0;
  if ((count !== 12 && count !== 24) || !validateMnemonic(normalized, wordlist)) {
    throw new LocalizedError(
      "invalidMnemonic",
      "Enter a valid 12- or 24-word English BIP-39 mnemonic",
    );
  }
  return normalized;
}

export function mnemonicFromEntropy(entropy: Uint8Array): string {
  if (entropy.byteLength !== 16) {
    throw new LocalizedError(
      "invalidEntropy",
      "A new wallet requires 128 bits of secure random entropy",
    );
  }
  return entropyToMnemonic(entropy, wordlist);
}

export function deriveAccount(mnemonicValue: string): {
  account: AccountDescriptor;
  privateKey: Uint8Array;
} {
  const mnemonic = assertValidMnemonic(mnemonicValue);
  const child = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive(
    CKB_DERIVATION_PATH,
  );
  if (!child.privateKey || !child.publicKey) {
    throw new LocalizedError(
      "derivationFailed",
      "Unable to derive a CKB account from the mnemonic",
    );
  }

  return {
    account: {
      derivationPath: CKB_DERIVATION_PATH,
      publicKey: hexFrom(child.publicKey),
    },
    privateKey: Uint8Array.from(child.privateKey),
  };
}

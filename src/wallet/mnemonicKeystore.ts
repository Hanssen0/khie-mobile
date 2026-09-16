import { gcm } from "@noble/ciphers/aes.js";
import { bytesFrom, hexFrom, type BytesLike } from "@ckb-ccc/core";
import * as Crypto from "expo-crypto";
import {
  entropyToMnemonic,
  mnemonicToEntropy,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import { assertValidMnemonic } from "./derivation";
const MASTER_KEY_LENGTH = 32;
const NONCE_LENGTH = 12;
const HEADER = Uint8Array.from([0x4b, 0x48, 0x49, 0x45, 0x01]);
const ENTROPY_LENGTH_OFFSET = HEADER.length;
const ENTROPY_OFFSET = ENTROPY_LENGTH_OFFSET + 1;

type SerializedMnemonicKeystore = {
  version: 1;
  cipher: "aes-256-gcm";
  ciphertext: string;
  nonce: string;
};

export async function encryptMnemonicKeystore(
  mnemonicValue: string,
  masterKeyLike: BytesLike,
  walletId: string,
): Promise<string> {
  const mnemonic = assertValidMnemonic(mnemonicValue);
  const entropy = mnemonicToEntropy(mnemonic, wordlist);
  const payload = new Uint8Array(ENTROPY_OFFSET + entropy.length);
  payload.set(HEADER);
  payload[ENTROPY_LENGTH_OFFSET] = entropy.length;
  payload.set(entropy, ENTROPY_OFFSET);
  const masterKey = bytesFrom(masterKeyLike);
  const nonce = await Crypto.getRandomBytesAsync(NONCE_LENGTH);
  if (masterKey.length !== MASTER_KEY_LENGTH) {
    throw new Error("Invalid wallet master key");
  }

  try {
    const ciphertext = gcm(masterKey, nonce, mnemonicAad(walletId)).encrypt(payload);
    const keystore: SerializedMnemonicKeystore = {
      version: 1,
      cipher: "aes-256-gcm",
      ciphertext: hexFrom(ciphertext).slice(2),
      nonce: hexFrom(nonce).slice(2),
    };
    return JSON.stringify(keystore);
  } finally {
    entropy.fill(0);
    payload.fill(0);
    nonce.fill(0);
  }
}

export async function decryptMnemonicKeystore(
  serializedKeystore: string,
  masterKeyLike: BytesLike,
  walletId: string,
): Promise<string> {
  const masterKey = bytesFrom(masterKeyLike);
  let payload: Uint8Array | undefined;
  let ciphertext: Uint8Array | undefined;
  let nonce: Uint8Array | undefined;
  try {
    if (masterKey.length !== MASTER_KEY_LENGTH) {
      throw new Error("Invalid wallet master key");
    }
    const keystore = parseMnemonicKeystore(JSON.parse(serializedKeystore));
    ciphertext = bytesFrom(`0x${keystore.ciphertext}`);
    nonce = bytesFrom(`0x${keystore.nonce}`);
    payload = gcm(masterKey, nonce, mnemonicAad(walletId)).decrypt(ciphertext);
    if (
      (payload.length !== ENTROPY_OFFSET + 16 && payload.length !== ENTROPY_OFFSET + 32) ||
      !HEADER.every((value, index) => payload?.[index] === value)
    ) {
      throw new Error("Invalid mnemonic keystore");
    }
    const entropyLength = payload[ENTROPY_LENGTH_OFFSET];
    if (entropyLength !== 16 && entropyLength !== 32) {
      throw new Error("Invalid mnemonic keystore");
    }
    const entropy = payload.slice(ENTROPY_OFFSET, ENTROPY_OFFSET + entropyLength);
    try {
      return entropyToMnemonic(entropy, wordlist);
    } finally {
      entropy.fill(0);
    }
  } catch (cause) {
    throw new Error("Invalid mnemonic keystore", { cause });
  } finally {
    payload?.fill(0);
    ciphertext?.fill(0);
    nonce?.fill(0);
  }
}

function mnemonicAad(walletId: string): Uint8Array {
  return bytesFrom(`khie.wallet.mnemonic.v1:${walletId}`, "utf8");
}

function parseMnemonicKeystore(value: unknown): SerializedMnemonicKeystore {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid mnemonic keystore");
  }
  const keystore = value as Partial<SerializedMnemonicKeystore>;
  if (
    keystore.version !== 1 ||
    keystore.cipher !== "aes-256-gcm" ||
    typeof keystore.ciphertext !== "string" ||
    !/^(?:[0-9a-f]{76}|[0-9a-f]{108})$/i.test(keystore.ciphertext) ||
    typeof keystore.nonce !== "string" ||
    !/^[0-9a-f]{24}$/i.test(keystore.nonce)
  ) {
    throw new Error("Invalid mnemonic keystore");
  }
  return keystore as SerializedMnemonicKeystore;
}

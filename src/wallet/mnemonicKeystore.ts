import {
  bytesConcat,
  type Bytes,
} from "@ckb-ccc/core";
import {
  entropyToMnemonic,
  mnemonicToEntropy,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import { assertValidMnemonic } from "./derivation";
import { decryptKeystore, encryptKeystore } from "./keystore";

const PAYLOAD_LENGTH = 64;
const HEADER = Uint8Array.from([0x4b, 0x48, 0x49, 0x45, 0x01]);
const ENTROPY_LENGTH_OFFSET = HEADER.length;
const ENTROPY_OFFSET = ENTROPY_LENGTH_OFFSET + 1;

export async function encryptMnemonicKeystore(
  mnemonicValue: string,
  passwordCredential: string,
): Promise<string> {
  const mnemonic = assertValidMnemonic(mnemonicValue);
  const entropy = mnemonicToEntropy(mnemonic, wordlist);
  const payload = new Uint8Array(PAYLOAD_LENGTH);
  payload.set(HEADER);
  payload[ENTROPY_LENGTH_OFFSET] = entropy.length;
  payload.set(entropy, ENTROPY_OFFSET);

  try {
    return JSON.stringify(
      await encryptKeystore(
        payload.subarray(0, 32),
        payload.subarray(32),
        passwordCredential,
      ),
    );
  } finally {
    entropy.fill(0);
    payload.fill(0);
  }
}

export async function decryptMnemonicKeystore(
  serializedKeystore: string,
  passwordCredential: string,
): Promise<string> {
  let privateKey: Bytes | undefined;
  let chainCode: Bytes | undefined;
  let payload: Bytes | undefined;
  try {
    ({ privateKey, chainCode } = await decryptKeystore(
      JSON.parse(serializedKeystore),
      passwordCredential,
    ));
    payload = bytesConcat(privateKey, chainCode);
    if (
      payload.length !== PAYLOAD_LENGTH ||
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
    if (cause instanceof SyntaxError) {
      throw new Error("Invalid mnemonic keystore", { cause });
    }
    throw cause;
  } finally {
    privateKey?.fill(0);
    chainCode?.fill(0);
    payload?.fill(0);
  }
}

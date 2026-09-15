import { ctr } from "@noble/ciphers/aes.js";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  bytesConcat,
  bytesFrom,
  hexFrom,
  type Bytes,
  type BytesLike,
} from "@ckb-ccc/core";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

const SCRYPT_COST = 262_144;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const DERIVED_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 512 * 1024 * 1024;

type SerializedKeystore = {
  id: string;
  crypto: {
    ciphertext: string;
    cipherparams: { iv: string };
    cipher: "aes-128-ctr";
    kdf: "scrypt";
    kdfparams: {
      n: number;
      r: number;
      p: number;
      dklen: number;
      salt: string;
    };
    mac: string;
  };
};

export async function encryptKeystore(
  privateKeyLike: BytesLike,
  chainCodeLike: BytesLike,
  password: string,
): Promise<SerializedKeystore> {
  const salt = await Crypto.getRandomBytesAsync(32);
  const iv = await Crypto.getRandomBytesAsync(16);
  const kdfparams = {
    dklen: DERIVED_KEY_LENGTH,
    salt: hexFrom(salt).slice(2),
    n: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  };
  const derivedKey = await deriveKey(password, salt, kdfparams);
  try {
    const ciphertext = ctr(derivedKey.subarray(0, 16), iv).encrypt(
      bytesConcat(bytesFrom(privateKeyLike), bytesFrom(chainCodeLike)),
    );
    return {
      id: hexFrom(await Crypto.getRandomBytesAsync(16)).slice(2),
      crypto: {
        ciphertext: hexFrom(ciphertext).slice(2),
        cipherparams: { iv: hexFrom(iv).slice(2) },
        cipher: "aes-128-ctr",
        kdf: "scrypt",
        kdfparams,
        mac: calculateMac(derivedKey, ciphertext),
      },
    };
  } finally {
    derivedKey.fill(0);
    salt.fill(0);
    iv.fill(0);
  }
}

export async function decryptKeystore(
  value: unknown,
  password: string,
): Promise<{ privateKey: Bytes; chainCode: Bytes }> {
  const keystore = parseKeystore(value);
  const salt = bytesFrom(`0x${keystore.crypto.kdfparams.salt}`);
  const derivedKey = await deriveKey(password, salt, keystore.crypto.kdfparams);
  const ciphertext = bytesFrom(`0x${keystore.crypto.ciphertext}`);
  try {
    if (calculateMac(derivedKey, ciphertext) !== keystore.crypto.mac) {
      throw new Error("Invalid password");
    }
    const plaintext = ctr(
      derivedKey.subarray(0, 16),
      bytesFrom(`0x${keystore.crypto.cipherparams.iv}`),
    ).decrypt(ciphertext);
    if (plaintext.length !== 64) {
      throw new Error("Invalid keystore payload length");
    }
    return {
      privateKey: plaintext.slice(0, 32),
      chainCode: plaintext.slice(32),
    };
  } finally {
    derivedKey.fill(0);
    salt.fill(0);
    ciphertext.fill(0);
  }
}

function calculateMac(derivedKey: Bytes, ciphertext: BytesLike): string {
  return hexFrom(
    keccak_256(bytesConcat(derivedKey.subarray(16), bytesFrom(ciphertext))),
  ).slice(2);
}

async function deriveKey(
  password: string,
  salt: Bytes,
  parameters: SerializedKeystore["crypto"]["kdfparams"],
): Promise<Bytes> {
  if (Platform.OS !== "web") {
    const { scrypt: scryptNative } = require(
      "react-native-quick-crypto/lib/module/scrypt"
    ) as typeof import("react-native-quick-crypto/lib/module/scrypt");
    return new Promise((resolve, reject) => {
      scryptNative(
        bytesFrom(password, "utf8"),
        salt,
        parameters.dklen,
        {
          N: parameters.n,
          r: parameters.r,
          p: parameters.p,
          maxmem: SCRYPT_MAX_MEMORY,
        },
        (error, derivedKey) => {
          if (error) {
            reject(error);
            return;
          }
          if (!derivedKey) {
            reject(new Error("scrypt returned no derived key"));
            return;
          }
          const result = Uint8Array.from(derivedKey);
          derivedKey.fill(0);
          resolve(result);
        },
      );
    });
  }
  return scryptAsync(bytesFrom(password, "utf8"), salt, {
    N: parameters.n,
    r: parameters.r,
    p: parameters.p,
    dkLen: parameters.dklen,
  });
}

function parseKeystore(value: unknown): SerializedKeystore {
  if (!value || typeof value !== "object" || !("crypto" in value)) {
    throw new Error("Invalid keystore");
  }
  const keystore = value as Partial<SerializedKeystore>;
  const crypto = keystore.crypto;
  const parameters = crypto?.kdfparams;
  if (
    typeof keystore.id !== "string" ||
    !crypto ||
    crypto.cipher !== "aes-128-ctr" ||
    crypto.kdf !== "scrypt" ||
    typeof crypto.ciphertext !== "string" ||
    typeof crypto.mac !== "string" ||
    typeof crypto.cipherparams?.iv !== "string" ||
    !parameters ||
    !Number.isSafeInteger(parameters.n) ||
    !Number.isSafeInteger(parameters.r) ||
    !Number.isSafeInteger(parameters.p) ||
    !Number.isSafeInteger(parameters.dklen) ||
    typeof parameters.salt !== "string"
  ) {
    throw new Error("Invalid keystore");
  }
  return keystore as SerializedKeystore;
}

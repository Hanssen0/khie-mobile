import {
  bytesFrom,
  hexFrom,
  type Bytes,
  type BytesLike,
} from "@ckb-ccc/core";

import {
  ARGON2_VERSION_13,
  decryptAes256Gcm,
  deriveArgon2id,
  encryptAes256Gcm,
  secureRandomBytes,
} from "./cryptoProvider";

const MASTER_KEY_LENGTH = 32;
const NONCE_LENGTH = 12;
const SALT_LENGTH = 32;
const ARGON2_MEMORY_KIB = 131_072;
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 4;
const DERIVED_KEY_LENGTH = 32;
const MIN_ARGON2_MEMORY_KIB = 8_192;
const MAX_ARGON2_MEMORY_KIB = 524_288;
const MIN_ARGON2_ITERATIONS = 1;
const MAX_ARGON2_ITERATIONS = 10;
const MIN_ARGON2_PARALLELISM = 1;
const MAX_ARGON2_PARALLELISM = 4;
const MASTER_KEY_AAD = bytesFrom("khie.wallet.master-key.v1", "utf8");

type SerializedMasterKeyEnvelope = {
  version: 1;
  cipher: "aes-256-gcm";
  ciphertext: string;
  nonce: string;
  kdf: "argon2id";
  kdfparams: {
    memory: number;
    iterations: number;
    parallelism: number;
    hashLength: number;
    salt: string;
    version: number;
  };
};

export async function generateMasterKey(): Promise<Bytes> {
  return secureRandomBytes(MASTER_KEY_LENGTH);
}

export async function encryptMasterKey(
  masterKeyLike: BytesLike,
  password: string,
): Promise<string> {
  const masterKey = bytesFrom(masterKeyLike);
  if (masterKey.length !== MASTER_KEY_LENGTH) {
    throw new Error("Invalid wallet master key");
  }
  const salt = secureRandomBytes(SALT_LENGTH);
  const nonce = secureRandomBytes(NONCE_LENGTH);
  const kdfparams = {
    memory: ARGON2_MEMORY_KIB,
    iterations: ARGON2_ITERATIONS,
    parallelism: ARGON2_PARALLELISM,
    hashLength: DERIVED_KEY_LENGTH,
    salt: hexFrom(salt).slice(2),
    version: ARGON2_VERSION_13,
  };
  const derivedKey = await deriveKey(password, salt, kdfparams);
  try {
    const ciphertext = await encryptAes256Gcm(
      masterKey,
      derivedKey,
      nonce,
      MASTER_KEY_AAD,
    );
    const envelope: SerializedMasterKeyEnvelope = {
      version: 1,
      cipher: "aes-256-gcm",
      ciphertext: hexFrom(ciphertext).slice(2),
      nonce: hexFrom(nonce).slice(2),
      kdf: "argon2id",
      kdfparams,
    };
    return JSON.stringify(envelope);
  } finally {
    derivedKey.fill(0);
    salt.fill(0);
    nonce.fill(0);
  }
}

export async function decryptMasterKey(
  serializedEnvelope: string,
  password: string,
): Promise<Bytes> {
  let envelope: SerializedMasterKeyEnvelope;
  try {
    envelope = parseMasterKeyEnvelope(JSON.parse(serializedEnvelope));
  } catch (cause) {
    throw new Error("Invalid wallet master key", { cause });
  }
  const salt = bytesFrom(`0x${envelope.kdfparams.salt}`);
  const nonce = bytesFrom(`0x${envelope.nonce}`);
  const ciphertext = bytesFrom(`0x${envelope.ciphertext}`);
  const derivedKey = await deriveKey(password, salt, envelope.kdfparams);
  try {
    const masterKey = await decryptAes256Gcm(
      ciphertext,
      derivedKey,
      nonce,
      MASTER_KEY_AAD,
    );
    if (masterKey.length !== MASTER_KEY_LENGTH) {
      masterKey.fill(0);
      throw new Error("Invalid wallet master key");
    }
    return masterKey;
  } catch (cause) {
    throw new Error("Invalid password", { cause });
  } finally {
    derivedKey.fill(0);
    salt.fill(0);
    nonce.fill(0);
    ciphertext.fill(0);
  }
}

async function deriveKey(
  password: string,
  salt: Bytes,
  parameters: SerializedMasterKeyEnvelope["kdfparams"],
): Promise<Bytes> {
  const passwordBytes = bytesFrom(password, "utf8");
  try {
    return await deriveArgon2id(passwordBytes, salt, parameters);
  } finally {
    passwordBytes.fill(0);
  }
}

function parseMasterKeyEnvelope(value: unknown): SerializedMasterKeyEnvelope {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid wallet master key");
  }
  const envelope = value as Partial<SerializedMasterKeyEnvelope>;
  const parameters = envelope.kdfparams;
  if (
    envelope.version !== 1 ||
    envelope.cipher !== "aes-256-gcm" ||
    envelope.kdf !== "argon2id" ||
    typeof envelope.ciphertext !== "string" ||
    !/^[0-9a-f]{96}$/i.test(envelope.ciphertext) ||
    typeof envelope.nonce !== "string" ||
    !/^[0-9a-f]{24}$/i.test(envelope.nonce) ||
    !parameters ||
    !Number.isSafeInteger(parameters.memory) ||
    parameters.memory < MIN_ARGON2_MEMORY_KIB ||
    parameters.memory > MAX_ARGON2_MEMORY_KIB ||
    !Number.isSafeInteger(parameters.iterations) ||
    parameters.iterations < MIN_ARGON2_ITERATIONS ||
    parameters.iterations > MAX_ARGON2_ITERATIONS ||
    !Number.isSafeInteger(parameters.parallelism) ||
    parameters.parallelism < MIN_ARGON2_PARALLELISM ||
    parameters.parallelism > MAX_ARGON2_PARALLELISM ||
    parameters.hashLength !== DERIVED_KEY_LENGTH ||
    parameters.version !== ARGON2_VERSION_13 ||
    typeof parameters.salt !== "string" ||
    !/^[0-9a-f]{64}$/i.test(parameters.salt)
  ) {
    throw new Error("Invalid wallet master key");
  }
  return envelope as SerializedMasterKeyEnvelope;
}

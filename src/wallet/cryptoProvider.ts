import { argon2, randomBytes, subtle } from "react-native-quick-crypto";

export const ARGON2_VERSION_13 = 0x13;

type Argon2idParameters = {
  memory: number;
  iterations: number;
  parallelism: number;
  hashLength: number;
  version: number;
};

export function secureRandomBytes(length: number): Uint8Array {
  const bytes = randomBytes(length);
  try {
    return Uint8Array.from(bytes);
  } finally {
    bytes.fill(0);
  }
}

export async function deriveArgon2id(
  password: Uint8Array,
  salt: Uint8Array,
  parameters: Argon2idParameters,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: password,
        nonce: salt,
        memory: parameters.memory,
        passes: parameters.iterations,
        parallelism: parameters.parallelism,
        tagLength: parameters.hashLength,
        version: parameters.version,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(Uint8Array.from(result));
        } finally {
          result.fill(0);
        }
      },
    );
  });
}

export async function encryptAes256Gcm(
  plaintext: Uint8Array,
  keyBytes: Uint8Array,
  nonce: Uint8Array,
  additionalData: Uint8Array,
): Promise<Uint8Array> {
  const key = await subtle.importKey(
    "raw",
    keyBytes,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  return new Uint8Array(
    await subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData,
        tagLength: 128,
      },
      key,
      plaintext,
    ),
  );
}

export async function decryptAes256Gcm(
  ciphertext: Uint8Array,
  keyBytes: Uint8Array,
  nonce: Uint8Array,
  additionalData: Uint8Array,
): Promise<Uint8Array> {
  const key = await subtle.importKey(
    "raw",
    keyBytes,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  return new Uint8Array(
    await subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData,
        tagLength: 128,
      },
      key,
      ciphertext,
    ),
  );
}

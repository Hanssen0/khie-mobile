import { beforeEach, describe, expect, it, vi } from "vitest";

const quickCrypto = vi.hoisted(() => ({
  argon2: vi.fn((
    _algorithm: string,
    {
      message,
      nonce,
    }: {
      message: Uint8Array;
      nonce: Uint8Array;
    },
    callback: (error: Error | null, result: Uint8Array) => void,
  ) => {
    const key = new Uint8Array(32);
    for (let index = 0; index < key.length; index += 1) {
      key[index] =
        message[index % message.length]! ^ nonce[index % nonce.length]! ^ index;
    }
    callback(null, key);
  }),
  randomBytes: vi.fn((length: number) =>
    Uint8Array.from({ length }, (_, index) => index + length),
  ),
}));

vi.mock("react-native-quick-crypto", async () => {
  const { webcrypto } = await import("node:crypto");
  return { ...quickCrypto, subtle: webcrypto.subtle };
});

import { decryptMasterKey, encryptMasterKey } from "./masterKeyEnvelope";

describe("master-key envelope", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records the Argon2id parameters used to wrap a 256-bit master key", async () => {
    const masterKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const serialized = await encryptMasterKey(masterKey, "test password");
    const envelope = JSON.parse(serialized) as Record<string, unknown>;

    expect(envelope).toMatchObject({
      cipher: "aes-256-gcm",
      ciphertext:
        "54a8ff48b8ccf77f7e383506096630fe99ec55d67bcefeaf254f3d99944c063ec6b705caf4ddc3c7592094e2e6a9e7bd",
      kdf: "argon2id",
      kdfparams: {
        hashLength: 32,
        iterations: 3,
        memory: 131_072,
        parallelism: 4,
        version: 0x13,
      },
      version: 1,
    });
    expect(quickCrypto.argon2).toHaveBeenCalledWith(
      "argon2id",
      expect.objectContaining({
        tagLength: 32,
        passes: 3,
        memory: 131_072,
        parallelism: 4,
        version: 0x13,
      }),
      expect.any(Function),
    );
    await expect(decryptMasterKey(serialized, "test password")).resolves.toEqual(
      masterKey,
    );
  });

  it("rejects an incorrect password credential", async () => {
    const serialized = await encryptMasterKey(new Uint8Array(32).fill(7), "right");
    await expect(decryptMasterKey(serialized, "wrong")).rejects.toThrow(
      "Invalid password",
    );
  });

  it("uses the KDF parameters recorded in the envelope", async () => {
    const envelope = JSON.parse(
      await encryptMasterKey(new Uint8Array(32).fill(7), "right"),
    ) as { kdfparams: { memory: number; parallelism: number } };
    envelope.kdfparams.memory = 196_608;
    envelope.kdfparams.parallelism = 2;
    await expect(decryptMasterKey(JSON.stringify(envelope), "right")).resolves.toEqual(
      new Uint8Array(32).fill(7),
    );
    expect(quickCrypto.argon2).toHaveBeenLastCalledWith(
      "argon2id",
      expect.objectContaining({ memory: 196_608, parallelism: 2 }),
      expect.any(Function),
    );
  });
});

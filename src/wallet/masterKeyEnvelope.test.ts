import { beforeEach, describe, expect, it, vi } from "vitest";

const argon2 = vi.hoisted(() => ({
  ARGON2_VERSION_13: 0x13,
  argon2id: vi.fn(async ({
    password,
    salt,
  }: {
    password: Uint8Array;
    salt: Uint8Array;
  }) => {
    const key = new Uint8Array(32);
    for (let index = 0; index < key.length; index += 1) {
      key[index] =
        password[index % password.length]! ^ salt[index % salt.length]! ^ index;
    }
    return key;
  }),
}));

const crypto = vi.hoisted(() => ({
  getRandomBytesAsync: vi.fn(async (length: number) =>
    Uint8Array.from({ length }, (_, index) => index + length),
  ),
}));

vi.mock("@sonnetstationsolutions/expo-argon2", () => argon2);
vi.mock("expo-crypto", () => crypto);

import { decryptMasterKey, encryptMasterKey } from "./masterKeyEnvelope";

describe("master-key envelope", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records the Argon2id parameters used to wrap a 256-bit master key", async () => {
    const masterKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const serialized = await encryptMasterKey(masterKey, "test password");
    const envelope = JSON.parse(serialized) as Record<string, unknown>;

    expect(envelope).toMatchObject({
      cipher: "aes-256-gcm",
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
    expect(argon2.argon2id).toHaveBeenCalledWith(
      expect.objectContaining({
        hashLength: 32,
        iterations: 3,
        memory: 131_072,
        parallelism: 4,
        version: 0x13,
      }),
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
    expect(argon2.argon2id).toHaveBeenLastCalledWith(
      expect.objectContaining({ memory: 196_608, parallelism: 2 }),
    );
  });
});

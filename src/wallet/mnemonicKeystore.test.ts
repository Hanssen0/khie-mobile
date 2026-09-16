import { beforeEach, describe, expect, it, vi } from "vitest";

const crypto = vi.hoisted(() => ({
  getRandomBytesAsync: vi.fn(async (length: number) =>
    Uint8Array.from({ length }, (_, index) => index + 1),
  ),
}));

vi.mock("expo-crypto", () => crypto);

import { decryptMnemonicKeystore, encryptMnemonicKeystore } from "./mnemonicKeystore";

const mnemonic =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const walletId = "wallet-1";

describe("mnemonic keystore", () => {
  beforeEach(() => vi.clearAllMocks());

  it("encrypts and decrypts a mnemonic with AES-256-GCM", async () => {
    const masterKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const serialized = await encryptMnemonicKeystore(mnemonic, masterKey, walletId);

    expect(JSON.parse(serialized)).toMatchObject({
      cipher: "aes-256-gcm",
      nonce: "0102030405060708090a0b0c",
      version: 1,
    });
    await expect(
      decryptMnemonicKeystore(serialized, masterKey, walletId),
    ).resolves.toBe(mnemonic);
  });

  it("binds the encrypted mnemonic to its wallet id", async () => {
    const masterKey = new Uint8Array(32).fill(7);
    const serialized = await encryptMnemonicKeystore(mnemonic, masterKey, walletId);

    await expect(
      decryptMnemonicKeystore(serialized, masterKey, "wallet-2"),
    ).rejects.toThrow("Invalid mnemonic keystore");
  });

  it("rejects a different master key", async () => {
    const serialized = await encryptMnemonicKeystore(
      mnemonic,
      new Uint8Array(32).fill(7),
      walletId,
    );
    await expect(
      decryptMnemonicKeystore(serialized, new Uint8Array(32).fill(8), walletId),
    ).rejects.toThrow("Invalid mnemonic keystore");
  });
});

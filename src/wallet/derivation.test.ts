import {
  ClientPublicMainnet,
  ClientPublicTestnet,
  Signer,
  SignerCkbPublicKey,
} from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";

import type { WalletVault } from "../storage/walletVault";
import { assertValidMnemonic, deriveAccount, mnemonicFromEntropy } from "./derivation";
import { LocalMnemonicSigningBackend } from "./localMnemonicBackend";

const mnemonic =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const publicKey =
  "0x0371e69290d7de7de8f8c3619f300ad27fdb96f4aa903e81e0d75a8dfcfaf285b4";

describe("BIP-39 CKB wallet", () => {
  it("creates a valid 12-word mnemonic from 128-bit entropy", () => {
    const generated = mnemonicFromEntropy(new Uint8Array(16));
    expect(generated).toBe(mnemonic);
    expect(assertValidMnemonic(generated)).toBe(generated);
  });

  it("accepts 12/24 words and rejects malformed English mnemonics", () => {
    expect(assertValidMnemonic(`  ${mnemonic.toUpperCase()}  `)).toBe(mnemonic);
    expect(() => assertValidMnemonic(mnemonic.replace("about", "zoo"))).toThrow();
    expect(() => assertValidMnemonic("abandon ".repeat(11))).toThrow();
  });

  it("matches the m/44'/309'/0'/0/0 fixed vector", () => {
    const derived = deriveAccount(mnemonic);
    expect(derived.account.publicKey).toBe(publicKey);
    expect(Buffer.from(derived.privateKey).toString("hex")).toBe(
      "b217d9a18ff657c99872cc11a2fa2aa3e970cef8c6faa7d6e424bf057cb3707b",
    );
  });

  it("produces the expected mainnet and testnet addresses", async () => {
    const testnet = new SignerCkbPublicKey(new ClientPublicTestnet(), publicKey);
    const mainnet = new SignerCkbPublicKey(new ClientPublicMainnet(), publicKey);
    expect(await testnet.getRecommendedAddress()).toBe(
      "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqgedakp7g0hm0cdlq298xuyqpvl4ja0cfqenlarn",
    );
    expect(await mainnet.getRecommendedAddress()).toBe(
      "ckb1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqgedakp7g0hm0cdlq298xuyqpvl4ja0cfqhp5jft",
    );
  });

  it("signs and verifies a message through the backend boundary", async () => {
    const vault = vaultWithMnemonic(mnemonic);
    const backend = new LocalMnemonicSigningBackend(deriveAccount(mnemonic).account, vault);
    const signer = backend.getReadOnlySigner(new ClientPublicTestnet());
    const signature = await backend.withSigner(signer.client, "message", (unlocked) =>
      unlocked.signMessage("hello khie"),
    );
    expect(await Signer.verifyMessage("hello khie", signature)).toBe(true);
  });

  it("does not retry or mask vault invalidation", async () => {
    const vault = vaultWithMnemonic(mnemonic);
    vault.readMnemonic = async () => {
      throw new Error("wallet key invalidated");
    };
    const backend = new LocalMnemonicSigningBackend(deriveAccount(mnemonic).account, vault);
    await expect(
      backend.withSigner(new ClientPublicTestnet(), "message", async () => "unused"),
    ).rejects.toThrow("wallet key invalidated");
  });
});

function vaultWithMnemonic(value: string): WalletVault {
  return {
    clear: async () => {},
    loadProfile: async () => undefined,
    readMnemonic: async () => value,
    save: async () => {},
  };
}

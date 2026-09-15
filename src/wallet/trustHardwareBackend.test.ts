import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  bytesFrom,
  hexFrom,
  recoverMessageSecp256k1,
  signMessageSecp256k1,
} from "@ckb-ccc/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("../trust/native", () => ({ signWithTrustWallet: vi.fn() }));

import { TrustHardwareSigningBackend } from "./trustHardwareBackend";
import {
  normalizeTrustPublicKey,
  normalizeTrustSignature,
  prepareTrustKeyImport,
} from "./trustSignature";

describe("Trust hardware wallet signature adapter", () => {
  const privateKey = bytesFrom(
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  );
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  const uncompressed = secp256k1.getPublicKey(privateKey, false).subarray(1);
  const digest = bytesFrom(
    "0xa5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5",
  );

  it("compresses the 64-byte public key returned by Trust", () => {
    expect(normalizeTrustPublicKey(uncompressed)).toBe(hexFrom(publicKey));
  });

  it("adds the CKB recovery byte to a raw Trust signature", () => {
    const ckbSignature = signMessageSecp256k1(digest, privateKey);
    const rawSignature = bytesFrom(ckbSignature).subarray(0, 64);
    const normalized = normalizeTrustSignature(rawSignature, digest, uncompressed);

    expect(recoverMessageSecp256k1(digest, normalized)).toBe(hexFrom(publicKey));
  });

  it("derives the uncompressed device public key for imports", () => {
    expect(prepareTrustKeyImport(hexFrom(privateKey))).toEqual({
      privateKey: hexFrom(privateKey),
      publicKey: hexFrom(uncompressed),
    });
  });

  it("rejects malformed or invalid private keys before import", () => {
    expect(() => prepareTrustKeyImport("1234")).toThrow("32 bytes");
    expect(() => prepareTrustKeyImport(`0x${"00".repeat(32)}`)).toThrow();
  });

  it("releases the device connection after each signing request", async () => {
    const releaseConnection = vi.fn(async () => undefined);
    const reportError = vi.fn();
    const backend = new TrustHardwareSigningBackend(
      {
        id: "80:EA:D3:5B:DB:11",
        name: "Cryptape Trust",
        publicKey: hexFrom(uncompressed),
      },
      async () => "12345678",
      releaseConnection,
      reportError,
    );

    await expect(
      backend.withSigner(null as never, "message", async () => "signed"),
    ).resolves.toBe("signed");
    await expect(
      backend.withSigner(null as never, "transaction", async () => {
        throw new Error("Signing failed");
      }),
    ).rejects.toThrow("Signing failed");

    expect(releaseConnection).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "Signing failed" }));
  });
});

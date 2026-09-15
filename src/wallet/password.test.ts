import { describe, expect, it, vi } from "vitest";

const crypto = vi.hoisted(() => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: vi.fn(async () =>
    "15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225"
  ),
}));

vi.mock("expo-crypto", () => crypto);

import {
  assertWalletPassword,
  deriveWalletPasswordCredential,
} from "./password";

describe("wallet master password", () => {
  it("requires at least eight characters without strength rules", () => {
    expect(() => assertWalletPassword("1234567")).toThrow();
    expect(assertWalletPassword("12345678")).toBe("12345678");
    expect(assertWalletPassword("aaaaaaaa")).toBe("aaaaaaaa");
  });

  it("derives a deterministic SHA-256 credential", async () => {
    await expect(deriveWalletPasswordCredential("123456789")).resolves.toBe(
      "sha256:15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225",
    );
    expect(crypto.digestStringAsync).toHaveBeenCalledWith(
      "SHA-256",
      "123456789",
    );
  });
});

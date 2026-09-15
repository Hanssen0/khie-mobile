import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesFrom, hexFrom, type Hex, type HexLike } from "@ckb-ccc/core";

const SECP256K1_ORDER = BigInt(
  "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
);

export function normalizeTrustPublicKey(value: HexLike): Hex {
  const bytes = bytesFrom(value);
  if (bytes.length === 33 && (bytes[0] === 2 || bytes[0] === 3)) {
    return hexFrom(bytes);
  }
  const uncompressed = bytes.length === 65 && bytes[0] === 4 ? bytes.subarray(1) : bytes;
  if (uncompressed.length !== 64) {
    throw new Error("Cryptape Trust returned an invalid public key");
  }
  const compressed = new Uint8Array(33);
  compressed[0] = (uncompressed[63]! & 1) === 0 ? 2 : 3;
  compressed.set(uncompressed.subarray(0, 32), 1);
  secp256k1.Point.fromBytes(compressed).assertValidity();
  return hexFrom(compressed);
}

export function prepareTrustKeyImport(value: string): {
  privateKey: Hex;
  publicKey: Hex;
} {
  const normalized = value.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("Cryptape Trust private key must contain 32 bytes");
  }
  const privateKey = bytesFrom(`0x${normalized}`);
  const uncompressed = secp256k1.getPublicKey(privateKey, false);
  return {
    privateKey: hexFrom(privateKey),
    publicKey: hexFrom(uncompressed.subarray(1)),
  };
}

export function normalizeTrustSignature(
  value: HexLike,
  digest: HexLike,
  expectedPublicKey: HexLike,
): Hex {
  const signatureBytes = bytesFrom(value);
  const parsed = secp256k1.Signature.fromBytes(
    signatureBytes,
    signatureBytes.length === 64 ? "compact" : "der",
  );
  const signature = parsed.hasHighS()
    ? new secp256k1.Signature(parsed.r, SECP256K1_ORDER - parsed.s)
    : parsed;
  const compact = signature.toBytes("compact");
  const message = bytesFrom(digest);
  const expected = bytesFrom(normalizeTrustPublicKey(expectedPublicKey));

  for (let recovery = 0; recovery < 4; recovery += 1) {
    try {
      const recovered = signature.addRecoveryBit(recovery).recoverPublicKey(message);
      const publicKey = recovered.toBytes(true);
      if (publicKey.every((byte, index) => byte === expected[index])) {
        const result = new Uint8Array(65);
        result.set(compact);
        result[64] = recovery;
        return hexFrom(result);
      }
    } catch {
      // Not every recovery id represents a valid curve point.
    }
  }
  throw new Error("Cryptape Trust signature does not match the connected device");
}

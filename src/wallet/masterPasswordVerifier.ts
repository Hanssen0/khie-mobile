import {
  bytesConcat,
  type Bytes,
} from "@ckb-ccc/core";

import { decryptKeystore, encryptKeystore } from "./keystore";

const VERIFIER_PAYLOAD = Uint8Array.from([
  0x4b, 0x48, 0x49, 0x45, 0x5f, 0x4d, 0x41, 0x53,
  0x54, 0x45, 0x52, 0x5f, 0x50, 0x41, 0x53, 0x53,
  0x57, 0x4f, 0x52, 0x44, 0x5f, 0x56, 0x45, 0x52,
  0x49, 0x46, 0x49, 0x45, 0x52, 0x5f, 0x56, 0x31,
]);

export async function createMasterPasswordVerifier(
  passwordCredential: string,
): Promise<string> {
  const payload = new Uint8Array(64);
  payload.set(VERIFIER_PAYLOAD);
  try {
    return JSON.stringify(
      await encryptKeystore(
        payload.subarray(0, 32),
        payload.subarray(32),
        passwordCredential,
      ),
    );
  } finally {
    payload.fill(0);
  }
}

export async function verifyMasterPasswordCredential(
  serializedVerifier: string,
  passwordCredential: string,
): Promise<boolean> {
  let privateKey: Bytes | undefined;
  let chainCode: Bytes | undefined;
  let payload: Bytes | undefined;
  try {
    ({ privateKey, chainCode } = await decryptKeystore(
      JSON.parse(serializedVerifier),
      passwordCredential,
    ));
    payload = bytesConcat(privateKey, chainCode);
    return VERIFIER_PAYLOAD.every((value, index) => payload?.[index] === value);
  } catch {
    return false;
  } finally {
    privateKey?.fill(0);
    chainCode?.fill(0);
    payload?.fill(0);
  }
}

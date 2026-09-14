import type { Client, Signer } from "@ckb-ccc/core";

export const CKB_DERIVATION_PATH = "m/44'/309'/0'/0/0";

export type Network = "testnet" | "mainnet";
export type SigningCapability = "message" | "transaction";

export type AccountDescriptor = {
  derivationPath: typeof CKB_DERIVATION_PATH;
  publicKey: string;
};

export type WalletProfile = AccountDescriptor & {
  createdAt: string;
  version: 1;
};

export type SigningPurpose = "message" | "transaction";

export interface SigningBackend {
  readonly account: AccountDescriptor;
  readonly capabilities: ReadonlySet<SigningCapability>;
  getReadOnlySigner(client: Client): Signer;
  withSigner<T>(
    client: Client,
    purpose: SigningPurpose,
    operation: (signer: Signer) => Promise<T>,
  ): Promise<T>;
}

export interface ExportableSigningBackend extends SigningBackend {
  exportMnemonic(): Promise<string>;
  exportPrivateKey(): Promise<string>;
}

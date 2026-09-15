import type { Client, Signer } from "@ckb-ccc/core";

export const CKB_DERIVATION_PATH = "m/44'/309'/0'/0/0";

export type Network = "testnet" | "mainnet";
export type SigningCapability = "message" | "transaction";

export type AccountDescriptor = {
  derivationPath: typeof CKB_DERIVATION_PATH;
  publicKey: string;
};

export type SigningAccountDescriptor = {
  derivationPath?: typeof CKB_DERIVATION_PATH;
  publicKey: string;
};

export type MnemonicWalletProfile = AccountDescriptor & {
  id: string;
  createdAt: string;
  kind: "mnemonic";
  version: 3;
};

export type CryptapeTrustWalletProfile = {
  id: string;
  createdAt: string;
  deviceId: string;
  kind: "cryptape-trust";
  name: string;
  publicKey?: string;
  version: 3;
};

export type WalletProfile = MnemonicWalletProfile | CryptapeTrustWalletProfile;

export type WalletState = {
  selectedWalletId?: string;
  wallets: WalletProfile[];
  version: 3;
};

export type SigningPurpose = "message" | "transaction";

export interface SigningBackend {
  readonly account: SigningAccountDescriptor;
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

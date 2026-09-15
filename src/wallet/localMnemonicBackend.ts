import {
  SignerCkbPrivateKey,
  SignerCkbPublicKey,
  hexFrom,
  type Client,
  type Signer,
} from "@ckb-ccc/core";

import { LocalizedError } from "../errors";
import type { WalletAuthenticationPurpose } from "../storage/walletVault";
import { deriveAccount } from "./derivation";
import type {
  AccountDescriptor,
  ExportableSigningBackend,
  SigningCapability,
  SigningPurpose,
} from "./types";

const capabilities = new Set<SigningCapability>(["message", "transaction"]);

export class LocalMnemonicSigningBackend implements ExportableSigningBackend {
  readonly capabilities = capabilities;

  constructor(
    readonly account: AccountDescriptor,
    private readonly unlock: (
      purpose: WalletAuthenticationPurpose,
    ) => Promise<string>,
  ) {}

  getReadOnlySigner(client: Client): Signer {
    return new SignerCkbPublicKey(client, this.account.publicKey);
  }

  async withSigner<T>(
    client: Client,
    purpose: SigningPurpose,
    operation: (signer: Signer) => Promise<T>,
  ): Promise<T> {
    const mnemonic = await this.unlock(
      purpose === "message" ? "signMessage" : "signTransaction",
    );
    const { account, privateKey } = deriveAccount(mnemonic);
    try {
      if (account.publicKey !== this.account.publicKey) {
        throw new LocalizedError(
          "mnemonicMismatch",
          "The mnemonic does not match this account",
        );
      }
      return await operation(new SignerCkbPrivateKey(client, privateKey));
    } finally {
      privateKey.fill(0);
    }
  }

  exportMnemonic(): Promise<string> {
    return this.unlock("viewMnemonic");
  }

  async exportPrivateKey(): Promise<string> {
    const mnemonic = await this.unlock("viewPrivateKey");
    const { privateKey } = deriveAccount(mnemonic);
    try {
      return hexFrom(privateKey);
    } finally {
      privateKey.fill(0);
    }
  }
}

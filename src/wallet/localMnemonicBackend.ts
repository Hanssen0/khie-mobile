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
      signal?: AbortSignal,
    ) => Promise<string>,
    private readonly request?: {
      signal: AbortSignal;
      validate: () => void;
    },
  ) {}

  forRequest(signal: AbortSignal, validate: () => void): LocalMnemonicSigningBackend {
    return new LocalMnemonicSigningBackend(this.account, this.unlock, {
      signal,
      validate,
    });
  }

  getReadOnlySigner(client: Client): Signer {
    return new SignerCkbPublicKey(client, this.account.publicKey);
  }

  async withSigner<T>(
    client: Client,
    purpose: SigningPurpose,
    operation: (signer: Signer) => Promise<T>,
  ): Promise<T> {
    this.assertRequestValid();
    const mnemonic = await this.unlock(
      purpose === "message" ? "signMessage" : "signTransaction",
      this.request?.signal,
    );
    this.assertRequestValid();
    const { account, privateKey } = deriveAccount(mnemonic);
    try {
      if (account.publicKey !== this.account.publicKey) {
        throw new LocalizedError(
          "mnemonicMismatch",
          "The mnemonic does not match this account",
        );
      }
      this.assertRequestValid();
      const result = await operation(new SignerCkbPrivateKey(client, privateKey));
      this.assertRequestValid();
      return result;
    } finally {
      privateKey.fill(0);
    }
  }

  async exportMnemonic(): Promise<string> {
    this.assertRequestValid();
    const mnemonic = await this.unlock("viewMnemonic", this.request?.signal);
    this.assertRequestValid();
    return mnemonic;
  }

  async exportPrivateKey(): Promise<string> {
    this.assertRequestValid();
    const mnemonic = await this.unlock("viewPrivateKey", this.request?.signal);
    this.assertRequestValid();
    const { privateKey } = deriveAccount(mnemonic);
    try {
      return hexFrom(privateKey);
    } finally {
      privateKey.fill(0);
    }
  }

  private assertRequestValid(): void {
    this.request?.signal.throwIfAborted();
    this.request?.validate();
  }
}

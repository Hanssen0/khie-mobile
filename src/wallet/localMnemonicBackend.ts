import {
  SignerCkbPrivateKey,
  SignerCkbPublicKey,
  hexFrom,
  type Client,
  type Signer,
} from "@ckb-ccc/core";

import type { WalletVault } from "../storage/walletVault";
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
    private readonly vault: WalletVault,
  ) {}

  getReadOnlySigner(client: Client): Signer {
    return new SignerCkbPublicKey(client, this.account.publicKey);
  }

  async withSigner<T>(
    client: Client,
    purpose: SigningPurpose,
    operation: (signer: Signer) => Promise<T>,
  ): Promise<T> {
    const label = purpose === "message" ? "签名消息" : "签名交易";
    const mnemonic = await this.vault.readMnemonic(`验证身份以${label}`);
    const { account, privateKey } = deriveAccount(mnemonic);
    try {
      if (account.publicKey !== this.account.publicKey) {
        throw new Error("助记词与当前账户不匹配");
      }
      return await operation(new SignerCkbPrivateKey(client, privateKey));
    } finally {
      privateKey.fill(0);
    }
  }

  exportMnemonic(): Promise<string> {
    return this.vault.readMnemonic("验证身份以查看助记词");
  }

  async exportPrivateKey(): Promise<string> {
    const mnemonic = await this.vault.readMnemonic("验证身份以查看私钥");
    const { privateKey } = deriveAccount(mnemonic);
    try {
      return hexFrom(privateKey);
    } finally {
      privateKey.fill(0);
    }
  }
}

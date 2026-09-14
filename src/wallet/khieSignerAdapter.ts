import {
  Signer,
  type Address,
  type BytesLike,
  type SignerSignType,
  type SignerType,
  type Transaction,
  type TransactionLike,
} from "@ckb-ccc/core";

import type { SigningBackend } from "./types";

export class KhieSignerAdapter extends Signer {
  private readonly reader: Signer;

  constructor(
    client: Signer["client"],
    private readonly backend: SigningBackend,
  ) {
    super(client);
    this.reader = backend.getReadOnlySigner(client);
  }

  override get type(): SignerType {
    return this.reader.type;
  }

  override get signType(): SignerSignType {
    return this.reader.signType;
  }

  override connect(): Promise<void> {
    return Promise.resolve();
  }

  override isConnected(): Promise<boolean> {
    return Promise.resolve(true);
  }

  override getInternalAddress(): Promise<string> {
    return this.reader.getInternalAddress();
  }

  override getIdentity(): Promise<string> {
    return this.reader.getIdentity();
  }

  override getAddressObjs(): Promise<Address[]> {
    return this.reader.getAddressObjs();
  }

  override getRecommendedAddressObj(preference?: unknown): Promise<Address> {
    return this.reader.getRecommendedAddressObj(preference);
  }

  override prepareTransaction(tx: TransactionLike): Promise<Transaction> {
    return this.reader.prepareTransaction(tx);
  }

  override signMessageRaw(message: string | BytesLike): Promise<string> {
    return this.backend.withSigner(this.client, "message", (signer) =>
      signer.signMessageRaw(message),
    );
  }

  override signOnlyTransaction(tx: TransactionLike): Promise<Transaction> {
    return this.backend.withSigner(this.client, "transaction", (signer) =>
      signer.signOnlyTransaction(tx),
    );
  }
}

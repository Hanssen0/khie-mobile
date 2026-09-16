import {
  SignerCkbPublicKey,
  Transaction,
  WitnessArgs,
  hexFrom,
  messageHashCkbSecp256k1,
  type BytesLike,
  type Client,
  type Hex,
  type HexLike,
  type Signer,
  type TransactionLike,
} from "@ckb-ccc/core";

import { LocalizedError } from "../errors";
import { signWithTrustWallet, type ConnectedTrustDevice } from "../trust/native";
import type {
  SigningAccountDescriptor,
  SigningBackend,
  SigningCapability,
  SigningPurpose,
} from "./types";
import { normalizeTrustPublicKey, normalizeTrustSignature } from "./trustSignature";

const capabilities = new Set<SigningCapability>(["message", "transaction"]);

export type RequestTrustPin = (
  purpose: SigningPurpose | "connect" | "keyManagement",
  signal?: AbortSignal,
) => Promise<string>;

class SignerCkbTrustWallet extends SignerCkbPublicKey {
  constructor(
    client: Client,
    publicKey: HexLike,
    private readonly pin: string,
  ) {
    super(client, publicKey);
  }

  async _signMessage(message: HexLike): Promise<Hex> {
    const signature = await signWithTrustWallet(hexFrom(message), this.pin);
    return normalizeTrustSignature(signature, message, this.publicKey);
  }

  override async signMessageRaw(message: string | BytesLike): Promise<Hex> {
    return this._signMessage(messageHashCkbSecp256k1(message));
  }

  override async signOnlyTransaction(txLike: TransactionLike): Promise<Transaction> {
    const tx = Transaction.from(txLike);
    for (const { script } of await this.getRelatedScripts(tx)) {
      const info = await tx.getSignHashInfo(script, this.client);
      if (!info) return tx;
      const witness = tx.getWitnessArgs(info.position) ?? WitnessArgs.from({});
      witness.lock = await this._signMessage(info.message);
      tx.setWitnessArgs(info.position, witness);
    }
    return tx;
  }
}

export class TrustHardwareSigningBackend implements SigningBackend {
  readonly capabilities = capabilities;
  readonly account: SigningAccountDescriptor;

  constructor(
    readonly device: ConnectedTrustDevice & { publicKey: string },
    private readonly requestPin: RequestTrustPin,
    private readonly releaseConnection?: () => Promise<void>,
    private readonly reportError?: (cause: unknown) => void,
    private readonly request?: {
      signal: AbortSignal;
      validate: () => void;
    },
  ) {
    this.account = { publicKey: normalizeTrustPublicKey(device.publicKey) };
  }

  forRequest(signal: AbortSignal, validate: () => void): TrustHardwareSigningBackend {
    return new TrustHardwareSigningBackend(
      this.device,
      this.requestPin,
      this.releaseConnection,
      this.reportError,
      { signal, validate },
    );
  }

  getReadOnlySigner(client: Client): Signer {
    return new SignerCkbPublicKey(client, this.account.publicKey);
  }

  async withSigner<T>(
    client: Client,
    purpose: SigningPurpose,
    operation: (signer: Signer) => Promise<T>,
  ): Promise<T> {
    try {
      this.assertRequestValid();
      const pin = await this.requestPin(purpose, this.request?.signal);
      this.assertRequestValid();
      if (!/^\d{8}$/.test(pin)) {
        throw new LocalizedError(
          "trustPinInvalid",
          "Cryptape Trust PIN must contain 8 digits",
        );
      }
      this.assertRequestValid();
      const result = await operation(
        new SignerCkbTrustWallet(client, this.account.publicKey, pin),
      );
      this.assertRequestValid();
      return result;
    } catch (cause) {
      this.reportError?.(cause);
      throw cause;
    } finally {
      await this.releaseConnection?.().catch(() => undefined);
    }
  }

  private assertRequestValid(): void {
    this.request?.signal.throwIfAborted();
    this.request?.validate();
  }
}

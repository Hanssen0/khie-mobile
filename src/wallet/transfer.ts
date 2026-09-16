import {
  Address,
  CellOutput,
  Transaction,
  Zero,
  fixedPointFrom,
  type Num,
  type Signer,
  type Transaction as CkbTransaction,
} from "@ckb-ccc/core";

export const ECONOMY_FEE_RATE = 1_000n;
export const MIN_CUSTOM_FEE_RATE = ECONOMY_FEE_RATE;
export const MAX_CUSTOM_FEE_RATE = 10_000_000n;

export type TransferFeeOption = "economy" | "auto" | "custom";

export function parseCkbAmount(value: string): Num | undefined {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(normalized)) return undefined;
  const amount = fixedPointFrom(normalized);
  return amount > Zero ? amount : undefined;
}

export function customFeeRate(value: string): Num | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const rate = BigInt(value);
  return rate >= MIN_CUSTOM_FEE_RATE && rate <= MAX_CUSTOM_FEE_RATE
    ? rate
    : undefined;
}

export function selectedFeeRate(
  option: TransferFeeOption,
  customRate: string,
): Num | undefined {
  if (option === "economy") return ECONOMY_FEE_RATE;
  if (option === "auto") return undefined;
  return customFeeRate(customRate);
}

export async function prepareTransfer(
  signer: Signer,
  recipient: string,
  capacity: Num,
  feeRate?: Num,
): Promise<CkbTransaction> {
  const { script: lock } = await Address.fromString(recipient.trim(), signer.client);
  const transaction = Transaction.from({ outputs: [{ capacity, lock }] });
  await transaction.completeInputsByCapacity(signer);
  await transaction.completeFeeBy(signer, feeRate);
  return transaction;
}

export async function prepareMaximumTransfer(
  signer: Signer,
  recipient: string,
  feeRate: Num,
): Promise<Num> {
  const { script: lock } = await Address.fromString(recipient.trim(), signer.client);
  const transaction = Transaction.from({ outputs: [{ capacity: Zero, lock }] });

  await transaction.completeInputsAll(signer);
  const prepared = await signer.prepareTransaction(transaction);
  const inputCapacity = await prepared.getInputsCapacity(signer.client);
  const amount = inputCapacity - prepared.estimateFee(feeRate);
  const minimumCapacity = fixedPointFrom(
    CellOutput.from({ capacity: Zero, lock }).occupiedSize,
  );
  if (amount < minimumCapacity) {
    throw new Error("Insufficient capacity for a recipient cell");
  }

  const recipientOutput = prepared.outputs[0];
  if (!recipientOutput) {
    throw new Error("Recipient output is missing");
  }
  recipientOutput.capacity = amount;
  return amount;
}

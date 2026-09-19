import { Zero, type CellOutput, type Num, type Script } from "@ckb-ccc/core";

export type TransferSummary = {
  /** CKB leaving this wallet, grouped by recipient lock. */
  outgoing: { lock: Script; capacity: Num }[];
  /** Own outputs minus own inputs; undefined while any input is unresolved. */
  netChange?: Num;
  /** Any cell carries a type script, so capacity alone does not describe the transaction. */
  involvesTypeScripts: boolean;
};

export function summarizeTransfer(
  inputs: { cellOutput?: CellOutput; extraCapacity?: Num }[],
  outputs: CellOutput[],
  ownLocks: Script[],
): TransferSummary {
  const own = (lock: Script) => ownLocks.some((item) => item.eq(lock));
  let netChange: Num | undefined = Zero;
  for (const { cellOutput, extraCapacity } of inputs) {
    if (!cellOutput) netChange = undefined;
    else if (netChange !== undefined && own(cellOutput.lock)) netChange -= cellOutput.capacity + (extraCapacity ?? Zero);
  }
  const outgoing = new Map<string, { lock: Script; capacity: Num }>();
  for (const output of outputs) {
    if (own(output.lock)) {
      if (netChange !== undefined) netChange += output.capacity;
      continue;
    }
    const key = output.lock.hash();
    outgoing.set(key, { lock: output.lock, capacity: (outgoing.get(key)?.capacity ?? Zero) + output.capacity });
  }
  const involvesTypeScripts = [...inputs.map(({ cellOutput }) => cellOutput), ...outputs].some((cell) => cell?.type);
  return { outgoing: [...outgoing.values()], netChange, involvesTypeScripts };
}

import { Zero, type CellOutput, type Num, type Script } from "@ckb-ccc/core";

export type TransferSummary = {
  /** CKB leaving this wallet, grouped by recipient lock. */
  outgoing: { lock: Script; capacity: Num }[];
  /** Own outputs minus own inputs; undefined while any input is unresolved. */
  netChange?: Num;
  /** Capacity contributed by inputs that do not belong to this wallet. */
  otherParticipantsInputCapacity: Num;
  /** Any cell carries a type script or output data, so capacity alone does not describe the transaction. */
  involvesSpecialData: boolean;
};

export function summarizeTransfer(
  inputs: { cellOutput?: CellOutput; extraCapacity?: Num; outputData?: string }[],
  outputs: CellOutput[],
  ownLocks: Script[],
  outputsData: string[] = [],
): TransferSummary {
  const own = (lock: Script) => ownLocks.some((item) => item.eq(lock));
  let netChange: Num | undefined = Zero;
  let otherParticipantsInputCapacity = Zero;
  for (const { cellOutput, extraCapacity } of inputs) {
    if (!cellOutput) netChange = undefined;
    else {
      const capacity = cellOutput.capacity + (extraCapacity ?? Zero);
      if (own(cellOutput.lock)) {
        if (netChange !== undefined) netChange -= capacity;
      } else {
        otherParticipantsInputCapacity += capacity;
      }
    }
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
  const hasOutputData = (data: string | undefined) => data !== undefined && data !== "0x";
  const involvesSpecialData =
    [...inputs.map(({ cellOutput }) => cellOutput), ...outputs].some((cell) => cell?.type) ||
    inputs.some(({ outputData }) => hasOutputData(outputData)) ||
    outputsData.some(hasOutputData);
  return { outgoing: [...outgoing.values()], netChange, otherParticipantsInputCapacity, involvesSpecialData };
}

import { CellOutput, Script } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";

import { summarizeTransfer } from "./transactionSummary";

const lock = (args: string) => Script.from({ codeHash: `0x${"11".repeat(32)}`, hashType: "type", args });
const cell = (capacity: bigint, owner: Script, type?: Script) => CellOutput.from({ capacity, lock: owner, type });
const me = lock("0x01");
const alice = lock("0x02");

describe("transfer summary", () => {
  it("groups outgoing CKB by recipient and nets own change against own inputs", () => {
    const summary = summarizeTransfer(
      [{ cellOutput: cell(1_000n, me) }, { cellOutput: cell(500n, me) }],
      [cell(300n, alice), cell(200n, alice), cell(990n, me)],
      [me],
    );
    expect(summary.outgoing).toHaveLength(1);
    expect(summary.outgoing[0]?.capacity).toBe(500n);
    expect(summary.netChange).toBe(-510n);
    expect(summary.involvesTypeScripts).toBe(false);
  });

  it("counts DAO compensation as part of an own input", () => {
    const summary = summarizeTransfer([{ cellOutput: cell(1_000n, me), extraCapacity: 20n }], [cell(1_019n, me)], [me]);
    expect(summary.outgoing).toHaveLength(0);
    expect(summary.netChange).toBe(-1n);
  });

  it("gives up on the net change when an input is unresolved and flags type scripts", () => {
    const summary = summarizeTransfer([{}], [cell(100n, alice, lock("0x03"))], [me]);
    expect(summary.netChange).toBeUndefined();
    expect(summary.involvesTypeScripts).toBe(true);
  });
});

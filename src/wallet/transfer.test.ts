import { describe, expect, it } from "vitest";

import {
  ECONOMY_FEE_RATE,
  MAX_CUSTOM_FEE_RATE,
  MIN_CUSTOM_FEE_RATE,
  customFeeRate,
  parseCkbAmount,
  selectedFeeRate,
} from "./transfer";

describe("transfer inputs", () => {
  it("parses CKB amounts without losing shannon precision", () => {
    expect(parseCkbAmount("1.23456789")).toBe(123_456_789n);
    expect(parseCkbAmount("0")).toBeUndefined();
    expect(parseCkbAmount("1.234567891")).toBeUndefined();
  });

  it("uses CCC Connector's Economy, Auto and Custom fee semantics", () => {
    expect(selectedFeeRate("economy", "")).toBe(ECONOMY_FEE_RATE);
    expect(selectedFeeRate("auto", "")).toBeUndefined();
    expect(customFeeRate(String(MIN_CUSTOM_FEE_RATE))).toBe(MIN_CUSTOM_FEE_RATE);
    expect(customFeeRate(String(MAX_CUSTOM_FEE_RATE))).toBe(MAX_CUSTOM_FEE_RATE);
    expect(customFeeRate("999")).toBeUndefined();
    expect(customFeeRate("10000001")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import { assertWalletPassword } from "./password";

describe("wallet master password", () => {
  it("requires at least eight characters without strength rules", () => {
    expect(() => assertWalletPassword("1234567")).toThrow();
    expect(assertWalletPassword("12345678")).toBe("12345678");
    expect(assertWalletPassword("aaaaaaaa")).toBe("aaaaaaaa");
  });
});

import { describe, expect, it } from "vitest";

import { assertTxConfirmed, mapTxError } from "./errors";

// waitForTransactionReceipt resolves even when the transaction reverted
// on-chain. Seller/mint flows call assertTxConfirmed inside wait() so a
// reverted receipt surfaces as a mapped CONTRACT_REVERT failure instead of a
// false success (FR-003, US2.5).
describe("assertTxConfirmed", () => {
  it("passes when the receipt status is success", () => {
    expect(() => assertTxConfirmed({ status: "success" })).not.toThrow();
  });

  it("throws when the receipt status is reverted", () => {
    expect(() => assertTxConfirmed({ status: "reverted" })).toThrow(/execution reverted/);
  });

  it("throws when the receipt is missing or has no status", () => {
    expect(() => assertTxConfirmed(null)).toThrow(/execution reverted/);
    expect(() => assertTxConfirmed(undefined)).toThrow(/execution reverted/);
    expect(() => assertTxConfirmed({})).toThrow(/execution reverted/);
  });

  it("maps the thrown error to CONTRACT_REVERT for display", () => {
    let thrown: unknown;
    try {
      assertTxConfirmed({ status: "reverted" });
    } catch (error) {
      thrown = error;
    }
    expect(mapTxError(thrown)).toMatchObject({ code: "CONTRACT_REVERT" });
  });
});

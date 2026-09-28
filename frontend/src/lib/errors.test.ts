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

// T067: the purchase action must never fail silently - every failure path,
// including a confirmation with no RPC client behind it, maps to plain copy.
describe("mapTxError (T067, FR-003/FR-020 purchase paths)", () => {
  it("maps a missing network client during confirmation to RPC_ERROR copy", () => {
    const mapped = mapTxError(new Error("Network client unavailable"));
    expect(mapped.code).toBe("RPC_ERROR");
    expect(mapped.what).toMatch(/network did not respond/i);
    expect(mapped.next).toMatch(/check your internet connection/i);
    // FR-003: plain language only - never raw error strings or hex.
    expect(mapped.what + mapped.next).not.toMatch(/0x[0-9a-f]{6,}/i);
    expect(mapped.what + mapped.next).not.toMatch(/network client unavailable/i);
  });

  it("still falls back to UNKNOWN plain copy for unmatched failures", () => {
    const mapped = mapTxError(new Error("something exotic exploded"));
    expect(mapped.code).toBe("UNKNOWN");
    expect(mapped.what.length).toBeGreaterThan(0);
    expect(mapped.next.length).toBeGreaterThan(0);
  });
});

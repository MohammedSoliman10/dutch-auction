import { describe, expect, it } from "vitest";

import { computePrice, deriveStatus, isPurchasable } from "./price";
import type { AuctionFlags, AuctionParams } from "./price";

// data-model.md section 1.2: price(auction, now) =
// startingPrice - discountRate * min(now - startAt, duration), clamped >= 0.
const params: AuctionParams = {
  startingPrice: 100n,
  discountRate: 1n,
  duration: 100n,
  startAt: 1_000n,
  expiresAt: 1_100n,
};

const liveFlags: AuctionFlags = {
  sold: false,
  cancelled: false,
  expiresAt: params.expiresAt,
};

describe("computePrice (T030)", () => {
  it("equals the starting price at startAt", () => {
    expect(computePrice(params, 1_000n)).toBe(100n);
  });

  it("decays by discountRate per second of elapsed time", () => {
    expect(computePrice(params, 1_050n)).toBe(50n);
  });

  it("clamps elapsed at duration so the price freezes at expiry (FR-005)", () => {
    const frozen: AuctionParams = {
      startingPrice: 200n,
      discountRate: 1n,
      duration: 100n,
      startAt: 1_000n,
      expiresAt: 1_100n,
    };
    // elapsed == duration keeps 200 - 100 = 100 (min(elapsed, duration)),
    // and later instants must not decay any further.
    expect(computePrice(frozen, 1_100n)).toBe(100n);
    expect(computePrice(frozen, 1_150n)).toBe(100n);
  });

  it("never returns a negative value when the floor is hit before expiry", () => {
    const earlyFloor: AuctionParams = {
      startingPrice: 10n,
      discountRate: 1n,
      duration: 100n,
      startAt: 1_000n,
      expiresAt: 1_100n,
    };
    expect(computePrice(earlyFloor, 1_010n)).toBe(0n);
    expect(computePrice(earlyFloor, 1_150n)).toBe(0n);
  });

  it("never reverts after expiry, even far in the future (FR-005)", () => {
    expect(() => computePrice(params, 10_000_000_000n)).not.toThrow();
    expect(computePrice(params, 10_000_000_000n)).toBe(0n);
  });

  it("returns the starting price for instants before startAt", () => {
    expect(computePrice(params, 999n)).toBe(100n);
    expect(computePrice(params, 0n)).toBe(100n);
  });
});

describe("isPurchasable (T030 boundaries)", () => {
  it("allows the purchase at the last second before expiry (expiresAt - 1)", () => {
    expect(isPurchasable(liveFlags, 1_099n)).toBe(true);
  });

  it("disables the purchase at expiresAt", () => {
    expect(isPurchasable(liveFlags, 1_100n)).toBe(false);
  });

  it("stays purchasable at the zero price floor before expiry", () => {
    const earlyFloor: AuctionParams = {
      startingPrice: 10n,
      discountRate: 1n,
      duration: 100n,
      startAt: 1_000n,
      expiresAt: 1_100n,
    };
    const floorFlags: AuctionFlags = {
      sold: false,
      cancelled: false,
      expiresAt: earlyFloor.expiresAt,
    };
    expect(computePrice(earlyFloor, 1_010n)).toBe(0n);
    expect(isPurchasable(floorFlags, 1_010n)).toBe(true);
  });

  it("is false once sold or cancelled", () => {
    expect(isPurchasable({ ...liveFlags, sold: true }, 1_050n)).toBe(false);
    expect(isPurchasable({ ...liveFlags, cancelled: true }, 1_050n)).toBe(false);
  });
});

describe("deriveStatus (T030, data-model 1.2 verbatim values)", () => {
  it("derives live before expiry", () => {
    expect(deriveStatus(liveFlags, 1_099n)).toBe("live");
  });

  it("derives expired at or after expiresAt", () => {
    expect(deriveStatus(liveFlags, 1_100n)).toBe("expired");
    expect(deriveStatus(liveFlags, 1_200n)).toBe("expired");
  });

  it("derives sold regardless of elapsed time", () => {
    expect(deriveStatus({ ...liveFlags, sold: true }, 1_050n)).toBe("sold");
    expect(deriveStatus({ ...liveFlags, sold: true }, 1_200n)).toBe("sold");
  });

  it("derives cancelled regardless of elapsed time", () => {
    expect(deriveStatus({ ...liveFlags, cancelled: true }, 1_050n)).toBe("cancelled");
    expect(deriveStatus({ ...liveFlags, cancelled: true }, 1_200n)).toBe("cancelled");
  });

  it("prefers sold over expiry (terminal states win)", () => {
    expect(deriveStatus({ ...liveFlags, sold: true }, 1_200n)).toBe("sold");
  });
});

// Auction price + status derivation per data-model.md section 1.2 (FR-004,
// FR-005, FR-007). All values are on-chain units: wei for prices, unix
// seconds for timestamps. The price formula never reverts and is clamped
// at zero, including after expiry (FR-005).

export type AuctionStatus = "live" | "sold" | "expired" | "cancelled";

export interface AuctionParams {
  startingPrice: bigint;
  discountRate: bigint;
  duration: bigint;
  startAt: bigint;
  expiresAt: bigint;
}

export interface AuctionFlags {
  sold: boolean;
  cancelled: boolean;
  expiresAt: bigint;
}

export interface PriceAnchor {
  price: bigint;
  at: bigint;
}

function toSeconds(now: bigint | number): bigint {
  return typeof now === "number" ? BigInt(Math.trunc(now)) : now;
}

// price(now) = startingPrice - discountRate * min(now - startAt, duration),
// clamped >= 0. Elapsed time before startAt counts as zero.
export function computePrice(params: AuctionParams, now: bigint | number): bigint {
  const current = toSeconds(now);
  const elapsed = current > params.startAt ? current - params.startAt : 0n;
  const decayWindow = elapsed < params.duration ? elapsed : params.duration;
  const decayed = params.discountRate * decayWindow;
  return params.startingPrice > decayed ? params.startingPrice - decayed : 0n;
}

// Continues decay from an anchor (the last known authoritative price at a
// given instant) instead of the immutable start values. Callers clamp `now`
// at expiresAt so the displayed price freezes at its final value.
export function anchoredPrice(
  anchor: PriceAnchor,
  discountRate: bigint,
  now: bigint | number,
): bigint {
  const current = toSeconds(now);
  const elapsed = current > anchor.at ? current - anchor.at : 0n;
  const decayed = discountRate * elapsed;
  return anchor.price > decayed ? anchor.price - decayed : 0n;
}

// Last purchasable instant is expiresAt - 1; disabled at/after expiresAt.
export function isPurchasable(flags: AuctionFlags, now: bigint | number): boolean {
  if (flags.sold || flags.cancelled) return false;
  return toSeconds(now) < flags.expiresAt;
}

// Derived status, verbatim values: live | sold | expired | cancelled.
export function deriveStatus(flags: AuctionFlags, now: bigint | number): AuctionStatus {
  if (flags.sold) return "sold";
  if (flags.cancelled) return "cancelled";
  if (toSeconds(now) >= flags.expiresAt) return "expired";
  return "live";
}

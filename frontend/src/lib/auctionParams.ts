// Auction configuration validation for the seller flow (FR-008, FR-011,
// US2.3). Every constraint from the spec is enforced BEFORE any transaction
// is requested, and every failure returns a plain-language reason that names
// the violated rule - never hex data or contract error codes (FR-003).
//
// Verbatim constraints:
//   - "60s ≤ duration ≤ 2_592_000, default 300"  (FR-011)
//   - startingPrice ≥ discountRate × duration, equality VALID  (FR-008)
//   - startingPrice > 0
//   - discountRate ≥ 1 (wei per second)

import { parseEther } from "viem";

/** Inclusive duration bounds mirrored from AuctionFactory (FR-011). */
export const MIN_DURATION = 60;
export const MAX_DURATION = 2_592_000;
/** Default duration: 300 seconds = 5 minutes (FR-011). */
export const DEFAULT_DURATION = 300;

export const DURATION_RULE = "60s ≤ duration ≤ 2_592_000";
export const PRICE_FLOOR_RULE = "startingPrice ≥ discountRate × duration";
export const PRICE_POSITIVE_RULE = "startingPrice > 0";
export const RATE_RULE = "discountRate ≥ 1";

export type AuctionParamField = "startingPrice" | "discountRate" | "duration";

export interface ParamIssue {
  field: AuctionParamField;
  /** Plain-language description of what is wrong. */
  what: string;
  /** Names the violated rule and the concrete fix. */
  next: string;
}

/** Raw form values as typed by the seller (ETH strings, seconds string). */
export interface AuctionFormValues {
  startingPrice: string;
  discountRate: string;
  /** Whole seconds; empty string falls back to DEFAULT_DURATION. */
  duration: string;
}

export interface ParsedAuctionParams {
  startingPrice: bigint;
  discountRate: bigint;
  duration: bigint;
}

export type AuctionParamsValidation =
  | { ok: true; params: ParsedAuctionParams; issues?: undefined }
  | { ok: false; issues: ParamIssue[]; params?: undefined };

const WHOLE_SECONDS = /^\d+$/;

function parseEth(value: string): bigint | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    return parseEther(trimmed);
  } catch {
    return null;
  }
}

/**
 * Validates the full auction configuration. Returns every violated rule at
 * once so the seller can fix the form in a single pass; a valid result is the
 * exact on-chain parameter set for `AuctionFactory.createAuction`.
 */
export function validateAuctionParams(
  values: AuctionFormValues,
): AuctionParamsValidation {
  const issues: ParamIssue[] = [];

  // --- duration: 60s ≤ duration ≤ 2_592_000, default 300 (FR-011) ---
  const rawDuration = values.duration.trim();
  let duration: bigint | null = null;
  if (rawDuration.length === 0) {
    duration = BigInt(DEFAULT_DURATION);
  } else if (!WHOLE_SECONDS.test(rawDuration)) {
    issues.push({
      field: "duration",
      what: "Duration must be a whole number of seconds",
      next: `Rule: ${DURATION_RULE}, default ${DEFAULT_DURATION} - enter a whole number of seconds (like 300), or leave it empty for the default.`,
    });
  } else {
    const seconds = BigInt(rawDuration);
    if (seconds < BigInt(MIN_DURATION) || seconds > BigInt(MAX_DURATION)) {
      issues.push({
        field: "duration",
        what: "Duration is outside the allowed range",
        next: `Rule: ${DURATION_RULE} - that is 60 seconds to 30 days; the default is ${DEFAULT_DURATION} seconds (5 minutes).`,
      });
    } else {
      duration = seconds;
    }
  }

  // --- startingPrice > 0 (wei precision via ETH input) ---
  const startingPrice = parseEth(values.startingPrice);
  if (startingPrice === null || startingPrice <= 0n) {
    issues.push({
      field: "startingPrice",
      what:
        startingPrice === null
          ? "Starting price must be a number greater than 0"
          : "Starting price must be greater than 0",
      next: `Rule: ${PRICE_POSITIVE_RULE} - enter the starting price in ETH, for example 0.05.`,
    });
  }

  // --- discountRate ≥ 1 (wei per second) ---
  const discountRate = parseEth(values.discountRate);
  if (discountRate === null || discountRate < 1n) {
    issues.push({
      field: "discountRate",
      what:
        discountRate === null
          ? "Discount rate must be a number"
          : "Discount rate must be at least 1",
      next: `Rule: ${RATE_RULE} - the price drops by at least 1 wei each second; enter a rate like 0.0001 ETH per second.`,
    });
  }

  // --- price floor: startingPrice ≥ discountRate × duration (FR-008) ---
  // Equality is VALID: the price then reaches exactly zero at the end.
  if (startingPrice !== null && startingPrice > 0n && discountRate !== null && duration !== null) {
    if (startingPrice < discountRate * duration) {
      issues.push({
        field: "startingPrice",
        what: "Starting price is too low: the price would hit zero before the auction ends",
        next: `Rule: ${PRICE_FLOOR_RULE} - raise the starting price or lower the discount rate; reaching exactly zero at the end is allowed.`,
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    params: {
      startingPrice: startingPrice as bigint,
      discountRate: discountRate as bigint,
      duration: duration as bigint,
    },
  };
}

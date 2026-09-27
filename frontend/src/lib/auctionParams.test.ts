import { describe, expect, it } from "vitest";

import {
  DEFAULT_DURATION,
  MAX_DURATION,
  MIN_DURATION,
  validateAuctionParams,
} from "@/lib/auctionParams";
import type { AuctionFormValues, ParamIssue } from "@/lib/auctionParams";

// Constraints quoted verbatim from the spec (FR-011, FR-008, US2.3):
//   - "60s ≤ duration ≤ 2_592_000, default 300"
//   - startingPrice ≥ discountRate × duration (equality VALID)
//   - startingPrice > 0
//   - discountRate ≥ 1
const DURATION_RULE = "60s ≤ duration ≤ 2_592_000";
const PRICE_FLOOR_RULE = "startingPrice ≥ discountRate × duration";
const PRICE_POSITIVE_RULE = "startingPrice > 0";
const RATE_RULE = "discountRate ≥ 1";

function issuesOf(values: AuctionFormValues): ParamIssue[] {
  const result = validateAuctionParams(values);
  if (result.ok) {
    throw new Error("expected validation to fail, but it passed");
  }
  return result.issues;
}

function issueText(issue: ParamIssue): string {
  return `${issue.what} ${issue.next}`;
}

describe("auctionParams validation (T045, FR-011, FR-008, US2.3)", () => {
  it("exposes the FR-011 bounds verbatim: 60s ≤ duration ≤ 2_592_000, default 300", () => {
    expect(MIN_DURATION).toBe(60);
    expect(MAX_DURATION).toBe(2_592_000);
    expect(DEFAULT_DURATION).toBe(300);

    // An empty duration falls back to the default of 300 seconds.
    const empty = validateAuctionParams({
      startingPrice: "0.05",
      discountRate: "0.0001",
      duration: "",
    });
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.params.duration).toBe(300n);
  });

  it("accepts the inclusive duration bounds and rejects values outside them with a reason naming the rule", () => {
    const base = { startingPrice: "300", discountRate: "0.0001" };

    // Inclusive bounds: 60 and 2_592_000 are VALID.
    expect(validateAuctionParams({ ...base, duration: "60" }).ok).toBe(true);
    expect(validateAuctionParams({ ...base, duration: "2592000" }).ok).toBe(true);

    // Outside the bounds: rejected with a plain-language reason naming the rule.
    for (const duration of ["59", "2592001", "abc", "300.5"]) {
      const issues = issuesOf({ ...base, duration });
      const issue = issues.find((entry) => entry.field === "duration");
      expect(issue, `expected a duration issue for ${duration}`).toBeDefined();
      expect(issueText(issue!)).toContain(DURATION_RULE);
      expect(issue!.what).toMatch(/duration/i);
    }
  });

  it("treats startingPrice == discountRate × duration as VALID (FR-008 equality)", () => {
    // 0.0001 ETH/s × 300 s = 0.03 ETH exactly.
    const atEquality = validateAuctionParams({
      startingPrice: "0.03",
      discountRate: "0.0001",
      duration: "300",
    });
    expect(atEquality.ok).toBe(true);

    // 1 wei/s × 60 s = 60 wei exactly (smallest legal configuration).
    const weiEquality = validateAuctionParams({
      startingPrice: "0.000000000000000060",
      discountRate: "0.000000000000000001",
      duration: "60",
    });
    expect(weiEquality.ok).toBe(true);
  });

  it("rejects startingPrice < discountRate × duration with a plain-language reason naming the rule (FR-008)", () => {
    const issues = issuesOf({
      startingPrice: "0.02",
      discountRate: "0.0001",
      duration: "300",
    });
    const issue = issues.find((entry) => entry.field === "startingPrice");
    expect(issue).toBeDefined();
    expect(issueText(issue!)).toContain(PRICE_FLOOR_RULE);
    // Plain language: names the consequence (price hitting zero early).
    expect(issue!.what).toMatch(/zero|too low/i);
  });

  it("requires startingPrice > 0", () => {
    for (const startingPrice of ["0", "-1", "", "not-a-number"]) {
      const issues = issuesOf({
        startingPrice,
        discountRate: "0.0001",
        duration: "300",
      });
      const issue = issues.find((entry) => entry.field === "startingPrice");
      expect(issue, `expected a startingPrice issue for "${startingPrice}"`).toBeDefined();
      expect(issueText(issue!)).toContain(PRICE_POSITIVE_RULE);
      expect(issue!.what).toMatch(/starting price/i);
    }
  });

  it("requires discountRate ≥ 1 (wei per second)", () => {
    const zeroRate = issuesOf({
      startingPrice: "1",
      discountRate: "0",
      duration: "300",
    });
    const issue = zeroRate.find((entry) => entry.field === "discountRate");
    expect(issue).toBeDefined();
    expect(issueText(issue!)).toContain(RATE_RULE);
    expect(issue!.what).toMatch(/discount rate/i);

    // 1 wei per second is the smallest legal rate.
    const oneWeiRate = validateAuctionParams({
      startingPrice: "0.000000000000000300",
      discountRate: "0.000000000000000001",
      duration: "300",
    });
    expect(oneWeiRate.ok).toBe(true);
  });

  it("gathers every violated rule in one rejection (all failures name their rule)", () => {
    const issues = issuesOf({
      startingPrice: "0",
      discountRate: "0",
      duration: "30",
    });
    const fields = issues.map((entry) => entry.field);
    expect(fields).toContain("startingPrice");
    expect(fields).toContain("discountRate");
    expect(fields).toContain("duration");
  });

  it("keeps every failure plain language - names the violated rule, no hex or revert codes (US2.3)", () => {
    const battery: AuctionFormValues[] = [
      { startingPrice: "", discountRate: "0.0001", duration: "300" },
      { startingPrice: "0", discountRate: "0.0001", duration: "300" },
      { startingPrice: "-1", discountRate: "0.0001", duration: "300" },
      { startingPrice: "abc", discountRate: "0.0001", duration: "300" },
      { startingPrice: "0.02", discountRate: "0.0001", duration: "300" },
      { startingPrice: "0.05", discountRate: "0", duration: "300" },
      { startingPrice: "0.05", discountRate: "abc", duration: "300" },
      { startingPrice: "0.05", discountRate: "0.0001", duration: "59" },
      { startingPrice: "300", discountRate: "0.0001", duration: "2592001" },
      { startingPrice: "0.05", discountRate: "0.0001", duration: "abc" },
      { startingPrice: "0.05", discountRate: "0.0001", duration: "300.5" },
    ];

    for (const values of battery) {
      const result = validateAuctionParams(values);
      expect(result.ok, `expected rejection for ${JSON.stringify(values)}`).toBe(false);
      if (result.ok) continue;
      expect(result.issues.length).toBeGreaterThan(0);
      const rules = [DURATION_RULE, PRICE_FLOOR_RULE, PRICE_POSITIVE_RULE, RATE_RULE];
      for (const issue of result.issues) {
        const text = issueText(issue);
        // Plain language: names the violated rule in words, no hex, no revert codes.
        expect(text).toMatch(/duration|starting price|discount rate/i);
        expect(rules.some((rule) => text.includes(rule))).toBe(true);
        expect(text).not.toMatch(/0x[0-9a-fA-F]{6,}/);
        expect(text).not.toMatch(/revert|Error\(\)|panic/i);
      }
    }
  });
});

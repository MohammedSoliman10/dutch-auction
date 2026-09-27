import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuctionParams } from "../lib/price";

const h = vi.hoisted(() => ({
  readCalls: [] as Array<{
    functionName?: string;
    query?: { refetchInterval?: number; enabled?: boolean };
  }>,
  getPrice: undefined as bigint | undefined,
}));

vi.mock("wagmi", () => ({
  useReadContract: (config: {
    functionName?: string;
    query?: { refetchInterval?: number; enabled?: boolean };
  }) => {
    h.readCalls.push(config);
    return { data: h.getPrice, isLoading: false, refetch: vi.fn() };
  },
}));

import { useCurrentPrice } from "./useCurrentPrice";

const T0 = 1_767_225_600; // 2026-01-01T00:00:00Z
const AUCTION = "0x1111111111111111111111111111111111111111" as const;

const params: AuctionParams = {
  startingPrice: 100n,
  discountRate: 1n,
  duration: 100n,
  startAt: BigInt(T0),
  expiresAt: BigInt(T0 + 100),
};

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.setSystemTime(T0 * 1_000);
  h.readCalls = [];
  h.getPrice = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCurrentPrice (T031, FR-005 / SC-002)", () => {
  it("shows the price derived from cached params at mount", () => {
    const { result } = renderHook(() => useCurrentPrice(AUCTION, params));
    expect(result.current.price).toBe(100n);
  });

  it("re-renders at least once per second with <= 1 s lag and no manual refresh", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useCurrentPrice(AUCTION, params);
    });
    expect(result.current.price).toBe(100n);

    const before = renders;
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(renders).toBeGreaterThan(before);
    expect(result.current.price).toBe(99n);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.price).toBe(98n);
  });

  it("keeps ticking over longer stretches of viewing time", () => {
    const { result } = renderHook(() => useCurrentPrice(AUCTION, params));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.price).toBe(95n);
  });

  it("clamps at zero - never negative - including after expiry", () => {
    const earlyFloor: AuctionParams = {
      startingPrice: 10n,
      discountRate: 1n,
      duration: 100n,
      startAt: BigInt(T0),
      expiresAt: BigInt(T0 + 100),
    };
    const { result } = renderHook(() => useCurrentPrice(AUCTION, earlyFloor));

    act(() => {
      vi.advanceTimersByTime(11_000); // floor at 10 s, still live until 100 s
    });
    expect(result.current.price).toBe(0n);

    act(() => {
      vi.advanceTimersByTime(200_000); // far past expiresAt
    });
    expect(result.current.price).toBe(0n);
  });

  it("adopts a periodic on-chain getPrice() refetch as the correction anchor (R7)", () => {
    const { result, rerender } = renderHook(() => useCurrentPrice(AUCTION, params));

    const getPriceCall = h.readCalls.find(
      (call) => call.functionName === "getPrice",
    );
    expect(getPriceCall).toBeDefined();
    expect(getPriceCall?.query?.refetchInterval).toBe(15_000);

    h.getPrice = 42n;
    rerender();
    expect(result.current.price).toBe(42n);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.price).toBe(41n);
  });
});

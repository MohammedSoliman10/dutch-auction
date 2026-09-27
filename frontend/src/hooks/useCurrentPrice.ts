import { useEffect, useMemo, useState } from "react";
import { useReadContract } from "wagmi";

import { dutchAuctionAbi } from "../config/contracts";
import { anchoredPrice } from "../lib/price";
import type { AuctionParams } from "../lib/price";

// Periodic on-chain getPrice() refetch used to correct local drift (R7);
// the per-second display itself is computed locally from cached params.
export const ON_CHAIN_PRICE_REFRESH_MS = 15_000;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

interface PriceAnchor {
  price: bigint;
  at: number;
}

export interface CurrentPrice {
  /** Displayed price in wei - declines every second, never below zero. */
  price: bigint;
  /** Latest ticker timestamp in unix seconds (drives countdowns). */
  now: number;
}

/**
 * Live price ticker (FR-005, SC-002): re-renders from a 1-second local
 * interval using immutable auction params - no manual refresh, lag < 1 s.
 * A periodic on-chain getPrice() read re-anchors the computation so local
 * clock drift cannot accumulate.
 */
export function useCurrentPrice(
  address: `0x${string}` | undefined,
  params: AuctionParams | null,
): CurrentPrice {
  const [now, setNow] = useState<number>(nowSeconds);
  const [chainAnchor, setChainAnchor] = useState<PriceAnchor | null>(null);

  useEffect(() => {
    const ticker = setInterval(() => setNow(nowSeconds()), 1_000);
    return () => clearInterval(ticker);
  }, []);

  const { data: chainPrice } = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "getPrice",
    query: {
      enabled: params !== null,
      refetchInterval: ON_CHAIN_PRICE_REFRESH_MS,
    },
  });

  useEffect(() => {
    if (typeof chainPrice === "bigint") {
      setChainAnchor({ price: chainPrice, at: nowSeconds() });
    }
  }, [chainPrice]);

  const localAnchor = useMemo<PriceAnchor>(
    () => ({
      price: params?.startingPrice ?? 0n,
      at: Number(params?.startAt ?? 0n),
    }),
    [params?.startingPrice, params?.startAt],
  );

  const anchor = chainAnchor ?? localAnchor;
  // Freeze at expiresAt: the contract stops decaying at duration, and the
  // displayed value must stop with it (edge: "expires while page is open").
  const effectiveNow =
    params === null ? now : Math.min(now, Number(params.expiresAt));
  const price =
    params === null
      ? 0n
      : anchoredPrice(
          { price: anchor.price, at: BigInt(anchor.at) },
          params.discountRate,
          effectiveNow,
        );

  return { price, now };
}

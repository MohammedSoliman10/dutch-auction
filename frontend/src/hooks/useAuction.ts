// T061: single-auction detail query with the FR-020 fallback chain -
// index API (`GET /api/auctions/:address`) first, then direct on-chain reads
// of the auction contract. The returned `source` lets the UI label fallback
// data instead of presenting it as index-current.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useReadContract } from "wagmi";

import { dutchAuctionAbi, dutchAuctionNftAbi } from "../config/contracts";
import type { PlainMessage } from "../lib/errors";
import { computePrice, deriveStatus } from "../lib/price";
import {
  GALLERY_REFRESH_MS,
  fetchIndexJson,
  isAddressLike,
  normalizeApiAuction,
} from "./useAuctions";
import type { AuctionSource, AuctionViewItem } from "./useAuctions";

const AUCTION_DETAIL_FAILED: PlainMessage = {
  what: "This auction could not be loaded",
  next: "The auction index and the chain both failed to respond - check your connection, then retry",
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

export interface UseAuctionResult {
  auction: AuctionViewItem | null;
  /** Which source answered - `chain` means degraded, label it (FR-020). */
  source: AuctionSource | null;
  isLoading: boolean;
  /** Set only when BOTH the index and the chain failed (FR-020). */
  error: PlainMessage | null;
  /** Retry: re-attempt the index and the chain reads behind it. */
  refetch: () => void;
}

/**
 * Auction detail (T061, FR-004/FR-015/FR-020): try the index with a bounded
 * fetch; any failure - network, non-JSON, 404 AUCTION_NOT_FOUND (the indexer
 * may simply lag) - moves to direct reads of the auction contract, with status
 * derived locally per data-model section 1.2 and reads refreshed every ~15 s.
 */
export function useAuction(address: `0x${string}` | undefined): UseAuctionResult {
  const [apiDetail, setApiDetail] = useState<AuctionViewItem | null>(null);
  const [source, setSource] = useState<AuctionSource | null>(null);
  const [nonce, setNonce] = useState(0);
  const [now, setNow] = useState(nowSeconds);

  useEffect(() => {
    const ticker = setInterval(() => setNow(nowSeconds()), GALLERY_REFRESH_MS);
    return () => clearInterval(ticker);
  }, []);

  useEffect(() => {
    if (address === undefined) return;
    let active = true;
    const controller = new AbortController();
    setApiDetail(null);
    setSource(null);

    const load = async (): Promise<void> => {
      try {
        const body = await fetchIndexJson(
          `/api/auctions/${address.toLowerCase()}`,
          controller.signal,
        );
        const detail = normalizeApiAuction(body);
        if (detail === null) {
          throw new Error("The auction index returned an unexpected document");
        }
        if (!active) return;
        setApiDetail(detail);
        setSource("api");
      } catch {
        // Index unreachable / non-JSON / not indexed yet -> read the chain.
        if (!active) return;
        setSource("chain");
      }
    };

    void load();
    const interval = setInterval(() => void load(), GALLERY_REFRESH_MS);
    return () => {
      active = false;
      controller.abort();
      clearInterval(interval);
    };
  }, [address, nonce]);

  const chainEnabled = source === "chain" && address !== undefined;
  const query = {
    refetchInterval: GALLERY_REFRESH_MS,
    enabled: chainEnabled,
  };

  const sellerRead = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "seller",
    query,
  });
  const startingPriceRead = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "startingPrice",
    query,
  });
  const discountRateRead = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "discountRate",
    query,
  });
  const durationRead = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "duration",
    query,
  });
  const startAtRead = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "startAt",
    query,
  });
  const expiresAtRead = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "expiresAt",
    query,
  });
  const soldRead = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "sold",
    query,
  });
  const cancelledRead = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "cancelled",
    query,
  });
  const buyerRead = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "buyer",
    query,
  });
  const salePriceRead = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "salePrice",
    query,
  });
  const nftRead = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "nft",
    query,
  });
  const nftIdRead = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "nftId",
    query,
  });
  const tokenUriRead = useReadContract({
    address: nftRead.data,
    abi: dutchAuctionNftAbi,
    functionName: "tokenURI",
    args: [nftIdRead.data ?? 0n],
    query: {
      refetchInterval: GALLERY_REFRESH_MS,
      enabled: chainEnabled && nftRead.data !== undefined && nftIdRead.data !== undefined,
    },
  });

  const chainDetail = useMemo<AuctionViewItem | null>(() => {
    if (!chainEnabled || address === undefined) return null;
    const seller = sellerRead.data;
    const expiresAt = expiresAtRead.data;
    const sold = soldRead.data;
    const cancelled = cancelledRead.data;
    if (
      typeof seller !== "string" ||
      typeof expiresAt !== "bigint" ||
      typeof sold !== "boolean" ||
      typeof cancelled !== "boolean"
    ) {
      return null; // core read still pending
    }
    const startingPrice =
      typeof startingPriceRead.data === "bigint" ? startingPriceRead.data : null;
    const discountRate =
      typeof discountRateRead.data === "bigint" ? discountRateRead.data : null;
    const duration = typeof durationRead.data === "bigint" ? durationRead.data : null;
    const startAt = typeof startAtRead.data === "bigint" ? startAtRead.data : null;
    const paramsReady =
      startingPrice !== null && discountRate !== null && duration !== null && startAt !== null;
    return {
      address,
      seller: seller as `0x${string}`,
      nftContract: isAddressLike(nftRead.data) ? nftRead.data : null,
      tokenId: typeof nftIdRead.data === "bigint" ? String(nftIdRead.data) : null,
      startingPrice,
      discountRate,
      duration: duration === null ? null : Number(duration),
      startAt: startAt === null ? null : Number(startAt),
      expiresAt: Number(expiresAt),
      // Status derived client-side per data-model section 1.2 (verbatim enum).
      status: deriveStatus({ sold, cancelled, expiresAt }, now),
      currentPrice: paramsReady
        ? computePrice(
            {
              startingPrice,
              discountRate,
              duration,
              startAt,
              expiresAt,
            },
            now,
          )
        : null,
      buyer: typeof buyerRead.data === "string" ? buyerRead.data : null,
      salePrice: typeof salePriceRead.data === "bigint" ? salePriceRead.data : null,
      tokenUri: typeof tokenUriRead.data === "string" ? tokenUriRead.data : null,
      nftName: null,
      nftImage: null,
    };
  }, [
    chainEnabled,
    address,
    now,
    sellerRead.data,
    startingPriceRead.data,
    discountRateRead.data,
    durationRead.data,
    startAtRead.data,
    expiresAtRead.data,
    soldRead.data,
    cancelledRead.data,
    buyerRead.data,
    salePriceRead.data,
    nftRead.data,
    nftIdRead.data,
    tokenUriRead.data,
  ]);

  const chainReadFailed =
    sellerRead.isError === true ||
    expiresAtRead.isError === true ||
    soldRead.isError === true ||
    cancelledRead.isError === true;

  const error = chainEnabled && chainReadFailed ? AUCTION_DETAIL_FAILED : null;
  const auction = source === "api" ? apiDetail : chainDetail;
  const isLoading =
    address !== undefined &&
    (source === null || (source === "chain" && auction === null && error === null));

  const refetch = useCallback(() => {
    setNonce((value) => value + 1);
    const refetchers: Array<() => void> = [
      () => void sellerRead.refetch(),
      () => void startingPriceRead.refetch(),
      () => void discountRateRead.refetch(),
      () => void durationRead.refetch(),
      () => void startAtRead.refetch(),
      () => void expiresAtRead.refetch(),
      () => void soldRead.refetch(),
      () => void cancelledRead.refetch(),
      () => void buyerRead.refetch(),
      () => void salePriceRead.refetch(),
      () => void nftRead.refetch(),
      () => void nftIdRead.refetch(),
      () => void tokenUriRead.refetch(),
    ];
    for (const refetchOne of refetchers) refetchOne();
  }, [
    sellerRead.refetch,
    startingPriceRead.refetch,
    discountRateRead.refetch,
    durationRead.refetch,
    startAtRead.refetch,
    expiresAtRead.refetch,
    soldRead.refetch,
    cancelledRead.refetch,
    buyerRead.refetch,
    salePriceRead.refetch,
    nftRead.refetch,
    nftIdRead.refetch,
    tokenUriRead.refetch,
  ]);

  return { auction, source, isLoading, error, refetch };
}

// T061: gallery list query for US3. The index API (`GET /api/auctions`) is the
// primary source; when it is unreachable - or, in production, does not exist at
// all - the hook falls back to direct on-chain discovery through the factory
// registry (FR-020). The caller always learns which source is being served so
// degraded data can be labeled and retried, never presented as current.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReadContract, useReadContracts } from "wagmi";

import { auctionFactoryAbi, dutchAuctionAbi, dutchAuctionNftAbi } from "../config/contracts";
import { deployments } from "../config/deployments";
import type { PlainMessage } from "../lib/errors";
import { computePrice, deriveStatus } from "../lib/price";
import type { AuctionStatus } from "../lib/price";
import { ON_CHAIN_PRICE_REFRESH_MS } from "./useCurrentPrice";

// SC-007 visibility window: the gallery refreshes every ~15 s, both the API
// pages and the on-chain fallback reads.
export const GALLERY_REFRESH_MS = ON_CHAIN_PRICE_REFRESH_MS;
// The index must answer within 4 s before we fall back to the chain.
const FETCH_TIMEOUT_MS = 4_000;
const DEFAULT_LIMIT = 20;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const KNOWN_STATUSES: readonly string[] = ["live", "sold", "expired", "cancelled"];

export type AuctionStatusFilter = "all" | AuctionStatus;
export type AuctionSource = "api" | "chain";

/** One auction, normalized from either the index API or direct chain reads. */
export interface AuctionViewItem {
  address: `0x${string}`;
  seller: `0x${string}`;
  nftContract: `0x${string}` | null;
  tokenId: string | null;
  startingPrice: bigint | null;
  discountRate: bigint | null;
  duration: number | null;
  startAt: number | null;
  expiresAt: number | null;
  status: AuctionStatus;
  currentPrice: bigint | null;
  buyer: string | null;
  salePrice: bigint | null;
  tokenUri: string | null;
  nftName: string | null;
  nftImage: string | null;
}

export const GALLERY_LIST_FAILED: PlainMessage = {
  what: "The auction list could not be loaded",
  next: "The auction index and the chain both failed to respond - check your connection, then retry",
};

export function isAddressLike(value: unknown): value is `0x${string}` {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function parseBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && value.trim() !== "") {
    try {
      return BigInt(value.trim());
    } catch {
      return null;
    }
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  return null;
}

/**
 * Index rows carry the verbatim status enum; if a row ever omits or mangles it
 * we re-derive it from the sale + expiry facts (data-model section 1.2). Rows
 * whose status cannot be established at all are dropped (defensive filtering).
 */
function apiStatus(raw: Record<string, unknown>): AuctionStatus | null {
  if (typeof raw.status === "string" && KNOWN_STATUSES.includes(raw.status)) {
    return raw.status as AuctionStatus;
  }
  if (typeof raw.expiresAt !== "number") return null;
  const sold =
    raw.salePrice !== null && raw.salePrice !== undefined && raw.buyer != null;
  return deriveStatus({ sold, cancelled: false, expiresAt: BigInt(raw.expiresAt) }, nowSeconds());
}

/** Normalizes an index AuctionSummary; returns null for malformed rows. */
export function normalizeApiAuction(value: unknown): AuctionViewItem | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!isAddressLike(raw.address) || !isAddressLike(raw.seller)) return null;
  const status = apiStatus(raw);
  if (status === null) return null;
  const nft =
    typeof raw.nft === "object" && raw.nft !== null
      ? (raw.nft as Record<string, unknown>)
      : {};
  return {
    address: raw.address,
    seller: raw.seller,
    nftContract: isAddressLike(raw.nftContract) ? raw.nftContract : null,
    tokenId:
      typeof raw.tokenId === "string"
        ? raw.tokenId
        : typeof raw.tokenId === "number" && Number.isInteger(raw.tokenId)
          ? String(raw.tokenId)
          : null,
    startingPrice: parseBigInt(raw.startingPrice),
    discountRate: parseBigInt(raw.discountRate),
    duration:
      typeof raw.duration === "number" && Number.isFinite(raw.duration)
        ? raw.duration
        : null,
    startAt: typeof raw.startAt === "number" ? raw.startAt : null,
    expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : null,
    status,
    currentPrice: parseBigInt(raw.currentPrice),
    buyer: typeof raw.buyer === "string" ? raw.buyer : null,
    salePrice: parseBigInt(raw.salePrice),
    tokenUri: typeof nft.tokenUri === "string" ? nft.tokenUri : null,
    nftName: typeof nft.name === "string" ? nft.name : null,
    nftImage: typeof nft.image === "string" ? nft.image : null,
  };
}

/**
 * GET JSON from the index with a hard timeout. ANY failure - network error,
 * non-2xx status, or a non-JSON body such as the SPA HTML served in production
 * where `/api` does not exist - throws, so callers treat it as "index
 * unavailable" and fall back to the chain (FR-020).
 */
export async function fetchIndexJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const relayAbort = () => controller.abort();
  signal?.addEventListener("abort", relayAbort);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`The auction index responded with ${response.status}`);
    }
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relayAbort);
  }
}

function batchResults(data: unknown): unknown[] {
  const entries = (data ?? []) as Array<{ status?: string; result?: unknown }>;
  return entries.map((entry) => (entry.status === "success" ? entry.result : undefined));
}

function dedupeByAddress(items: AuctionViewItem[]): AuctionViewItem[] {
  const seen = new Set<string>();
  const merged: AuctionViewItem[] = [];
  for (const item of items) {
    const key = item.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

interface GalleryPage {
  items: AuctionViewItem[];
  nextCursor: string | null;
}

async function fetchGalleryPage(
  status: AuctionStatusFilter,
  limit: number,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<GalleryPage> {
  const params = new URLSearchParams();
  params.set("status", status);
  params.set("limit", String(limit));
  if (cursor !== null) params.set("cursor", cursor);
  const body = await fetchIndexJson(`/api/auctions?${params.toString()}`, signal);
  if (typeof body !== "object" || body === null || !Array.isArray((body as { items?: unknown }).items)) {
    throw new Error("The auction index returned an unexpected document");
  }
  const record = body as { items: unknown[]; nextCursor?: unknown };
  return {
    items: record.items
      .map(normalizeApiAuction)
      .filter((item): item is AuctionViewItem => item !== null),
    nextCursor: typeof record.nextCursor === "string" ? record.nextCursor : null,
  };
}

interface ChainGallery {
  items: AuctionViewItem[];
  pending: boolean;
  error: PlainMessage | null;
  refetch: () => void;
}

/**
 * Direct on-chain discovery (FR-020 fallback): enumerate the factory registry
 * (`auctionCount()` + `allAuctions(i)`), read each auction's core fields, then
 * resolve token URIs for previews. Reads refresh inside the 15 s window and a
 * status filter is applied client-side because the chain has no filter.
 */
function useChainGallery(enabled: boolean, status: AuctionStatusFilter): ChainGallery {
  const factory = deployments.factory;
  const [tick, setTick] = useState(nowSeconds);

  useEffect(() => {
    const ticker = setInterval(() => setTick(nowSeconds()), GALLERY_REFRESH_MS);
    return () => clearInterval(ticker);
  }, []);

  const query = { refetchInterval: GALLERY_REFRESH_MS };
  const countRead = useReadContract({
    address: factory,
    abi: auctionFactoryAbi,
    functionName: "auctionCount",
    query: { ...query, enabled: enabled && factory !== undefined },
  });
  const count = typeof countRead.data === "bigint" ? countRead.data : undefined;

  const registryContracts = useMemo(() => {
    if (count === undefined || factory === undefined) return [];
    return Array.from({ length: Number(count) }, (_, index) => ({
      address: factory,
      abi: auctionFactoryAbi,
      functionName: "allAuctions" as const,
      args: [BigInt(index)] as const,
    }));
  }, [count, factory]);

  const registryRead = useReadContracts({
    contracts: registryContracts,
    query: { ...query, enabled: enabled && registryContracts.length > 0 },
  });

  const addresses = useMemo(() => {
    const found: `0x${string}`[] = [];
    for (const entry of batchResults(registryRead.data)) {
      if (isAddressLike(entry)) found.push(entry);
    }
    return found;
  }, [registryRead.data]);

  const fieldsQuery = { ...query, enabled: enabled && addresses.length > 0 };
  const sellersRead = useReadContracts({
    contracts: addresses.map((address) => ({
      address,
      abi: dutchAuctionAbi,
      functionName: "seller" as const,
    })),
    query: fieldsQuery,
  });
  const startingPricesRead = useReadContracts({
    contracts: addresses.map((address) => ({
      address,
      abi: dutchAuctionAbi,
      functionName: "startingPrice" as const,
    })),
    query: fieldsQuery,
  });
  const discountRatesRead = useReadContracts({
    contracts: addresses.map((address) => ({
      address,
      abi: dutchAuctionAbi,
      functionName: "discountRate" as const,
    })),
    query: fieldsQuery,
  });
  const durationsRead = useReadContracts({
    contracts: addresses.map((address) => ({
      address,
      abi: dutchAuctionAbi,
      functionName: "duration" as const,
    })),
    query: fieldsQuery,
  });
  const startAtsRead = useReadContracts({
    contracts: addresses.map((address) => ({
      address,
      abi: dutchAuctionAbi,
      functionName: "startAt" as const,
    })),
    query: fieldsQuery,
  });
  const expiresAtsRead = useReadContracts({
    contracts: addresses.map((address) => ({
      address,
      abi: dutchAuctionAbi,
      functionName: "expiresAt" as const,
    })),
    query: fieldsQuery,
  });
  const soldsRead = useReadContracts({
    contracts: addresses.map((address) => ({
      address,
      abi: dutchAuctionAbi,
      functionName: "sold" as const,
    })),
    query: fieldsQuery,
  });
  const cancelledsRead = useReadContracts({
    contracts: addresses.map((address) => ({
      address,
      abi: dutchAuctionAbi,
      functionName: "cancelled" as const,
    })),
    query: fieldsQuery,
  });
  const buyersRead = useReadContracts({
    contracts: addresses.map((address) => ({
      address,
      abi: dutchAuctionAbi,
      functionName: "buyer" as const,
    })),
    query: fieldsQuery,
  });
  const salePricesRead = useReadContracts({
    contracts: addresses.map((address) => ({
      address,
      abi: dutchAuctionAbi,
      functionName: "salePrice" as const,
    })),
    query: fieldsQuery,
  });
  const nftsRead = useReadContracts({
    contracts: addresses.map((address) => ({
      address,
      abi: dutchAuctionAbi,
      functionName: "nft" as const,
    })),
    query: fieldsQuery,
  });
  const nftIdsRead = useReadContracts({
    contracts: addresses.map((address) => ({
      address,
      abi: dutchAuctionAbi,
      functionName: "nftId" as const,
    })),
    query: fieldsQuery,
  });

  // tokenURI lives on the NFT contract, so it needs the (nft, tokenId) pair
  // resolved first; failures here only cost the preview, never the listing.
  const tokenUriBatch = useMemo(() => {
    const contracts: Array<{
      address: `0x${string}`;
      abi: typeof dutchAuctionNftAbi;
      functionName: "tokenURI";
      args: [bigint];
    }> = [];
    const owners: number[] = [];
    const nfts = batchResults(nftsRead.data);
    const tokenIds = batchResults(nftIdsRead.data);
    addresses.forEach((_, index) => {
      const nft = nfts[index];
      const tokenId = tokenIds[index];
      if (isAddressLike(nft) && typeof tokenId === "bigint") {
        contracts.push({
          address: nft,
          abi: dutchAuctionNftAbi,
          functionName: "tokenURI",
          args: [tokenId],
        });
        owners.push(index);
      }
    });
    return { contracts, owners };
  }, [addresses, nftsRead.data, nftIdsRead.data]);

  const tokenUrisRead = useReadContracts({
    contracts: tokenUriBatch.contracts,
    query: { ...query, enabled: enabled && tokenUriBatch.contracts.length > 0 },
  });

  const tokenUriByIndex = useMemo(() => {
    const map = new Map<number, string>();
    batchResults(tokenUrisRead.data).forEach((value, position) => {
      const owner = tokenUriBatch.owners[position];
      if (typeof value === "string" && owner !== undefined) map.set(owner, value);
    });
    return map;
  }, [tokenUrisRead.data, tokenUriBatch]);

  const items = useMemo(() => {
    if (!enabled) return [];
    const sellers = batchResults(sellersRead.data);
    const startingPrices = batchResults(startingPricesRead.data);
    const discountRates = batchResults(discountRatesRead.data);
    const durations = batchResults(durationsRead.data);
    const startAts = batchResults(startAtsRead.data);
    const expiresAts = batchResults(expiresAtsRead.data);
    const solds = batchResults(soldsRead.data);
    const cancelleds = batchResults(cancelledsRead.data);
    const buyers = batchResults(buyersRead.data);
    const salePrices = batchResults(salePricesRead.data);
    const nfts = batchResults(nftsRead.data);
    const tokenIds = batchResults(nftIdsRead.data);

    const built: AuctionViewItem[] = [];
    addresses.forEach((address, index) => {
      const seller = sellers[index];
      const expiresAt = expiresAts[index];
      const sold = solds[index];
      const cancelled = cancelleds[index];
      // Core read still pending or failed - skip until it resolves.
      if (
        !isAddressLike(seller) ||
        typeof expiresAt !== "bigint" ||
        typeof sold !== "boolean" ||
        typeof cancelled !== "boolean"
      ) {
        return;
      }
      const itemStatus = deriveStatus({ sold, cancelled, expiresAt }, tick);
      if (status !== "all" && itemStatus !== status) return;

      const startingPrice = parseBigInt(startingPrices[index]);
      const discountRate = parseBigInt(discountRates[index]);
      const durationRaw = durations[index];
      const startAtRaw = startAts[index];
      const duration = typeof durationRaw === "bigint" ? Number(durationRaw) : null;
      const startAt = typeof startAtRaw === "bigint" ? Number(startAtRaw) : null;
      const expiresAtSeconds = Number(expiresAt);
      const paramsReady =
        startingPrice !== null &&
        discountRate !== null &&
        duration !== null &&
        startAt !== null;
      const currentPrice = paramsReady
        ? computePrice(
            {
              startingPrice,
              discountRate,
              duration: BigInt(duration),
              startAt: BigInt(startAt),
              expiresAt,
            },
            tick,
          )
        : null;

      built.push({
        address,
        seller: seller as `0x${string}`,
        nftContract: isAddressLike(nfts[index]) ? (nfts[index] as `0x${string}`) : null,
        tokenId: typeof tokenIds[index] === "bigint" ? String(tokenIds[index]) : null,
        startingPrice,
        discountRate,
        duration,
        startAt,
        expiresAt: expiresAtSeconds,
        status: itemStatus,
        currentPrice,
        buyer: typeof buyers[index] === "string" ? buyers[index] : null,
        salePrice: parseBigInt(salePrices[index]),
        tokenUri: tokenUriByIndex.get(index) ?? null,
        nftName: null,
        nftImage: null,
      });
    });
    return built;
  }, [
    enabled,
    status,
    tick,
    addresses,
    sellersRead.data,
    startingPricesRead.data,
    discountRatesRead.data,
    durationsRead.data,
    startAtsRead.data,
    expiresAtsRead.data,
    soldsRead.data,
    cancelledsRead.data,
    buyersRead.data,
    salePricesRead.data,
    nftsRead.data,
    nftIdsRead.data,
    tokenUriByIndex,
  ]);

  const chainReadFailed =
    countRead.isError === true ||
    registryRead.isError === true ||
    sellersRead.isError === true ||
    startingPricesRead.isError === true ||
    discountRatesRead.isError === true ||
    durationsRead.isError === true ||
    startAtsRead.isError === true ||
    expiresAtsRead.isError === true ||
    soldsRead.isError === true ||
    cancelledsRead.isError === true ||
    buyersRead.isError === true ||
    salePricesRead.isError === true ||
    nftsRead.isError === true ||
    nftIdsRead.isError === true;

  const error =
    enabled && (factory === undefined || chainReadFailed) ? GALLERY_LIST_FAILED : null;

  const registryPending =
    count !== undefined && count > 0n && registryRead.data === undefined;
  const pending =
    enabled && error === null && (count === undefined || registryPending);

  const refetch = () => {
    const refetchers: Array<() => void> = [
      () => void countRead.refetch(),
      () => void registryRead.refetch(),
      () => void sellersRead.refetch(),
      () => void startingPricesRead.refetch(),
      () => void discountRatesRead.refetch(),
      () => void durationsRead.refetch(),
      () => void startAtsRead.refetch(),
      () => void expiresAtsRead.refetch(),
      () => void soldsRead.refetch(),
      () => void cancelledsRead.refetch(),
      () => void buyersRead.refetch(),
      () => void salePricesRead.refetch(),
      () => void nftsRead.refetch(),
      () => void nftIdsRead.refetch(),
      () => void tokenUrisRead.refetch(),
    ];
    for (const refetchOne of refetchers) refetchOne();
  };

  return { items, pending, error, refetch };
}

export interface UseAuctionsOptions {
  /** Status filter (verbatim enum, `all` for everything). Default `all`. */
  status?: AuctionStatusFilter;
  /** Page size for the index query (1-100, default 20 per contracts/api.md). */
  limit?: number;
}

export interface UseAuctionsResult {
  items: AuctionViewItem[];
  /** Opaque continuation cursor; null when exhausted or serving chain data. */
  nextCursor: string | null;
  /** Which source the current items come from - the UI must label `chain`. */
  source: AuctionSource | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  /** Set only when BOTH the index and the chain failed (FR-020). */
  error: PlainMessage | null;
  /** Retry: re-attempt the index (and the chain reads behind it). */
  refetch: () => void;
  /** Cursor paging: fetch and append the next index page. */
  loadMore: () => void;
}

/**
 * Gallery query (T061, FR-014): index pages with ~15 s refresh and cursor
 * paging, falling back to factory-registry enumeration when the index is
 * unavailable (FR-020). The chain fallback applies status filters locally.
 */
export function useAuctions(options: UseAuctionsOptions = {}): UseAuctionsResult {
  const status = options.status ?? "all";
  const limit = options.limit ?? DEFAULT_LIMIT;

  const [apiItems, setApiItems] = useState<AuctionViewItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [source, setSource] = useState<AuctionSource | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Cursor chain for the pages currently loaded (null = first page), so the
  // periodic refresh re-fetches exactly what the visitor is looking at.
  const cursorsRef = useRef<Array<string | null>>([null]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    cursorsRef.current = [null];
    setApiItems([]);
    setNextCursor(null);
    setSource(null);

    const load = async (): Promise<void> => {
      try {
        const cursors = [...cursorsRef.current];
        const pages = await Promise.all(
          cursors.map((cursor) => fetchGalleryPage(status, limit, cursor, controller.signal)),
        );
        if (!active) return;
        setApiItems(dedupeByAddress(pages.flatMap((page) => page.items)));
        setNextCursor(pages[pages.length - 1]?.nextCursor ?? null);
        setSource("api");
      } catch {
        // Index unreachable or non-JSON -> on-chain discovery (FR-020).
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
  }, [status, limit, nonce]);

  const chain = useChainGallery(source === "chain", status);

  const refetch = useCallback(() => {
    setNonce((value) => value + 1);
    chain.refetch();
  }, [chain.refetch]);

  const loadMore = useCallback(() => {
    if (source !== "api" || nextCursor === null || loadingMore) return;
    const cursor = nextCursor;
    setLoadingMore(true);
    const controller = new AbortController();
    fetchGalleryPage(status, limit, cursor, controller.signal)
      .then((page) => {
        cursorsRef.current = [...cursorsRef.current, cursor];
        setApiItems((previous) => dedupeByAddress([...previous, ...page.items]));
        setNextCursor(page.nextCursor);
      })
      .catch(() => {
        // The index stopped answering mid-pagination - hand the view to the
        // on-chain fallback rather than showing half a stale gallery.
        setSource("chain");
      })
      .finally(() => setLoadingMore(false));
  }, [source, nextCursor, loadingMore, status, limit]);

  const items = source === "chain" ? chain.items : apiItems;
  const isLoading = source === null || (source === "chain" && chain.pending);
  const error = source === "chain" ? chain.error : null;

  return {
    items,
    nextCursor: source === "api" ? nextCursor : null,
    source,
    isLoading,
    isLoadingMore: loadingMore,
    error,
    refetch,
    loadMore,
  };
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount, useReadContract, useReadContracts } from "wagmi";

import { SellerActions } from "@/components/auction/SellerActions";
import { StatusBadge } from "@/components/auction/StatusBadge";
import { NetworkGuard } from "@/components/wallet/NetworkGuard";
import { auctionFactoryAbi, dutchAuctionAbi } from "@/config/contracts";
import { deployments } from "@/config/deployments";
import { ON_CHAIN_PRICE_REFRESH_MS } from "@/hooks/useCurrentPrice";
import { formatEthWithUnit } from "@/lib/format";
import { deriveStatus } from "@/lib/price";
import type { AuctionStatus } from "@/lib/price";

// SC-007 visibility window: the indexed list and the on-chain fallback are
// both refreshed at most 15 s after a change.
const LIST_REFRESH_MS = ON_CHAIN_PRICE_REFRESH_MS;
// The index API must answer within 4 s before we fall back to the chain.
const FETCH_TIMEOUT_MS = 4_000;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const KNOWN_STATUSES: readonly string[] = ["live", "sold", "expired", "cancelled"];

type ListSource = "api" | "chain";

/** One auction as returned by `GET /api/auctions` (indexer shape, US2). */
interface ApiAuction {
  address: string;
  chainId?: number;
  seller: string;
  tokenId?: string;
  startingPrice?: string;
  discountRate?: string;
  duration?: number;
  startAt?: number;
  expiresAt?: number;
  status?: string;
  buyer?: string | null;
  salePrice?: string | null;
}

function isAddressLike(value: unknown): value is `0x${string}` {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

function toBigInt(value: string | null | undefined): bigint | undefined {
  if (value === null || value === undefined || value.trim() === "") return undefined;
  try {
    return BigInt(value.trim());
  } catch {
    return undefined;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

/**
 * Indexer rows carry the verbatim status; if the index ever omits it we
 * derive it locally from the sale + expiry facts so the four values stay
 * consistent (FR-004).
 */
function apiStatus(item: ApiAuction): AuctionStatus {
  if (item.status !== undefined && KNOWN_STATUSES.includes(item.status)) {
    return item.status as AuctionStatus;
  }
  const sold =
    item.salePrice !== null && item.salePrice !== undefined && item.buyer != null;
  return deriveStatus(
    { sold, cancelled: false, expiresAt: BigInt(item.expiresAt ?? 0) },
    nowSeconds(),
  );
}

function EmptyState() {
  return (
    <section className="mt-6 border border-hairline bg-panel p-6 text-center">
      <p className="text-display">No auctions yet</p>
      <p className="mt-2 text-muted">
        List one of your NFTs to start a Dutch auction.
      </p>
      <Link
        to="/mint"
        className="mt-4 inline-block font-display text-sm uppercase tracking-wide text-display underline underline-offset-4 transition-colors hover:text-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
      >
        Mint an NFT
      </Link>
    </section>
  );
}

interface AuctionRowProps {
  address: `0x${string}`;
  seller: `0x${string}`;
  status: AuctionStatus;
  tokenId?: string;
  startingPrice?: bigint;
  salePrice?: bigint;
  buyer?: string;
  onRefresh: () => void;
}

/**
 * One seller auction with its management entry points (FR-013, FR-014).
 * Sold rows spell out the atomic outcome of the settlement transaction
 * (US2.4): proceeds and NFT transfer happened together or not at all.
 */
function AuctionRow({
  address,
  seller,
  status,
  tokenId,
  startingPrice,
  salePrice,
  buyer,
  onRefresh,
}: AuctionRowProps) {
  return (
    <li
      data-testid="my-auction"
      data-address={address}
      className="border border-hairline bg-panel p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-sm uppercase tracking-wide text-display">
          {tokenId !== undefined ? `Token #${tokenId}` : "Your auction"}
        </p>
        <StatusBadge status={status} />
      </div>

      {startingPrice !== undefined ? (
        <p className="mt-2 text-sm text-muted">
          Opening price {formatEthWithUnit(startingPrice)}
        </p>
      ) : null}

      {status === "sold" && salePrice !== undefined ? (
        <div
          data-testid="sale-outcome"
          className="mt-3 border border-hairline bg-ink p-3 text-sm"
        >
          <p className="text-display">
            Sold at {formatEthWithUnit(salePrice)} - you received the full
            winning bid and the buyer received the NFT, atomically in the same
            transaction.
          </p>
          {buyer !== undefined ? (
            <p className="mt-1 text-muted">Buyer: {buyer}</p>
          ) : null}
        </div>
      ) : null}

      <SellerActions
        auctionAddress={address}
        status={status}
        seller={seller}
        onSuccess={onRefresh}
      />
    </li>
  );
}

interface ChainRowProps {
  address: `0x${string}`;
  account: `0x${string}`;
  onRefresh: () => void;
}

/**
 * Reads one enumerated auction straight from the contract and renders it
 * only when this wallet is the seller (defensive client-side filter, US2).
 * Every read refetches inside the 15 s SC-007 window.
 */
function ChainAuctionRow({ address, account, onRefresh }: ChainRowProps) {
  const query = { refetchInterval: LIST_REFRESH_MS };
  const sellerRead = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "seller",
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
  const expiresAtRead = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "expiresAt",
    query,
  });
  const startingPriceRead = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "startingPrice",
    query,
  });
  const salePriceRead = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "salePrice",
    query,
  });
  const buyerRead = useReadContract({
    address,
    abi: dutchAuctionAbi,
    functionName: "buyer",
    query,
  });

  const seller = typeof sellerRead.data === "string" ? sellerRead.data : undefined;
  if (seller === undefined || seller.toLowerCase() !== account.toLowerCase()) {
    return null;
  }

  const status = deriveStatus(
    {
      sold: soldRead.data === true,
      cancelled: cancelledRead.data === true,
      expiresAt:
        typeof expiresAtRead.data === "bigint" ? expiresAtRead.data : 0n,
    },
    nowSeconds(),
  );

  return (
    <AuctionRow
      address={address}
      seller={seller as `0x${string}`}
      status={status}
      startingPrice={
        typeof startingPriceRead.data === "bigint"
          ? startingPriceRead.data
          : undefined
      }
      salePrice={
        typeof salePriceRead.data === "bigint" ? salePriceRead.data : undefined
      }
      buyer={typeof buyerRead.data === "string" ? buyerRead.data : undefined}
      onRefresh={onRefresh}
    />
  );
}

interface ChainRegistryProps {
  /** False while the index API serves the list - the probe read stays off. */
  enabled: boolean;
  account: `0x${string}`;
  onRefresh: () => void;
}

/**
 * On-chain enumeration of the factory registry (T053 fallback, US2
 * independence): `auctionCount()` + `allAuctions(i)`, then one row per
 * address. The probe read is always issued but only enabled when the index
 * API is unreachable, so the API path never enumerates the registry.
 */
function ChainRegistry({ enabled, account, onRefresh }: ChainRegistryProps) {
  const factory = deployments.factory;

  const countRead = useReadContract({
    address: factory,
    abi: auctionFactoryAbi,
    functionName: "auctionCount",
    query: {
      enabled: enabled && factory !== undefined,
      refetchInterval: LIST_REFRESH_MS,
    },
  });
  const count = typeof countRead.data === "bigint" ? countRead.data : undefined;

  const contracts = useMemo(() => {
    if (count === undefined || factory === undefined) return [];
    return Array.from({ length: Number(count) }, (_, index) => ({
      address: factory,
      abi: auctionFactoryAbi,
      functionName: "allAuctions" as const,
      args: [BigInt(index)] as const,
    }));
  }, [count, factory]);

  const listRead = useReadContracts({
    contracts,
    query: {
      enabled: enabled && contracts.length > 0,
      refetchInterval: LIST_REFRESH_MS,
    },
  });

  const addresses = useMemo(() => {
    const entries = (listRead.data ?? []) as Array<{
      status?: string;
      result?: unknown;
    }>;
    const found: `0x${string}`[] = [];
    for (const entry of entries) {
      if (entry.status === "success" && isAddressLike(entry.result)) {
        found.push(entry.result);
      }
    }
    return found;
  }, [listRead.data]);

  if (!enabled) return null;

  return (
    <>
      {addresses.length === 0 && count !== undefined ? <EmptyState /> : null}
      {addresses.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-4">
          {addresses.map((address) => (
            <ChainAuctionRow
              key={address}
              address={address}
              account={account}
              onRefresh={onRefresh}
            />
          ))}
        </ul>
      ) : null}
    </>
  );
}

/**
 * Seller dashboard (FR-014, US2): list this wallet's auctions from the
 * index API first, falling back to factory enumeration on chain when the
 * API is unreachable (US2 independence). Rows link every seller action -
 * cancel while live, reclaim after expiry - and spell out sold outcomes.
 */
export default function MyAuctionsPage() {
  const account = useAccount();
  const address = account.address;
  const connected = account.isConnected === true && address !== undefined;

  const [items, setItems] = useState<ApiAuction[]>([]);
  const [source, setSource] = useState<ListSource | null>(null);
  const loadRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!connected || address === undefined) return;
    const seller = address.toLowerCase();
    let active = true;

    const load = async (): Promise<void> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(`/api/auctions?seller=${seller}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Auction index responded with ${response.status}`);
        }
        const body = (await response.json()) as { items?: ApiAuction[] };
        if (!active) return;
        setItems(Array.isArray(body.items) ? body.items : []);
        setSource("api");
      } catch {
        // API unreachable -> on-chain enumeration (US2 independence).
        if (active) setSource("chain");
      } finally {
        clearTimeout(timeout);
      }
    };

    loadRef.current = () => {
      void load();
    };
    void load();
    const interval = setInterval(() => {
      void load();
    }, LIST_REFRESH_MS);

    return () => {
      active = false;
      clearInterval(interval);
      loadRef.current = null;
    };
  }, [connected, address]);

  const refresh = () => {
    if (loadRef.current) loadRef.current();
  };

  const visible = useMemo(() => {
    if (address === undefined) return [];
    const accountAddress = address.toLowerCase();
    return items.filter(
      (item) =>
        isAddressLike(item.address) &&
        isAddressLike(item.seller) &&
        item.seller.toLowerCase() === accountAddress,
    );
  }, [items, address]);

  return (
    <main data-testid="MyAuctionsPage" className="mx-auto w-full max-w-6xl px-6 py-12">
      <h1 className="text-display-lg">My Auctions</h1>

      <NetworkGuard />

      {!connected || address === undefined ? (
        <p className="mt-8 text-display">Connect your wallet to see your auctions.</p>
      ) : (
        <>
          {source === null ? (
            <p role="status" aria-live="polite" className="mt-8 text-muted">
              Loading your auctions...
            </p>
          ) : null}

          {source === "api" ? (
            visible.length === 0 ? (
              <EmptyState />
            ) : (
              <ul className="mt-6 flex flex-col gap-4">
                {visible.map((item) => (
                  <AuctionRow
                    key={item.address}
                    address={item.address as `0x${string}`}
                    seller={item.seller as `0x${string}`}
                    status={apiStatus(item)}
                    tokenId={item.tokenId}
                    startingPrice={toBigInt(item.startingPrice)}
                    salePrice={toBigInt(item.salePrice)}
                    buyer={item.buyer ?? undefined}
                    onRefresh={refresh}
                  />
                ))}
              </ul>
            )
          ) : null}

          {source !== null ? (
            <ChainRegistry
              enabled={source === "chain"}
              account={address}
              onRefresh={refresh}
            />
          ) : null}
        </>
      )}
    </main>
  );
}

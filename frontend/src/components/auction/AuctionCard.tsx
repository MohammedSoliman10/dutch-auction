import { useMemo } from "react";
import { Link } from "react-router-dom";

import { useCurrentPrice } from "../../hooks/useCurrentPrice";
import { useMetadata } from "../../hooks/useMetadata";
import type { AuctionViewItem } from "../../hooks/useAuctions";
import { formatEthWithUnit } from "../../lib/format";
import { resolveMediaUrl } from "../../lib/ipfs";
import { deriveStatus } from "../../lib/price";
import type { AuctionStatus } from "../../lib/price";
import type { AuctionParams } from "../../lib/price";
import { Countdown } from "./Countdown";
import { PriceTicker } from "./PriceTicker";
import { StatusBadge } from "./StatusBadge";

export interface AuctionCardProps {
  auction: AuctionViewItem;
}

/**
 * Gallery card (T064): preview, ticking price and countdown for live
 * auctions; the FR-015 outcome afterwards - "sold at price P to buyer B" or
 * expired/cancelled with the seller named (US3.2). Metadata resolves through
 * useMetadata/ipfs with a placeholder fallback, and any metadata-derived link
 * follows FR-019: explicit link text, new tab only on user action, safe rel
 * attributes, never auto-executed.
 */
export function AuctionCard({ auction }: AuctionCardProps) {
  const params = useMemo<AuctionParams | null>(() => {
    if (
      auction.startingPrice === null ||
      auction.discountRate === null ||
      auction.duration === null ||
      auction.startAt === null ||
      auction.expiresAt === null
    ) {
      return null;
    }
    return {
      startingPrice: auction.startingPrice,
      discountRate: auction.discountRate,
      duration: BigInt(auction.duration),
      startAt: BigInt(auction.startAt),
      expiresAt: BigInt(auction.expiresAt),
    };
  }, [
    auction.startingPrice,
    auction.discountRate,
    auction.duration,
    auction.startAt,
    auction.expiresAt,
  ]);

  const current = useCurrentPrice(auction.address, params);
  const metadata = useMetadata(auction.tokenUri ?? undefined);

  const meta = metadata.status === "ready" ? metadata.metadata : null;
  // Placeholder fallback chain: fetched metadata -> indexer-cached copy ->
  // generic name (edge: missing or unresolvable metadata).
  const displayName = meta?.name ?? auction.nftName ?? "Unnamed NFT";
  const image =
    meta?.image ?? (auction.nftImage !== null ? resolveMediaUrl(auction.nftImage) : null);
  const externalHref = meta?.externalUrl ? resolveMediaUrl(meta.externalUrl) : null;

  // Re-derive the time-based status locally every second so a card flips to
  // expired the moment its countdown passes, without waiting for a refresh
  // (data-model section 1.2; sold/cancelled come from the settlement facts).
  const status: AuctionStatus =
    auction.expiresAt !== null
      ? deriveStatus(
          {
            sold: auction.status === "sold",
            cancelled: auction.status === "cancelled",
            expiresAt: BigInt(auction.expiresAt),
          },
          current.now,
        )
      : auction.status;
  const isLive = status === "live";

  let outcomeText: string | null = null;
  if (status === "sold") {
    const price =
      auction.salePrice !== null ? ` at ${formatEthWithUnit(auction.salePrice)}` : "";
    const buyer = auction.buyer !== null ? ` to ${auction.buyer}` : "";
    outcomeText = `Sold${price}${buyer}`;
  } else if (status === "expired") {
    outcomeText = `Expired - unsold. Seller ${auction.seller} can reclaim the NFT.`;
  } else if (status === "cancelled") {
    outcomeText = `Cancelled by seller ${auction.seller} - the NFT went back to them.`;
  }

  return (
    <li
      data-testid="auction-card"
      data-address={auction.address}
      className="flex flex-col border border-hairline bg-panel p-4"
    >
      {image !== null ? (
        <img
          src={image}
          alt={displayName}
          className="aspect-square w-full border border-hairline object-cover"
        />
      ) : (
        <div
          data-testid="nft-placeholder"
          role="img"
          aria-label="NFT preview placeholder"
          className="flex aspect-square w-full items-center justify-center border border-dashed border-hairline bg-ink font-display text-sm uppercase text-muted"
        >
          Preview unavailable
        </div>
      )}

      <p className="mt-3 font-display text-display-sm text-display">
        <Link
          to={`/auction/${auction.address}`}
          className="underline-offset-4 transition-colors hover:text-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
        >
          {displayName}
        </Link>
      </p>

      {/* Status + outcome announced when they change (FR-018). */}
      <div aria-live="polite" className="mt-2">
        <StatusBadge status={status} />
        {outcomeText !== null ? (
          <div
            data-testid="sale-outcome"
            className="mt-2 border border-hairline bg-ink p-3 text-sm"
          >
            <p className="text-display">{outcomeText}</p>
          </div>
        ) : null}
      </div>

      {isLive ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {params !== null ? (
            <PriceTicker price={current.price} />
          ) : (
            <span data-testid="price-unavailable" className="text-sm text-muted">
              Price unavailable
            </span>
          )}
          {auction.expiresAt !== null ? (
            <Countdown expiresAt={BigInt(auction.expiresAt)} now={current.now} />
          ) : null}
        </div>
      ) : null}

      <dl className="mt-3 grid gap-1 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted">Seller</dt>
          <dd data-testid="card-seller" className="break-all text-display">
            {auction.seller}
          </dd>
        </div>
        {auction.tokenId !== null ? (
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted">Token</dt>
            <dd className="text-display">#{auction.tokenId}</dd>
          </div>
        ) : null}
      </dl>

      {externalHref !== null ? (
        <a
          href={externalHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block break-all text-sm text-display underline underline-offset-4 transition-colors hover:text-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
        >
          {externalHref}
        </a>
      ) : null}
    </li>
  );
}

import { useCallback, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { isAddress } from "viem";
import { useReadContract } from "wagmi";

import { Countdown } from "../components/auction/Countdown";
import { PriceTicker } from "../components/auction/PriceTicker";
import { StatusBadge } from "../components/auction/StatusBadge";
import { BuyPanel } from "../components/wallet/BuyPanel";
import { NetworkGuard } from "../components/wallet/NetworkGuard";
import { dutchAuctionAbi, dutchAuctionNftAbi } from "../config/contracts";
import { useCurrentPrice } from "../hooks/useCurrentPrice";
import { useMetadata } from "../hooks/useMetadata";
import { formatEthWithUnit, formatRate } from "../lib/format";
import { resolveMediaUrl } from "../lib/ipfs";
import { deriveStatus } from "../lib/price";
import type { AuctionParams } from "../lib/price";

export default function AuctionPage() {
  const { address } = useParams<{ address: string }>();
  const auctionAddress =
    address !== undefined && isAddress(address) ? (address as `0x${string}`) : undefined;

  const seller = useReadContract({
    address: auctionAddress,
    abi: dutchAuctionAbi,
    functionName: "seller",
    query: { enabled: auctionAddress !== undefined },
  });
  const startingPrice = useReadContract({
    address: auctionAddress,
    abi: dutchAuctionAbi,
    functionName: "startingPrice",
    query: { enabled: auctionAddress !== undefined },
  });
  const discountRate = useReadContract({
    address: auctionAddress,
    abi: dutchAuctionAbi,
    functionName: "discountRate",
    query: { enabled: auctionAddress !== undefined },
  });
  const duration = useReadContract({
    address: auctionAddress,
    abi: dutchAuctionAbi,
    functionName: "duration",
    query: { enabled: auctionAddress !== undefined },
  });
  const startAt = useReadContract({
    address: auctionAddress,
    abi: dutchAuctionAbi,
    functionName: "startAt",
    query: { enabled: auctionAddress !== undefined },
  });
  const expiresAt = useReadContract({
    address: auctionAddress,
    abi: dutchAuctionAbi,
    functionName: "expiresAt",
    query: { enabled: auctionAddress !== undefined },
  });
  const sold = useReadContract({
    address: auctionAddress,
    abi: dutchAuctionAbi,
    functionName: "sold",
    query: { enabled: auctionAddress !== undefined },
  });
  const cancelled = useReadContract({
    address: auctionAddress,
    abi: dutchAuctionAbi,
    functionName: "cancelled",
    query: { enabled: auctionAddress !== undefined },
  });
  const buyer = useReadContract({
    address: auctionAddress,
    abi: dutchAuctionAbi,
    functionName: "buyer",
    query: { enabled: auctionAddress !== undefined },
  });
  const salePrice = useReadContract({
    address: auctionAddress,
    abi: dutchAuctionAbi,
    functionName: "salePrice",
    query: { enabled: auctionAddress !== undefined },
  });
  const nft = useReadContract({
    address: auctionAddress,
    abi: dutchAuctionAbi,
    functionName: "nft",
    query: { enabled: auctionAddress !== undefined },
  });
  const nftId = useReadContract({
    address: auctionAddress,
    abi: dutchAuctionAbi,
    functionName: "nftId",
    query: { enabled: auctionAddress !== undefined },
  });
  const tokenUri = useReadContract({
    address: nft.data,
    abi: dutchAuctionNftAbi,
    functionName: "tokenURI",
    args: [nftId.data ?? 0n],
    query: { enabled: nft.data !== undefined && nftId.data !== undefined },
  });

  const params = useMemo<AuctionParams | null>(() => {
    if (
      startingPrice.data === undefined ||
      discountRate.data === undefined ||
      duration.data === undefined ||
      startAt.data === undefined ||
      expiresAt.data === undefined
    ) {
      return null;
    }
    return {
      startingPrice: startingPrice.data,
      discountRate: discountRate.data,
      duration: duration.data,
      startAt: startAt.data,
      expiresAt: expiresAt.data,
    };
  }, [
    startingPrice.data,
    discountRate.data,
    duration.data,
    startAt.data,
    expiresAt.data,
  ]);

  const current = useCurrentPrice(auctionAddress, params);
  const metadata = useMetadata(tokenUri.data);

  // Refetch terminal-state fields after a confirmed purchase (SC-007 visibility).
  // The read results are refreshed every render, so the callbacks live behind a
  // ref to keep this callback stable for the BuyPanel effect.
  const outcomeReads = useRef({ sold, cancelled, buyer, salePrice });
  outcomeReads.current = { sold, cancelled, buyer, salePrice };
  const refreshOutcome = useCallback(() => {
    void outcomeReads.current.sold.refetch();
    void outcomeReads.current.cancelled.refetch();
    void outcomeReads.current.buyer.refetch();
    void outcomeReads.current.salePrice.refetch();
  }, []);

  if (auctionAddress === undefined) {
    return (
      <main data-testid="AuctionPage" className="mx-auto w-full max-w-6xl px-6 py-12">
        <h1 className="text-display-lg">Auction</h1>
        <p className="mt-4 text-muted">
          This auction link is not a valid address - check the URL and try again.
        </p>
      </main>
    );
  }

  if (
    params === null ||
    seller.data === undefined ||
    expiresAt.data === undefined ||
    sold.data === undefined ||
    cancelled.data === undefined
  ) {
    return (
      <main data-testid="AuctionPage" className="mx-auto w-full max-w-6xl px-6 py-12">
        <h1 className="text-display-lg">Auction</h1>
        <p className="mt-4 text-muted">Loading auction...</p>
      </main>
    );
  }

  const status = deriveStatus(
    { sold: sold.data, cancelled: cancelled.data, expiresAt: expiresAt.data },
    current.now,
  );
  const meta = metadata.status === "ready" ? metadata.metadata : null;
  const displayName = meta?.name ?? "Unnamed NFT";
  const image = meta?.image ?? null;
  const externalHref = meta?.externalUrl ? resolveMediaUrl(meta.externalUrl) : null;

  return (
    <main data-testid="AuctionPage" className="mx-auto w-full max-w-6xl px-6 py-12">
      <h1 className="text-display-lg">Auction</h1>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-label="NFT preview" className="border border-hairline bg-panel p-4">
          <h2 className="font-display text-xs uppercase tracking-wide text-muted">
            NFT
          </h2>
          {image ? (
            <img
              src={image}
              alt={displayName}
              className="mt-3 aspect-square w-full border border-hairline object-cover"
            />
          ) : (
            <div
              data-testid="nft-placeholder"
              role="img"
              aria-label="NFT preview placeholder"
              className="mt-3 flex aspect-square w-full items-center justify-center border border-dashed border-hairline bg-ink font-display text-sm uppercase text-muted"
            >
              Preview unavailable
            </div>
          )}
          <p className="mt-3 font-display text-display-sm text-display">{displayName}</p>
          {meta?.description ? <p className="mt-1 text-muted">{meta.description}</p> : null}
          {externalHref ? (
            <a
              href={externalHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block break-all text-display underline underline-offset-4 transition-colors hover:text-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
            >
              {externalHref}
            </a>
          ) : null}
        </section>

        <section aria-label="Auction details" className="border border-hairline bg-panel p-4">
          <h2 className="font-display text-xs uppercase tracking-wide text-muted">
            Details
          </h2>
          <dl className="mt-3 grid gap-3">
            <div>
              <dt className="font-display text-xs uppercase tracking-wide text-muted">
                Seller
              </dt>
              <dd data-testid="seller" className="mt-0.5 break-all font-body text-sm text-display">
                {seller.data}
              </dd>
            </div>
            <div>
              <dt className="font-display text-xs uppercase tracking-wide text-muted">
                Starting price
              </dt>
              <dd data-testid="starting-price" className="mt-0.5 text-display">
                {formatEthWithUnit(params.startingPrice)}
              </dd>
            </div>
            <div>
              <dt className="font-display text-xs uppercase tracking-wide text-muted">
                Current price
              </dt>
              <dd className="mt-0.5">
                <PriceTicker price={current.price} />
              </dd>
            </div>
            <div>
              <dt className="font-display text-xs uppercase tracking-wide text-muted">
                Discount rate
              </dt>
              <dd data-testid="discount-rate" className="mt-0.5 text-display">
                {formatRate(params.discountRate)}
              </dd>
            </div>
            <div>
              <dt className="font-display text-xs uppercase tracking-wide text-muted">
                Time remaining
              </dt>
              <dd className="mt-0.5">
                <Countdown expiresAt={params.expiresAt} now={current.now} />
              </dd>
            </div>
            <div>
              <dt className="font-display text-xs uppercase tracking-wide text-muted">
                Status
              </dt>
              <dd className="mt-0.5">
                <StatusBadge status={status} />
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="mt-6 flex flex-col gap-6">
        <NetworkGuard />
        <BuyPanel
          auctionAddress={auctionAddress}
          price={current.price}
          status={status}
          onSuccess={refreshOutcome}
        />
      </div>
    </main>
  );
}

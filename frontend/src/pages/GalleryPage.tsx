import { useState } from "react";
import { Link } from "react-router-dom";

import { AuctionCard } from "@/components/auction/AuctionCard";
import { Button } from "@/components/ui/Button";
import { useAuctions } from "@/hooks/useAuctions";
import type { AuctionStatusFilter } from "@/hooks/useAuctions";

const FILTERS: ReadonlyArray<{ value: AuctionStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "sold", label: "Sold" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

interface EmptyStateProps {
  filter: AuctionStatusFilter;
  onShowAll: () => void;
}

/**
 * Explicit empty states (FR-014, Edge Cases): each one names WHY it is empty
 * and WHAT to do next instead of a bare "nothing here".
 */
function EmptyState({ filter, onShowAll }: EmptyStateProps) {
  if (filter === "live") {
    return (
      <section className="mt-6 border border-hairline bg-panel p-6 text-center">
        <p className="text-display">No live auctions right now</p>
        <p className="mt-2 text-muted">
          Every auction on the list has already ended - live auctions show up
          here while they are running.
        </p>
        <p className="mt-1 text-muted">
          Check back soon, or browse the ended auctions to see who won.
        </p>
        <Button variant="secondary" className="mt-4" onClick={onShowAll}>
          Show all auctions
        </Button>
      </section>
    );
  }

  if (filter === "all") {
    return (
      <section className="mt-6 border border-hairline bg-panel p-6 text-center">
        <p className="text-display">No auctions yet</p>
        <p className="mt-2 text-muted">
          Nothing has been listed for auction yet - every gallery starts with a
          minted NFT.
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

  return (
    <section className="mt-6 border border-hairline bg-panel p-6 text-center">
      <p className="text-display">No auctions match this filter</p>
      <p className="mt-2 text-muted">
        There are no {filter} auctions in the gallery right now.
      </p>
      <p className="mt-1 text-muted">Clear the filter to see every auction.</p>
      <Button variant="secondary" className="mt-4" onClick={onShowAll}>
        Show all auctions
      </Button>
    </section>
  );
}

/**
 * Gallery (T062/T063, FR-014/FR-020, US3): browsable auction cards with a
 * status filter and cursor paging. The index API is primary; when it is
 * unreachable the page serves factory-discovered auctions straight from the
 * chain (FR-020) - that path is a normal, fully supported data source, so it
 * is not bannered as an error - and every empty state names why it is empty
 * and what to do next. A live auction is one click away from this page - no
 * address pasting (SC-009).
 */
export default function GalleryPage() {
  const [filter, setFilter] = useState<AuctionStatusFilter>("all");
  const { items, nextCursor, source, isLoading, isLoadingMore, error, refetch, loadMore } =
    useAuctions({ status: filter });

  const announcement =
    error !== null
      ? `${error.what}. ${error.next}`
      : isLoading
        ? "Loading auctions..."
        : `Showing ${items.length} auction${items.length === 1 ? "" : "s"}${
            filter === "all" ? "" : ` - filter: ${filter}`
          }`;

  return (
    <main data-testid="GalleryPage" className="mx-auto w-full max-w-6xl px-6 py-12">
      <h1 className="text-display-lg">Gallery</h1>
      <p className="mt-2 text-muted">
        Every auction in one place - live, sold, expired and cancelled.
      </p>

      <div
        role="group"
        aria-label="Filter auctions by status"
        className="mt-6 flex flex-wrap gap-2"
      >
        {FILTERS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            data-testid={`filter-${entry.value}`}
            aria-pressed={filter === entry.value}
            onClick={() => setFilter(entry.value)}
            className={[
              "border px-3 py-1.5 font-display text-xs uppercase tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember",
              filter === entry.value
                ? "border-display text-display"
                : "border-hairline text-muted hover:text-display",
            ].join(" ")}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <p
        role="status"
        aria-live="polite"
        data-testid="gallery-status"
        className="mt-4 text-sm text-muted"
      >
        {announcement}
      </p>

      {error !== null ? (
        <div
          data-testid="gallery-error"
          className="mt-6 border border-hairline bg-panel p-6 text-center"
        >
          <p className="text-display">{error.what}</p>
          <p className="mt-2 text-muted">{error.next}</p>
          <Button className="mt-4" onClick={refetch}>
            Retry
          </Button>
        </div>
      ) : null}

      {error === null && !isLoading ? (
        items.length === 0 ? (
          <EmptyState filter={filter} onShowAll={() => setFilter("all")} />
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <AuctionCard key={item.address} auction={item} />
            ))}
          </ul>
        )
      ) : null}

      {source === "api" && nextCursor !== null ? (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" loading={isLoadingMore} onClick={loadMore}>
            Load more auctions
          </Button>
        </div>
      ) : null}
    </main>
  );
}

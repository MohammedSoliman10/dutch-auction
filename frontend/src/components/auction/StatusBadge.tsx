import type { AuctionStatus } from "../../lib/price";
import { Badge } from "../ui/Badge";

export interface StatusBadgeProps {
  status: AuctionStatus;
}

/**
 * Auction status with the verbatim data-model values rendered as-is:
 * live | sold | expired | cancelled (FR-004).
 */
export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span data-testid="status" className="inline-flex items-center gap-2">
      <span className="font-display text-xs uppercase tracking-wide text-muted">
        Status
      </span>
      <Badge status={status}>{status}</Badge>
    </span>
  );
}

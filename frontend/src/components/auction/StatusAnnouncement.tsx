import { useEffect, useRef, useState } from "react";

import type { AuctionStatus } from "../../lib/price";

export interface StatusAnnouncementProps {
  status: AuctionStatus;
}

/**
 * Polite announcement of auction status transitions (FR-018): the badge itself
 * only changes visually, so live -> sold/expired/cancelled would be silent for
 * screen-reader users. The region mounts empty and only speaks on a real
 * transition - no announcement spam while the countdown ticks.
 *
 * Deliberately `aria-live="polite"` without `role="status"`: pages already
 * dedicate their role=status region to transaction outcomes, and every status
 * change here is a content change inside a persistent live region, which is
 * what FR-018 requires for programmatic announcement.
 */
export function StatusAnnouncement({ status }: StatusAnnouncementProps) {
  const previous = useRef<AuctionStatus | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const before = previous.current;
    previous.current = status;
    if (before !== null && before !== status) {
      setAnnouncement(`Auction status changed from ${before} to ${status}.`);
    }
  }, [status]);

  return (
    <span
      data-testid="status-announcement"
      aria-live="polite"
      className="sr-only"
    >
      {announcement}
    </span>
  );
}

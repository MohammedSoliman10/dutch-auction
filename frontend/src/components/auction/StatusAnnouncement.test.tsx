// T066 (FR-018): auction status transitions must be programmatically announced
// - tx outcomes already have live regions in BuyPanel/Mint/Create/SellerActions,
// but the auction's own status (live -> sold/expired/cancelled) changes without
// any wallet transaction, so it needs its own polite live region.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusAnnouncement } from "./StatusAnnouncement";

describe("StatusAnnouncement (T066, FR-018 status transitions)", () => {
  it("mounts an empty polite live region so later changes are announced", () => {
    render(<StatusAnnouncement status="live" />);
    const region = screen.getByTestId("status-announcement");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("");
  });

  it("announces a transition once the status changes", () => {
    const view = render(<StatusAnnouncement status="live" />);
    expect(screen.getByTestId("status-announcement")).toHaveTextContent("");

    view.rerender(<StatusAnnouncement status="expired" />);
    const region = screen.getByTestId("status-announcement");
    expect(region).toHaveTextContent(/changed from live to expired/i);

    // Stable while the status stays the same - no announcement spam.
    view.rerender(<StatusAnnouncement status="expired" />);
    expect(region).toHaveTextContent(/changed from live to expired/i);
  });

  it("announces settlement transitions (live -> sold) too", () => {
    const view = render(<StatusAnnouncement status="live" />);
    view.rerender(<StatusAnnouncement status="sold" />);
    expect(screen.getByTestId("status-announcement")).toHaveTextContent(
      /changed from live to sold/i,
    );
  });
});

// T066 keyboard sweep (FR-018): the pre-sign dialog must be fully operable
// from the keyboard - focus enters the dialog, Tab cycles within it, Escape
// cancels, and focus returns to the control that opened it.
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TxSummaryModal } from "./TxSummaryModal";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
        Buy now
      </button>
      {open ? (
        <TxSummaryModal
          summary={{ action: "Buy NFT", amountEth: "0.05 ETH" }}
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

describe("TxSummaryModal (T066, FR-018 keyboard)", () => {
  it("moves focus to Confirm when the dialog opens", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByTestId("trigger"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm/i })).toHaveFocus();
  });

  it("cycles Tab inside the dialog instead of escaping into the page behind it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByTestId("trigger"));

    const confirm = screen.getByRole("button", { name: /confirm/i });
    const cancel = screen.getByRole("button", { name: /cancel/i });
    expect(confirm).toHaveFocus();

    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(cancel).toHaveFocus();

    // From the last control, Tab wraps back into the dialog.
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(confirm).toHaveFocus();

    // Shift+Tab from the first control wraps to the last.
    fireEvent.keyDown(confirm, { key: "Tab", shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it("Escape cancels and returns focus to the control that opened it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByTestId("trigger");
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("button", { name: /confirm/i }), {
      key: "Escape",
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

import { useEffect, useRef } from "react";

import type { TxSummary } from "../../hooks/useTxFlow";
import { Button } from "../ui/Button";

export interface TxSummaryModalProps {
  summary: TxSummary;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Pre-signature plain-language summary (FR-019, US1.8): shown before any
 * wallet prompt - the wallet is only asked to sign once Confirm is pressed.
 * Keyboard operable (FR-018): focus lands on Confirm, Escape cancels.
 */
export function TxSummaryModal({ summary, onConfirm, onCancel }: TxSummaryModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = "tx-summary-title";

  useEffect(() => {
    dialogRef.current?.querySelector("button")?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 p-6"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md border border-hairline bg-panel p-6"
      >
        <h2 id={titleId} className="text-display-md text-display">
          Confirm before your wallet opens
        </h2>
        <p className="mt-4 font-display text-sm uppercase tracking-wide text-display">
          {summary.action}
        </p>
        {summary.amountEth ? (
          <p className="mt-2 font-display text-display-sm text-display">
            Amount: {summary.amountEth}
          </p>
        ) : null}
        {summary.detail ? <p className="mt-2 text-muted">{summary.detail}</p> : null}
        <p className="mt-4 text-muted">
          Your wallet will ask you to confirm next. Nothing has been sent yet.
        </p>
        <div className="mt-6 flex gap-3">
          <Button onClick={onConfirm}>Confirm</Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

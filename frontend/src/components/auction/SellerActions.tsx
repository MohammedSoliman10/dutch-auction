import { useAccount, usePublicClient, useWriteContract } from "wagmi";

import { Button } from "@/components/ui/Button";
import { TxSummaryModal } from "@/components/wallet/TxSummaryModal";
import { dutchAuctionAbi } from "@/config/contracts";
import { useTxFlow } from "@/hooks/useTxFlow";
import { assertTxConfirmed } from "@/lib/errors";
import type { AuctionStatus } from "@/lib/price";

export interface SellerActionsProps {
  auctionAddress: `0x${string}`;
  status: AuctionStatus;
  seller: `0x${string}`;
  /** Called after a confirmed cancel/reclaim so the page can refresh (US2.5). */
  onSuccess?: () => void;
}

interface ActionPlan {
  functionName: "cancel" | "reclaim";
  label: string;
  /** Plain-language note announced once the transaction confirms (US2.5). */
  doneNote: string;
}

const PLANS: Record<"live" | "expired", ActionPlan> = {
  live: {
    functionName: "cancel",
    label: "Cancel auction",
    doneNote: "Cancelled - your NFT was returned to your wallet.",
  },
  expired: {
    functionName: "reclaim",
    label: "Reclaim NFT",
    doneNote: "Reclaimed - your NFT is back in your wallet.",
  },
};

/**
 * Seller-only auction controls (FR-013, US2.5): cancel while the auction is
 * live, reclaim once it has expired. Every path guards before any transaction
 * (US2.3) - wrong wallet, disconnected wallet, or a status that forbids the
 * action all block the write with the plain-language reason on screen.
 */
export function SellerActions({
  auctionAddress,
  status,
  seller,
  onSuccess,
}: SellerActionsProps) {
  const account = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const tx = useTxFlow();

  // Terminal statuses offer no actions at all (a sold or cancelled auction
  // has already settled - there is nothing left to manage).
  if (status !== "live" && status !== "expired") return null;

  const plan = PLANS[status];
  const connected = account.isConnected && account.address !== undefined;
  const isSeller =
    connected &&
    seller !== undefined &&
    (account.address ?? "").toLowerCase() === seller.toLowerCase();
  const canManage = connected && isSeller;

  const inFlight =
    tx.state === "awaiting_signature" ||
    tx.state === "pending" ||
    tx.state === "confirming";
  // Re-entrancy guard: one action at a time (US2.6 ordering discipline).
  const busy = !canManage || inFlight || tx.state === "success";
  // Only the status-appropriate action is offered; the other stays visible
  // but disabled so the plain-language guard explains why (FR-013).
  const cancelDisabled = status !== "live" || busy;
  const reclaimDisabled = status !== "expired" || busy;
  const blocked = cancelDisabled && reclaimDisabled;

  function startAction(): void {
    // US2.3: every guard runs before the summary - no transaction is staged.
    if (blocked) return;
    void tx.run({
      summary: {
        action: plan.label,
        detail:
          plan.functionName === "cancel"
            ? "Cancelling returns the NFT to your wallet and ends the auction."
            : "Reclaiming returns the expired auction's NFT to your wallet.",
      },
      execute: async () => {
        const hash = await writeContractAsync({
          address: auctionAddress,
          abi: dutchAuctionAbi,
          functionName: plan.functionName,
        });
        return {
          hash,
          wait: async () => {
            if (!publicClient) {
              throw new Error("Network client unavailable");
            }
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            assertTxConfirmed(receipt);
            onSuccess?.();
            return receipt;
          },
        };
      },
    });
  }

  const hint =
    status === "live" ? (
      <p className="mt-2 text-sm text-muted">The auction has not expired yet</p>
    ) : (
      <p className="mt-2 text-sm text-muted">This auction is no longer live</p>
    );

  return (
    <section
      aria-label="Manage auction"
      className="mt-4 border border-hairline bg-panel p-4"
    >
      <h3 className="font-display text-sm uppercase tracking-wide text-muted">
        Seller actions
      </h3>

      {!connected ? (
        <p className="mt-2 text-muted">
          Connect your wallet to manage this auction.
        </p>
      ) : null}
      {connected && !isSeller ? (
        <p role="alert" className="mt-2 text-display">
          Only the seller can do this
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-3">
        <Button
          variant="danger"
          onClick={startAction}
          disabled={cancelDisabled}
        >
          Cancel auction
        </Button>
        <Button
          variant="secondary"
          onClick={startAction}
          disabled={reclaimDisabled}
        >
          Reclaim NFT
        </Button>
      </div>

      {/* Plain-language guard for whichever action the status forbids. */}
      {hint}

      {tx.state === "rejected" || tx.state === "failed" ? (
        <Button variant="secondary" className="mt-3" onClick={() => void tx.retry()}>
          Retry
        </Button>
      ) : null}

      {/* FR-018: transaction outcomes announced for screen readers. */}
      <div
        role="status"
        aria-live="polite"
        className="mt-4 border border-hairline bg-ink p-3 text-sm"
      >
        {tx.message ? (
          <>
            <p className="font-display text-xs uppercase tracking-wide text-display">
              {tx.message.what}
            </p>
            <p className="mt-1 text-muted">{tx.message.next}</p>
          </>
        ) : null}
        {tx.state === "success" ? (
          <p className="mt-2 text-display">{plan.doneNote}</p>
        ) : null}
      </div>

      {tx.state === "awaiting_signature" && tx.summary ? (
        <TxSummaryModal
          summary={tx.summary}
          onConfirm={() => void tx.confirm()}
          onCancel={tx.reset}
        />
      ) : null}
    </section>
  );
}

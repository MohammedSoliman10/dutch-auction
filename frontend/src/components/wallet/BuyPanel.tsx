import { useEffect, useState } from "react";
import { parseEther } from "viem";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";

import { SEPOLIA_CHAIN_ID } from "../../config/chains";
import { dutchAuctionAbi } from "../../config/contracts";
import { assertTxConfirmed, ERROR_MESSAGES } from "../../lib/errors";
import { formatEth, formatEthWithUnit } from "../../lib/format";
import type { AuctionStatus } from "../../lib/price";
import { useTxFlow } from "../../hooks/useTxFlow";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { TxSummaryModal } from "./TxSummaryModal";

export interface BuyPanelProps {
  auctionAddress: `0x${string}`;
  price: bigint;
  status: AuctionStatus;
  /** Called after a confirmed purchase so the page refetches outcome fields. */
  onSuccess?: () => void;
}

interface PaymentIssue {
  what: string;
  next: string;
}

/**
 * Buy flow (FR-006, FR-007, US1): payment defaults to the current price,
 * overpayment is refunded in the same purchase, rejection reasons are shown
 * before any transaction is sent, and the wallet prompt only happens after
 * the pre-sign summary is confirmed (FR-019).
 */
export function BuyPanel({ auctionAddress, price, status, onSuccess }: BuyPanelProps) {
  const account = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const tx = useTxFlow();

  const [rawAmount, setRawAmount] = useState("");
  const [touched, setTouched] = useState(false);
  const [issue, setIssue] = useState<PaymentIssue | null>(null);

  // Default to the live price until the buyer edits the amount.
  const amount = touched ? rawAmount : formatEth(price);

  // Same source as NetworkGuard: the wallet's own chain wins over the
  // configured fallback so both components agree on a wrong network.
  const activeChainId = account.chainId ?? chainId;
  const wrongNetwork = account.isConnected === true && activeChainId !== SEPOLIA_CHAIN_ID;
  const inFlight =
    tx.state === "awaiting_signature" ||
    tx.state === "pending" ||
    tx.state === "confirming";
  // T042: one purchase in flight; controls also disable when status is not
  // live (expiry while the page is open) or after a confirmed purchase.
  const buyDisabled =
    status !== "live" || !account.isConnected || wrongNetwork || inFlight || tx.state === "success";

  useEffect(() => {
    if (tx.state === "success") onSuccess?.();
  }, [tx.state, onSuccess]);

  const statusReason =
    status === "expired"
      ? ERROR_MESSAGES.AuctionExpired
      : status === "sold"
        ? ERROR_MESSAGES.AlreadySold
        : status === "cancelled"
          ? ERROR_MESSAGES.AlreadyCancelled
          : null;

  function handleBuy(): void {
    if (buyDisabled) return;

    let value: bigint;
    try {
      value = parseEther(amount);
    } catch {
      setIssue({
        what: "The amount is not a valid ETH value",
        next: "Enter an amount like 0.05 and try again",
      });
      return;
    }
    // FR-007 pre-check: reject before any wallet prompt, no funds at risk.
    if (value < price) {
      setIssue({
        what: ERROR_MESSAGES.InsufficientPayment.what,
        next: `Increase it to at least ${formatEthWithUnit(price)} and try again`,
      });
      return;
    }

    const refund = value - price;
    setIssue(null);
    void tx.run({
      summary: {
        action: "Buy NFT",
        amountEth: formatEthWithUnit(value),
        detail:
          refund > 0n
            ? `Refund of ${formatEthWithUnit(refund)} returns to you in the same transaction.`
            : undefined,
      },
      execute: async () => {
        const hash = await writeContractAsync({
          address: auctionAddress,
          abi: dutchAuctionAbi,
          functionName: "buy",
          value,
        });
        return {
          hash,
          wait: async () => {
            if (!publicClient) {
              return Promise.reject(new Error("Network client unavailable"));
            }
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            // SC-004/FR-003: waitForTransactionReceipt resolves on a reverted
            // receipt too - a failed purchase must surface as a mapped
            // failure with retry, never as a silent "confirmed".
            assertTxConfirmed(receipt);
            return receipt;
          },
        };
      },
    });
  }

  return (
    <section aria-label="Buy" className="border border-hairline bg-panel p-4">
      <h2 className="font-display text-sm uppercase tracking-wide text-muted">Buy</h2>

      <p className="mt-2 text-muted">
        Pay the current price or more - anything above it is refunded to you in the
        same purchase.
      </p>

      {statusReason ? (
        <p className="mt-3 text-display">{statusReason.what}</p>
      ) : null}
      {!account.isConnected ? (
        <p className="mt-3 text-display">Connect your wallet to buy this NFT.</p>
      ) : null}

      <div className="mt-4 max-w-sm">
        <Input
          label="Amount to pay"
          inputMode="decimal"
          value={amount}
          error={issue?.what}
          onChange={(event) => {
            setTouched(true);
            setRawAmount(event.target.value);
            setIssue(null);
          }}
        />
        {issue ? <p className="mt-1 text-sm text-muted">{issue.next}</p> : null}
      </div>

      <Button className="mt-4" onClick={handleBuy} disabled={buyDisabled}>
        Buy now
      </Button>

      {/* FR-018: transaction status changes announced for screen readers. */}
      <div role="status" aria-live="polite" className="mt-4 border border-hairline bg-ink p-3 text-sm">
        {tx.message ? (
          <>
            <p className="font-display text-xs uppercase tracking-wide text-display">
              {tx.message.what}
            </p>
            <p className="mt-1 text-muted">{tx.message.next}</p>
          </>
        ) : null}
      </div>

      {tx.state === "rejected" || tx.state === "failed" ? (
        <Button variant="secondary" className="mt-3" onClick={() => void tx.retry()}>
          Retry
        </Button>
      ) : null}
      {tx.state === "success" ? (
        <Button variant="secondary" className="mt-3" onClick={tx.reset}>
          Close
        </Button>
      ) : null}

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

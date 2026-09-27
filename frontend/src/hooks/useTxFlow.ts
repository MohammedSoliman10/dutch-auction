import { useCallback, useMemo, useRef, useState } from "react";

import type { AppError } from "../lib/errors";
import { mapTxError } from "../lib/errors";

export type TxFlowState =
  | "idle"
  | "awaiting_signature"
  | "pending"
  | "confirming"
  | "success"
  | "rejected"
  | "failed";

export interface TxSummary {
  action: string;
  amountEth?: string;
  detail?: string;
}

export interface TxFlowMessage {
  what: string;
  next: string;
}

export interface TxHandle {
  hash: `0x${string}`;
  wait: () => Promise<unknown>;
}

export interface TxRunOptions {
  summary: TxSummary;
  execute: (summary: TxSummary) => Promise<TxHandle>;
}

export interface UseTxFlowResult {
  state: TxFlowState;
  summary: TxSummary | null;
  txHash: `0x${string}` | null;
  error: AppError | null;
  message: TxFlowMessage | null;
  /** Stages the action and shows the pre-sign summary (FR-019) - no wallet prompt yet. */
  run: (options: TxRunOptions) => Promise<void>;
  /** Called after the user confirms the summary: requests the wallet signature. */
  confirm: () => Promise<void>;
  /** From rejected/failed: re-offers the summary for another attempt (FR-003). */
  retry: () => Promise<void>;
  reset: () => void;
}

// Yields a macrotask so React can render the pending state before the
// confirmation wait starts (a same-tick transition would batch straight past it).
function yieldToRenderer(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function buildMessage(
  state: TxFlowState,
  summary: TxSummary | null,
  error: AppError | null,
): TxFlowMessage | null {
  const action = summary?.action;
  switch (state) {
    case "idle":
      return null;
    case "awaiting_signature":
      if (!summary) return null;
      return {
        what: summary.amountEth
          ? `${summary.action} - ${summary.amountEth} ETH`
          : summary.action,
        next: "Confirm in your wallet to continue, or reject to cancel. Nothing has been sent yet.",
      };
    case "pending":
      return {
        what: action ? `${action} submitted` : "Transaction submitted",
        next: "Waiting for the network to pick it up - keep this window open.",
      };
    case "confirming":
      return {
        what: action ? `${action} is confirming` : "Transaction is confirming",
        next: "This usually takes a few seconds - the page updates automatically.",
      };
    case "success":
      return {
        what: action ? `${action} confirmed` : "Transaction confirmed",
        next: "The result is final on-chain - no further action needed.",
      };
    case "rejected":
    case "failed":
      return error ? { what: error.what, next: error.next } : null;
  }
}

// Transaction state machine per data-model.md section 1.5 (FR-003):
// idle -> awaiting_signature -> pending(txHash) -> confirming -> success,
// with rejected/failed terminals. FR-019: run() only stages the action and
// surfaces the plain-language summary; the wallet prompt happens exclusively
// in confirm(), after the user accepts that summary. Terminal outcomes only
// touch this hook's own state: the caller's auction/session data is left
// unchanged, and retry() re-offers the summary from either terminal.
export function useTxFlow(): UseTxFlowResult {
  const [state, setState] = useState<TxFlowState>("idle");
  const [summary, setSummary] = useState<TxSummary | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  const stateRef = useRef<TxFlowState>("idle");
  const busyRef = useRef(false);
  const lastRunRef = useRef<TxRunOptions | null>(null);

  const transition = useCallback((next: TxFlowState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const stageRun = useCallback(
    (options: TxRunOptions): void => {
      // Re-entrancy guard: repeated triggers (double-click) are ignored.
      if (busyRef.current) return;
      lastRunRef.current = options;
      setSummary(options.summary);
      setError(null);
      setTxHash(null);
      transition("awaiting_signature");
    },
    [transition],
  );

  const executeRun = useCallback(
    async (options: TxRunOptions): Promise<void> => {
      // Re-entrancy guard: one transaction in flight, duplicates ignored.
      if (busyRef.current) return;
      busyRef.current = true;
      lastRunRef.current = options;

      setSummary(options.summary);
      setError(null);
      setTxHash(null);
      transition("awaiting_signature");

      try {
        const handle = await options.execute(options.summary);
        setTxHash(handle.hash);
        transition("pending");
        await yieldToRenderer();
        transition("confirming");
        await handle.wait();
        transition("success");
      } catch (err) {
        const appError = mapTxError(err);
        setError(appError);
        transition(appError.code === "USER_REJECTED" ? "rejected" : "failed");
      } finally {
        busyRef.current = false;
      }
    },
    [transition],
  );

  const run = useCallback(
    async (options: TxRunOptions): Promise<void> => {
      stageRun(options);
    },
    [stageRun],
  );

  const confirm = useCallback(async (): Promise<void> => {
    const options = lastRunRef.current;
    if (!options) return;
    if (stateRef.current !== "awaiting_signature") return;
    await executeRun(options);
  }, [executeRun]);

  const retry = useCallback(async (): Promise<void> => {
    if (stateRef.current !== "rejected" && stateRef.current !== "failed") return;
    const options = lastRunRef.current;
    if (!options) return;
    // Re-enter the summary step: FR-019 applies to the retried wallet prompt.
    stageRun(options);
  }, [stageRun]);

  const reset = useCallback(() => {
    lastRunRef.current = null;
    setSummary(null);
    setTxHash(null);
    setError(null);
    transition("idle");
  }, [transition]);

  const message = useMemo(
    () => buildMessage(state, summary, error),
    [state, summary, error],
  );

  return {
    state,
    summary,
    txHash,
    error,
    message,
    run,
    confirm,
    retry,
    reset,
  };
}

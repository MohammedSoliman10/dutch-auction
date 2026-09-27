import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTxFlow } from "./useTxFlow";
import type { TxRunOptions } from "./useTxFlow";

const HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeRun(execute: TxRunOptions["execute"]): TxRunOptions {
  return {
    summary: { action: "Buy NFT", amountEth: "0.05 ETH" },
    execute,
  };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTxFlow (T032, data-model 1.5 state machine + FR-003)", () => {
  it("starts idle with no summary and no message", () => {
    const { result } = renderHook(() => useTxFlow());
    expect(result.current.state).toBe("idle");
    expect(result.current.summary).toBeNull();
    expect(result.current.message).toBeNull();
    expect(result.current.txHash).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("run() shows the plain-language summary before any wallet prompt (FR-019)", async () => {
    const execute = vi.fn();
    const { result } = renderHook(() => useTxFlow());

    await act(async () => {
      await result.current.run(makeRun(execute));
    });

    expect(result.current.state).toBe("awaiting_signature");
    expect(result.current.summary).toEqual({
      action: "Buy NFT",
      amountEth: "0.05 ETH",
    });
    expect(result.current.message?.what).toContain("Buy NFT");
    expect(result.current.message?.what).toContain("0.05 ETH");
    expect(result.current.message?.next).toMatch(/confirm in your wallet/i);
    // No wallet interaction may happen before the user confirms the summary.
    expect(execute).not.toHaveBeenCalled();
  });

  it("confirm() walks pending -> confirming -> success and records the tx hash", async () => {
    const receipt = deferred<unknown>();
    const execute = vi.fn().mockResolvedValue({
      hash: HASH,
      wait: () => receipt.promise,
    });
    const states: string[] = [];
    const { result } = renderHook(() => {
      const snapshot = useTxFlow();
      states.push(snapshot.state);
      return snapshot;
    });

    await act(async () => {
      await result.current.run(makeRun(execute));
    });

    let inFlight: Promise<void> | undefined;
    await act(async () => {
      inFlight = result.current.confirm();
    });

    expect(result.current.state).toBe("pending");
    expect(result.current.txHash).toBe(HASH);
    expect(states).toContain("pending");
    expect(execute).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state).toBe("confirming");

    receipt.resolve({ status: "success" });
    await act(async () => {
      await inFlight;
    });
    expect(result.current.state).toBe("success");
    expect(result.current.message?.what).toMatch(/confirmed/i);
  });

  it("a wallet rejection ends in the rejected terminal with state unchanged and retry offered (US1.4)", async () => {
    // Models the caller's on-chain snapshot: terminals must never touch it.
    let auctionState = "live";
    const execute = vi
      .fn()
      .mockRejectedValue({ code: 4001, message: "User rejected the request" });
    const { result } = renderHook(() => useTxFlow());

    await act(async () => {
      await result.current.run(makeRun(execute));
      await result.current.confirm();
    });

    expect(result.current.state).toBe("rejected");
    expect(result.current.error?.code).toBe("USER_REJECTED");
    expect(result.current.error?.what).toMatch(/rejected the request in your wallet/i);
    expect(result.current.message?.next).toMatch(/retry/i);
    expect(result.current.txHash).toBeNull();
    expect(auctionState).toBe("live");
    expect(typeof result.current.retry).toBe("function");
  });

  it("retry() re-offers the summary, then confirm() re-attempts the transaction", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce({ code: 4001, message: "User rejected the request" })
      .mockResolvedValueOnce({
        hash: HASH,
        wait: () => Promise.resolve({ status: "success" }),
      });
    const { result } = renderHook(() => useTxFlow());

    await act(async () => {
      await result.current.run(makeRun(execute));
      await result.current.confirm();
    });
    expect(result.current.state).toBe("rejected");

    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.state).toBe("awaiting_signature");
    expect(result.current.error).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);

    await act(async () => {
      const second = result.current.confirm();
      await vi.advanceTimersByTimeAsync(0);
      await second;
    });
    expect(result.current.state).toBe("success");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("a contract failure ends in the failed terminal with a plain-language message (no hex)", async () => {
    const execute = vi
      .fn()
      .mockRejectedValue({ message: "Reverted with custom error: AlreadySold()" });
    const { result } = renderHook(() => useTxFlow());

    await act(async () => {
      await result.current.run(makeRun(execute));
      await result.current.confirm();
    });

    expect(result.current.state).toBe("failed");
    expect(result.current.error?.code).toBe("AlreadySold");
    const shown = `${result.current.message?.what} ${result.current.message?.next}`;
    expect(shown).toMatch(/already been sold/i);
    expect(shown).not.toMatch(/0x[0-9a-f]{6,}/i);
    expect(result.current.message?.next).toBeTruthy();
  });

  it("ignores a duplicate confirm while a transaction is in flight (double-click guard)", async () => {
    const execute = vi.fn().mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useTxFlow());

    await act(async () => {
      await result.current.run(makeRun(execute));
    });
    await act(async () => {
      void result.current.confirm();
      void result.current.confirm();
    });

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("retry() does nothing outside the rejected/failed terminals", async () => {
    const execute = vi.fn();
    const { result } = renderHook(() => useTxFlow());

    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.state).toBe("idle");
    expect(execute).not.toHaveBeenCalled();
  });

  it("reset() returns to idle and clears the summary", async () => {
    const execute = vi.fn();
    const { result } = renderHook(() => useTxFlow());

    await act(async () => {
      await result.current.run(makeRun(execute));
    });
    await act(async () => {
      result.current.reset();
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.summary).toBeNull();
    expect(result.current.message).toBeNull();
  });
});

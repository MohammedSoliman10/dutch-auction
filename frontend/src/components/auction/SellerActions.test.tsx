import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SEPOLIA_ID = 11155111;
const USER = "0x4444444444444444444444444444444444444444";
const OTHER = "0x9999999999999999999999999999999999999999";
const AUCTION = "0x5555555555555555555555555555555555555555";
const TX_HASH =
  "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

const h = vi.hoisted(() => ({
  readCalls: [] as Array<{ functionName?: string }>,
  writeContractAsync: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  account: {
    address: "0x4444444444444444444444444444444444444444",
    isConnected: true,
    chainId: 11155111,
  } as { address?: string; isConnected: boolean; chainId: number },
  chainIdFallback: 11155111,
}));

vi.mock("wagmi", () => ({
  useReadContract: (config: { functionName?: string }) => {
    h.readCalls.push(config);
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  },
  useReadContracts: () => ({
    data: [] as Array<{ status: "success"; result: unknown }>,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useWriteContract: () => ({
    writeContractAsync: h.writeContractAsync,
    isPending: false,
    reset: vi.fn(),
  }),
  usePublicClient: () => ({ waitForTransactionReceipt: h.waitForTransactionReceipt }),
  useAccount: () => ({
    address: h.account.address,
    isConnected: h.account.isConnected,
    chainId: h.account.chainId,
  }),
  useChainId: () => h.chainIdFallback,
  useBalance: () => ({ data: undefined, isLoading: false }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
}));

import type { AuctionStatus } from "@/lib/price";

import { SellerActions } from "./SellerActions";

function renderActions(status: AuctionStatus, seller = USER) {
  return render(
    <SellerActions
      auctionAddress={AUCTION as `0x${string}`}
      status={status}
      seller={seller as `0x${string}`}
    />,
  );
}

async function flushAsync() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    }
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.resetAllMocks();
  h.readCalls = [];
  h.chainIdFallback = SEPOLIA_ID;
  h.account = { address: USER, isConnected: true, chainId: SEPOLIA_ID };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SellerActions (T052, FR-013, US2.5)", () => {
  it("offers cancel while live and blocks reclaim with the plain-language expiry guard", () => {
    renderActions("live");

    expect(screen.getByRole("button", { name: /cancel auction/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /reclaim nft/i })).toBeDisabled();
    expect(screen.getByText("The auction has not expired yet")).toBeInTheDocument();
  });

  it("offers reclaim after expiry and blocks cancel with the plain-language not-live guard", () => {
    renderActions("expired");

    expect(screen.getByRole("button", { name: /reclaim nft/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /cancel auction/i })).toBeDisabled();
    expect(screen.getByText("This auction is no longer live")).toBeInTheDocument();
  });

  it("blocks a connected wallet that is not the seller before any transaction (NotSeller)", () => {
    h.account = { address: OTHER, isConnected: true, chainId: SEPOLIA_ID };
    renderActions("live");

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Only the seller can do this");
    expect(screen.getByRole("button", { name: /cancel auction/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /reclaim nft/i })).toBeDisabled();
    expect(h.writeContractAsync).not.toHaveBeenCalled();
  });

  it("asks a disconnected visitor to connect before managing the auction", () => {
    h.account = { address: undefined, isConnected: false, chainId: SEPOLIA_ID };
    renderActions("live");

    expect(screen.getByText(/connect your wallet to manage/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel auction/i })).toBeDisabled();
    expect(h.writeContractAsync).not.toHaveBeenCalled();
  });

  it("cancels a live auction after the summary and reports that the NFT returned (FR-013, US2.5)", async () => {
    h.writeContractAsync.mockResolvedValue(TX_HASH);
    h.waitForTransactionReceipt.mockResolvedValue({ status: "success", logs: [] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderActions("live");

    await user.click(screen.getByRole("button", { name: /cancel auction/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Cancel auction");
    expect(h.writeContractAsync).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));
    await flushAsync();

    expect(h.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(h.writeContractAsync).toHaveBeenCalledWith({
      address: AUCTION,
      abi: expect.anything(),
      functionName: "cancel",
    });
    expect(screen.getByRole("status")).toHaveTextContent(/confirmed/i);
    expect(screen.getByText(/your nft was returned to your wallet/i)).toBeInTheDocument();
  });

  it("reclaims an expired auction after the summary and reports the NFT is back (FR-013, US2.5)", async () => {
    h.writeContractAsync.mockResolvedValue(TX_HASH);
    h.waitForTransactionReceipt.mockResolvedValue({ status: "success", logs: [] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderActions("expired");

    await user.click(screen.getByRole("button", { name: /reclaim nft/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Reclaim NFT");
    expect(h.writeContractAsync).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));
    await flushAsync();

    expect(h.writeContractAsync).toHaveBeenCalledWith({
      address: AUCTION,
      abi: expect.anything(),
      functionName: "reclaim",
    });
    expect(screen.getByText(/your nft is back in your wallet/i)).toBeInTheDocument();
  });

  it("maps a NotLive cancel rejection to plain language with a retry path (FR-003)", async () => {
    h.writeContractAsync.mockRejectedValue({
      name: "TransactionExecutionError",
      cause: { name: "ContractFunctionRevertedError", errorName: "NotLive" },
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderActions("live");

    await user.click(screen.getByRole("button", { name: /cancel auction/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /confirm/i }),
    );
    await flushAsync();

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/no longer live/i);
    expect(status.textContent).not.toMatch(/0x[0-9a-f]{6,}/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("maps an AuctionNotExpired reclaim rejection to plain language (guard)", async () => {
    h.writeContractAsync.mockRejectedValue({
      name: "TransactionExecutionError",
      cause: { name: "ContractFunctionRevertedError", errorName: "AuctionNotExpired" },
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderActions("expired");

    await user.click(screen.getByRole("button", { name: /reclaim nft/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /confirm/i }),
    );
    await flushAsync();

    expect(screen.getByRole("status")).toHaveTextContent(/has not expired yet/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("maps a NotSeller rejection to plain language when the guard races (guard)", async () => {
    h.writeContractAsync.mockRejectedValue({
      name: "TransactionExecutionError",
      cause: { name: "ContractFunctionRevertedError", errorName: "NotSeller" },
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderActions("live");

    await user.click(screen.getByRole("button", { name: /cancel auction/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /confirm/i }),
    );
    await flushAsync();

    expect(screen.getByRole("status")).toHaveTextContent(/only the seller can do this/i);
  });

  it("shows no action buttons once the auction is sold or cancelled", () => {
    renderActions("sold");
    expect(screen.queryByRole("button", { name: /cancel auction/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reclaim nft/i })).not.toBeInTheDocument();

    renderActions("cancelled");
    expect(screen.queryByRole("button", { name: /cancel auction/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reclaim nft/i })).not.toBeInTheDocument();
  });
});

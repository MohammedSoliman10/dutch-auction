import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SEPOLIA_ID = 11155111;
const AUCTION = "0x1111111111111111111111111111111111111111";
const NFT = "0x2222222222222222222222222222222222222222";
const SELLER = "0x3333333333333333333333333333333333333333";
const BUYER = "0x4444444444444444444444444444444444444444";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TX_HASH =
  "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

const START = 1_767_225_600n;
const DURATION = 300n;
const STARTING_PRICE = 50_000_000_000_000_000n; // 0.05 ETH
const DISCOUNT_RATE = 100_000_000_000_000n; // 0.0001 ETH per second

const METADATA = {
  name: "Forge Relic #1",
  image: "ipfs://bafyimg/1.png",
  description: "A relic forged in the drop.",
  external_url: "https://example.com/relic",
};

const h = vi.hoisted(() => ({
  reads: {} as Record<string, unknown>,
  readError: false,
  readCalls: [] as Array<{
    functionName?: string;
    query?: { enabled?: boolean; refetchInterval?: number };
  }>,
  writeContractAsync: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  switchChain: vi.fn(),
  account: {
    address: "0x4444444444444444444444444444444444444444",
    isConnected: true,
    chainId: 11155111,
  } as { address: string; isConnected: boolean; chainId: number },
  chainIdFallback: 11155111,
  balanceValue: undefined as bigint | undefined,
}));

vi.mock("wagmi", () => ({
  useReadContract: (config: {
    functionName?: string;
    query?: { enabled?: boolean; refetchInterval?: number };
  }) => {
    h.readCalls.push(config);
    return {
      // Stale-data model (react-query keeps the last value on a failed refetch):
      // data survives, isError flips - the page must label it as delayed.
      data: h.reads[config.functionName ?? ""],
      isLoading: false,
      isError: h.readError,
      refetch: vi.fn(),
    };
  },
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
  useBalance: () => ({
    data: h.balanceValue === undefined ? undefined : { value: h.balanceValue },
    isLoading: false,
  }),
  useSwitchChain: () => ({ switchChain: h.switchChain, isPending: false }),
}));

import AuctionPage from "./AuctionPage";

const fetchMock = vi.fn();

function seedAuction(overrides: Record<string, unknown> = {}) {
  h.reads = {
    seller: SELLER,
    startingPrice: STARTING_PRICE,
    discountRate: DISCOUNT_RATE,
    duration: DURATION,
    startAt: START,
    expiresAt: START + DURATION,
    sold: false,
    cancelled: false,
    buyer: ZERO_ADDRESS,
    salePrice: 0n,
    nft: NFT,
    nftId: 1n,
    tokenURI: "ipfs://bafydemo/1.json",
    getPrice: STARTING_PRICE,
    ...overrides,
  };
}

function renderAuctionPage() {
  return render(
    <MemoryRouter initialEntries={[`/auction/${AUCTION}`]}>
      <Routes>
        <Route path="/auction/:address" element={<AuctionPage />} />
      </Routes>
    </MemoryRouter>,
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
  vi.setSystemTime(Number(START) * 1_000);
  vi.resetAllMocks();
  h.readCalls = [];
  h.readError = false;
  h.balanceValue = undefined;
  h.chainIdFallback = SEPOLIA_ID;
  h.account = { address: BUYER, isConnected: true, chainId: SEPOLIA_ID };
  seedAuction();
  fetchMock.mockResolvedValue({
    ok: true,
    text: async () => JSON.stringify(METADATA),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AuctionPage (T033)", () => {
  it("renders every FR-004 field, metadata preview, and safe metadata link", async () => {
    renderAuctionPage();
    await flushAsync();

    expect(screen.getByTestId("status")).toHaveTextContent("live");
    expect(screen.getByTestId("seller")).toHaveTextContent(SELLER);
    expect(screen.getByTestId("starting-price")).toHaveTextContent("0.05 ETH");
    expect(screen.getByTestId("current-price")).toHaveTextContent("0.05 ETH");
    expect(screen.getByTestId("discount-rate")).toHaveTextContent(
      "0.0001 ETH per second",
    );
    expect(screen.getByTestId("time-remaining")).toHaveTextContent("5m 0s");

    // Metadata-derived preview: image resolved through the IPFS gateway.
    expect(screen.getByText("Forge Relic #1")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "https://ipfs.io/ipfs/bafyimg/1.png",
    );

    // FR-019 clause 2: metadata links open only on explicit action,
    // in a new tab with safe attributes.
    const link = screen.getByRole("link", { name: "https://example.com/relic" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");

    // Never auto-executed: only the metadata document was fetched.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to a placeholder and generic name when metadata is unresolvable", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    renderAuctionPage();
    await flushAsync();

    expect(screen.getByText("Unnamed NFT")).toBeInTheDocument();
    expect(screen.getByTestId("nft-placeholder")).toBeInTheDocument();
    // The auction remains fully usable (edge case).
    expect(screen.getByRole("button", { name: /buy now/i })).toBeEnabled();
  });

  it("ticks the current price down every second with no manual refresh (FR-005, SC-002)", () => {
    renderAuctionPage();
    expect(screen.getByTestId("current-price")).toHaveTextContent("0.05 ETH");

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByTestId("current-price")).toHaveTextContent("0.0499 ETH");
    expect(screen.getByTestId("time-remaining")).toHaveTextContent("4m 59s");

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.getByTestId("current-price")).toHaveTextContent("0.0495 ETH");
    expect(screen.getByTestId("time-remaining")).toHaveTextContent("4m 55s");
  });

  it("disables the buy control the moment the auction expires, without a reload", () => {
    renderAuctionPage();
    expect(screen.getByRole("button", { name: /buy now/i })).toBeEnabled();

    act(() => {
      vi.advanceTimersByTime(299_000);
    });
    expect(screen.getByRole("button", { name: /buy now/i })).toBeEnabled();

    act(() => {
      vi.advanceTimersByTime(1_000); // now == expiresAt
    });
    expect(screen.getByTestId("status")).toHaveTextContent("expired");
    expect(screen.getByText("This auction has expired")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /buy now/i })).toBeDisabled();
    // Price freezes at its final value - never negative (FR-005).
    expect(screen.getByTestId("current-price")).toHaveTextContent("0.02 ETH");
  });

  it("shows the already-sold reason and blocks the buy action (US1.3, US1.5)", () => {
    seedAuction({ sold: true, buyer: BUYER, salePrice: 40_000_000_000_000_000n });
    renderAuctionPage();

    expect(screen.getByTestId("status")).toHaveTextContent("sold");
    expect(
      screen.getByText("This NFT has already been sold to another buyer"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /buy now/i })).toBeDisabled();
  });

  it("rejects a payment below the current price with a specific reason and sends nothing (US1.3, FR-007)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAuctionPage();

    const amount = screen.getByLabelText(/amount to pay/i);
    expect(amount).toHaveValue("0.05");

    await user.clear(amount);
    await user.type(amount, "0.01");
    await user.click(screen.getByRole("button", { name: /buy now/i }));

    expect(
      screen.getByText("The amount offered is below the current price"),
    ).toBeInTheDocument();
    expect(h.writeContractAsync).not.toHaveBeenCalled();
  });

  it("shows the plain-language summary before any wallet prompt and completes an overpaying buy (US1.2, US1.8, FR-019)", async () => {
    h.writeContractAsync.mockResolvedValue(TX_HASH);
    h.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAuctionPage();

    expect(
      screen.getByText(/refunded to you in the same purchase/i),
    ).toBeInTheDocument();

    const amount = screen.getByLabelText(/amount to pay/i);
    await user.clear(amount);
    await user.type(amount, "0.06");
    await user.click(screen.getByRole("button", { name: /buy now/i }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Buy NFT");
    expect(dialog).toHaveTextContent("0.06 ETH");
    expect(dialog).toHaveTextContent("0.01 ETH"); // refund explained up front
    // No wallet prompt has happened yet (FR-019).
    expect(h.writeContractAsync).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));
    await flushAsync();

    expect(h.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(h.writeContractAsync).toHaveBeenCalledWith({
      address: AUCTION,
      abi: expect.anything(),
      functionName: "buy",
      value: 60_000_000_000_000_000n,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/confirmed/i);
  });

  it("prompts to switch networks before any transaction on the wrong chain (US1.6, FR-002)", async () => {
    h.account.chainId = 1;
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAuctionPage();

    expect(screen.getByText(/wrong network/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /buy now/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /buy now/i }));
    expect(h.writeContractAsync).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /switch to sepolia/i }));
    expect(h.switchChain).toHaveBeenCalledWith({ chainId: SEPOLIA_ID });
  });

  it("shows a faucet notice when the connected wallet holds no test ETH (FR-002)", () => {
    h.balanceValue = 0n;
    renderAuctionPage();

    const link = screen.getByRole("link", { name: /faucet/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("tells a race loser they were already sold, with no hex and a retry path (US1.5, FR-003, FR-007)", async () => {
    h.writeContractAsync.mockResolvedValue(TX_HASH);
    h.waitForTransactionReceipt.mockRejectedValue({
      name: "TransactionExecutionError",
      cause: { name: "ContractFunctionRevertedError", errorName: "AlreadySold" },
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAuctionPage();

    await user.click(screen.getByRole("button", { name: /buy now/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /confirm/i }),
    );
    await flushAsync();

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(/already been sold/i);
    expect(status.textContent).not.toMatch(/0x[0-9a-f]{6,}/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("maps the seller self-buy rejection to plain language (FR-007)", async () => {
    h.account.address = SELLER;
    h.writeContractAsync.mockRejectedValue({
      message: "execution reverted: SellerCannotBuy()",
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAuctionPage();

    await user.click(screen.getByRole("button", { name: /buy now/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /confirm/i }),
    );
    await flushAsync();

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/cannot buy their own auction/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("ignores a duplicate confirm click while a purchase is in flight (T042 edge)", async () => {
    h.writeContractAsync.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAuctionPage();

    await user.click(screen.getByRole("button", { name: /buy now/i }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", {
      name: /confirm/i,
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(h.writeContractAsync).toHaveBeenCalledTimes(1);
  });

  it("completes the purchase path with the keyboard alone (FR-018, US1.9)", async () => {
    h.writeContractAsync.mockResolvedValue(TX_HASH);
    h.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAuctionPage();
    await flushAsync();

    const buy = screen.getByRole("button", { name: /buy now/i });
    let guard = 0;
    while (guard < 25 && !buy.matches(":focus")) {
      guard += 1;
      await user.tab();
    }
    expect(buy).toHaveFocus();

    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /confirm/i })).toHaveFocus();

    await user.keyboard("{Enter}");
    await flushAsync();

    expect(h.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(/confirmed/i);
  });
});

function auctionTree() {
  return (
    <MemoryRouter initialEntries={[`/auction/${AUCTION}`]}>
      <Routes>
        <Route path="/auction/:address" element={<AuctionPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AuctionPage (T066/T067 polish sweeps)", () => {
  it("labels a failed chain read instead of loading forever, with retry (FR-020)", async () => {
    h.reads = {}; // no cached values at all
    h.readError = true;
    renderAuctionPage();
    await flushAsync();

    expect(screen.queryByText("Loading auction...")).not.toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/could not be loaded/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    // FR-020: no purchase is enabled on values that could not be read.
    expect(screen.queryByRole("button", { name: /buy now/i })).not.toBeInTheDocument();
  });

  it("keeps loaded values on screen but labels them possibly delayed when a later read fails (FR-020)", async () => {
    // Fresh element per rerender: React bails out of re-rendering when given
    // the identical element reference, which would hide the later read failure.
    const view = render(auctionTree());
    await flushAsync();
    expect(screen.getByTestId("seller")).toHaveTextContent(SELLER);

    h.readError = true; // a later refetch fails: cached values stay, freshness is gone
    view.rerender(auctionTree());
    await flushAsync();

    expect(screen.getByTestId("seller")).toHaveTextContent(SELLER);
    expect(screen.getByTestId("current-price")).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/possibly delayed/i);
    expect(within(alert).getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: /retry/i })).toBeEnabled();
  });

  it("refetches auction fields inside the 15 s window so status never goes stale (SC-007)", () => {
    renderAuctionPage();

    const core = [
      "seller",
      "startingPrice",
      "discountRate",
      "duration",
      "startAt",
      "expiresAt",
      "sold",
      "cancelled",
      "buyer",
      "salePrice",
      "nft",
      "nftId",
    ];
    const calls = h.readCalls.filter(
      (call) => call.functionName !== undefined && core.includes(call.functionName),
    );
    expect(calls.length).toBeGreaterThanOrEqual(core.length);
    for (const call of calls) {
      expect(call.query?.refetchInterval, call.functionName).toBe(15_000);
    }
  });

  it("treats a reverted purchase receipt as a failure with retry, never a false success (SC-004, FR-003)", async () => {
    h.writeContractAsync.mockResolvedValue(TX_HASH);
    h.waitForTransactionReceipt.mockResolvedValue({ status: "reverted" });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAuctionPage();

    await user.click(screen.getByRole("button", { name: /buy now/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /confirm/i }),
    );
    await flushAsync();

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(/declined/i);
    expect(status).not.toHaveTextContent(/confirmed/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("announces auction status transitions through a polite live region (FR-018)", async () => {
    renderAuctionPage();
    await flushAsync();

    const region = screen.getByTestId("status-announcement");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("");

    act(() => {
      vi.advanceTimersByTime(300_000); // countdown reaches expiresAt
    });
    expect(screen.getByTestId("status")).toHaveTextContent("expired");
    expect(region).toHaveTextContent(/changed from live to expired/i);
  });
});

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics } from "viem";
type UserEventInstance = ReturnType<typeof userEvent.setup>;

const SEPOLIA_ID = 11155111;
const USER = "0x4444444444444444444444444444444444444444";
const OTHER = "0x9999999999999999999999999999999999999999";
const NFT = "0x2222222222222222222222222222222222222222";
const AUCTION = "0x5555555555555555555555555555555555555555";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TX_HASH =
  "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

const START = 1_767_225_600n;
const DURATION = 300n;
const STARTING_PRICE = 30_000_000_000_000_000n; // 0.03 ETH
const DISCOUNT_RATE = 100_000_000_000_000n; // 0.0001 ETH per second
const DURATION_RULE = "60s ≤ duration ≤ 2_592_000";
const PRICE_FLOOR_RULE = "startingPrice ≥ discountRate × duration";

const h = vi.hoisted(() => ({
  reads: {} as Record<string, unknown>,
  readCalls: [] as Array<{
    functionName?: string;
    args?: unknown[];
    query?: { enabled?: boolean; refetchInterval?: number };
  }>,
  writeContractAsync: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  account: {
    address: "0x4444444444444444444444444444444444444444",
    isConnected: true,
    chainId: 11155111,
  } as { address?: string; isConnected: boolean; chainId: number },
  chainIdFallback: 11155111,
  balanceValue: undefined as bigint | undefined,
}));

vi.mock("wagmi", () => ({
  useReadContract: (config: {
    functionName?: string;
    args?: unknown[];
    query?: { enabled?: boolean; refetchInterval?: number };
  }) => {
    h.readCalls.push(config);
    return {
      data: h.reads[config.functionName ?? ""],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  },
  useReadContracts: (config: { contracts?: unknown[]; query?: unknown }) => ({
    data: config.contracts?.map(() => ({ status: "success" as const, result: undefined })),
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
  useBalance: () => ({
    data: h.balanceValue === undefined ? undefined : { value: h.balanceValue },
    isLoading: false,
  }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
}));

import { deployments } from "@/config/deployments";
import { auctionFactoryAbi } from "@/config/contracts";

import CreateAuctionPage from "./CreateAuctionPage";

/** AuctionCreated log emitted by the factory (3 indexed + 6 data words). */
function createdLog(overrides: Partial<Record<string, bigint | string>> = {}) {
  const args = {
    auction: AUCTION,
    seller: USER,
    nft: NFT,
    tokenId: 7n,
    startingPrice: STARTING_PRICE,
    discountRate: DISCOUNT_RATE,
    duration: DURATION,
    startAt: START,
    expiresAt: START + DURATION,
    ...overrides,
  };
  const topics = encodeEventTopics({
    abi: auctionFactoryAbi,
    eventName: "AuctionCreated",
    args: {
      auction: args.auction as `0x${string}`,
      seller: args.seller as `0x${string}`,
      nft: args.nft as `0x${string}`,
    },
  });
  const data = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [
      args.tokenId as bigint,
      args.startingPrice as bigint,
      args.discountRate as bigint,
      args.duration as bigint,
      args.startAt as bigint,
      args.expiresAt as bigint,
    ],
  );
  return { address: AUCTION, topics, data };
}

function renderCreatePage(initialEntry = "/create") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/create" element={<CreateAuctionPage />} />
        <Route path="/auction/:address" element={<div data-testid="auction-route" />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillForm(
  user: UserEventInstance,
  values: { tokenId?: string; price?: string; rate?: string; duration?: string } = {},
) {
  const { tokenId = "7", price = "0.03", rate = "0.0001", duration } = values;
  const tokenInput = screen.getByLabelText(/token id/i);
  await user.clear(tokenInput);
  await user.type(tokenInput, tokenId);
  const priceInput = screen.getByLabelText(/starting price/i);
  await user.clear(priceInput);
  await user.type(priceInput, price);
  const rateInput = screen.getByLabelText(/discount rate/i);
  await user.clear(rateInput);
  await user.type(rateInput, rate);
  if (duration !== undefined) {
    const durationInput = screen.getByLabelText(/duration/i);
    await user.clear(durationInput);
    await user.type(durationInput, duration);
  }
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
  h.balanceValue = undefined;
  h.chainIdFallback = SEPOLIA_ID;
  h.account = { address: USER, isConnected: true, chainId: SEPOLIA_ID };
  h.reads = {
    ownerOf: USER,
    isApprovedForAll: false,
    getApproved: ZERO_ADDRESS,
    getPrice: STARTING_PRICE,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CreateAuctionPage (T046, FR-011, US2.2, US2.3, US2.6)", () => {
  it("rejects an invalid configuration before any transaction, even before approval (US2.2, US2.3)", async () => {
    h.reads.isApprovedForAll = false;
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCreatePage();
    await flushAsync();

    // Duration defaults to 300 seconds (FR-011).
    expect(screen.getByLabelText(/duration/i)).toHaveValue("300");

    // startingPrice 0.02 < 0.0001 × 300 → price would go negative.
    await fillForm(user, { price: "0.02" });
    await user.click(screen.getByRole("button", { name: /approve nft first/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(PRICE_FLOOR_RULE);
    expect(h.writeContractAsync).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("names the violated duration rule for an out-of-bounds duration and sends nothing", async () => {
    h.reads.isApprovedForAll = true;
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCreatePage();
    await flushAsync();

    await fillForm(user, { price: "0.05", duration: "30" });
    await user.click(screen.getByRole("button", { name: /create auction/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(DURATION_RULE);
    expect(h.writeContractAsync).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("guides the approval transaction first and only creates after approval confirms (US2.6)", async () => {
    h.reads.isApprovedForAll = false;
    h.reads.getApproved = ZERO_ADDRESS;
    h.writeContractAsync.mockResolvedValue(TX_HASH);
    h.waitForTransactionReceipt.mockResolvedValue({ status: "success", logs: [] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCreatePage();
    await flushAsync();

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: /approve nft first/i }));

    // The approval summary appears before the wallet prompt - no create yet.
    const approveDialog = screen.getByRole("dialog");
    expect(approveDialog).toHaveTextContent(/approve nft for auction/i);
    expect(h.writeContractAsync).not.toHaveBeenCalled();

    await user.click(within(approveDialog).getByRole("button", { name: /confirm/i }));
    await flushAsync();

    // Exactly one transaction so far - the approval, not the creation.
    expect(h.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(h.writeContractAsync).toHaveBeenCalledWith({
      address: deployments.nft,
      abi: expect.anything(),
      functionName: "setApprovalForAll",
      args: [deployments.factory, true],
    });
    expect(screen.getByText(/approval confirmed/i)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Creation is only offered after the approval confirmed.
    const createButton = screen.getByRole("button", { name: /create auction/i });
    expect(createButton).toBeEnabled();
    await user.click(createButton);

    const createDialog = screen.getByRole("dialog");
    expect(createDialog).toHaveTextContent(/create auction/i);
    expect(h.writeContractAsync).toHaveBeenCalledTimes(1); // still no create tx

    await user.click(within(createDialog).getByRole("button", { name: /confirm/i }));
    await flushAsync();

    expect(h.writeContractAsync).toHaveBeenCalledTimes(2);
    expect(h.writeContractAsync).toHaveBeenLastCalledWith({
      address: deployments.factory,
      abi: expect.anything(),
      functionName: "createAuction",
      args: [deployments.nft, 7n, STARTING_PRICE, DISCOUNT_RATE, DURATION],
    });
  });

  it("explains the not-owned/not-approved edge case and sends nothing (T050)", async () => {
    h.reads.ownerOf = OTHER;
    h.reads.isApprovedForAll = false;
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCreatePage();
    await flushAsync();

    await fillForm(user);

    expect(screen.getByText(/not owned or not approved/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approve nft first/i })).toBeDisabled();
    expect(h.writeContractAsync).not.toHaveBeenCalled();
  });

  it("shows escrow confirmation, live status at the starting price, and redirects to the auction page (US2.2, T051)", async () => {
    h.reads.isApprovedForAll = true;
    h.writeContractAsync.mockResolvedValue(TX_HASH);
    h.waitForTransactionReceipt.mockResolvedValue({
      status: "success",
      logs: [createdLog()],
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCreatePage();
    await flushAsync();

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: /create auction/i }));
    const createDialog = screen.getByRole("dialog");
    // After creation the factory escrow owns the token (read for confirmation).
    h.reads.ownerOf = AUCTION;
    await user.click(within(createDialog).getByRole("button", { name: /confirm/i }));
    await flushAsync();

    expect(h.writeContractAsync).toHaveBeenCalledWith({
      address: deployments.factory,
      abi: expect.anything(),
      functionName: "createAuction",
      args: [deployments.nft, 7n, STARTING_PRICE, DISCOUNT_RATE, DURATION],
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Post-creation success flow: escrow + live at starting price + countdown.
    expect(screen.getByText(/escrow confirmed/i)).toBeInTheDocument();
    expect(screen.getByTestId("status")).toHaveTextContent("live");
    expect(screen.getByTestId("current-price")).toHaveTextContent("0.03 ETH");
    expect(screen.getByTestId("time-remaining")).toHaveTextContent("5m 0s");
    expect(screen.getByText(/opening your auction/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view auction/i })).toHaveAttribute(
      "href",
      `/auction/${AUCTION}`,
    );

    // Redirect to the auction page (US2.2).
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByTestId("auction-route")).toBeInTheDocument();
  });
});

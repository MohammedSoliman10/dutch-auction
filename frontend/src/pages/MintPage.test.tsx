import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeEventTopics } from "viem";

const SEPOLIA_ID = 11155111;
const USER = "0x4444444444444444444444444444444444444444";
const NFT = "0x2222222222222222222222222222222222222222";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TX_HASH =
  "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;
const URI = "https://example.com/relic.json";

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
import { dutchAuctionNftAbi } from "@/config/contracts";

import MintPage from "./MintPage";

/** ERC-721 Transfer log for a mint to `to` (all three args are indexed). */
function transferLog(to: string, tokenId: bigint) {
  const topics = encodeEventTopics({
    abi: dutchAuctionNftAbi,
    eventName: "Transfer",
    args: {
      from: ZERO_ADDRESS as `0x${string}`,
      to: to as `0x${string}`,
      tokenId,
    },
  });
  return { address: NFT as `0x${string}`, topics, data: "0x" as const };
}

function renderMintPage() {
  return render(
    <MemoryRouter initialEntries={["/mint"]}>
      <Routes>
        <Route path="/mint" element={<MintPage />} />
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
  vi.resetAllMocks();
  h.readCalls = [];
  h.balanceValue = undefined;
  h.chainIdFallback = SEPOLIA_ID;
  h.account = { address: USER, isConnected: true, chainId: SEPOLIA_ID };
  h.reads = { ownerOf: USER };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MintPage (T046, FR-010, US2.1)", () => {
  it("renders the metadata URI input and requires a connected wallet to mint", () => {
    h.account = { address: undefined, isConnected: false, chainId: SEPOLIA_ID };
    renderMintPage();

    expect(screen.getByLabelText(/metadata uri/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mint nft/i })).toBeDisabled();
    expect(screen.getByText(/connect your wallet to mint/i)).toBeInTheDocument();
  });

  it("rejects an empty metadata URI before any transaction is sent", async () => {
    h.writeContractAsync.mockResolvedValue(TX_HASH);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderMintPage();
    await flushAsync();

    await user.click(screen.getByRole("button", { name: /mint nft/i }));

    expect(screen.getByText(/metadata link is empty/i)).toBeInTheDocument();
    expect(h.writeContractAsync).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("mints after a plain-language summary and shows the new token id owned by the wallet (US2.1, FR-010, FR-019)", async () => {
    h.writeContractAsync.mockResolvedValue(TX_HASH);
    h.waitForTransactionReceipt.mockResolvedValue({
      status: "success",
      logs: [transferLog(USER, 7n)],
    });
    h.reads.ownerOf = USER;
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderMintPage();
    await flushAsync();

    await user.type(screen.getByLabelText(/metadata uri/i), URI);
    await user.click(screen.getByRole("button", { name: /mint nft/i }));

    // FR-019: summary before any wallet prompt.
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Mint NFT");
    expect(dialog).toHaveTextContent(URI);
    expect(h.writeContractAsync).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));
    await flushAsync();

    expect(h.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(h.writeContractAsync).toHaveBeenCalledWith({
      address: deployments.nft,
      abi: expect.anything(),
      functionName: "mintNFT",
      args: [URI],
    });

    // Success shows the new token id and wallet ownership.
    expect(screen.getByText("Minted token #7")).toBeInTheDocument();
    expect(screen.getByText("Your wallet owns token #7.")).toBeInTheDocument();
    expect(
      h.readCalls.some(
        (call) => call.functionName === "ownerOf" && call.args?.[0] === 7n,
      ),
    ).toBe(true);

    // aria-live confirmation (FR-018).
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(/confirmed/i);

    // Next step toward the auction flow.
    expect(
      screen.getByRole("link", { name: /create an auction/i }),
    ).toHaveAttribute("href", "/create");
  });

  it("cancels from the pre-sign summary without sending anything (FR-019, FR-003)", async () => {
    h.writeContractAsync.mockResolvedValue(TX_HASH);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderMintPage();
    await flushAsync();

    await user.type(screen.getByLabelText(/metadata uri/i), URI);
    await user.click(screen.getByRole("button", { name: /mint nft/i }));

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.writeContractAsync).not.toHaveBeenCalled();
  });
});

import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SEPOLIA_ID = 11155111;
const REFRESH_MS = 15_000;
const USER = "0x4444444444444444444444444444444444444444";
const OTHER = "0x9999999999999999999999999999999999999999";
const A1 = "0x1111111111111111111111111111111111111111";
const A2 = "0x2222222222222222222222222222222222222222";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TX_HASH =
  "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

const START = 1_767_225_600n;
const STARTING_PRICE = 50_000_000_000_000_000n; // 0.05 ETH
const SALE_PRICE = 40_000_000_000_000_000n; // 0.04 ETH

interface ReadConfig {
  address?: string;
  functionName?: string;
  args?: unknown[];
  query?: { enabled?: boolean; refetchInterval?: number };
}

const h = vi.hoisted(() => ({
  reads: {} as Record<string, unknown>,
  argsReads: {} as Record<string, unknown>,
  addrReads: {} as Record<string, unknown>,
  readCalls: [] as Array<ReadConfig>,
  batchCalls: [] as Array<{
    contracts?: ReadConfig[];
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
}));

// Read resolution priority: per-address -> per-argument -> per-function.
function resolveRead(config: ReadConfig): unknown {
  const fn = config.functionName ?? "";
  if (config.address !== undefined) {
    const addressKey = `${config.address}:${fn}`;
    if (addressKey in h.addrReads) return h.addrReads[addressKey];
  }
  const arg0 =
    Array.isArray(config.args) && config.args.length > 0 ? String(config.args[0]) : "";
  const argsKey = `${fn}:${arg0}`;
  if (argsKey in h.argsReads) return h.argsReads[argsKey];
  return h.reads[fn];
}

vi.mock("wagmi", () => ({
  useReadContract: (config: ReadConfig) => {
    h.readCalls.push(config);
    return {
      data: resolveRead(config),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  },
  useReadContracts: (config: { contracts?: ReadConfig[]; query?: ReadConfig["query"] }) => {
    h.batchCalls.push(config);
    return {
      data: (config.contracts ?? []).map((contract) => ({
        status: "success" as const,
        result: resolveRead(contract),
      })),
      isLoading: false,
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
  useBalance: () => ({ data: undefined, isLoading: false }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
}));

import MyAuctionsPage from "./MyAuctionsPage";

const fetchMock = vi.fn();

function apiItem(overrides: Record<string, unknown> = {}) {
  return {
    address: A1,
    chainId: SEPOLIA_ID,
    seller: USER,
    tokenId: "7",
    startingPrice: STARTING_PRICE.toString(),
    discountRate: "100000000000000",
    duration: 300,
    startAt: Number(START - 100n),
    expiresAt: Number(START + 300n),
    status: "live",
    buyer: null,
    salePrice: null,
    ...overrides,
  };
}

function seedChainAuction(
  address: string,
  fields: { seller: string; sold?: boolean; cancelled?: boolean; expiresAt: bigint },
) {
  h.addrReads[`${address}:seller`] = fields.seller;
  h.addrReads[`${address}:sold`] = fields.sold ?? false;
  h.addrReads[`${address}:cancelled`] = fields.cancelled ?? false;
  h.addrReads[`${address}:expiresAt`] = fields.expiresAt;
  h.addrReads[`${address}:startingPrice`] = STARTING_PRICE;
  h.addrReads[`${address}:salePrice`] = fields.sold === true ? SALE_PRICE : 0n;
  h.addrReads[`${address}:buyer`] =
    fields.sold === true ? OTHER : ZERO_ADDRESS;
}

function renderMyAuctions() {
  return render(
    <MemoryRouter initialEntries={["/my"]}>
      <Routes>
        <Route path="/my" element={<MyAuctionsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function flushAsync() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) {
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
  h.reads = {};
  h.argsReads = {};
  h.addrReads = {};
  h.readCalls = [];
  h.batchCalls = [];
  h.chainIdFallback = SEPOLIA_ID;
  h.account = { address: USER, isConnected: true, chainId: SEPOLIA_ID };
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("MyAuctionsPage (T053, FR-014)", () => {
  it("loads the seller's auctions via the API seller filter, with cancel/reclaim entry points", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          apiItem(),
          apiItem({
            address: A2,
            status: "expired",
            expiresAt: Number(START - 1n),
            startAt: Number(START - 301n),
          }),
        ],
        nextCursor: null,
      }),
    });
    renderMyAuctions();
    await flushAsync();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/auctions?seller=${USER.toLowerCase()}`,
      expect.anything(),
    );

    const rows = screen.getAllByTestId("my-auction");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("data-address", A1);
    expect(within(rows[0]).getByTestId("status")).toHaveTextContent("live");
    expect(
      within(rows[0]).getByRole("button", { name: /cancel auction/i }),
    ).toBeInTheDocument();

    expect(rows[1]).toHaveAttribute("data-address", A2);
    expect(within(rows[1]).getByTestId("status")).toHaveTextContent("expired");
    expect(
      within(rows[1]).getByRole("button", { name: /reclaim nft/i }),
    ).toBeInTheDocument();

    // The API path must not enumerate the chain registry.
    const countCalls = h.readCalls.filter((call) => call.functionName === "auctionCount");
    expect(countCalls.length).toBeGreaterThan(0);
    for (const call of countCalls) expect(call.query?.enabled).toBe(false);
  });

  it("falls back to on-chain factory enumeration when the API is unreachable (US2 independence)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    h.reads.auctionCount = 2n;
    h.argsReads["allAuctions:0"] = A1;
    h.argsReads["allAuctions:1"] = A2;
    seedChainAuction(A1, { seller: USER, expiresAt: START + 300n });
    seedChainAuction(A2, { seller: OTHER, expiresAt: START + 300n });
    renderMyAuctions();
    await flushAsync();

    // No warning banner: chain discovery is the normal data path here.
    expect(screen.queryByText(/directly from the chain/i)).toBeNull();

    const rows = screen.getAllByTestId("my-auction");
    expect(rows).toHaveLength(1); // seller filter drops A2 (owner OTHER)
    expect(rows[0]).toHaveAttribute("data-address", A1);
    expect(
      within(rows[0]).getByRole("button", { name: /cancel auction/i }),
    ).toBeInTheDocument();

    // SC-007 visibility window: chain reads refetch within 15 s.
    const countCall = h.readCalls.find((call) => call.functionName === "auctionCount");
    expect(countCall?.query?.enabled).toBe(true);
    expect(countCall?.query?.refetchInterval).toBe(REFRESH_MS);
    const soldCalls = h.readCalls.filter((call) => call.functionName === "sold");
    expect(soldCalls.length).toBeGreaterThan(0);
    for (const call of soldCalls) expect(call.query?.refetchInterval).toBe(REFRESH_MS);
    expect(
      h.batchCalls.some((call) => call.query?.refetchInterval === REFRESH_MS),
    ).toBe(true);
  });

  it("shows a friendly empty state when the seller has no auctions (FR-014)", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [], nextCursor: null }) });
    renderMyAuctions();
    await flushAsync();

    expect(screen.getByText(/no auctions yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /mint an nft/i })).toHaveAttribute(
      "href",
      "/mint",
    );
  });

  it("reports a sold auction with atomic proceeds + NFT transfer messaging (US2.4, T054)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          apiItem({
            status: "sold",
            salePrice: SALE_PRICE.toString(),
            buyer: OTHER,
            startAt: Number(START - 300n),
            expiresAt: Number(START - 1n),
          }),
        ],
        nextCursor: null,
      }),
    });
    renderMyAuctions();
    await flushAsync();

    const row = screen.getAllByTestId("my-auction")[0];
    expect(within(row).getByTestId("status")).toHaveTextContent("sold");
    const outcome = within(row).getByTestId("sale-outcome");
    expect(outcome).toHaveTextContent("0.04 ETH");
    expect(outcome).toHaveTextContent(/full winning bid/i);
    expect(outcome).toHaveTextContent(/atomically/i);
    expect(outcome).toHaveTextContent(/same transaction/i);
    expect(within(row).getByText(new RegExp(OTHER, "i"))).toBeInTheDocument();
  });

  it("refreshes the seller list within the 15 s SC-007 window", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [apiItem()], nextCursor: null }),
    });
    renderMyAuctions();
    await flushAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(REFRESH_MS);
      for (let i = 0; i < 3; i += 1) {
        await vi.advanceTimersByTimeAsync(0);
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("asks a disconnected visitor to connect before listing auctions", async () => {
    h.account = { address: undefined, isConnected: false, chainId: SEPOLIA_ID };
    renderMyAuctions();
    await flushAsync();

    expect(screen.getByText(/connect your wallet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("my-auction")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("filters API rows to the connected wallet defensively", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [apiItem({ address: A1, seller: USER }), apiItem({ address: A2, seller: OTHER })],
        nextCursor: null,
      }),
    });
    renderMyAuctions();
    await flushAsync();

    const rows = screen.getAllByTestId("my-auction");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("data-address", A1);

    // A row action is reachable from the list (entry point, FR-014).
    expect(
      within(rows[0]).getByRole("button", { name: /cancel auction/i }),
    ).toBeInTheDocument();
  });
});

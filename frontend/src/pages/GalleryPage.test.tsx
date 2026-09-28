import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SEPOLIA_ID = 11155111;
const REFRESH_MS = 15_000;
const A1 = "0x1111111111111111111111111111111111111111";
const A2 = "0x2222222222222222222222222222222222222222";
const SELLER = "0x3333333333333333333333333333333333333333";
const BUYER = "0x4444444444444444444444444444444444444444";
const NFT = "0x5555555555555555555555555555555555555555";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const START = 1_767_225_600;
const STARTING_PRICE = 50_000_000_000_000_000n;
const DISCOUNT_RATE = 100_000_000_000_000n;
const SALE_PRICE = 40_000_000_000_000_000n;

const METADATA = {
  name: "Forge Relic #7",
  image: "ipfs://bafyimg/7.png",
  description: "A relic forged in the drop.",
  external_url: "https://example.com/relic",
};

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
  readCalls: [] as ReadConfig[],
  batchCalls: [] as Array<{ contracts?: ReadConfig[]; query?: ReadConfig["query"] }>,
  readError: false,
  batchError: false,
}));

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
      data: h.readError ? undefined : resolveRead(config),
      isLoading: false,
      isError: h.readError,
      refetch: vi.fn(),
    };
  },
  useReadContracts: (config: { contracts?: ReadConfig[]; query?: ReadConfig["query"] }) => {
    h.batchCalls.push(config);
    return {
      data: (config.contracts ?? []).map((contract) =>
        h.batchError
          ? { status: "failure" as const, result: undefined, error: new Error("RPC down") }
          : { status: "success" as const, result: resolveRead(contract) },
      ),
      isLoading: false,
      isError: h.batchError,
      refetch: vi.fn(),
    };
  },
}));

import GalleryPage from "./GalleryPage";

const fetchMock = vi.fn();

function jsonResponse(body: unknown) {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  };
}

function apiItem(overrides: Record<string, unknown> = {}) {
  return {
    address: A1,
    chainId: SEPOLIA_ID,
    seller: SELLER,
    nftContract: NFT,
    tokenId: "7",
    startingPrice: STARTING_PRICE.toString(),
    discountRate: DISCOUNT_RATE.toString(),
    duration: 300,
    startAt: START,
    expiresAt: START + 300,
    status: "live",
    currentPrice: STARTING_PRICE.toString(),
    buyer: null,
    salePrice: null,
    nft: {
      tokenUri: "ipfs://bafydemo/7.json",
      name: "Forge Relic #7",
      image: "https://cdn.example/7.png",
    },
    ...overrides,
  };
}

/** Serves the index API with per-status payloads and metadata for card previews. */
function mockApi(listFor: (url: string) => { items: unknown[]; nextCursor: string | null }) {
  fetchMock.mockImplementation(async (url: string) => {
    if (typeof url === "string" && url.startsWith("/api")) {
      return jsonResponse(listFor(url));
    }
    return jsonResponse(METADATA); // NFT metadata document (bounded fetch)
  });
}

function seedChainAuction(
  address: string,
  fields: { seller: string; expiresAt: bigint; tokenId?: bigint },
) {
  h.addrReads[`${address}:seller`] = fields.seller;
  h.addrReads[`${address}:startingPrice`] = STARTING_PRICE;
  h.addrReads[`${address}:discountRate`] = DISCOUNT_RATE;
  h.addrReads[`${address}:duration`] = 300n;
  h.addrReads[`${address}:startAt`] = BigInt(START);
  h.addrReads[`${address}:expiresAt`] = fields.expiresAt;
  h.addrReads[`${address}:sold`] = false;
  h.addrReads[`${address}:cancelled`] = false;
  h.addrReads[`${address}:buyer`] = ZERO_ADDRESS;
  h.addrReads[`${address}:salePrice`] = 0n;
  h.addrReads[`${address}:nft`] = NFT;
  h.addrReads[`${address}:nftId`] = fields.tokenId ?? 7n;
}

function renderGallery() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<GalleryPage />} />
        <Route path="/auction/:address" element={<div data-testid="auction-route" />} />
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

function apiCalls(): unknown[] {
  return fetchMock.mock.calls
    .filter((call) => typeof call[0] === "string" && call[0].startsWith("/api"))
    .map((call) => call[0]);
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.setSystemTime(START * 1_000);
  vi.resetAllMocks();
  h.reads = {};
  h.argsReads = {};
  h.addrReads = {};
  h.readCalls = [];
  h.batchCalls = [];
  h.readError = false;
  h.batchError = false;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GalleryPage (T062, T063 - FR-014, SC-009)", () => {
  it("lists a live auction with preview, current price and time reachable in one click (US3.1, SC-009)", async () => {
    mockApi(() => ({ items: [apiItem()], nextCursor: null }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderGallery();
    await flushAsync();

    const cards = screen.getAllByTestId("auction-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveAttribute("data-address", A1);

    const card = within(cards[0]);
    expect(card.getByTestId("status")).toHaveTextContent("live");
    expect(card.getByTestId("current-price")).toHaveTextContent("0.05 ETH");
    expect(card.getByTestId("time-remaining")).toHaveTextContent("5m 0s");
    // Metadata-driven preview (placeholder-free).
    expect(card.getByText("Forge Relic #7")).toBeInTheDocument();
    expect(card.getByRole("img")).toHaveAttribute(
      "src",
      "https://ipfs.io/ipfs/bafyimg/7.png",
    );

    // SC-009: a live auction is one deliberate click away, no address pasted.
    const link = card.getByRole("link", { name: /forge relic #7/i });
    expect(link).toHaveAttribute("href", `/auction/${A1}`);
    await user.click(link);
    expect(screen.getByTestId("auction-route")).toBeInTheDocument();
  });

  it("filters by status through the index query (US3.3)", async () => {
    mockApi((url) =>
      url.includes("status=sold")
        ? {
            items: [
              apiItem({
                address: A2,
                status: "sold",
                startAt: START - 300,
                expiresAt: START - 1,
                salePrice: SALE_PRICE.toString(),
                buyer: BUYER,
              }),
            ],
            nextCursor: null,
          }
        : { items: [apiItem()], nextCursor: null },
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderGallery();
    await flushAsync();

    const soldFilter = screen.getByRole("button", { name: "Sold" });
    await user.click(soldFilter);
    await flushAsync();

    expect(soldFilter).toHaveAttribute("aria-pressed", "true");
    expect(apiCalls()).toContain("/api/auctions?status=sold&limit=20");

    const cards = screen.getAllByTestId("auction-card");
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByTestId("status")).toHaveTextContent("sold");
    expect(within(cards[0]).getByTestId("sale-outcome")).toHaveTextContent(
      /sold at 0\.04 ETH to 0x4444444444444444444444444444444444444444/i,
    );
  });

  it("keeps filtering when only ended auctions exist, with no dead links (US3.3)", async () => {
    const expired = apiItem({
      address: A2,
      status: "expired",
      startAt: START - 301,
      expiresAt: START - 1,
    });
    mockApi((url) =>
      url.includes("status=expired")
        ? { items: [expired], nextCursor: null }
        : { items: [apiItem({ ...expired, address: A2 })], nextCursor: null },
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderGallery();
    await flushAsync();

    // Only ended auctions on the default view - the page still renders cards.
    expect(screen.getAllByTestId("auction-card")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Expired" }));
    await flushAsync();

    const cards = screen.getAllByTestId("auction-card");
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByTestId("status")).toHaveTextContent("expired");
    // FR-015: the ended outcome names the seller.
    expect(within(cards[0]).getByTestId("sale-outcome")).toHaveTextContent(
      new RegExp(SELLER, "i"),
    );
    // No dead links: the card still routes to a real auction view.
    await user.click(within(cards[0]).getByRole("link", { name: /forge relic #7/i }));
    expect(screen.getByTestId("auction-route")).toBeInTheDocument();
  });

  it("pages through the gallery with the opaque cursor (FR-014)", async () => {
    mockApi((url) =>
      url.includes("cursor=cursor-2")
        ? {
            items: [apiItem({ address: A2, tokenId: "8" })],
            nextCursor: null,
          }
        : { items: [apiItem()], nextCursor: "cursor-2" },
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderGallery();
    await flushAsync();

    expect(screen.getAllByTestId("auction-card")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /load more/i }));
    await flushAsync();

    expect(apiCalls()).toContain("/api/auctions?status=all&limit=20&cursor=cursor-2");
    expect(screen.getAllByTestId("auction-card")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("shows the no-auctions empty state naming why and the next step (FR-014)", async () => {
    mockApi(() => ({ items: [], nextCursor: null }));
    renderGallery();
    await flushAsync();

    expect(screen.getByText(/no auctions yet/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing has been listed/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /mint an nft/i })).toHaveAttribute(
      "href",
      "/mint",
    );
  });

  it("shows the no-live-auctions empty state naming why and the next step", async () => {
    mockApi((url) =>
      url.includes("status=live")
        ? { items: [], nextCursor: null }
        : { items: [apiItem()], nextCursor: null },
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderGallery();
    await flushAsync();

    await user.click(screen.getByRole("button", { name: "Live" }));
    await flushAsync();

    expect(screen.getByText(/no live auctions right now/i)).toBeInTheDocument();
    expect(screen.getByText(/already ended/i)).toBeInTheDocument();
    expect(screen.getByText(/check back soon/i)).toBeInTheDocument();

    // The next step works: clearing the filter brings the auctions back.
    await user.click(screen.getByRole("button", { name: /show all auctions/i }));
    await flushAsync();
    expect(screen.getAllByTestId("auction-card")).toHaveLength(1);
    expect(apiCalls()).toContain("/api/auctions?status=all&limit=20");
  });

  it("shows the no-filter-match empty state naming why and the next step", async () => {
    mockApi((url) =>
      url.includes("status=cancelled")
        ? { items: [], nextCursor: null }
        : { items: [apiItem()], nextCursor: null },
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderGallery();
    await flushAsync();

    await user.click(screen.getByRole("button", { name: "Cancelled" }));
    await flushAsync();

    expect(screen.getByText(/no auctions match this filter/i)).toBeInTheDocument();
    expect(screen.getByText(/there are no cancelled auctions/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /show all auctions/i }),
    ).toBeInTheDocument();
  });

  it("serves on-chain discovered auctions with no warning banner when the index is unavailable (FR-020 fallback)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    h.reads.auctionCount = 1n;
    h.argsReads["allAuctions:0"] = A1;
    seedChainAuction(A1, { seller: SELLER, expiresAt: BigInt(START + 300) });

    renderGallery();
    await flushAsync();

    // FR-020 fallback still applies: the gallery never depends on the index.
    expect(screen.getAllByTestId("auction-card")).toHaveLength(1);

    // Chain discovery is the normal production data path, not a degraded
    // state - no "unreachable"/"delayed" warning is shown. Chain reads here
    // are live, so "values may be delayed" would be inaccurate copy.
    expect(screen.queryByTestId("degraded-banner")).toBeNull();
    expect(screen.queryByText(/auction index is unreachable/i)).toBeNull();
    expect(screen.queryByText(/values may be delayed/i)).toBeNull();

    // FR-018: the result is announced programmatically.
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(/showing 1 auction/i);
  });

  it("shows a degraded error view with retry when both the index and the chain fail (FR-020)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    h.readError = true;
    h.batchError = true;

    renderGallery();
    await flushAsync();

    const errorBlock = screen.getByTestId("gallery-error");
    expect(errorBlock).toHaveTextContent(/could not be loaded/i);
    expect(errorBlock).toHaveTextContent(/retry/i);

    const before = apiCalls().length;
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      within(errorBlock).getByRole("button", { name: /retry/i }),
    );
    await flushAsync();
    expect(apiCalls().length).toBe(before + 1);
  });

  it("announces loading and result changes through a polite live region (FR-018)", async () => {
    mockApi((url) =>
      url.includes("status=sold")
        ? {
            items: [
              apiItem({
                address: A2,
                status: "sold",
                startAt: START - 300,
                expiresAt: START - 1,
                salePrice: SALE_PRICE.toString(),
                buyer: BUYER,
              }),
            ],
            nextCursor: null,
          }
        : { items: [apiItem()], nextCursor: null },
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderGallery();

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(/loading auctions/i);

    await flushAsync();
    expect(status).toHaveTextContent(/showing 1 auction/i);

    await user.click(screen.getByRole("button", { name: "Sold" }));
    await flushAsync();
    expect(status).toHaveTextContent(/sold/i);
  });

  it("reaches a live auction with the keyboard alone (FR-018, SC-009)", async () => {
    mockApi(() => ({ items: [apiItem()], nextCursor: null }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderGallery();
    await flushAsync();

    const link = screen.getByRole("link", { name: /forge relic #7/i });
    let guard = 0;
    while (guard < 30 && !link.matches(":focus")) {
      guard += 1;
      await user.tab();
    }
    expect(link).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(screen.getByTestId("auction-route")).toBeInTheDocument();
  });
});

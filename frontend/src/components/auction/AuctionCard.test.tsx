import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const A1 = "0x1111111111111111111111111111111111111111";
const SELLER = "0x3333333333333333333333333333333333333333";
const BUYER = "0x4444444444444444444444444444444444444444";
const NFT = "0x5555555555555555555555555555555555555555";

const START = 1_767_225_600;
const STARTING_PRICE = 50_000_000_000_000_000n; // 0.05 ETH
const DISCOUNT_RATE = 100_000_000_000_000n; // 0.0001 ETH per second
const SALE_PRICE = 40_000_000_000_000_000n; // 0.04 ETH

const METADATA = {
  name: "Forge Relic #7",
  image: "ipfs://bafyimg/7.png",
  description: "A relic forged in the drop.",
  external_url: "https://example.com/relic",
};

const h = vi.hoisted(() => ({
  readCalls: [] as Array<{
    functionName?: string;
    query?: { enabled?: boolean; refetchInterval?: number };
  }>,
  getPrice: undefined as bigint | undefined,
}));

vi.mock("wagmi", () => ({
  useReadContract: (config: {
    functionName?: string;
    query?: { enabled?: boolean; refetchInterval?: number };
  }) => {
    h.readCalls.push(config);
    return { data: h.getPrice, isLoading: false, isError: false, refetch: vi.fn() };
  },
  useReadContracts: (config: { contracts?: unknown[]; query?: unknown }) => ({
    data: config.contracts?.map(() => ({ status: "success" as const, result: undefined })),
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

import { AuctionCard } from "./AuctionCard";
import type { AuctionViewItem } from "@/hooks/useAuctions";

const fetchMock = vi.fn();

function auctionItem(overrides: Partial<AuctionViewItem> = {}): AuctionViewItem {
  return {
    address: A1,
    seller: SELLER,
    nftContract: NFT,
    tokenId: "7",
    startingPrice: STARTING_PRICE,
    discountRate: DISCOUNT_RATE,
    duration: 300,
    startAt: START,
    expiresAt: START + 300,
    status: "live",
    currentPrice: STARTING_PRICE,
    buyer: null,
    salePrice: null,
    tokenUri: "ipfs://bafydemo/7.json",
    nftName: null,
    nftImage: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  };
}

function renderCard(item: AuctionViewItem) {
  return render(
    <MemoryRouter>
      <AuctionCard auction={item} />
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
  vi.setSystemTime(START * 1_000);
  vi.resetAllMocks();
  h.readCalls = [];
  h.getPrice = undefined;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse(METADATA));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AuctionCard (T064 - FR-015, FR-019, US3)", () => {
  it("renders a live auction with preview, ticking price and time remaining (US3.1)", async () => {
    renderCard(auctionItem());
    await flushAsync();

    const card = screen.getByTestId("auction-card");
    expect(card).toHaveAttribute("data-address", A1);
    expect(within(card).getByTestId("status")).toHaveTextContent("live");
    expect(within(card).getByText("Forge Relic #7")).toBeInTheDocument();
    expect(within(card).getByRole("img")).toHaveAttribute(
      "src",
      "https://ipfs.io/ipfs/bafyimg/7.png",
    );

    const price = within(card).getByTestId("current-price");
    expect(price).toHaveTextContent("0.05 ETH");
    expect(within(card).getByTestId("time-remaining")).toHaveTextContent("5m 0s");

    // Ticks without a manual refresh (FR-005 on the card, via useCurrentPrice).
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(price).toHaveTextContent("0.0499 ETH");
    expect(within(card).getByTestId("time-remaining")).toHaveTextContent("4m 59s");

    // One click routes to the auction detail page (SC-009).
    expect(
      within(card).getByRole("link", { name: /forge relic #7/i }),
    ).toHaveAttribute("href", `/auction/${A1}`);
  });

  it("reports a sold auction as sold at price P to buyer B (FR-015, US3.2)", async () => {
    renderCard(
      auctionItem({
        status: "sold",
        startAt: START - 300,
        expiresAt: START - 1,
        salePrice: SALE_PRICE,
        buyer: BUYER,
      }),
    );
    await flushAsync();

    const card = screen.getByTestId("auction-card");
    expect(within(card).getByTestId("status")).toHaveTextContent("sold");
    expect(within(card).getByTestId("sale-outcome")).toHaveTextContent(
      /sold at 0\.04 ETH to 0x4444444444444444444444444444444444444444/i,
    );
    // Ended cards do not present a ticking "current price" as live data.
    expect(within(card).queryByTestId("current-price")).not.toBeInTheDocument();
  });

  it("reports an expired auction as expired — unsold with the seller named (FR-015, US3.2)", async () => {
    renderCard(
      auctionItem({
        status: "expired",
        startAt: START - 301,
        expiresAt: START - 1,
      }),
    );
    await flushAsync();

    const card = screen.getByTestId("auction-card");
    expect(within(card).getByTestId("status")).toHaveTextContent("expired");
    const outcome = within(card).getByTestId("sale-outcome");
    expect(outcome).toHaveTextContent(/expired/i);
    expect(outcome).toHaveTextContent(/unsold/i);
    expect(outcome).toHaveTextContent(new RegExp(SELLER, "i"));
  });

  it("reports a cancelled auction with the seller named (FR-015, US3.2)", async () => {
    renderCard(auctionItem({ status: "cancelled" }));
    await flushAsync();

    const card = screen.getByTestId("auction-card");
    expect(within(card).getByTestId("status")).toHaveTextContent("cancelled");
    const outcome = within(card).getByTestId("sale-outcome");
    expect(outcome).toHaveTextContent(/cancelled/i);
    expect(outcome).toHaveTextContent(new RegExp(SELLER, "i"));
  });

  it("flips a live card to expired the moment its countdown passes, without a reload", async () => {
    renderCard(auctionItem());
    await flushAsync();

    expect(within(screen.getByTestId("auction-card")).getByTestId("status")).toHaveTextContent(
      "live",
    );

    act(() => {
      vi.advanceTimersByTime(300_000);
    });
    const card = screen.getByTestId("auction-card");
    expect(within(card).getByTestId("status")).toHaveTextContent("expired");
    expect(within(card).getByTestId("sale-outcome")).toHaveTextContent(/unsold/i);
  });

  it("falls back to a placeholder preview when metadata is unresolvable (edge)", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    renderCard(auctionItem());
    await flushAsync();

    const card = screen.getByTestId("auction-card");
    expect(within(card).getByText("Unnamed NFT")).toBeInTheDocument();
    expect(within(card).getByTestId("nft-placeholder")).toBeInTheDocument();
    // The auction remains fully usable: price + status still render.
    expect(within(card).getByTestId("current-price")).toHaveTextContent("0.05 ETH");
    expect(within(card).getByTestId("status")).toHaveTextContent("live");
  });

  it("uses the indexer-cached name and image when no metadata URI resolves", async () => {
    renderCard(
      auctionItem({
        tokenUri: undefined,
        nftName: "Cached Relic",
        nftImage: "https://cdn.example/cached.png",
      }),
    );
    await flushAsync();

    const card = screen.getByTestId("auction-card");
    expect(within(card).getByText("Cached Relic")).toBeInTheDocument();
    expect(within(card).getByRole("img")).toHaveAttribute(
      "src",
      "https://cdn.example/cached.png",
    );
    // No metadata URI -> no metadata fetch at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exposes metadata links only as explicit, safe new-tab links (FR-019)", async () => {
    renderCard(auctionItem());
    await flushAsync();

    const card = screen.getByTestId("auction-card");
    const link = within(card).getByRole("link", {
      name: "https://example.com/relic",
    });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");

    // Only the metadata document was fetched - never auto-executed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector("script")).not.toBeInTheDocument();
    expect(document.querySelector("iframe")).not.toBeInTheDocument();
  });

  it("drops unsafe metadata URIs instead of linking or fetching them (FR-019)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ...METADATA, external_url: "javascript:alert(1)" }),
    );
    const { container } = renderCard(auctionItem());
    await flushAsync();

    const card = screen.getByTestId("auction-card");
    expect(
      within(card).queryByRole("link", { name: /javascript/i }),
    ).not.toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
    // The unsafe URI was rejected: only the metadata document was fetched.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

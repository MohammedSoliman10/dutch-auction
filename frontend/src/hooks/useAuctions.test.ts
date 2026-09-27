import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REFRESH_MS = 15_000;
const A1 = "0x1111111111111111111111111111111111111111";
const A2 = "0x2222222222222222222222222222222222222222";
const SELLER = "0x3333333333333333333333333333333333333333";
const BUYER = "0x4444444444444444444444444444444444444444";
const NFT = "0x5555555555555555555555555555555555555555";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const START = 1_767_225_600; // 2026-01-01T00:00:00Z
const STARTING_PRICE = 50_000_000_000_000_000n; // 0.05 ETH
const DISCOUNT_RATE = 100_000_000_000_000n; // 0.0001 ETH per second
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
  readCalls: [] as ReadConfig[],
  batchCalls: [] as Array<{ contracts?: ReadConfig[]; query?: ReadConfig["query"] }>,
  readError: false,
  batchError: false,
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

import { useAuctions } from "./useAuctions";

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
    chainId: 11155111,
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

function seedChainAuction(
  address: string,
  fields: {
    seller: string;
    expiresAt: bigint;
    sold?: boolean;
    cancelled?: boolean;
    tokenId?: bigint;
    tokenUri?: string;
  },
) {
  h.addrReads[`${address}:seller`] = fields.seller;
  h.addrReads[`${address}:startingPrice`] = STARTING_PRICE;
  h.addrReads[`${address}:discountRate`] = DISCOUNT_RATE;
  h.addrReads[`${address}:duration`] = 300n;
  h.addrReads[`${address}:startAt`] = BigInt(START);
  h.addrReads[`${address}:expiresAt`] = fields.expiresAt;
  h.addrReads[`${address}:sold`] = fields.sold ?? false;
  h.addrReads[`${address}:cancelled`] = fields.cancelled ?? false;
  h.addrReads[`${address}:buyer`] = fields.sold === true ? BUYER : ZERO_ADDRESS;
  h.addrReads[`${address}:salePrice`] = fields.sold === true ? SALE_PRICE : 0n;
  h.addrReads[`${address}:nft`] = NFT;
  h.addrReads[`${address}:nftId`] = fields.tokenId ?? 7n;
  h.argsReads[`tokenURI:${fields.tokenId ?? 7n}`] =
    fields.tokenUri ?? "ipfs://bafydemo/7.json";
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

describe("useAuctions (T061, FR-014)", () => {
  it("loads the first gallery page from the index API with verbatim fields (contracts/api.md)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [apiItem()], nextCursor: "cursor-2" }),
    );

    const { result } = renderHook(() => useAuctions());
    expect(result.current.isLoading).toBe(true);
    await flushAsync();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auctions?status=all&limit=20",
      expect.anything(),
    );
    expect(result.current.source).toBe("api");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.nextCursor).toBe("cursor-2");

    expect(result.current.items).toHaveLength(1);
    const [item] = result.current.items;
    expect(item.address).toBe(A1);
    expect(item.seller).toBe(SELLER);
    expect(item.status).toBe("live"); // verbatim status enum
    expect(item.startingPrice).toBe(STARTING_PRICE); // wei parsed to bigint
    expect(item.discountRate).toBe(DISCOUNT_RATE);
    expect(item.duration).toBe(300);
    expect(item.expiresAt).toBe(START + 300);
    expect(item.tokenId).toBe("7");
    expect(item.tokenUri).toBe("ipfs://bafydemo/7.json");
    expect(item.nftName).toBe("Forge Relic #7");
    expect(item.nftImage).toBe("https://cdn.example/7.png");
    expect(item.buyer).toBeNull();
    expect(item.salePrice).toBeNull();

    // The API path must not enumerate the chain registry.
    const countCalls = h.readCalls.filter((call) => call.functionName === "auctionCount");
    expect(countCalls.length).toBeGreaterThan(0);
    for (const call of countCalls) expect(call.query?.enabled).toBe(false);
  });

  it("passes the chosen status filter and page limit to the index", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));

    renderHook(() => useAuctions({ status: "sold" }));
    await flushAsync();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auctions?status=sold&limit=20",
      expect.anything(),
    );

    renderHook(() => useAuctions({ status: "cancelled", limit: 50 }));
    await flushAsync();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auctions?status=cancelled&limit=50",
      expect.anything(),
    );
  });

  it("refreshes the gallery every ~15 s (SC-007 visibility window)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [apiItem()], nextCursor: null }),
    );

    renderHook(() => useAuctions());
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

  it("pages with the opaque cursor from nextCursor and appends items", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ items: [apiItem()], nextCursor: "cursor-2" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [apiItem({ address: A2, tokenId: "8" })],
          nextCursor: null,
        }),
      );

    const { result } = renderHook(() => useAuctions());
    await flushAsync();
    expect(result.current.items).toHaveLength(1);
    expect(result.current.nextCursor).toBe("cursor-2");

    act(() => {
      result.current.loadMore();
    });
    await flushAsync();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auctions?status=all&limit=20&cursor=cursor-2",
      expect.anything(),
    );
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items.map((item) => item.address)).toEqual([A1, A2]);
    expect(result.current.nextCursor).toBeNull();
  });

  it("falls back to on-chain registry discovery when the index returns a non-JSON document (FR-020)", async () => {
    // Production (Vercel) has no /api: the SPA HTML comes back with 200.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token < in JSON");
      },
      text: async () => "<!DOCTYPE html><html>…</html>",
    });
    h.reads.auctionCount = 2n;
    h.argsReads["allAuctions:0"] = A1;
    h.argsReads["allAuctions:1"] = A2;
    seedChainAuction(A1, { seller: SELLER, expiresAt: BigInt(START + 300) });
    seedChainAuction(A2, {
      seller: BUYER,
      expiresAt: BigInt(START - 1),
      tokenId: 8n,
      tokenUri: "ipfs://bafydemo/8.json",
    });

    const { result } = renderHook(() => useAuctions());
    await flushAsync();

    expect(result.current.source).toBe("chain"); // degraded label source
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull(); // chain fallback succeeded
    expect(result.current.nextCursor).toBeNull();

    expect(result.current.items).toHaveLength(2);
    const [first, second] = result.current.items;
    expect(first.address).toBe(A1);
    expect(first.status).toBe("live");
    expect(first.seller).toBe(SELLER);
    expect(first.startingPrice).toBe(STARTING_PRICE);
    expect(first.tokenUri).toBe("ipfs://bafydemo/7.json");
    expect(second.address).toBe(A2);
    expect(second.status).toBe("expired"); // derived per data-model §1.2
    expect(second.buyer).toBe(ZERO_ADDRESS);

    // SC-007 / FR-014: the on-chain fallback refreshes within 15 s. Reads are
    // issued unconditionally (hook rules), so the assertions target the latest
    // calls - the ones made while serving chain data.
    const countCalls = h.readCalls.filter((call) => call.functionName === "auctionCount");
    const countCall = countCalls[countCalls.length - 1];
    expect(countCall?.query?.enabled).toBe(true);
    expect(countCall?.query?.refetchInterval).toBe(REFRESH_MS);
    expect(
      h.batchCalls.some((call) => call.query?.refetchInterval === REFRESH_MS),
    ).toBe(true);
    const sellerBatches = h.batchCalls.filter(
      (call) => call.contracts?.[0]?.functionName === "seller",
    );
    expect(sellerBatches.length).toBeGreaterThan(0);
    expect(sellerBatches[sellerBatches.length - 1].query?.enabled).toBe(true);
  });

  it("applies the status filter client-side while serving on-chain fallback data", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    h.reads.auctionCount = 2n;
    h.argsReads["allAuctions:0"] = A1;
    h.argsReads["allAuctions:1"] = A2;
    seedChainAuction(A1, { seller: SELLER, expiresAt: BigInt(START + 300) });
    seedChainAuction(A2, {
      seller: BUYER,
      expiresAt: BigInt(START - 1),
      tokenId: 8n,
    });

    const { result, rerender } = renderHook(
      ({ status }: { status: "live" | "expired" }) => useAuctions({ status }),
      { initialProps: { status: "live" as "live" | "expired" } },
    );
    await flushAsync();
    expect(result.current.items.map((item) => item.address)).toEqual([A1]);

    rerender({ status: "expired" });
    await flushAsync();
    expect(result.current.items.map((item) => item.address)).toEqual([A2]);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/auctions?status=expired&limit=20",
      expect.anything(),
    );
  });

  it("surfaces a plain-language error with a retry when both the index and the chain fail (FR-020)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    h.readError = true;
    h.batchError = true;

    const { result } = renderHook(() => useAuctions());
    await flushAsync();

    expect(result.current.source).toBe("chain");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.items).toHaveLength(0);
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.what).toMatch(/could not be loaded/i);
    expect(result.current.error?.next).toMatch(/retry/i);
    expect(result.current.error?.what).not.toMatch(/0x[0-9a-f]{6,}/i);

    const before = apiCalls().length;
    act(() => {
      result.current.refetch();
    });
    await flushAsync();
    expect(apiCalls().length).toBe(before + 1);
  });
});

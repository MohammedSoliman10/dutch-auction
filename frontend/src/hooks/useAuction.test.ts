import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REFRESH_MS = 15_000;
const AUCTION = "0x1111111111111111111111111111111111111111";
const SELLER = "0x3333333333333333333333333333333333333333";
const BUYER = "0x4444444444444444444444444444444444444444";
const NFT = "0x5555555555555555555555555555555555555555";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const START = 1_767_225_600;
const STARTING_PRICE = 50_000_000_000_000_000n;
const DISCOUNT_RATE = 100_000_000_000_000n;
const SALE_PRICE = 40_000_000_000_000_000n;

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

import { useAuction } from "./useAuction";

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

function apiDetail(overrides: Record<string, unknown> = {}) {
  return {
    address: AUCTION,
    chainId: 11155111,
    seller: SELLER,
    nftContract: NFT,
    tokenId: "7",
    startingPrice: STARTING_PRICE.toString(),
    discountRate: DISCOUNT_RATE.toString(),
    duration: 300,
    startAt: START - 300,
    expiresAt: START,
    status: "sold",
    currentPrice: "0",
    buyer: BUYER,
    salePrice: SALE_PRICE.toString(),
    nft: { tokenUri: "ipfs://bafydemo/7.json", name: "Forge Relic #7", image: null },
    createdAtBlock: 7_910_000,
    createdAtTx:
      "0xabc0000000000000000000000000000000000000000000000000000000000001",
    updatedBlock: 7_912_000,
    cancelledAt: null,
    reclaimedAt: null,
    ...overrides,
  };
}

function seedChainAuction(
  fields: {
    seller: string;
    expiresAt: bigint;
    sold?: boolean;
    cancelled?: boolean;
    tokenId?: bigint;
    tokenUri?: string;
  },
) {
  h.addrReads[`${AUCTION}:seller`] = fields.seller;
  h.addrReads[`${AUCTION}:startingPrice`] = STARTING_PRICE;
  h.addrReads[`${AUCTION}:discountRate`] = DISCOUNT_RATE;
  h.addrReads[`${AUCTION}:duration`] = 300n;
  h.addrReads[`${AUCTION}:startAt`] = BigInt(START);
  h.addrReads[`${AUCTION}:expiresAt`] = fields.expiresAt;
  h.addrReads[`${AUCTION}:sold`] = fields.sold ?? false;
  h.addrReads[`${AUCTION}:cancelled`] = fields.cancelled ?? false;
  h.addrReads[`${AUCTION}:buyer`] = fields.sold === true ? BUYER : ZERO_ADDRESS;
  h.addrReads[`${AUCTION}:salePrice`] = fields.sold === true ? SALE_PRICE : 0n;
  h.addrReads[`${AUCTION}:nft`] = NFT;
  h.addrReads[`${AUCTION}:nftId`] = fields.tokenId ?? 7n;
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

describe("useAuction (T061, FR-020 detail fallback chain)", () => {
  it("loads the auction detail from the index API with verbatim fields", async () => {
    fetchMock.mockResolvedValue(jsonResponse(apiDetail()));

    const { result } = renderHook(() => useAuction(AUCTION));
    expect(result.current.isLoading).toBe(true);
    await flushAsync();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/auctions/${AUCTION}`,
      expect.anything(),
    );
    expect(result.current.source).toBe("api");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.auction?.address).toBe(AUCTION);
    expect(result.current.auction?.status).toBe("sold");
    expect(result.current.auction?.startingPrice).toBe(STARTING_PRICE);
    expect(result.current.auction?.salePrice).toBe(SALE_PRICE);
    expect(result.current.auction?.buyer).toBe(BUYER);
    expect(result.current.auction?.tokenUri).toBe("ipfs://bafydemo/7.json");

    // The API path must not touch the chain.
    const chainReads = h.readCalls.filter(
      (call) => call.functionName === "seller" || call.functionName === "sold",
    );
    expect(chainReads.length).toBeGreaterThan(0);
    for (const call of chainReads) expect(call.query?.enabled).toBe(false);
  });

  it("falls back to direct on-chain reads when the index is unreachable (FR-020)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    seedChainAuction({ seller: SELLER, expiresAt: BigInt(START + 300) });

    const { result } = renderHook(() => useAuction(AUCTION));
    await flushAsync();

    expect(result.current.source).toBe("chain"); // labeled fallback source
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.auction?.address).toBe(AUCTION);
    expect(result.current.auction?.seller).toBe(SELLER);
    expect(result.current.auction?.status).toBe("live");
    expect(result.current.auction?.startingPrice).toBe(STARTING_PRICE);
    expect(result.current.auction?.discountRate).toBe(DISCOUNT_RATE);
    expect(result.current.auction?.expiresAt).toBe(START + 300);
    expect(result.current.auction?.tokenUri).toBe("ipfs://bafydemo/7.json");

    // SC-007: fallback reads refetch within the 15 s window. Reads are issued
    // unconditionally (hook rules), so assert on the latest call - the one
    // made while serving chain data.
    const sellerCalls = h.readCalls.filter((call) => call.functionName === "seller");
    const sellerRead = sellerCalls[sellerCalls.length - 1];
    expect(sellerRead?.query?.enabled).toBe(true);
    expect(sellerRead?.query?.refetchInterval).toBe(REFRESH_MS);
    for (const functionName of ["sold", "expiresAt", "salePrice"]) {
      const calls = h.readCalls.filter((call) => call.functionName === functionName);
      expect(calls[calls.length - 1]?.query?.refetchInterval).toBe(REFRESH_MS);
    }
  });

  it("derives the verbatim status from chain flags per data-model §1.2", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const scenarios = [
      {
        fields: {
          seller: SELLER,
          expiresAt: BigInt(START + 300),
          sold: true,
          tokenId: 7n,
        },
        expected: "sold",
      },
      {
        fields: {
          seller: SELLER,
          expiresAt: BigInt(START + 300),
          cancelled: true,
          tokenId: 7n,
        },
        expected: "cancelled",
      },
      {
        fields: { seller: SELLER, expiresAt: BigInt(START - 1), tokenId: 7n },
        expected: "expired",
      },
    ] as const;

    for (const scenario of scenarios) {
      seedChainAuction(scenario.fields);
      const { result } = renderHook(() => useAuction(AUCTION));
      await flushAsync();
      expect(result.current.auction?.status).toBe(scenario.expected);
      cleanup();
    }

    seedChainAuction({ seller: SELLER, expiresAt: BigInt(START + 300), sold: true, tokenId: 7n });
    const sold = renderHook(() => useAuction(AUCTION));
    await flushAsync();
    expect(sold.result.current.auction?.buyer).toBe(BUYER);
    expect(sold.result.current.auction?.salePrice).toBe(SALE_PRICE);
    cleanup();
  });

  it("treats a 404 AUCTION_NOT_FOUND as an index miss and still falls back to the chain", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: { code: "AUCTION_NOT_FOUND", message: "Auction is not in the read-model" },
      }),
      text: async () => "",
    });
    seedChainAuction({ seller: SELLER, expiresAt: BigInt(START + 300) });

    const { result } = renderHook(() => useAuction(AUCTION));
    await flushAsync();

    expect(result.current.source).toBe("chain");
    expect(result.current.auction?.status).toBe("live");
    expect(result.current.auction?.seller).toBe(SELLER);
  });

  it("returns a plain-language error with retry when both the index and the chain fail (FR-020)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    h.readError = true;
    h.batchError = true;

    const { result } = renderHook(() => useAuction(AUCTION));
    await flushAsync();

    expect(result.current.source).toBe("chain");
    expect(result.current.auction).toBeNull();
    expect(result.current.isLoading).toBe(false);
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

  it("stays quiet without an address - no fetch, no chain reads", async () => {
    const { result } = renderHook(() => useAuction(undefined));
    await flushAsync();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.auction).toBeNull();
    expect(result.current.source).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

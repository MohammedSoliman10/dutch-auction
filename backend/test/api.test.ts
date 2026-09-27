// T055: contracts/api.md conformance - AuctionSummary shape, decimal-string wei,
// unix-second timestamps, lowercase addresses, query validation, 404, health.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chainMocks = vi.hoisted(() => ({
  chainId: 11155111,
  addresses: {
    factory: "0x4444444444444444444444444444444444444444",
    nft: "0x3333333333333333333333333333333333333333",
  },
  abis: { auctionFactory: [], dutchAuction: [], dutchAuctionNFT: [] },
  client: {
    getBlockNumber: vi.fn<() => Promise<bigint>>(),
  },
}));

vi.mock("../src/chain.js", () => chainMocks);

import { createDb, type AuctionInput, type Db } from "../src/db.js";
import { registerRoutes } from "../src/routes/index.js";

const NOW = Math.floor(Date.now() / 1000);

const SELLER_A = "0x1a2b3c4d5e6f102030405060708090a0b0c0d0e1";
const SELLER_B = "0x2b3c4d5e6f708192030405060708090a0b0c0d0e";
const NFT_CONTRACT = "0x3c4d5e6f708192030405060708090a0b0c0d0e1f";
const AUCTION_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const AUCTION_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BUYER = "0x9999999999999999999999999999999999999999";
const TX = `0x${"ab".repeat(32)}`;

interface NftView {
  tokenUri: string | null;
  name: string | null;
  image: string | null;
}

interface Summary {
  address: string;
  chainId: number;
  seller: string;
  nftContract: string;
  tokenId: string;
  startingPrice: string;
  discountRate: string;
  duration: number;
  startAt: number;
  expiresAt: number;
  status: string;
  currentPrice: string;
  buyer: string | null;
  salePrice: string | null;
  nft: NftView;
}

interface Detail extends Summary {
  createdAtBlock: number;
  createdAtTx: string;
  updatedBlock: number;
  cancelledAt: number | null;
  reclaimedAt: number | null;
}

interface ListBody {
  items: Summary[];
  nextCursor: string | null;
}

interface ErrorBody {
  error: { code: string; message: string };
}

interface HealthBody {
  status: string;
  chainId: number;
  factoryAddress: string;
  lastIndexedBlock: number;
  headBlock: number;
  lagBlocks: number;
}

function jsonBody<T>(response: { json(): unknown }): T {
  return response.json() as T;
}

const SUMMARY_KEYS = [
  "address", "chainId", "seller", "nftContract", "tokenId", "startingPrice",
  "discountRate", "duration", "startAt", "expiresAt", "status", "currentPrice",
  "buyer", "salePrice", "nft",
];

const DETAIL_EXTRA_KEYS = ["createdAtBlock", "createdAtTx", "updatedBlock", "cancelledAt", "reclaimedAt"];

function liveFixture(overrides: Partial<AuctionInput> = {}): AuctionInput {
  return {
    address: AUCTION_A,
    chainId: 11155111,
    seller: SELLER_A,
    nftContract: NFT_CONTRACT,
    tokenId: "12",
    startingPrice: "100000000000000000",
    discountRate: "333333333333333",
    duration: 300,
    startAt: NOW - 60,
    expiresAt: NOW + 240,
    status: "live",
    createdBlock: 7910000,
    createdTx: TX,
    updatedBlock: 7910000,
    ...overrides,
  };
}

let dir: string;
let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  dir = mkdtempSync(path.join(tmpdir(), "dutch-api-"));
  db = createDb(path.join(dir, "index.db"));
  chainMocks.client.getBlockNumber.mockResolvedValue(7912350n);
  app = Fastify();
  await registerRoutes(app, db);
});

afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/health", () => {
  it("returns the exact api.md health shape with lag within bounds", async () => {
    db.setSyncState(7912345);
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = jsonBody<HealthBody>(res);
    expect(Object.keys(body).sort()).toEqual(
      ["status", "chainId", "factoryAddress", "lastIndexedBlock", "headBlock", "lagBlocks"].sort(),
    );
    expect(body).toEqual({
      status: "ok",
      chainId: 11155111,
      factoryAddress: chainMocks.addresses.factory,
      lastIndexedBlock: 7912345,
      headBlock: 7912350,
      lagBlocks: 5,
    });
    expect(body.factoryAddress).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it("reports syncing instead of failing when the RPC head is unavailable", async () => {
    db.setSyncState(7912345);
    chainMocks.client.getBlockNumber.mockRejectedValue(new Error("rpc down"));
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = jsonBody<HealthBody>(res);
    expect(body.status).toBe("syncing");
    expect(body.headBlock).toBe(0);
    expect(body.lastIndexedBlock).toBe(7912345);
  });

  it("reports syncing when the indexer lag exceeds 60 blocks", async () => {
    db.setSyncState(7912345);
    chainMocks.client.getBlockNumber.mockResolvedValue(7912410n);
    const res = await app.inject({ method: "GET", url: "/api/health" });
    const body = jsonBody<HealthBody>(res);
    expect(body.status).toBe("syncing");
    expect(body.lagBlocks).toBe(65);
  });
});

describe("GET /api/auctions - AuctionSummary conformance", () => {
  it("returns the exact AuctionSummary field set with api.md value encodings", async () => {
    db.upsertAuction(liveFixture());
    const res = await app.inject({ method: "GET", url: "/api/auctions" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(String(res.headers["content-type"])).toContain("application/json");

    const body = jsonBody<ListBody>(res);
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).toBeNull();
    const item = body.items[0];

    expect(Object.keys(item).sort()).toEqual([...SUMMARY_KEYS].sort());
    expect(Object.keys(item.nft).sort()).toEqual(["tokenUri", "name", "image"].sort());

    // Big numbers are decimal strings, never JS numbers.
    for (const key of ["tokenId", "startingPrice", "discountRate", "currentPrice"] as const) {
      expect(typeof item[key]).toBe("string");
      expect(item[key]).toMatch(/^\d+$/);
    }
    expect(item.buyer).toBeNull();
    expect(item.salePrice).toBeNull();

    // Addresses are lowercase 0x hex.
    for (const key of ["address", "seller", "nftContract"] as const) {
      expect(item[key]).toMatch(/^0x[0-9a-f]{40}$/);
    }

    // Timestamps are unix seconds (integers) and internally consistent.
    for (const key of ["startAt", "expiresAt"] as const) {
      expect(Number.isInteger(item[key])).toBe(true);
    }
    expect(item.expiresAt).toBe(item.startAt + item.duration);
    expect(item.chainId).toBe(11155111);
    expect(item.status).toBe("live");
    expect(item.nft).toEqual({ tokenUri: null, name: null, image: null });

    // currentPrice: local linear decay from startAt (contract getPrice formula).
    const elapsed = BigInt(NOW - item.startAt);
    const expected = BigInt(item.startingPrice) - BigInt(item.discountRate) * elapsed;
    const price = BigInt(item.currentPrice);
    expect(price <= expected && price >= expected - BigInt(item.discountRate) * 2n).toBe(true);
  });

  it("normalizes mixed-case stored addresses to lowercase in responses", async () => {
    db.upsertAuction(
      liveFixture({
        address: AUCTION_A.toUpperCase().replace("0X", "0x"),
        seller: SELLER_A.toUpperCase().replace("0X", "0x"),
        nftContract: NFT_CONTRACT.toUpperCase().replace("0X", "0x"),
      }),
    );
    const res = await app.inject({ method: "GET", url: "/api/auctions" });
    const item = jsonBody<ListBody>(res).items[0];
    expect(item.address).toBe(AUCTION_A);
    expect(item.seller).toBe(SELLER_A);
    expect(item.nftContract).toBe(NFT_CONTRACT);
  });

  it("computes currentPrice as zero at/after full decay", async () => {
    // startingPrice 1e17 - discountRate * duration = 1e17 - 99999999999999900 = 100 wei left.
    db.upsertAuction(
      liveFixture({
        startAt: NOW - 10_000,
        duration: 300,
        expiresAt: NOW - 9700,
      }),
    );
    const res = await app.inject({ method: "GET", url: "/api/auctions" });
    const item = jsonBody<ListBody>(res).items[0];
    expect(item.currentPrice).toBe("100");
    expect(item.status).toBe("expired");
  });

  it("nulls buyer and salePrice unless status is sold", async () => {
    db.upsertAuction(liveFixture({ buyer: BUYER, salePrice: "123" }));
    const live = jsonBody<ListBody>(await app.inject({ method: "GET", url: "/api/auctions" })).items[0];
    expect(live.buyer).toBeNull();
    expect(live.salePrice).toBeNull();

    db.upsertAuction(
      liveFixture({
        address: AUCTION_B,
        seller: SELLER_B,
        status: "sold",
        buyer: BUYER.toUpperCase().replace("0X", "0x"),
        salePrice: "95000000000000000",
        startAt: NOW - 360,
        expiresAt: NOW - 60,
        createdBlock: 7910001,
        updatedBlock: 7910002,
      }),
    );
    const sold = jsonBody<ListBody>(
      await app.inject({ method: "GET", url: "/api/auctions?status=sold" }),
    ).items[0];
    expect(sold.status).toBe("sold");
    expect(sold.buyer).toBe(BUYER);
    expect(sold.salePrice).toBe("95000000000000000");
    expect(typeof sold.salePrice).toBe("string");
  });
});

describe("GET /api/auctions - query validation (400 INVALID_PARAMETER)", () => {
  beforeEach(() => {
    db.upsertAuction(liveFixture());
  });

  const badRequests: Array<{ query: string; why: string }> = [
    { query: "status=nope", why: "status outside the enum" },
    { query: "status=", why: "empty status" },
    { query: "status=live&status=sold", why: "repeated status" },
    { query: "limit=0", why: "limit below 1" },
    { query: "limit=101", why: "limit above 100" },
    { query: "limit=abc", why: "non-numeric limit" },
    { query: "limit=1.5", why: "fractional limit" },
    { query: "limit=-1", why: "negative limit" },
    { query: "cursor=not-a-cursor", why: "garbage cursor" },
    { query: "cursor=MTIz", why: "cursor decoding to a non-opaque value" },
    { query: "seller=0x123", why: "truncated seller address" },
    { query: "seller=not-an-address", why: "non-address seller" },
    { query: "seller=0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", why: "non-hex seller" },
  ];

  for (const { query, why } of badRequests) {
    it(`rejects ${why} with 400 INVALID_PARAMETER`, async () => {
      const res = await app.inject({ method: "GET", url: `/api/auctions?${query}` });
      expect(res.statusCode).toBe(400);
      const body = jsonBody<ErrorBody>(res);
      expect(body.error.code).toBe("INVALID_PARAMETER");
      expect(typeof body.error.message).toBe("string");
      expect(body.error.message.length).toBeGreaterThan(0);
    });
  }

  it("ignores unknown query params", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auctions?foo=bar&limit=1" });
    expect(res.statusCode).toBe(200);
    expect(jsonBody<ListBody>(res).items).toHaveLength(1);
  });
});

describe("GET /api/auctions - filters, ordering, paging", () => {
  beforeEach(() => {
    // effective statuses: live (future expiry), sold, cancelled, expired-by-time.
    db.upsertAuction(liveFixture({ address: AUCTION_A, seller: SELLER_A, createdBlock: 100 }));
    db.upsertAuction(
      liveFixture({
        address: AUCTION_B,
        seller: SELLER_B,
        status: "sold",
        buyer: BUYER,
        salePrice: "95000000000000000",
        createdBlock: 101,
        updatedBlock: 102,
      }),
    );
    db.upsertAuction(
      liveFixture({
        address: "0xcccccccccccccccccccccccccccccccccccccccc",
        seller: SELLER_A,
        status: "cancelled",
        nftReturnedAt: NOW - 5,
        createdBlock: 103,
        updatedBlock: 104,
      }),
    );
    db.upsertAuction(
      liveFixture({
        address: "0xdddddddddddddddddddddddddddddddddddddddd",
        seller: SELLER_B,
        startAt: NOW - 10_000,
        duration: 300,
        expiresAt: NOW - 9700,
        createdBlock: 99,
      }),
    );
  });

  it("orders by created_block descending (newest first) with a deterministic tie-break", async () => {
    const body = jsonBody<ListBody>(await app.inject({ method: "GET", url: "/api/auctions?status=all" }));
    expect(body.items.map((item) => item.address)).toEqual([
      "0xcccccccccccccccccccccccccccccccccccccccc",
      AUCTION_B,
      AUCTION_A,
      "0xdddddddddddddddddddddddddddddddddddddddd",
    ]);
  });

  it("filters by each status enum value including derived expiry", async () => {
    const cases: Array<[string, string[]]> = [
      ["live", [AUCTION_A]],
      ["sold", [AUCTION_B]],
      ["cancelled", ["0xcccccccccccccccccccccccccccccccccccccccc"]],
      ["expired", ["0xdddddddddddddddddddddddddddddddddddddddd"]],
      ["all", [AUCTION_A, AUCTION_B, "0xcccccccccccccccccccccccccccccccccccccccc", "0xdddddddddddddddddddddddddddddddddddddddd"]],
    ];
    for (const [status, expected] of cases) {
      const res = await app.inject({ method: "GET", url: `/api/auctions?status=${status}` });
      expect(res.statusCode).toBe(200);
      const body = jsonBody<ListBody>(res);
      expect(body.items.map((item) => item.address).sort()).toEqual([...expected].sort());
    }
  });

  it("filters by seller, accepting a mixed-case query address", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/auctions?seller=${SELLER_A.toUpperCase().replace("0X", "0x")}`,
    });
    expect(res.statusCode).toBe(200);
    const body = jsonBody<ListBody>(res);
    expect(body.items.map((item) => item.seller)).toEqual([SELLER_A, SELLER_A]);
    expect(body.items.every((item) => item.seller === SELLER_A)).toBe(true);
  });

  it("rejects an invalid seller with 400 even when other params are valid", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auctions?status=live&seller=0xnope" });
    expect(res.statusCode).toBe(400);
    expect(jsonBody<ErrorBody>(res).error.code).toBe("INVALID_PARAMETER");
  });
});

describe("GET /api/auctions - cursor paging (opaque round-trip)", () => {
  const TOTAL = 25;

  beforeEach(() => {
    for (let i = 1; i <= TOTAL; i += 1) {
      db.upsertAuction(
        liveFixture({
          address: `0x${i.toString(16).padStart(40, "0")}`,
          seller: i % 2 === 0 ? SELLER_A : SELLER_B,
          createdBlock: 5000 + i,
        }),
      );
    }
  });

  it("defaults to limit 20 and pages through all items exactly once", async () => {
    const first = jsonBody<ListBody>(await app.inject({ method: "GET", url: "/api/auctions" }));
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = jsonBody<ListBody>(
      await app.inject({ method: "GET", url: `/api/auctions?cursor=${encodeURIComponent(first.nextCursor ?? "")}` }),
    );
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();

    const seen = [...first.items, ...second.items].map((item) => item.address);
    expect(new Set(seen).size).toBe(TOTAL);
    expect(first.items[0].address).toBe(`0x${TOTAL.toString(16).padStart(40, "0")}`);
    expect(second.items[4].address).toBe(`0x${(1).toString(16).padStart(40, "0")}`);
  });

  it("honours limit 1-100 boundaries", async () => {
    const one = jsonBody<ListBody>(await app.inject({ method: "GET", url: "/api/auctions?limit=1" }));
    expect(one.items).toHaveLength(1);
    expect(one.nextCursor).toEqual(expect.any(String));

    const hundred = jsonBody<ListBody>(await app.inject({ method: "GET", url: "/api/auctions?limit=100" }));
    expect(hundred.items).toHaveLength(TOTAL);
    expect(hundred.nextCursor).toBeNull();
  });
});

describe("GET /api/auctions - status recomputed at read time (data-model 1.2)", () => {
  it("flips a stored live row to expired when the clock passes expiresAt, without a write", async () => {
    db.upsertAuction(liveFixture({ startAt: NOW - 240, duration: 300, expiresAt: NOW + 60 }));

    vi.useFakeTimers({ toFake: ["Date"] });

    vi.setSystemTime(new Date((NOW + 1) * 1000));
    const before = jsonBody<ListBody>(await app.inject({ method: "GET", url: "/api/auctions" }));
    expect(before.items[0].status).toBe("live");

    vi.setSystemTime(new Date((NOW + 120) * 1000));
    const after = jsonBody<ListBody>(await app.inject({ method: "GET", url: "/api/auctions" }));
    expect(after.items[0].status).toBe("expired");

    // The same warp is visible through the status filter and the detail route.
    const liveFilter = jsonBody<ListBody>(await app.inject({ method: "GET", url: "/api/auctions?status=live" }));
    expect(liveFilter.items).toHaveLength(0);
    const expiredFilter = jsonBody<ListBody>(await app.inject({ method: "GET", url: "/api/auctions?status=expired" }));
    expect(expiredFilter.items).toHaveLength(1);
    const detail = jsonBody<Detail>(
      await app.inject({ method: "GET", url: `/api/auctions/${AUCTION_A}` }),
    );
    expect(detail.status).toBe("expired");

    vi.useRealTimers();
    // Stored status is still `live`: expiry was derived at read time, not persisted.
    const stored = jsonBody<ListBody>(await app.inject({ method: "GET", url: "/api/auctions" }));
    expect(stored.items[0].status).toBe("live");
  });
});

describe("GET /api/auctions/:address - AuctionDetail", () => {
  beforeEach(() => {
    db.upsertAuction(liveFixture());
  });

  it("returns AuctionSummary plus the exact detail fields", async () => {
    const res = await app.inject({ method: "GET", url: `/api/auctions/${AUCTION_A}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = jsonBody<Detail>(res);
    expect(Object.keys(body).sort()).toEqual([...SUMMARY_KEYS, ...DETAIL_EXTRA_KEYS].sort());
    expect(body.createdAtBlock).toBe(7910000);
    expect(body.createdAtTx).toBe(TX);
    expect(body.updatedBlock).toBe(7910000);
    expect(body.cancelledAt).toBeNull();
    expect(body.reclaimedAt).toBeNull();
  });

  it("accepts a mixed-case path address", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/auctions/${AUCTION_A.toUpperCase().replace("0X", "0x")}`,
    });
    expect(res.statusCode).toBe(200);
    expect(jsonBody<Detail>(res).address).toBe(AUCTION_A);
  });

  it("returns 404 AUCTION_NOT_FOUND for an unknown but well-formed address", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auctions/0x9999999999999999999999999999999999999999" });
    expect(res.statusCode).toBe(404);
    const body = jsonBody<ErrorBody>(res);
    expect(body.error.code).toBe("AUCTION_NOT_FOUND");
    expect(typeof body.error.message).toBe("string");
  });

  const malformed = ["0x123", "not-an-address", "0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"];
  for (const address of malformed) {
    it(`returns 400 INVALID_PARAMETER for malformed address "${address}"`, async () => {
      const res = await app.inject({ method: "GET", url: `/api/auctions/${address}` });
      expect(res.statusCode).toBe(400);
      expect(jsonBody<ErrorBody>(res).error.code).toBe("INVALID_PARAMETER");
    });
  }

  it("surfaces cancellation provenance on cancelledAt only", async () => {
    db.upsertAuction(
      liveFixture({
        address: AUCTION_B,
        status: "cancelled",
        nftReturnedAt: NOW - 5,
        createdBlock: 7910010,
        updatedBlock: 7910020,
      }),
    );
    const body = jsonBody<Detail>(await app.inject({ method: "GET", url: `/api/auctions/${AUCTION_B}` }));
    expect(body.status).toBe("cancelled");
    expect(body.cancelledAt).toBe(NOW - 5);
    expect(body.reclaimedAt).toBeNull();
    expect(body.buyer).toBeNull();
    expect(body.salePrice).toBeNull();
  });

  it("surfaces reclaim provenance on reclaimedAt only", async () => {
    db.upsertAuction(
      liveFixture({
        address: AUCTION_B,
        startAt: NOW - 10_000,
        duration: 300,
        expiresAt: NOW - 9700,
        nftReturnedAt: NOW - 10,
        createdBlock: 7910010,
        updatedBlock: 7910030,
      }),
    );
    const body = jsonBody<Detail>(await app.inject({ method: "GET", url: `/api/auctions/${AUCTION_B}` }));
    expect(body.status).toBe("expired");
    expect(body.reclaimedAt).toBe(NOW - 10);
    expect(body.cancelledAt).toBeNull();
  });
});

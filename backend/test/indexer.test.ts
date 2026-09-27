// T056: indexer idempotency + resume - UNIQUE(tx_hash, log_index) replays are
// no-ops, sync_state resumes without double-apply, and status derivation follows
// data-model 1.2 verbatim, recomputed at read time.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chainMocks = vi.hoisted(() => {
  const auctionCreated = {
    type: "event",
    name: "AuctionCreated",
    inputs: [
      { name: "auction", type: "address", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "nft", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "startingPrice", type: "uint256", indexed: false },
      { name: "discountRate", type: "uint256", indexed: false },
      { name: "duration", type: "uint256", indexed: false },
      { name: "startAt", type: "uint256", indexed: false },
      { name: "expiresAt", type: "uint256", indexed: false },
    ],
  };
  const auctionSold = {
    type: "event",
    name: "AuctionSold",
    inputs: [
      { name: "buyer", type: "address", indexed: true },
      { name: "price", type: "uint256", indexed: false },
    ],
  };
  const auctionCancelled = { type: "event", name: "AuctionCancelled", inputs: [] };
  const auctionReclaimed = { type: "event", name: "AuctionReclaimed", inputs: [] };
  return {
    chainId: 11155111,
    addresses: {
      factory: "0x4444444444444444444444444444444444444444",
      nft: "0x3333333333333333333333333333333333333333",
    },
    abis: {
      auctionFactory: [auctionCreated],
      dutchAuction: [auctionSold, auctionCancelled, auctionReclaimed],
      dutchAuctionNFT: [],
    },
    client: {
      getLogs: vi.fn<(params: {
        address?: unknown;
        fromBlock?: unknown;
        toBlock?: unknown;
      }) => Promise<unknown>>(),
      getBlockNumber: vi.fn<() => Promise<bigint>>(),
      getBlock: vi.fn<(params: { blockNumber: bigint }) => Promise<{ timestamp: bigint } | undefined>>(),
      readContract: vi.fn<(params: { functionName?: unknown }) => Promise<unknown>>(),
    },
  };
});

vi.mock("../src/chain.js", () => chainMocks);
vi.mock("../src/metadata.js", () => ({ resolveTokenMetadata: vi.fn() }));

import { resolveTokenMetadata } from "../src/metadata.js";
import { createDb, INDEXER_SYNC_KEY, type AuctionInput, type AuctionRecord, type Db } from "../src/db.js";
import { POLL_INTERVAL_MS, startIndexer, syncOnce } from "../src/indexer.js";

const NOW = Math.floor(Date.now() / 1000);
const START = BigInt(NOW - 60);
const EXPIRES = START + 300n;

const SELLER_A = "0x1a2b3c4d5e6f102030405060708090a0b0c0d0e1";
const NFT = "0x3c4d5e6f708192030405060708090a0b0c0d0e1f";
const AUCTION_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BUYER = "0x9999999999999999999999999999999999999999";
const FACTORY_TX = `0x${"11".repeat(32)}`;
const SOLD_TX = `0x${"22".repeat(32)}`;
const CANCEL_TX = `0x${"33".repeat(32)}`;
const RECLAIM_TX = `0x${"44".repeat(32)}`;

interface CreatedLogOptions {
  blockNumber?: bigint;
  txHash?: string;
  logIndex?: number;
  startAt?: bigint;
}

function createdLog(options: CreatedLogOptions = {}): unknown {
  const startAt = options.startAt ?? START;
  return {
    address: chainMocks.addresses.factory,
    blockNumber: options.blockNumber ?? 100n,
    transactionHash: options.txHash ?? FACTORY_TX,
    logIndex: options.logIndex ?? 0,
    eventName: "AuctionCreated",
    args: {
      auction: AUCTION_A,
      seller: SELLER_A,
      nft: NFT,
      tokenId: 12n,
      startingPrice: 10n ** 17n,
      discountRate: 333333333333333n,
      duration: 300n,
      startAt,
      expiresAt: startAt + 300n,
    },
  };
}

function soldLog(): unknown {
  return {
    address: AUCTION_A,
    blockNumber: 105n,
    transactionHash: SOLD_TX,
    logIndex: 0,
    eventName: "AuctionSold",
    args: { buyer: BUYER, price: 97777777777777777n },
  };
}

function cancelledLog(): unknown {
  return {
    address: AUCTION_A,
    blockNumber: 110n,
    transactionHash: CANCEL_TX,
    logIndex: 0,
    eventName: "AuctionCancelled",
    args: {},
  };
}

function reclaimedLog(): unknown {
  return {
    address: AUCTION_A,
    blockNumber: 110n,
    transactionHash: RECLAIM_TX,
    logIndex: 0,
    eventName: "AuctionReclaimed",
    args: {},
  };
}

function fixture(overrides: Partial<AuctionInput> = {}): AuctionInput {
  return {
    address: AUCTION_A,
    chainId: 11155111,
    seller: SELLER_A,
    nftContract: NFT,
    tokenId: "12",
    startingPrice: "100000000000000000",
    discountRate: "333333333333333",
    duration: 300,
    startAt: NOW - 60,
    expiresAt: NOW + 240,
    status: "live",
    createdBlock: 100,
    createdTx: FACTORY_TX,
    updatedBlock: 100,
    ...overrides,
  };
}

function eventCount(): number {
  const raw = new Database(path.join(dir, "index.db"), { readonly: true });
  try {
    const row = raw.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
    return row.n;
  } finally {
    raw.close();
  }
}

let dir: string;
let db: Db;
let factoryLogs: unknown[];
let auctionLogs: unknown[];

beforeEach(() => {
  vi.clearAllMocks();
  dir = mkdtempSync(path.join(tmpdir(), "dutch-indexer-"));
  db = createDb(path.join(dir, "index.db"));
  factoryLogs = [];
  auctionLogs = [];
  chainMocks.client.getBlockNumber.mockResolvedValue(100n);
  chainMocks.client.getLogs.mockImplementation(
    async (params) => (Array.isArray(params.address) ? auctionLogs : factoryLogs),
  );
  chainMocks.client.getBlock.mockResolvedValue({ timestamp: BigInt(NOW - 10) });
  chainMocks.client.readContract.mockResolvedValue(null);
  vi.mocked(resolveTokenMetadata).mockResolvedValue({ name: null, image: null });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("T058 - AuctionCreated registration + cursor", () => {
  it("registers an AuctionCreated row verbatim and advances the sync cursor", async () => {
    factoryLogs = [createdLog()];

    const result = await syncOnce(db);

    expect(result.caughtUp).toBe(true);
    const items = db.listAuctions({ limit: 100 }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      address: AUCTION_A,
      chainId: 11155111,
      seller: SELLER_A,
      nftContract: NFT,
      tokenId: "12",
      startingPrice: "100000000000000000",
      discountRate: "333333333333333",
      duration: 300,
      startAt: Number(START),
      expiresAt: Number(EXPIRES),
      status: "live",
      buyer: null,
      salePrice: null,
      nftReturnedAt: null,
      tokenUri: null,
      metadataName: null,
      metadataImage: null,
      createdBlock: 100,
      createdTx: FACTORY_TX,
      updatedBlock: 100,
    });
    expect(db.getSyncState(INDEXER_SYNC_KEY)?.lastBlock).toBe(100);
    expect(eventCount()).toBe(1);
  });

  it("does not poll outcome logs while no auctions are known (empty address filter)", async () => {
    factoryLogs = [];
    await syncOnce(db);
    expect(chainMocks.client.getLogs).toHaveBeenCalledTimes(1);
  });
});

describe("T056 - replay idempotency via UNIQUE(tx_hash, log_index)", () => {
  it("replaying the same AuctionCreated log yields a single row and single event", async () => {
    factoryLogs = [createdLog()];
    await syncOnce(db);

    // The cursor moved on, but a flaky provider replays the log anyway.
    chainMocks.client.getBlockNumber.mockResolvedValue(105n);
    const callsBefore = chainMocks.client.getLogs.mock.calls.length;
    await syncOnce(db);

    expect(db.listAuctions({ limit: 100 }).items).toHaveLength(1);
    expect(eventCount()).toBe(1);
    expect(
      db.recordEvent({
        blockNumber: 100,
        txHash: FACTORY_TX,
        logIndex: 0,
        address: chainMocks.addresses.factory,
        eventName: "AuctionCreated",
        args: {},
      }),
    ).toBe(false);
    for (const [params] of chainMocks.client.getLogs.mock.calls.slice(callsBefore)) {
      expect(params.fromBlock).toBe(101n);
    }
    expect(db.getSyncState(INDEXER_SYNC_KEY)?.lastBlock).toBe(105);
  });

  it("replaying AuctionSold does not double-apply state", async () => {
    factoryLogs = [createdLog()];
    await syncOnce(db);
    chainMocks.client.getBlockNumber.mockResolvedValue(110n);
    factoryLogs = [];
    auctionLogs = [soldLog()];
    await syncOnce(db);

    chainMocks.client.getBlockNumber.mockResolvedValue(120n);
    await syncOnce(db); // sold log replayed by the mock

    const row = db.getAuction(AUCTION_A);
    expect(row).toMatchObject({
      status: "sold",
      buyer: BUYER,
      salePrice: "97777777777777777",
      updatedBlock: 105,
    });
    expect(eventCount()).toBe(2);
    expect(db.getSyncState(INDEXER_SYNC_KEY)?.lastBlock).toBe(120);
  });
});

describe("T056 - sync_state resume without double-apply", () => {
  it("resumes strictly from lastBlock + 1 on the next round", async () => {
    factoryLogs = [createdLog()];
    await syncOnce(db);
    expect(db.getSyncState(INDEXER_SYNC_KEY)?.lastBlock).toBe(100);

    const callsBefore = chainMocks.client.getLogs.mock.calls.length;
    chainMocks.client.getBlockNumber.mockResolvedValue(105n);
    factoryLogs = [];
    await syncOnce(db);

    const newCalls = chainMocks.client.getLogs.mock.calls.slice(callsBefore);
    expect(newCalls.length).toBeGreaterThan(0);
    for (const [params] of newCalls) {
      expect(params.fromBlock).toBe(101n);
      expect(params.toBlock).toBe(105n);
    }
    expect(db.getSyncState(INDEXER_SYNC_KEY)?.lastBlock).toBe(105);
    const items = db.listAuctions({ limit: 100 }).items;
    expect(items).toHaveLength(1);
    expect(items[0].updatedBlock).toBe(100);
    expect(eventCount()).toBe(1);
  });

  it("advances the cursor in bounded windows until caught up", async () => {
    chainMocks.client.getBlockNumber.mockResolvedValue(5000n);

    const first = await syncOnce(db);
    expect(first.caughtUp).toBe(false);
    expect(db.getSyncState(INDEXER_SYNC_KEY)?.lastBlock).toBe(1999);

    const second = await syncOnce(db);
    expect(second.caughtUp).toBe(false);
    expect(db.getSyncState(INDEXER_SYNC_KEY)?.lastBlock).toBe(3999);

    const third = await syncOnce(db);
    expect(third.caughtUp).toBe(true);
    expect(db.getSyncState(INDEXER_SYNC_KEY)?.lastBlock).toBe(5000);
    expect(eventCount()).toBe(0);
  });
});

describe("T058 - outcome events", () => {
  beforeEach(async () => {
    factoryLogs = [createdLog()];
    await syncOnce(db);
    chainMocks.client.getBlockNumber.mockResolvedValue(110n);
    factoryLogs = [];
  });

  it("applies AuctionSold: status, lowercase buyer, decimal-string salePrice", async () => {
    auctionLogs = [soldLog()];
    await syncOnce(db);

    const row = db.getAuction(AUCTION_A);
    expect(row).toMatchObject({
      status: "sold",
      buyer: BUYER,
      salePrice: "97777777777777777",
      updatedBlock: 105,
    });
    expect(row?.salePrice).toMatch(/^\d+$/);
    expect(eventCount()).toBe(2);
  });

  it("applies AuctionCancelled: status cancelled + nftReturnedAt from the block timestamp", async () => {
    auctionLogs = [cancelledLog()];
    await syncOnce(db);

    expect(chainMocks.client.getBlock).toHaveBeenCalledWith({ blockNumber: 110n });
    const row = db.getAuction(AUCTION_A);
    expect(row).toMatchObject({
      status: "cancelled",
      nftReturnedAt: NOW - 10,
      buyer: null,
      salePrice: null,
      updatedBlock: 110,
    });
    expect(eventCount()).toBe(2);
  });
});

describe("T058 - AuctionReclaimed", () => {
  it("applies AuctionReclaimed: nftReturnedAt set, status reads as expired", async () => {
    // Reclaim only happens after expiry on-chain, so the auction must already be
    // past expiresAt when the reclaim log lands.
    factoryLogs = [createdLog({ startAt: BigInt(NOW - 400) })];
    await syncOnce(db);
    chainMocks.client.getBlockNumber.mockResolvedValue(110n);
    factoryLogs = [];
    auctionLogs = [reclaimedLog()];

    await syncOnce(db);

    const row = db.getAuction(AUCTION_A);
    expect(row).toMatchObject({
      status: "expired",
      nftReturnedAt: NOW - 10,
      buyer: null,
      salePrice: null,
      updatedBlock: 110,
    });
    expect(eventCount()).toBe(2);
  });
});

describe("T056 - status derivation verbatim (data-model 1.2) at read time", () => {
  it("derives live / expired / sold / cancelled exactly per the spec", () => {
    db.upsertAuction(fixture({ address: "0x0000000000000000000000000000000000000001" }));
    db.upsertAuction(
      fixture({
        address: "0x0000000000000000000000000000000000000002",
        startAt: NOW - 1000,
        expiresAt: NOW - 700,
      }),
    );
    db.upsertAuction(
      fixture({
        address: "0x0000000000000000000000000000000000000003",
        status: "sold",
        buyer: BUYER,
        salePrice: "95000000000000000",
      }),
    );
    db.upsertAuction(
      fixture({ address: "0x0000000000000000000000000000000000000004", status: "cancelled" }),
    );

    expect(db.getAuction("0x0000000000000000000000000000000000000001")?.status).toBe("live");
    expect(db.getAuction("0x0000000000000000000000000000000000000002")?.status).toBe("expired");
    expect(db.getAuction("0x0000000000000000000000000000000000000003")?.status).toBe("sold");
    expect(db.getAuction("0x0000000000000000000000000000000000000004")?.status).toBe("cancelled");
  });

  it("nulls buyer and salePrice on every non-sold read", () => {
    db.upsertAuction(fixture({ buyer: BUYER, salePrice: "123" })); // stored on a live row

    const row: AuctionRecord | null = db.getAuction(AUCTION_A);
    expect(row?.status).toBe("live");
    expect(row?.buyer).toBeNull();
    expect(row?.salePrice).toBeNull();
  });
});

describe("T059 - metadata enrichment hook", () => {
  it("caches tokenUri + metadata name/image from the bounded fetch hook", async () => {
    factoryLogs = [createdLog()];
    chainMocks.client.readContract.mockResolvedValue("ipfs://QmMeta123");
    vi.mocked(resolveTokenMetadata).mockResolvedValue({
      name: "Soliman #12",
      image: "https://img.example/12.png",
    });

    await syncOnce(db);

    expect(chainMocks.client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: NFT, functionName: "tokenURI", args: [12n] }),
    );
    expect(resolveTokenMetadata).toHaveBeenCalledWith("ipfs://QmMeta123");
    expect(db.getAuction(AUCTION_A)).toMatchObject({
      tokenUri: "ipfs://QmMeta123",
      metadataName: "Soliman #12",
      metadataImage: "https://img.example/12.png",
    });
  });

  it("leaves nulls and never wedges when the tokenURI read fails", async () => {
    factoryLogs = [createdLog()];
    chainMocks.client.readContract.mockRejectedValue(new Error("rpc down"));

    await expect(syncOnce(db)).resolves.toEqual({ caughtUp: true });

    const row = db.getAuction(AUCTION_A);
    expect(row).toMatchObject({
      status: "live",
      tokenUri: null,
      metadataName: null,
      metadataImage: null,
    });
  });

  it("leaves nulls and never wedges when the metadata fetch hook throws", async () => {
    factoryLogs = [createdLog()];
    chainMocks.client.readContract.mockResolvedValue("ipfs://QmMeta123");
    vi.mocked(resolveTokenMetadata).mockRejectedValue(new Error("fetch exploded"));

    await expect(syncOnce(db)).resolves.toEqual({ caughtUp: true });

    const row = db.getAuction(AUCTION_A);
    expect(row).toMatchObject({
      status: "live",
      metadataName: null,
      metadataImage: null,
    });
    expect(eventCount()).toBe(1);
  });
});

describe("T058 - polling cadence (SC-007 <= 15s visibility)", () => {
  it("keeps the default poll interval within the 15 second window", () => {
    expect(POLL_INTERVAL_MS).toBeGreaterThan(0);
    expect(POLL_INTERVAL_MS).toBeLessThanOrEqual(15_000);
  });

  it("startIndexer ticks repeatedly and stops cleanly (no open handles)", async () => {
    const handle = await startIndexer({ db, intervalMs: 10 });
    try {
      await vi.waitFor(() => {
        expect(chainMocks.client.getBlockNumber.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
    } finally {
      handle.stop();
    }

    // Let any in-flight round settle, then prove no further ticks happen.
    await new Promise((resolve) => {
      setTimeout(resolve, 30);
    });
    const callsAtStop = chainMocks.client.getBlockNumber.mock.calls.length;
    await new Promise((resolve) => {
      setTimeout(resolve, 60);
    });
    expect(chainMocks.client.getBlockNumber.mock.calls.length).toBe(callsAtStop);
  });
});

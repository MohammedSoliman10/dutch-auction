import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { getConfig } from "./config.js";

export type AuctionStatus = "live" | "sold" | "expired" | "cancelled";

export interface AuctionRecord {
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
  status: AuctionStatus;
  buyer: string | null;
  salePrice: string | null;
  nftReturnedAt: number | null;
  tokenUri: string | null;
  metadataName: string | null;
  metadataImage: string | null;
  createdBlock: number;
  createdTx: string;
  updatedBlock: number;
}

export type AuctionInput = Omit<AuctionRecord, "buyer" | "salePrice" | "nftReturnedAt" | "tokenUri" | "metadataName" | "metadataImage"> & {
  buyer?: string | null;
  salePrice?: string | null;
  nftReturnedAt?: number | null;
  tokenUri?: string | null;
  metadataName?: string | null;
  metadataImage?: string | null;
};

export interface ListAuctionsParams {
  status?: AuctionStatus | "all";
  seller?: string;
  limit?: number;
  cursor?: string;
}

export interface AuctionListPage {
  items: AuctionRecord[];
  nextCursor: string | null;
}

export interface EventInput {
  blockNumber: number;
  txHash: string;
  logIndex: number;
  address: string;
  eventName: string;
  args: unknown;
}

export interface SyncState {
  key: string;
  lastBlock: number;
  updatedAt: number;
}

export interface Db {
  upsertAuction(input: AuctionInput): void;
  getAuction(address: string): AuctionRecord | null;
  listAuctions(params?: ListAuctionsParams): AuctionListPage;
  listAuctionAddresses(): string[];
  listAuctionsMissingMetadata(limit: number): AuctionRecord[];
  recordEvent(event: EventInput): boolean;
  getSyncState(key?: string): SyncState | null;
  setSyncState(lastBlock: number, key?: string): void;
  close(): void;
}

// Shared cursor key: the indexer (T058) advances it; /api/health reads it.
export const INDEXER_SYNC_KEY = "indexer";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

// data-model 1.7: `status` is derived and recomputed at read time, so a `live`
// row expires between refreshes without a write.
const EFFECTIVE_STATUS = `CASE
  WHEN status IN ('sold', 'cancelled') THEN status
  WHEN status = 'expired' THEN 'expired'
  WHEN ? >= expires_at THEN 'expired'
  ELSE 'live'
END`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS auctions (
  address TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  seller TEXT NOT NULL,
  nft_contract TEXT NOT NULL,
  token_id TEXT NOT NULL,
  starting_price TEXT NOT NULL,
  discount_rate TEXT NOT NULL,
  duration INTEGER NOT NULL,
  start_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('live', 'sold', 'expired', 'cancelled')),
  buyer TEXT,
  sale_price TEXT,
  nft_returned_at INTEGER,
  token_uri TEXT,
  metadata_name TEXT,
  metadata_image TEXT,
  created_block INTEGER NOT NULL,
  created_tx TEXT NOT NULL,
  updated_block INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auctions_status_expires ON auctions (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_auctions_seller ON auctions (seller);
CREATE INDEX IF NOT EXISTS idx_auctions_token ON auctions (token_id);

CREATE TABLE IF NOT EXISTS events (
  block_number INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  address TEXT NOT NULL,
  event_name TEXT NOT NULL,
  args_json TEXT NOT NULL,
  UNIQUE (tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  last_block INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

interface AuctionRow {
  address: string;
  chain_id: number;
  seller: string;
  nft_contract: string;
  token_id: string;
  starting_price: string;
  discount_rate: string;
  duration: number;
  start_at: number;
  expires_at: number;
  status: AuctionStatus;
  buyer: string | null;
  sale_price: string | null;
  nft_returned_at: number | null;
  token_uri: string | null;
  metadata_name: string | null;
  metadata_image: string | null;
  created_block: number;
  created_tx: string;
  updated_block: number;
}

export function openDb(path: string = getConfig().dbPath): Db {
  mkdirSync(dirname(path), { recursive: true });
  const raw = new Database(path);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  raw.exec(SCHEMA);

  // On replay, terminal statuses (data-model 1.2) and provenance never regress.
  const insertAuctionStmt = raw.prepare(`
    INSERT INTO auctions (
      address, chain_id, seller, nft_contract, token_id, starting_price, discount_rate,
      duration, start_at, expires_at, status, buyer, sale_price, nft_returned_at,
      token_uri, metadata_name, metadata_image, created_block, created_tx, updated_block
    ) VALUES (
      @address, @chain_id, @seller, @nft_contract, @token_id, @starting_price, @discount_rate,
      @duration, @start_at, @expires_at, @status, @buyer, @sale_price, @nft_returned_at,
      @token_uri, @metadata_name, @metadata_image, @created_block, @created_tx, @updated_block
    )
    ON CONFLICT(address) DO UPDATE SET
      chain_id = excluded.chain_id,
      seller = excluded.seller,
      nft_contract = excluded.nft_contract,
      token_id = excluded.token_id,
      starting_price = excluded.starting_price,
      discount_rate = excluded.discount_rate,
      duration = excluded.duration,
      start_at = excluded.start_at,
      expires_at = excluded.expires_at,
      status = CASE WHEN auctions.status IN ('sold', 'cancelled') THEN auctions.status ELSE excluded.status END,
      buyer = COALESCE(excluded.buyer, auctions.buyer),
      sale_price = COALESCE(excluded.sale_price, auctions.sale_price),
      nft_returned_at = COALESCE(excluded.nft_returned_at, auctions.nft_returned_at),
      token_uri = COALESCE(excluded.token_uri, auctions.token_uri),
      metadata_name = COALESCE(excluded.metadata_name, auctions.metadata_name),
      metadata_image = COALESCE(excluded.metadata_image, auctions.metadata_image),
      updated_block = MAX(excluded.updated_block, auctions.updated_block)
  `);
  const selectAuctionStmt = raw.prepare(`SELECT * FROM auctions WHERE address = ?`);
  const selectAddressesStmt = raw.prepare(`SELECT address FROM auctions ORDER BY address`);
  const selectMissingMetadataStmt = raw.prepare(`
    SELECT * FROM auctions
    WHERE token_uri IS NULL OR metadata_name IS NULL
    ORDER BY created_block ASC, address ASC
    LIMIT ?
  `);
  const insertEventStmt = raw.prepare(`
    INSERT OR IGNORE INTO events (block_number, tx_hash, log_index, address, event_name, args_json)
    VALUES (@block_number, @tx_hash, @log_index, @address, @event_name, @args_json)
  `);
  const selectSyncStmt = raw.prepare(`SELECT key, last_block, updated_at FROM sync_state WHERE key = ?`);
  const upsertSyncStmt = raw.prepare(`
    INSERT INTO sync_state (key, last_block, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET last_block = excluded.last_block, updated_at = excluded.updated_at
  `);

  return {
    upsertAuction(input: AuctionInput): void {
      insertAuctionStmt.run(toNamedParams(normalizeAuctionInput(input)));
    },

    getAuction(address: string): AuctionRecord | null {
      const row = selectAuctionStmt.get(address.toLowerCase()) as AuctionRow | undefined;
      if (row === undefined) {
        return null;
      }
      return toRecord(row, nowSeconds());
    },

    listAuctions(params: ListAuctionsParams = {}): AuctionListPage {
      const now = nowSeconds();
      const limit = params.limit ?? DEFAULT_LIST_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
        throw new Error(`Invalid limit: ${limit} (expected integer 1-${MAX_LIST_LIMIT})`);
      }
      const offset = decodeCursor(params.cursor);

      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.seller !== undefined) {
        conditions.push("seller = ?");
        values.push(params.seller.toLowerCase());
      }
      if (params.status !== undefined && params.status !== "all") {
        conditions.push(`(${EFFECTIVE_STATUS}) = ?`);
        values.push(now, params.status);
      }
      const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";

      const rows = raw
        .prepare(`SELECT * FROM auctions${where} ORDER BY created_block DESC, address ASC LIMIT ? OFFSET ?`)
        .all(...values, limit + 1, offset) as AuctionRow[];

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      return {
        items: page.map((row) => toRecord(row, now)),
        nextCursor: hasMore ? encodeCursor(offset + limit) : null,
      };
    },

    // The indexer polls every known auction for settlement events; the gallery
    // limit cap (100) must not truncate that list.
    listAuctionAddresses(): string[] {
      const rows = selectAddressesStmt.all() as Array<{ address: string }>;
      return rows.map((row) => row.address);
    },

    // Rows whose best-effort cache (R13) is still incomplete; the indexer
    // retries a bounded number of them per round.
    listAuctionsMissingMetadata(limit: number): AuctionRecord[] {
      const now = nowSeconds();
      const rows = selectMissingMetadataStmt.all(limit) as AuctionRow[];
      return rows.map((row) => toRecord(row, now));
    },

    recordEvent(event: EventInput): boolean {
      const result = insertEventStmt.run({
        block_number: event.blockNumber,
        tx_hash: event.txHash,
        log_index: event.logIndex,
        address: event.address.toLowerCase(),
        event_name: event.eventName,
        args_json: stringifyEventArgs(event.args),
      });
      return Number(result.changes) > 0;
    },

    getSyncState(key: string = INDEXER_SYNC_KEY): SyncState | null {
      const row = selectSyncStmt.get(key) as { key: string; last_block: number; updated_at: number } | undefined;
      if (row === undefined) {
        return null;
      }
      return { key: row.key, lastBlock: row.last_block, updatedAt: row.updated_at };
    },

    setSyncState(lastBlock: number, key: string = INDEXER_SYNC_KEY): void {
      upsertSyncStmt.run(key, lastBlock, nowSeconds());
    },

    close(): void {
      raw.close();
    },
  };
}

export const createDb = openDb;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function effectiveStatus(row: AuctionRow, now: number): AuctionStatus {
  return row.status === "live" && now >= row.expires_at ? "expired" : row.status;
}

function toRecord(row: AuctionRow, now: number): AuctionRecord {
  const status = effectiveStatus(row, now);
  const sold = status === "sold";
  return {
    address: row.address,
    chainId: row.chain_id,
    seller: row.seller,
    nftContract: row.nft_contract,
    tokenId: row.token_id,
    startingPrice: row.starting_price,
    discountRate: row.discount_rate,
    duration: row.duration,
    startAt: row.start_at,
    expiresAt: row.expires_at,
    status,
    buyer: sold ? row.buyer : null,
    salePrice: sold ? row.sale_price : null,
    nftReturnedAt: row.nft_returned_at,
    tokenUri: row.token_uri,
    metadataName: row.metadata_name,
    metadataImage: row.metadata_image,
    createdBlock: row.created_block,
    createdTx: row.created_tx,
    updatedBlock: row.updated_block,
  };
}

// data-model 1.6: all addresses stored lowercase.
function normalizeAuctionInput(input: AuctionInput): AuctionInput {
  return {
    ...input,
    address: input.address.toLowerCase(),
    seller: input.seller.toLowerCase(),
    nftContract: input.nftContract.toLowerCase(),
    buyer: input.buyer != null ? input.buyer.toLowerCase() : null,
  };
}

function toNamedParams(input: AuctionInput): Record<string, unknown> {
  return {
    address: input.address,
    chain_id: input.chainId,
    seller: input.seller,
    nft_contract: input.nftContract,
    token_id: input.tokenId,
    starting_price: input.startingPrice,
    discount_rate: input.discountRate,
    duration: input.duration,
    start_at: input.startAt,
    expires_at: input.expiresAt,
    status: input.status,
    buyer: input.buyer ?? null,
    sale_price: input.salePrice ?? null,
    nft_returned_at: input.nftReturnedAt ?? null,
    token_uri: input.tokenUri ?? null,
    metadata_name: input.metadataName ?? null,
    metadata_image: input.metadataImage ?? null,
    created_block: input.createdBlock,
    created_tx: input.createdTx,
    updated_block: input.updatedBlock,
  };
}

// viem decodes uint256 event args as bigint; api.md requires decimal strings.
function stringifyEventArgs(args: unknown): string {
  return JSON.stringify(args ?? null, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value);
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }
  const offset = decodeAuctionCursor(cursor);
  if (offset === null) {
    throw new Error(`Invalid cursor: "${cursor}"`);
  }
  return offset;
}

// Exported so the API layer can reject a malformed cursor with
// 400 INVALID_PARAMETER before querying; the cursor stays opaque to clients.
export function decodeAuctionCursor(cursor: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed === "object" && parsed !== null) {
    const offset = (parsed as { o?: unknown }).o;
    if (typeof offset === "number" && Number.isSafeInteger(offset) && offset >= 0) {
      return offset;
    }
  }
  return null;
}

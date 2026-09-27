// T058: auction event indexer. Each round polls the factory for AuctionCreated,
// then every known auction for AuctionSold / AuctionCancelled / AuctionReclaimed,
// within a bounded block window. State applies idempotently through the
// UNIQUE(tx_hash, log_index) events log (data-model 1.7) and sync_state resumes
// the cursor without double-applying. Only src/index.ts starts it; this module
// stays side-effect free so tests can import it.
import type { Abi, AbiEvent } from "viem";
import { abis, addresses, chainId, client, deployBlock } from "./chain.js";
import { createDb, INDEXER_SYNC_KEY, type AuctionInput, type Db, type EventInput } from "./db.js";
import { resolveTokenMetadata } from "./metadata.js";

export const POLL_INTERVAL_MS = 10_000; // SC-007: sale outcome visible within 15 s

const CATCHUP_DELAY_MS = 250;
// Alchemy's free tier rejects eth_getLogs windows wider than 10 blocks
// (-32600), so windows must stay provider-safe: catch-up speed comes from
// CATCHUP_DELAY_MS between rounds, not from wider ranges.
const MAX_BLOCK_RANGE = 10;
const MAX_METADATA_PER_ROUND = 3;

export interface StartIndexerOptions {
  db?: Db;
  intervalMs?: number;
}

export interface IndexerHandle {
  stop(): void;
}

export interface SyncRoundResult {
  caughtUp: boolean;
}

interface DecodedLog {
  address: `0x${string}`;
  blockNumber: bigint | null;
  transactionHash: `0x${string}`;
  logIndex: number | null;
  eventName?: string;
  args?: unknown;
}

/** Polls one bounded block window, applies new logs, advances the cursor. */
export async function syncOnce(db: Db): Promise<SyncRoundResult> {
  const head = Number(await client.getBlockNumber());
  const stored = db.getSyncState(INDEXER_SYNC_KEY)?.lastBlock;
  // Neither the factory nor any auction can emit before the factory's deploy
  // block, so flooring at the manifest startBlock is safe and turns a fresh
  // Sepolia sync from ~25 min of 0→head crawling into a single round.
  const floor = deployBlock ?? 0;
  const fromBlock = Math.max(stored === undefined ? 0 : stored + 1, floor);
  if (fromBlock > head) {
    return { caughtUp: true };
  }
  const toBlock = Math.min(fromBlock + MAX_BLOCK_RANGE - 1, head);
  const range = { fromBlock: BigInt(fromBlock), toBlock: BigInt(toBlock) };

  const createdLogs = (await client.getLogs({
    address: addresses.factory,
    event: requireAbiEvent(abis.auctionFactory, "AuctionCreated"),
    ...range,
  })) as DecodedLog[];
  for (const log of createdLogs) {
    // Upsert is idempotent by design (terminal statuses/provenance never regress),
    // so applying before recording cannot lose state if the process dies between.
    db.upsertAuction(auctionCreatedInput(log));
    db.recordEvent(eventInput(log, "AuctionCreated"));
  }

  const auctionAddresses = db.listAuctionAddresses();
  if (auctionAddresses.length > 0) {
    const outcomeLogs = (await client.getLogs({
      address: auctionAddresses as `0x${string}`[],
      events: [
        requireAbiEvent(abis.dutchAuction, "AuctionSold"),
        requireAbiEvent(abis.dutchAuction, "AuctionCancelled"),
        requireAbiEvent(abis.dutchAuction, "AuctionReclaimed"),
      ],
      ...range,
    })) as DecodedLog[];
    await applyOutcomeLogs(db, outcomeLogs);
  }

  await enrichMissingMetadata(db);

  db.setSyncState(toBlock, INDEXER_SYNC_KEY);
  return { caughtUp: toBlock >= head };
}

/** Starts the polling loop (catch-up first, then every intervalMs). */
export async function startIndexer(options: StartIndexerOptions = {}): Promise<IndexerHandle> {
  const db = options.db ?? createDb();
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  let stopped = false;
  let running: Promise<void> = Promise.resolve();

  const runRound = async (): Promise<void> => {
    try {
      let caughtUp = false;
      while (!stopped && !caughtUp) {
        ({ caughtUp } = await syncOnce(db));
        if (!caughtUp) {
          await delay(CATCHUP_DELAY_MS);
        }
      }
    } catch (error) {
      // The cursor only advances after a successful round; the next tick retries
      // the same window, so failures never skip or double-apply logs.
      console.error("[indexer] sync round failed:", error);
    }
  };

  const tick = (): void => {
    running = running.then(runRound);
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  return {
    stop(): void {
      stopped = true;
      clearInterval(timer);
    },
  };
}

async function applyOutcomeLogs(db: Db, logs: DecodedLog[]): Promise<void> {
  for (const log of logs) {
    const name = log.eventName;
    if (name !== "AuctionSold" && name !== "AuctionCancelled" && name !== "AuctionReclaimed") {
      continue;
    }
    const record = db.getAuction(log.address);
    if (record === null) {
      continue;
    }
    const blockNumber = blockNumberOf(log);
    if (name === "AuctionSold") {
      const args = requireArgs(log.args);
      db.upsertAuction({
        ...record,
        status: "sold",
        buyer: asAddress(args.buyer),
        salePrice: asUint(args.price).toString(),
        updatedBlock: blockNumber,
      });
    } else if (name === "AuctionCancelled") {
      db.upsertAuction({
        ...record,
        status: "cancelled",
        nftReturnedAt: await blockTimestamp(blockNumber),
        updatedBlock: blockNumber,
      });
    } else {
      db.upsertAuction({
        ...record,
        nftReturnedAt: await blockTimestamp(blockNumber),
        updatedBlock: blockNumber,
      });
    }
    db.recordEvent(eventInput(log, name));
  }
}

// T059 hook: fill the best-effort metadata cache for a bounded number of rows
// per round. Every failure is contained here - the round and cursor still finish.
async function enrichMissingMetadata(db: Db): Promise<void> {
  const pending = db.listAuctionsMissingMetadata(MAX_METADATA_PER_ROUND);
  for (const auction of pending) {
    try {
      const tokenUri = auction.tokenUri ?? (await readTokenUri(auction.nftContract, auction.tokenId));
      if (tokenUri === null) {
        continue;
      }
      const meta = await resolveTokenMetadata(tokenUri);
      db.upsertAuction({
        ...auction,
        tokenUri,
        metadataName: meta.name,
        metadataImage: meta.image,
      });
    } catch (error) {
      console.error(`[indexer] metadata enrichment failed for ${auction.address}:`, error);
    }
  }
}

async function readTokenUri(nftContract: string, tokenId: string): Promise<string | null> {
  const uri = await client.readContract({
    address: nftContract as `0x${string}`,
    abi: abis.dutchAuctionNFT,
    functionName: "tokenURI",
    args: [BigInt(tokenId)],
  });
  return typeof uri === "string" && uri !== "" ? uri : null;
}

async function blockTimestamp(blockNumber: number): Promise<number> {
  const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
  return Number(block.timestamp);
}

function auctionCreatedInput(log: DecodedLog): AuctionInput {
  const args = requireArgs(log.args);
  const blockNumber = blockNumberOf(log);
  return {
    address: asAddress(args.auction),
    chainId,
    seller: asAddress(args.seller),
    nftContract: asAddress(args.nft),
    tokenId: asUint(args.tokenId).toString(),
    startingPrice: asUint(args.startingPrice).toString(),
    discountRate: asUint(args.discountRate).toString(),
    duration: Number(asUint(args.duration)),
    startAt: Number(asUint(args.startAt)),
    expiresAt: Number(asUint(args.expiresAt)),
    status: "live",
    createdBlock: blockNumber,
    createdTx: log.transactionHash,
    updatedBlock: blockNumber,
  };
}

function eventInput(log: DecodedLog, eventName: string): EventInput {
  if (log.logIndex === null) {
    throw new Error("indexer: log is missing a log index");
  }
  return {
    blockNumber: blockNumberOf(log),
    txHash: log.transactionHash,
    logIndex: log.logIndex,
    address: log.address,
    eventName,
    args: log.args,
  };
}

function blockNumberOf(log: DecodedLog): number {
  if (log.blockNumber === null) {
    throw new Error("indexer: log is missing a block number");
  }
  return Number(log.blockNumber);
}

function requireAbiEvent(abi: Abi, name: string): AbiEvent {
  const item = abi.find((entry) => entry.type === "event" && entry.name === name);
  if (item === undefined || item.type !== "event") {
    throw new Error(`indexer: ABI is missing event ${name}`);
  }
  return item;
}

function requireArgs(args: unknown): Record<string, unknown> {
  if (typeof args !== "object" || args === null) {
    throw new Error("indexer: log is missing decoded args");
  }
  return args as Record<string, unknown>;
}

function asAddress(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error("indexer: expected an address argument");
  }
  return value.toLowerCase() as `0x${string}`;
}

function asUint(value: unknown): bigint {
  if (typeof value !== "bigint") {
    throw new Error("indexer: expected a uint argument");
  }
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

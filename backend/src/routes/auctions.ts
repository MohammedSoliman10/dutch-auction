// T057: GET /api/auctions + GET /api/auctions/:address per contracts/api.md.
// T060: status and currentPrice are derived at read time per data-model 1.2/1.3 -
// the row is a snapshot; expiry and price decay are recomputed on every response.
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  decodeAuctionCursor,
  type AuctionRecord,
  type AuctionStatus,
  type Db,
  type ListAuctionsParams,
} from "../db.js";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const STATUS_VALUES = ["live", "sold", "expired", "cancelled", "all"] as const;
type QueryStatus = (typeof STATUS_VALUES)[number];
const MAX_LIMIT = 100;

interface NftView {
  tokenUri: string | null;
  name: string | null;
  image: string | null;
}

interface AuctionSummary {
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
  currentPrice: string;
  buyer: string | null;
  salePrice: string | null;
  nft: NftView;
}

interface AuctionDetail extends AuctionSummary {
  createdAtBlock: number;
  createdAtTx: string;
  updatedBlock: number;
  cancelledAt: number | null;
  reclaimedAt: number | null;
}

interface ListResponse {
  items: AuctionSummary[];
  nextCursor: string | null;
}

type ParsedQuery = { ok: true; params: ListAuctionsParams } | { ok: false; message: string };

export async function registerAuctionRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get("/api/auctions", async (request, reply) => {
    reply.header("Cache-Control", "no-store");

    const parsed = parseListQuery(request.query);
    if (!parsed.ok) {
      return sendError(reply, 400, "INVALID_PARAMETER", parsed.message);
    }

    const page = db.listAuctions(parsed.params);
    const now = nowSeconds();
    const body: ListResponse = {
      items: page.items.map((record) => toSummary(record, now)),
      nextCursor: page.nextCursor,
    };
    return body;
  });

  app.get("/api/auctions/:address", async (request, reply) => {
    reply.header("Cache-Control", "no-store");

    const { address } = request.params as { address: string };
    if (!ADDRESS_PATTERN.test(address)) {
      return sendError(reply, 400, "INVALID_PARAMETER", "address must be 0x followed by 40 hex characters");
    }
    const record = db.getAuction(address);
    if (record === null) {
      return sendError(reply, 404, "AUCTION_NOT_FOUND", "Auction is not in the read-model");
    }
    return toDetail(record, nowSeconds());
  });
}

// Unknown params are ignored (api.md); only known params are validated.
function parseListQuery(query: unknown): ParsedQuery {
  const raw: Record<string, unknown> =
    typeof query === "object" && query !== null ? (query as Record<string, unknown>) : {};
  const params: ListAuctionsParams = {};

  const status = raw.status;
  if (status !== undefined) {
    if (typeof status !== "string" || !isQueryStatus(status)) {
      return { ok: false, message: `status must be one of ${STATUS_VALUES.join(", ")}` };
    }
    params.status = status;
  }

  const limit = raw.limit;
  if (limit !== undefined) {
    if (typeof limit !== "string" || !/^\d+$/.test(limit)) {
      return { ok: false, message: `limit must be an integer between 1 and ${MAX_LIMIT}` };
    }
    const parsed = Number(limit);
    if (parsed < 1 || parsed > MAX_LIMIT) {
      return { ok: false, message: `limit must be an integer between 1 and ${MAX_LIMIT}` };
    }
    params.limit = parsed;
  }

  const seller = raw.seller;
  if (seller !== undefined) {
    if (typeof seller !== "string" || !ADDRESS_PATTERN.test(seller)) {
      return { ok: false, message: "seller must be 0x followed by 40 hex characters" };
    }
    params.seller = seller.toLowerCase();
  }

  const cursor = raw.cursor;
  if (cursor !== undefined) {
    if (typeof cursor !== "string" || decodeAuctionCursor(cursor) === null) {
      return { ok: false, message: "cursor is not a valid continuation token" };
    }
    params.cursor = cursor;
  }

  return { ok: true, params };
}

function isQueryStatus(value: string): value is QueryStatus {
  return (STATUS_VALUES as readonly string[]).includes(value);
}

function toSummary(record: AuctionRecord, now: number): AuctionSummary {
  return {
    address: record.address,
    chainId: record.chainId,
    seller: record.seller,
    nftContract: record.nftContract,
    tokenId: record.tokenId,
    startingPrice: record.startingPrice,
    discountRate: record.discountRate,
    duration: record.duration,
    startAt: record.startAt,
    expiresAt: record.expiresAt,
    status: record.status,
    currentPrice: currentPriceAt(record, now),
    buyer: record.buyer,
    salePrice: record.salePrice,
    nft: {
      tokenUri: record.tokenUri,
      name: record.metadataName,
      image: record.metadataImage,
    },
  };
}

function toDetail(record: AuctionRecord, now: number): AuctionDetail {
  const base = toSummary(record, now);
  return {
    ...base,
    createdAtBlock: record.createdBlock,
    createdAtTx: record.createdTx,
    updatedBlock: record.updatedBlock,
    cancelledAt: record.status === "cancelled" ? record.nftReturnedAt : null,
    reclaimedAt: record.status !== "cancelled" && record.status !== "sold" ? record.nftReturnedAt : null,
  };
}

// Contract getPrice(): startingPrice - discountRate * min(now - startAt, duration),
// clamped at 0. Computed locally (R7) so responses never depend on RPC health.
function currentPriceAt(record: AuctionRecord, now: number): string {
  const starting = BigInt(record.startingPrice);
  const rate = BigInt(record.discountRate);
  const elapsed = BigInt(Math.max(Math.min(now - record.startAt, record.duration), 0));
  const decayed = rate * elapsed;
  return (decayed >= starting ? 0n : starting - decayed).toString();
}

function sendError(reply: FastifyReply, statusCode: 400 | 404, code: string, message: string): FastifyReply {
  return reply.code(statusCode).send({ error: { code, message } });
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

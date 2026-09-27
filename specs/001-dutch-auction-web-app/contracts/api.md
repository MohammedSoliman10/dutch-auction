# Interface Contract: REST API (Gallery / Indexer)

**Feature**: 001-dutch-auction-web-app | **Date**: 2026-09-27

Served by the Node 24 + Fastify backend at `/api/*`. In production the same service
serves the built SPA (same origin → no CORS). In development Vite proxies `/api` to
the backend, so CORS is never required.

## Conventions

- JSON in/out, UTF-8, `Content-Type: application/json`.
- **Big numbers** (wei, token ids) are **decimal strings** — never JS numbers.
- **Timestamps** are unix **seconds** (integers). **Addresses** are lowercase `0x` hex.
- Errors: HTTP status + body `{"error": {"code": "SCREAMING_SNAKE", "message": "…"}}`.
- Unknown params are ignored; invalid params → `400 INVALID_PARAMETER`.
- Live-data endpoints send `Cache-Control: no-store`; the client refreshes the
  gallery every ~15 s.

## Endpoints

### `GET /api/health`

Indexer/liveness probe.

```json
{
  "status": "ok",
  "chainId": 11155111,
  "factoryAddress": "0x…",
  "lastIndexedBlock": 7912345,
  "headBlock": 7912350,
  "lagBlocks": 5
}
```
- `200` always when the process is up; `status` is `"ok"` (lag ≤ 60 blocks) or
  `"syncing"`.

### `GET /api/auctions`

Gallery list (FR-014).

| Query param | Type | Default | Notes |
|-------------|------|---------|-------|
| `status` | `live \| sold \| expired \| cancelled \| all` | `all` | |
| `seller` | address | — | lowercase `0x…` |
| `limit` | int 1–100 | `20` | |
| `cursor` | opaque string | — | from previous `nextCursor` |

```json
{
  "items": [ { …AuctionSummary… } ],
  "nextCursor": "eyJvIjoxfQ" 
}
```
- Ordered by `created_block` descending (newest first).
- `nextCursor`: `null` when exhausted.

**AuctionSummary**

```json
{
  "address": "0x…",
  "chainId": 11155111,
  "seller": "0x…",
  "nftContract": "0x…",
  "tokenId": "12",
  "startingPrice": "100000000000000000",
  "discountRate": "333333333333333",
  "duration": 300,
  "startAt": 1777000000,
  "expiresAt": 1777000300,
  "status": "live",
  "currentPrice": "86666666666666666",
  "buyer": null,
  "salePrice": null,
  "nft": { "tokenUri": "ipfs://…", "name": "Soliman #12", "image": "https://…" }
}
```
- `status`: `live \| sold \| expired \| cancelled` (derived per data-model §1.2;
  recomputed at read time, so a `live` row can expire between refreshes).
- `currentPrice`: computed at response time from `startAt`/`discountRate` — the
  client re-derives locally every second (R7) and the chain remains authoritative.
- `buyer`/`salePrice`: non-null only when `status == "sold"`.
- `nft.name`/`nft.image`: nullable best-effort cache (R13); clients fall back to
  placeholder rendering.

- `400 INVALID_PARAMETER` — bad `status`, `limit`, `cursor`, or `seller`.

### `GET /api/auctions/:address`

Auction detail (FR-004/FR-015). `:address` = auction contract address.

- `200` → **AuctionDetail** = AuctionSummary **plus**:

```json
{
  "createdAtBlock": 7910000,
  "createdAtTx": "0x…",
  "updatedBlock": 7912000,
  "cancelledAt": null,
  "reclaimedAt": null
}
```
- `404 AUCTION_NOT_FOUND` — unknown address.

### `GET /api/auctions?seller=0x…`

Same endpoint/shape as the gallery with the `seller` filter — powers "my auctions"
without a separate route.

## Status/error catalogue

| HTTP | Code | When |
|------|------|------|
| 400 | `INVALID_PARAMETER` | Malformed query/path values |
| 404 | `AUCTION_NOT_FOUND` | Address not in read-model |
| 503 | `INDEXER_SYNCING` | Optional: detail requests while first sync incomplete |
| 500 | `INTERNAL` | Unexpected (logged with request id) |

## Non-goals (v1)

- No write endpoints — all writes are wallet transactions on-chain.
- No auth — read-only public data.
- No metadata proxy for arbitrary URIs (SSRF surface); the indexer caches only the
  auction's own `tokenURI`, the client resolves the rest with fallbacks (R13).

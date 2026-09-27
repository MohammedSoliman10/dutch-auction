# Phase 1 Data Model: Dutch Auction NFT Web App

**Feature**: 001-dutch-auction-web-app | **Date**: 2026-09-27

Canonical state lives on-chain; SQLite is a rebuildable read-model; frontend keeps only
session/transaction UI state. FR references point to [spec.md](./spec.md).

---

## 1. Entities

### 1.1 NFT (on-chain — `DutchAuctionNFT`)

| Field | Type | Notes |
|-------|------|-------|
| tokenId | uint256 | Sequential from 0, assigned at mint (FR-010) |
| owner | address | OZ ERC-721 ownership; changes on transfer/sale |
| tokenURI | string | Off-chain metadata URI (http/https/ipfs), set at mint |
| collection | fixed | Single collection: name "Soliman Web3", symbol "SW3" |

**Validation**: `tokenURI` MUST be non-empty at mint (`EmptyURI()`).

**Relationships**: 1 NFT ↔ 0..1 auctions over time; at most one *active* auction per
NFT (an escrowed NFT's owner is the auction contract, so the factory's ownership check
naturally blocks a second listing — no extra state needed).

### 1.2 Auction (on-chain — `DutchAuction`, created via `AuctionFactory`)

| Field | Type | Notes |
|-------|------|-------|
| auction | address | Contract address = auction identity / primary key (FR-014) |
| seller | address | Immutable; created the auction; receives proceeds (FR-012) |
| nftContract, tokenId | address, uint256 | Immutable; the NFT being sold |
| startingPrice | uint256 (wei) | Immutable; price at `startAt` (FR-011) |
| discountRate | uint256 (wei/s) | Immutable; linear decay (FR-005) |
| duration | uint256 (s) | Immutable; seller-chosen, default 300 s in UI (FR-011) |
| startAt | uint256 | Immutable; block timestamp at creation |
| expiresAt | uint256 | Immutable; `startAt + duration` |
| sold | bool | Set exactly once by `buy()` (FR-009) |
| cancelled | bool | Set by `cancel()` only, pre-expiry (FR-013) |
| buyer | address | Set on sale; 0 otherwise |
| salePrice | uint256 | Set on sale; the winning bid paid (FR-012) |

**Derived state**:

```
status(auction, now):
  if sold               → SOLD
  if cancelled          → CANCELLED
  if now >= expiresAt   → EXPIRED     (NFT still escrowed until seller.reclaim())
  else                  → LIVE

price(auction, now)  = startingPrice − discountRate × min(now − startAt, duration)
                       clamped ≥ 0; equals 0 at/after full decay (FR-005)
```

**State transitions**:

```
              createAuction (escrow pulled)
                       │
                       ▼
                    ┌──────┐  buy() @ price   ┌──────┐
                    │ LIVE │ ───────────────▶ │ SOLD │ (terminal)
                    └──────┘                  └──────┘
                   │        \─ cancel() ┌───────────┐
                   │ (seller)           │ CANCELLED │ (terminal, NFT returned)
                   │                    └───────────┘
                   │ now ≥ expiresAt ┌──────────┐  reclaim()  ┌───────────┐
                   └────────────────▶│ EXPIRED  │ ──────────▶ │ EXPIRED + │
                                     └──────────┘  (seller)   │ returned  │
                                                              └───────────┘
```

**Validation rules** (enforced on-chain, mirrored in UI):

| Rule | Where | Error |
|------|-------|-------|
| `60s ≤ duration ≤ 30d` | factory | `InvalidDuration()` |
| `startingPrice > 0`, `discountRate ≥ 1` | factory | `InvalidPriceParams()` |
| `startingPrice ≥ discountRate × duration` (FR-008) | factory + auction ctor | `PriceWouldGoNegative()` |
| caller owns `tokenId` | factory | `NotNftOwner()` |
| factory approved over the NFT | factory | `NotApproved()` |
| `buy`: not sold / not cancelled / `now < expiresAt` | auction | `AlreadySold()` / `AlreadyCancelled()` / `AuctionExpired()` |
| `buy`: `buyer ≠ seller` (FR-007) | auction | `SellerCannotBuy()` |
| `buy`: `msg.value ≥ price` (FR-006) | auction | `InsufficientPayment(required, sent)` |
| `cancel`: seller, still LIVE (FR-013) | auction | `NotSeller()` / `NotLive()` |
| `reclaim`: seller, EXPIRED, not sold/cancelled (FR-013) | auction | `NotSeller()` / `AuctionNotExpired()` / `NotLive()` |
| both settlement transfers succeed | auction | `TransferFailed()` |

### 1.3 AuctionFactory (on-chain)

| Field | Type | Notes |
|-------|------|-------|
| allAuctions[i] | address | Append-only registry (trustless discovery fallback) |
| auctionCount | uint256 | `allAuctions.length` |
| MIN_DURATION / MAX_DURATION | uint256 constants | 60 / 2_592_000 |

`createAuction(...) → address` pulls the NFT (one seller approval), deploys the
auction, escrows the NFT, appends to the registry, emits `AuctionCreated`.

### 1.4 Wallet session (frontend-only)

| Field | Type | Notes |
|-------|------|-------|
| status | `disconnected → connecting → connected` | RainbowKit/wagmi connector state |
| address | `0x…` \| null | Connected account |
| chainId | number \| null | Active chain; must equal Sepolia (11155111) for actions (FR-002) |
| networkMismatch | bool | Drives the "switch network" prompt |

### 1.5 Transaction (frontend-only, per user action — FR-003)

```
idle → awaiting_signature → pending(txHash) → confirming → success
                │                 │               │
                ▼                 ▼               ▼
            rejected           failed          failed
```
Terminal failure/rejection leaves auction + session state unchanged (FR-003,
edge-case "transaction rejected").

### 1.6 `auctions` table (SQLite read-model — see [contracts/api.md](./contracts/api.md))

| Column | Type | Notes |
|--------|------|-------|
| address | TEXT PK | lowercase `0x…` |
| chain_id | INTEGER | |
| seller, nft_contract | TEXT | lowercase addresses |
| token_id | TEXT | uint256 as decimal string |
| starting_price, discount_rate | TEXT | wei values as decimal strings (JS safety) |
| duration, start_at, expires_at | INTEGER | unix seconds |
| status | TEXT | `live \| sold \| expired \| cancelled` (derived, kept current) |
| buyer, sale_price | TEXT | null until sold |
| nft_returned_at | INTEGER | null until `cancel()`/`reclaim()` |
| token_uri, metadata_name, metadata_image | TEXT | nullable; best-effort cache (R13) |
| created_block, created_tx | INTEGER, TEXT | provenance |
| updated_block | INTEGER | last event block applied |

Indexes: `(status, expires_at)`, `(seller)`, `(token_id)`.

### 1.7 `events` + `sync_state` tables (idempotent indexing)

- `events(block_number, tx_hash, log_index, address, event_name, args_json)` with
  `UNIQUE(tx_hash, log_index)` — replays are no-ops (upsert).
- `sync_state(key TEXT PK, last_block INTEGER, updated_at INTEGER)` — cursor for
  resumable polling (R8); restart never double-applies.

---

## 2. FR → model coverage

| FR | Where satisfied |
|----|-----------------|
| FR-001/002 | wagmi config (Sepolia), `NetworkGuard`, backend `chain_id` |
| FR-003 | Transaction state machine (§1.5), API error envelope |
| FR-004/005 | Auction fields + derived `status`/`price`, `useCurrentPrice` (R7) |
| FR-006/007 | `buy()` validation table (§1.2) |
| FR-008/011 | factory + ctor validation table (§1.2) |
| FR-009 | `sold` single-set flag + invariant tests (R15) |
| FR-010 | NFT `mintNFT` validation (§1.1) |
| FR-012/013 | `buy()` settlement, `cancel()`/`reclaim()` transitions (§1.2) |
| FR-014/015 | `auctions` table + gallery endpoints (api.md) |
| FR-016/017 | Tailwind `@theme` tokens (theme.css), SPA router flows |

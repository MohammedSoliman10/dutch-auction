# Phase 0 Research: Dutch Auction NFT Web App

**Feature**: 001-dutch-auction-web-app | **Date**: 2026-09-27

All Technical Context unknowns are resolved here. Each entry: Decision → Rationale →
Alternatives considered.

---

## R1. Target network

**Decision**: Sepolia testnet for v1 (user-confirmed: Q1 = A).

**Rationale**: Spec FR-001 (user answer); public, free, faucet-funded — satisfies
"anybody can use it with his wallet" with zero local tooling; protects users from
unaudited real-value code.

**Alternatives considered**: Ethereum mainnet (real value but costly and premature for
v1); other L2s (viable later — chain is a single config value in `wagmi.ts` +
deploy script, so migration is cheap); local Anvil only (explicitly rejected in the
spec).

## R2. Contract architecture

**Decision**: Three single-purpose contracts: `DutchAuctionNFT` (ERC-721 collection),
`AuctionFactory` (validates, pulls the NFT into escrow, deploys one `DutchAuction` per
sale, emits `AuctionCreated`), and `DutchAuction` (per-auction escrow sale with
immutables). Seller approves the factory **once**; `createAuction` is one transaction.

**Rationale**: Matches the user's provided per-auction-contract design (immutables,
constructor params) while fixing its fatal flaw: the provided `buy()` calls
`nft.transferFrom(seller, …)` from a contract that owns nothing — it can only work if
the NFT is escrowed (or approved) first. Escrow makes `buy()` atomic and race-free
(the NFT cannot be pulled away mid-auction), which is required by FR-012/SC-003.
Factory events give cheap on-chain discovery (FR-014) and the factory is the single
address the backend/frontend need to configure.

**Alternatives considered**:
- *User's original no-escrow contract*: rejected — the auction contract has no
  authority over the seller's NFT; buys would revert or depend on a stale approval.
- *Seller pre-approves a CREATE2-predicted auction address*: works but requires
  computing addresses off-chain before deployment — fragile UX and needless
  complexity.
- *Monolithic multi-auction registry (one contract, auctionId → struct)*: cheaper
  deployments and trivial reads, but abandons the user's provided contract shape,
  loses per-auction immutables, and concentrates blast radius in one contract.
- *EIP-1167 minimal proxies (OZ `Clones`)*: cheaper gas, but clones cannot use
  immutables (would force storage-based params) and add delegatecall audit surface —
  rejected by YAGNI for v1 scale on a testnet.

## R3. Contract corrections (provided code → spec)

**Decision**: Update both provided contracts as follows (each maps to a spec FR):

| Provided-code issue | Fix | Spec |
|---|---|---|
| No escrow — auction can't transfer seller's NFT | Factory pulls NFT (seller approves factory once) and escrows it in the auction | FR-006/FR-012 |
| `getPrice()` underflows after `expiresAt` | Clamp elapsed time to `duration` so price floors at 0, never reverts | FR-005 |
| `DURATION` hardcoded to 300 | `duration` constructor param with `MIN_DURATION` (60 s) / `MAX_DURATION` (30 d) bounds, default 300 s in UI (user-confirmed Q2 = A) | FR-011 |
| `require` string errors, typos | Custom errors (`AuctionExpired()`, `InsufficientPayment()`, …) | Constitution I |
| No cancel/reclaim — NFT permanently locked if unsold | `cancel()` while live (seller), `reclaim()` after expiry (seller) | FR-013 |
| Seller can buy own auction | `SellerCannotBuy()` guard | FR-007 |
| `Stopped` flag + raw `call`s, no reentrancy guard | CEI ordering + `ReentrancyGuard` + guarded single-shot `sold` flag | FR-009, Constitution I |
| Second `call{value: address(this).balance}` pays seller everything (fragile balance assumptions) | Explicit split: `price` → seller, `msg.value − price` → buyer | FR-006/FR-012 |
| `import "https://github.com/…"` (unusable in Foundry) | `forge install OpenZeppelin/openzeppelin-contracts@v5.7.0` (pinned) | Constitution IV |
| `_mint` (no receiver check) | `_safeMint` in the collection | Constitution I |
| `startingPrice >= discountRate * DURATION` validated against a constant | Validate `startingPrice >= discountRate * duration` for the passed duration | FR-008 |

**Rationale**: The spec supersedes the provided code (Assumption bullet); these are the
minimum changes to satisfy every FR while preserving the original design intent.

**Alternatives considered**: rewrite as a single registry contract (rejected, R2);
keep provided code untouched (rejected — violates FR-005/FR-008/FR-013 outright).

## R4. Settlement pattern (push vs pull)

**Decision**: Push settlement inside `buy()` — proceeds to the immutable `seller`,
overpayment back to `msg.sender` — with CEI ordering, `ReentrancyGuard`, and
`TransferFailed()` custom errors. Recorded as a justified deviation in plan.md
Complexity Tracking.

**Rationale**: FR-012 + SC-003 + SC-007 mandate atomic receipt in the same purchase.
The constitution *prefers* pull-payment; the spec's testable outcomes win, with
mitigations (fixed recipients only, guard, fuzz/invariant coverage).

**Alternatives considered**: pull-payment ledger (`sellerWithdraw()`/`refund()`):
constitutionally preferred but violates the spec's atomicity requirements and adds an
extra user transaction; partial pull for proceeds only — same FR-012 violation.

## R5. Wallet connection stack

**Decision**: wagmi **v2** (latest 2.x) + viem 2.x + @tanstack/react-query v5 +
RainbowKit 2.2.11, React 19.

**Rationale**: User required wagmi. RainbowKit still peers on `wagmi ^2.9.0` only, and
it delivers the polished connect/switch UX (FR-002, SC-001) with near-zero code; wagmi
v2 is the most documented, battle-tested line; React 19 is supported by both.

**Alternatives considered**:
- *wagmi v3 + Reown AppKit*: newer, but AppKit wants a Reown Cloud projectId and the
  ecosystem docs lag; upgrade path noted in R14.
- *wagmi v3 + custom connector UI*: more code, worse first-run UX.
- *Injected-only (no library UI)*: cheapest, but fails the "anybody can use it with
  his wallet" polish (no WalletConnect, no network-switch UX).

## R6. Frontend framework & styling

**Decision**: React 19 + TypeScript + Vite 8 + Tailwind CSS 4 (CSS-first `@theme`
tokens in `styles/theme.css`) + React Router (SPA).

**Rationale**: User required React. Vite 8 is the current standard for SPAs; Tailwind
4's token-first config maps cleanly to the reference design (ink-black canvas, ember
accent, hairline grid) and avoids a JS config file; no SSR is needed for a wallet app
(all data is wallet/chain-dependent).

**Alternatives considered**: Next.js (SSR/RSC unnecessary overhead for a purely
on-chain SPA, complicates static + API single-host deploy); plain HTML/JS (user
required React); CSS-in-JS (runtime cost, no benefit over Tailwind tokens).

## R7. Live price display (SC-002 ≤ 1 s lag)

**Decision**: Compute price client-side each second from chain-read immutable params
(`startingPrice`, `discountRate`, `startAt`, `duration`) via a shared
`useCurrentPrice` hook, and re-read contract state periodically (every ~10 s) and on
window focus to correct drift; disable actions the moment local time passes
`expiresAt`.

**Rationale**: Price is a pure function of time — zero RPC traffic per tick, instant
sub-second updates (SC-002), works offline-of-RPC between refetches, and matches the
clamped on-chain formula (R3). Chain read remains the source of truth for permissioned
actions (`buy()` re-validates on-chain anyway).

**Alternatives considered**: `useReadContract` polling every second (RPC-heavy, still
render-limited); backend WebSocket push (infra complexity for a value the client can
compute); server-sent events (same).

## R8. Auction discovery (FR-014)

**Decision**: Node.js service indexes `AuctionCreated` logs from the factory (and
`AuctionSold`/`AuctionCancelled`/`AuctionReclaimed` logs from known auction addresses)
with idempotent `eth_getLogs` polling into SQLite; serves the gallery REST API. The
on-chain factory also keeps an `allAuctions[]` array as a trustless fallback the
frontend can read directly.

**Rationale**: User required Node.js; the gallery needs server-side filtering/paging
(FR-014) and cached metadata for fast loads; polling logs is simple, idempotent, and
resumable (`sync_state`), with events visible ≤ 15 s after confirmation.

**Alternatives considered**:
- *Client-side `getLogs` only*: no backend needed but RPC-provider limits make
  filtered/paged galleries brittle and re-do work per visitor; doesn't use Node as
  requested.
- *The Graph / subgraph*: hosted infra, deploy latency, overkill for one factory.
- *SaaS indexer (Ponder/Supabase)*: external account + cost; contrary to
  "self-contained".

## R9. Backend runtime, API framework, storage

**Decision**: Node.js 24 LTS + TypeScript + Fastify 5 + viem + better-sqlite3 13.

**Rationale**: Node 24 is the current Active LTS; Fastify gives typed, schema-validated
routes (Constitution I quality) with less boilerplate than Express 5; better-sqlite3
is zero-config, synchronous, and durable enough for a single-node indexer (canonical
state is on-chain — SQLite is a rebuildable cache, so no migration story needed);
viem reuses the frontend's web3 stack.

**Alternatives considered**: Express 5 (fine, but no free schema typing); Postgres
(operational overhead for a rebuildable cache); in-memory only (indexer would re-scan
from block 0 on every restart); Node's built-in sqlite (less mature driver).

## R10. ABI & address distribution

**Decision**: `@wagmi/cli` 2.10 with its Foundry plugin (`artifacts: 'out/'`) generates
typed hooks/ABIs into `frontend/src/config/contracts.ts`; deployed addresses come from
`deployments/<network>.json` written by `forge script` and imported by frontend config
and backend config.

**Rationale**: Single source of truth (forge artifacts) → no hand-copied ABIs
(Constitution I/IV); addresses are deploy outputs, never literals in code.

**Alternatives considered**: manual copy script (drift-prone); `abigen` (not TS-native);
hardcoded addresses (violates multi-environment deploys).

## R11. Quality toolchain

**Decision**: forge fmt (check mode), solhint 6, Slither 0.11, `forge coverage` with
thresholds, `forge snapshot` for gas, Vitest for frontend/backend, all as merge gates;
Conventional Commits.

**Rationale**: Directly implements the constitution's gate list; all tools current
(verified Sept 2026); OZ pinned at v5.7.0 (solc 0.8.31 compatible, `^0.8.20` pragma).

**Alternatives considered**: Mythril/other heavy symbolic tools (slow CI, beyond v1
need); no linter (violates constitution).

## R12. Deployment (public URL, no local chain)

**Decision**: One Node service (the Fastify backend) serves the built SPA as static
files plus `/api/*` on a public host (any PaaS/VPS — Fly, Render, Railway, Hetzner
VPS); configuration via environment (`RPC_URL`, `FACTORY_ADDRESS`, `PORT`, optional
`WALLETCONNECT_PROJECT_ID`); `.env.example` documents all keys, `.env` gitignored.
Contracts deployed once via `forge script … --broadcast --verify` to Sepolia;
addresses published in `deployments/sepolia.json`.

**Rationale**: Satisfies SC-005 ("public URL, no local node/CLI") with the smallest
operational surface — one service, one env file; RPC provider key stays server-side
where possible, and the frontend only needs a public RPC (or the same provider's
frontend-safe key) for reads/writes from the wallet.

**Alternatives considered**: static host + separate API host (two deploys, CORS,
split config); serverless functions (cold starts hurt the polling indexer); Docker
compose with local Anvil (explicitly out of scope per spec).

## R13. NFT metadata resolution (edge case)

**Decision**: Indexer stores `tokenURI` at auction creation and attempts one bounded
fetch (http/https/ipfs only, 5 s timeout, 100 KB cap) to cache `name`/`image` for the
gallery; the frontend rewrites `ipfs://` via a public gateway, falls back to a
placeholder image + generic name on failure, never blocking the auction UI.

**Rationale**: Spec edge case "missing/unresolvable metadata"; caching keeps the
gallery fast (p95 < 300 ms), bounding prevents the indexer from being wedged by bad
URIs; client fallback keeps auctions usable without metadata.

**Alternatives considered**: resolve fully client-side (gallery renders N RPC calls +
N fetches per visit — slow); never fetch URIs (gallery has no previews — poor UX).

## R14. Upgrade path (recorded, not in v1 scope)

**Decision**: When RainbowKit ships wagmi v3 support (or if AppKit is preferred), the
migration is isolated to `frontend/src/config/wagmi.ts` + provider wiring; v1 pins
wagmi v2 latest.

**Rationale**: Keeps v1 on the most stable, documented combination without foreclosing
the v3 line.

## R15. Test strategy mapping (constitution II/III)

**Decision**: Red→green per behavior; test layers:
- **Unit/fuzz** (`test/unit`): price decay & clamping (incl. post-expiry), duration
  bounds, FR-008 validation, overpayment refund math, seller self-buy block,
  cancel/reclaim permissions, double-buy, factory escrow + event emission, mint ids +
  metadata.
- **Invariant** (`test/invariant`): (1) ETH conservation — contract balance equals
  pending obligations; (2) NFT conservation — escrowed NFT present iff auction unsold
  & uncancelled; (3) at most one sale per auction.
- **Integration**: deploy-fixture flow — mint → approve → create → time-warp → buy →
  assertions (mirrors quickstart scenarios).
- **Frontend/backend**: Vitest + RTL for price ticker, status derivation, error
  mapping; API contract tests against fixture data.

**Rationale**: Implements Constitution II/III exactly; each layer maps to spec FRs
(traced in data-model.md and quickstart.md).

**Alternatives considered**: example-based tests only (misses boundary timing —
rejected by FR coverage targets); property testing on the frontend (low ROI).

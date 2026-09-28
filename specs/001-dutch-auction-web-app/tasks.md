---
description: "Task list template for feature implementation"
---

# Tasks: Dutch Auction NFT Web App

**Input**: Design documents from `/specs/001-dutch-auction-web-app/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED — not optional here. Constitution Principle II (Test-First,
NON-NEGOTIABLE) and plan research R15 mandate red→green: each test task MUST fail
(compile-fail or assertion-fail) before its implementation task runs.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Contracts**: Foundry `src/`, `test/`, `script/` at repository root
- **Web app**: `backend/src/`, `frontend/src/` (npm workspaces per plan.md)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and toolchain per plan.md Technical Context

- [X] T001 Initialize Foundry project: create `foundry.toml` at repository root pinning `solc = "0.8.31"` with optimizer enabled, plus `src/`, `test/`, `script/` directories per plan.md Project Structure
- [X] T002 Install pinned dependency `OpenZeppelin/openzeppelin-contracts@v5.7.0` via `forge install` and add remapping `@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/` to `remappings.txt`; record the resolved commit hash in a `remappings.txt` header comment (constitution IV requires exact-commit pinning)
- [X] T003 [P] Configure contract linters: create `.solhint.json` (solhint 6 recommended ruleset) and `slither.config.json` at repository root
- [X] T004 Create root `package.json` with npm workspaces (`frontend`, `backend`) and gate scripts: `fmt:check`, `test:contracts`, `coverage`, `lint:contracts`, `scan`, `test:frontend`, `test:backend`
- [X] T005 [P] Create `.env.example` (RPC_URL, DEPLOYER_KEY, FACTORY_ADDRESS, NFT_ADDRESS, PORT, WALLETCONNECT_PROJECT_ID) and `.gitignore` (`.env`, `node_modules/`, `out/`, `cache/`, `broadcast/`, `backend/data/`, `frontend/dist/`) at repository root; `.env.example` comments must state that `FACTORY_ADDRESS`/`NFT_ADDRESS` mirror the `factory`/`nft` keys of `deployments/sepolia.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The three contracts + tests + deploy path + app shells — required by ALL user stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Contracts (red → green per test task)

- [X] T006 [P] Create `src/interfaces/IDutchAuction.sol` from contracts/smart-contract-interface.md: full external surface (getPrice, buy, cancel, reclaim, public state getters), events `AuctionSold/AuctionCancelled/AuctionReclaimed`, and all custom errors — with NatSpec on every member (Constitution I)
- [X] T007 [P] Create `src/interfaces/IAuctionFactory.sol` from contracts/smart-contract-interface.md: `createAuction(...) returns (address)`, `auctionCount()`, `allAuctions(uint256)`, constants `MIN_DURATION = 60`, `MAX_DURATION = 2_592_000`, event `AuctionCreated` (indexed auction/seller/nft), custom errors — with NatSpec
- [X] T008 Create shared test harness `test/base/AuctionTestBase.sol`: fixtures deploying DutchAuctionNFT + AuctionFactory, actor setup (seller/buyer/second buyer), helpers for `vm.warp` time travel and creating auctions with valid params
- [X] T009 RED: Write `test/unit/DutchAuction.t.sol` (fails before T011) covering: price decay & clamping — "price(auction, now) = startingPrice − discountRate × min(now − startAt, duration), clamped ≥ 0" incl. post-expiry calls (FR-005); FR-008 equality `startingPrice == discountRate × duration` valid; all buy guards with custom errors per data-model §1.2 validation table (AlreadySold/AlreadyCancelled/AuctionExpired/SellerCannotBuy/InsufficientPayment); overpayment refund math exact (FR-006); cancel/reclaim permissions and transitions (FR-013); double-buy single-shot (FR-009) — fuzz price/duration/refund parameters
- [X] T010 RED: Write `test/unit/AuctionFactory.t.sol` (fails before T012) covering: duration bounds "`60s ≤ duration ≤ 2_592_000`" inclusive (InvalidDuration), `InvalidPriceParams`, `PriceWouldGoNegative`, `NotNftOwner`, `NotApproved`, `ZeroAddress`; escrow pulled via safeTransferFrom (NFT owner == new auction); registry append; `AuctionCreated` argument values incl. `startAt = block.timestamp`, `expiresAt = startAt + duration`
- [X] T011 [P] RED: Write `test/unit/DutchAuctionNFT.t.sol` (fails before T013) covering: sequential token ids from 0, `tokenURI` round-trip, `EmptyURI()` revert, mint to `msg.sender`
- [X] T012 Implement `src/DutchAuction.sol` implementing IDutchAuction: immutables (seller, nft, nftId, startingPrice, discountRate, duration, startAt, expiresAt), clamped `getPrice()`, `buy()` with checks-effects-interactions + `ReentrancyGuard` (set sold/buyer/salePrice → transfer NFT → send price to seller → refund `msg.value − price` to buyer, `TransferFailed()` on any failure), `cancel()` (seller, live), `reclaim()` (seller, post-expiry), `onERC721Received`, constructor validation (`InvalidDuration()`, `PriceWouldGoNegative()`) — full NatSpec; turns T009 green
- [X] T013 Implement `src/AuctionFactory.sol` implementing IAuctionFactory per data-model §1.2 validation table: validate all inputs, require owner + approval, deploy DutchAuction, `safeTransferFrom(msg.sender, auction, tokenId)` escrow, append registry, emit `AuctionCreated` — full NatSpec; turns T010 green
- [X] T014 [P] Implement `src/DutchAuctionNFT.sol`: OZ `ERC721URIStorage`, name "Soliman Web3", symbol "SW3", `mintNFT(string)` with `_safeMint` to `msg.sender`, `_setTokenURI`, id increment, `EmptyURI()` guard — full NatSpec; turns T011 green
- [X] T015 RED: Write `test/invariant/AuctionAccounting.invariant.t.sol` covering the three R15 invariants: (1) ETH conservation — contract balance equals pending obligations (0 for escrowed auctions); (2) NFT conservation — auction holds the NFT iff unsold and uncancelled; (3) at most one sale per auction — with ghost-variable tracking
- [X] T016 Fix any gaps surfaced by T015 in `src/DutchAuction.sol` / `src/AuctionFactory.sol` until `forge test --match-contract AuctionAccounting` passes (invariant handler: buy/warp/cancel/reclaim fuzzed sequences)
- [X] T017 [P] Create `script/Deploy.s.sol`: deploys DutchAuctionNFT + AuctionFactory, writes `{ chainId, nft, factory, startBlock }` to `deployments/<network>.json` via `vm.writeJson` (`startBlock` added in bf2c4b3/14bb8e2 to seed the indexer cursor; tests redirect output via `DEPLOYMENTS_DIR`)
- [X] T018 Deploy to Sepolia with `forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify` (requires DEPLOYER_KEY with Sepolia ETH) and commit resulting `deployments/sepolia.json`

### Frontend shell (blocks US1/US2/US3)

- [X] T019 Scaffold `frontend/`: `frontend/package.json` (React 19, TypeScript, Vite 8, wagmi v2, viem, @tanstack/react-query v5, RainbowKit 2.2.x, Tailwind CSS 4, React Router, Vitest + React Testing Library), `frontend/vite.config.ts` (dev proxy `/api` → localhost:3001), `frontend/index.html`
- [X] T020 [P] Create `frontend/src/styles/theme.css` — Tailwind 4 CSS-first `@theme` tokens implementing FR-016: ink-black canvas, ember-orange accent, hairline border color, display + body sans font families, dark-only
- [X] T021 Create `frontend/src/config/wagmi.ts` (Sepolia chain id 11155111, injected + WalletConnect connectors, projectId from env) and `frontend/src/App.tsx` wiring providers (wagmi, React Query, RainbowKit) + routes for `/`, `/auction/:address`, `/mint`, `/create`, `/my` — foundation for FR-002/FR-017
- [X] T022 [P] Create `frontend/wagmi.config.ts` with @wagmi/cli Foundry plugin (`artifacts: '../out/'`) generating `frontend/src/config/contracts.ts` (typed ABIs + addresses from `deployments/sepolia.json`) — run codegen once so the file exists
- [X] T023 [P] Create shared UI primitives: `frontend/src/components/ui/` (Button, Panel, Badge, Input, Toast) and `frontend/src/components/layout/` (Header, Footer, GridBackdrop) styled from theme tokens
- [X] T024 Create `frontend/src/hooks/useTxFlow.ts` implementing data-model §1.5 transaction state machine (`idle → awaiting_signature → pending → confirming → success`, with `rejected`/`failed` terminals) and `frontend/src/lib/errors.ts` mapping contract custom errors to plain-language message objects (FR-003: what happened + next step, no hex/jargon)

### Backend shell (blocks US3; production hosting for all)

- [X] T025 Scaffold `backend/`: `backend/package.json` (Node 24 LTS, Fastify 5, viem, better-sqlite3 13, TypeScript, Vitest) and `backend/tsconfig.json`
- [X] T026 [P] Create `backend/src/config.ts`: fail-fast env parsing for RPC_URL, FACTORY_ADDRESS, NFT_ADDRESS, PORT, DB_PATH — throws on missing vars; document that `FACTORY_ADDRESS`/`NFT_ADDRESS` mirror the `factory`/`nft` keys of `deployments/sepolia.json`; no secret values in repo
- [X] T027 Create `backend/src/db.ts` implementing data-model §1.6/§1.7 exactly: `auctions` table columns (address PK, chain_id, seller, nft_contract, token_id, starting_price, discount_rate, duration, start_at, expires_at, status CHECK IN ('live','sold','expired','cancelled'), buyer, sale_price, nft_returned_at, token_uri, metadata_name, metadata_image, created_block, created_tx, updated_block) with indexes `(status, expires_at)`, `(seller)`, `(token_id)`; `events` with `UNIQUE(tx_hash, log_index)`; `sync_state` cursor table
- [X] T028 [P] Create `backend/src/chain.ts`: viem public client from RPC_URL, factory/auction ABIs imported from forge `out/` artifacts, address from config
- [X] T029 Create `backend/src/server.ts` (Fastify bootstrap, serves `frontend/dist/` as static SPA in production per R12) and `backend/src/routes/health.ts` implementing contracts/api.md health shape (`status` ok/syncing, chainId, factoryAddress, lastIndexedBlock, headBlock, lagBlocks)

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 - Buy an NFT at the live declining price (Priority: P1) 🎯 MVP

**Goal**: Visitor connects wallet, watches price decay live, buys with atomic refund, owns the NFT

**Independent Test**: With one live auction seeded (scripts/seed-demo.sh or US2 flow) on Sepolia, connect a funded wallet, confirm price declines ≤ 1 s lag without refresh, buy while overpaying, verify NFT ownership + exact refund (spec US1 "Independent Test")

### Tests for User Story 1 (RED first — constitution II)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T030 [P] [US1] RED: `frontend/src/lib/price.test.ts` — price formula `startingPrice − rate × min(elapsed, duration)` clamped ≥ 0; boundary instants: floor before expiry purchasable, at `expiresAt` disabled, elapsed == duration == floor (Edge Cases)
- [X] T031 [P] [US1] RED: `frontend/src/hooks/useCurrentPrice.test.ts` — displayed value re-renders ≥ 1×/second from cached params with no manual refresh, ≤ 1 s lag (FR-005, SC-002)
- [X] T032 [P] [US1] RED: `frontend/src/hooks/useTxFlow.test.ts` — full §1.5 state machine; rejection/failure ends terminal with state-unchanged + retry signal (FR-003, US1.4)
- [X] T033 [P] [US1] RED: `frontend/src/pages/AuctionPage.test.tsx` — renders all FR-004 fields; US1.3 reasons shown (expired/sold/price-exceeds); US1.6 wrong-network prompt; US1.8 pre-sign summary present before wallet prompt; buy disabled after expiry without reload

### Implementation for User Story 1

- [X] T034 [P] [US1] Implement `frontend/src/lib/price.ts` price computation per data-model §1.2 (green T030)
- [X] T035 [US1] Implement `frontend/src/hooks/useCurrentPrice.ts`: 1-second local ticker from immutable params + periodic on-chain `getPrice()` refetch for correction (R7) (green T031)
- [X] T036 [US1] Implement `frontend/src/components/auction/PriceTicker.tsx`, `Countdown.tsx`, `StatusBadge.tsx` (status values verbatim: `live | sold | expired | cancelled`) (depends T034); shared display formatters (ETH/wei, relative time) in `frontend/src/lib/format.ts`
- [X] T037 [US1] Implement `frontend/src/pages/AuctionPage.tsx`: NFT preview with placeholder fallback for unresolvable metadata (edge), seller, starting/current price, discount rate, time remaining, status per FR-004; direct URL works without gallery (US1 independence); create `frontend/src/hooks/useMetadata.ts` + `frontend/src/lib/ipfs.ts` (ipfs:// gateway rewrite, bounded fetch, placeholder fallback) and render all metadata-derived links safely per FR-019 clause 2 — new tab only on explicit user action, `rel="noopener noreferrer"`, never auto-executed
- [X] T038 [US1] Implement buy flow `frontend/src/components/wallet/BuyPanel.tsx`: payment input defaulting to current price, optional overpay with refund-explainer (FR-006, US1.2), `writeContract(buy)` through useTxFlow (green T032)
- [X] T039 [US1] Wire `frontend/src/lib/errors.ts` mappings for all FR-007 reasons → plain-language messages with next step (green part of T033); race loser sees "already sold" (US1.5)
- [X] T040 [US1] Implement `frontend/src/components/wallet/NetworkGuard.tsx`: wrong-network switch prompt before any tx (US1.6, FR-002) + zero-balance notice with faucet guidance (FR-002)
- [X] T041 [US1] Implement pre-signature plain-language summary modal (action + amount) shown before every wallet prompt (FR-019, US1.8), integrated into useTxFlow
- [X] T042 [US1] Add double-click/pending guard (one buy in flight, duplicates ignored — edge) and expiry-time live disable of buy controls (edge: expires while page open)
- [X] T043 [US1] A11y on purchase flow: keyboard-only operability + `aria-live` announcements of tx status changes on AuctionPage/buy controls (FR-018, US1.9)
- [X] T044 [P] [US1] Create `scripts/seed-demo.sh` (cast commands: mint, approve, createAuction with short duration on Sepolia) so US1 is testable without US2 UI

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Mint an NFT and put it up for auction (Priority: P2)

**Goal**: Seller mints, lists with validated params (incl. approval step), and can always reclaim

**Independent Test**: Connect a fresh wallet → mint with metadata URI → create auction → appears live at starting price; then sell (seller receives exact bid atomically) or expire and reclaim (spec US2 "Independent Test")

### Tests for User Story 2 (RED first)

- [X] T045 [P] [US2] RED: `frontend/src/lib/auctionParams.test.ts` — validation quotes constraints verbatim: "`60s ≤ duration ≤ 2_592_000`, default 300" (FR-011), `startingPrice ≥ discountRate × duration` with equality VALID (FR-008), `startingPrice > 0`, `discountRate ≥ 1`, each failure returns a plain-language reason naming the violated rule (US2.3)
- [X] T046 [P] [US2] RED: `frontend/src/pages/MintPage.test.tsx` (US2.1: mint result → wallet owns token) and `frontend/src/pages/CreateAuctionPage.test.tsx` (US2.2 pre-submit rejection with no tx sent; US2.6 approval-before-create ordering)

### Implementation for User Story 2

- [X] T047 [US2] Implement `frontend/src/lib/auctionParams.ts` (green T045)
- [X] T048 [US2] Implement `frontend/src/pages/MintPage.tsx`: metadata URI input, `writeContract(mintNFT)` via useTxFlow, success shows new token id + wallet ownership (FR-010, US2.1)
- [X] T049 [US2] Implement `frontend/src/pages/CreateAuctionPage.tsx`: inputs for starting price, discount rate, duration (default 300 s), pre-submit validation via T047 with plain-language reasons and NO transaction on invalid input (FR-011, US2.3)
- [X] T050 [US2] Implement approval step in `frontend/src/pages/CreateAuctionPage.tsx`: pre-flight check of factory approval → guide one-time approve tx → proceed to create only after approval confirms (US2.6, FR-011); approval failure → "not owned or not approved" edge message
- [X] T051 [US2] Implement post-creation success flow: escrow confirmation, countdown from `startAt`, status `live` at starting price, redirect to auction page (US2.2)
- [X] T052 [US2] Implement `frontend/src/components/auction/SellerActions.tsx`: cancel while live + reclaim after expiry with plain-language guards (`NotSeller`/`NotLive`/`AuctionNotExpired`) and success messaging that the NFT returned (FR-013, US2.5)
- [X] T053 [US2] Implement `frontend/src/pages/MyAuctionsPage.tsx` (route `/my`): seller's auctions via API seller filter when reachable, else direct on-chain enumeration of the factory registry (keeps US2 independent of US3) — includes cancel/reclaim entry points (FR-014 seller filter)
- [X] T054 [US2] Implement sale-outcome messaging on seller views: atomic proceeds + NFT transfer confirmed messaging per US2.4, visibility within SC-007 window

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Browse auctions and track outcomes (Priority: P3)

**Goal**: Discoverable gallery with filters, outcomes, metadata previews, and resilience

**Independent Test**: Open app → find live auction in ≤ 3 interactions without pasting an address; filters work with only-ended data; API outage shows degraded view (spec US3 + SC-009)

### Tests for User Story 3 (RED first)

- [X] T055 [P] [US3] RED: `backend/test/api.test.ts` — contracts/api.md conformance: AuctionSummary fields verbatim, wei/token ids as DECIMAL STRINGS, unix-second timestamps, lowercase addresses; query validation (`status` enum, `limit` 1–100 default 20, opaque `cursor`, `seller` address) with 400 `INVALID_PARAMETER`; detail 404 `AUCTION_NOT_FOUND`; health shape
- [X] T056 [P] [US3] RED: `backend/test/indexer.test.ts` — replay idempotency via `UNIQUE(tx_hash, log_index)` upsert; `sync_state` resume without double-apply; status derivation verbatim from data-model §1.2 (sold→SOLD, cancelled→CANCELLED, now ≥ expiresAt→EXPIRED, else LIVE) recomputed at read time

### Implementation for User Story 3

- [X] T057 [US3] Implement `backend/src/routes/auctions.ts`: `GET /api/auctions` (filters + cursor paging, newest `created_block` first) and `GET /api/auctions/:address` per contracts/api.md (green T055)
- [X] T058 [US3] Implement `backend/src/indexer.ts`: poll `AuctionCreated` from factory, register auction rows, then poll known auction addresses for `AuctionSold`/`AuctionCancelled`/`AuctionReclaimed`; ≤ 15 s visibility cadence; idempotent upserts + cursor (green T056)
- [X] T059 [US3] Implement `backend/src/metadata.ts`: bounded `tokenURI` fetch (http/https/ipfs only, 5 s timeout, 100 KB cap, R13) caching `metadata_name`/`metadata_image`; failures leave nulls (never wedge the indexer)
- [X] T060 [US3] Implement read-time `status` + `currentPrice` computation in `backend/src/routes/auctions.ts` per data-model §1.2 (client still re-derives per second — R7); null `buyer`/`salePrice` unless sold
- [X] T061 [P] [US3] Implement `frontend/src/hooks/useAuctions.ts` (gallery query, ~15 s refresh) and `frontend/src/hooks/useAuction.ts` (detail with API → direct on-chain fallback chain for FR-020)
- [X] T062 [US3] Implement `frontend/src/pages/GalleryPage.tsx`: auction cards with preview, current price, time remaining; status filter; cursor paging; reach any live auction in ≤ 3 interactions (SC-009)
- [X] T063 [US3] Implement empty states (no auctions / no live / no filter match — friendly copy naming why + next step) and degraded view with retry when API unavailable (FR-014, FR-020, US3.4, Edge Cases)
- [X] T064 [US3] Implement `frontend/src/components/auction/AuctionCard.tsx` + outcome rendering per FR-015: "sold at price P to buyer B" or "expired/cancelled" with seller named (US3.2); metadata placeholder fallback (edge); reuse `hooks/useMetadata.ts` / `lib/ipfs.ts` including FR-019 safe-link rules (explicit action, new tab, `rel="noopener noreferrer"`, no auto-execution)

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Constitution gates + spec NFRs + end-to-end validation

- [X] T065 [P] Design conformance sweep vs FR-016/SC-008 in `frontend/src/styles/theme.css` + `frontend/src/components/layout/`: ink-black only, single ember accent (no stray colors), hairline borders, bold white display headings — 100% primary screens pass — verified 2026-09-28: `frontend/src/styles/theme.test.ts` (12 tests) enforces the exact ink/panel/hairline/ember/display/muted token set, warm-only color family (r ≥ g ≥ b), zero raw color literals outside the token set across every file in `src/`, zero Tailwind built-in palette classes, display-heading base styles; muted/ember-muted tokens retuned to warm tints that compute 4.5:1+ on ink and panel; `text-black`/`border-hairline`-on-controls replaced with token classes
- [X] T066 [P] Accessibility sweep vs FR-018 across `frontend/src/pages/`: ≥ 4.5:1 contrast audit for all text/controls on ink background, full keyboard pass, aria announcements on every status change — verified 2026-09-28: contrast arithmetic in `theme.test.ts` (text tokens on ink AND panel, control-border tokens, Button/Input borders — all ≥ 4.5:1), `TxSummaryModal` keyboard pass (focus lands on Confirm, Tab/Shift+Tab cycle inside the dialog, Escape cancels and restores focus to the opener), new `StatusAnnouncement` polite live region wired into `AuctionPage` for auction status transitions (no announcement spam); tx-outcome `role=status` regions already live in BuyPanel/Mint/Create/SellerActions/Gallery load states
- [X] T067 [P] Resilience sweep vs FR-020 across all chain-reading views in `frontend/src/`: API/RPC failure states labeled (never stale-as-current), retry actions, purchase action never silently failing — verified 2026-09-28: `AuctionPage` total read failure → labeled alert + Retry + purchase hidden (never loading forever), later refetch failure → cached values kept but labeled "possibly delayed" + enabled Retry, all 12 core auction reads on 15 s refetch (SC-007); `BuyPanel.wait` asserts receipts (`assertTxConfirmed`) so a reverted purchase surfaces as mapped failure — reverted-receipt test green; new `AUCTION_READ_FAILED`/`AUCTION_VALUES_DELAYED` copy + RPC-error mappings in `errors.test.ts`
- [X] T068 Performance vs SC-010 in `frontend/`: route code-splitting, React Query caching — gallery content ≤ 2 s at 95%; confirm no full-page reloads anywhere (FR-017) — verified 2026-09-28: `React.lazy` + Suspense route chunks in the production build (Gallery 15.7 KB, Create 12.3 KB, Auction 10.5 KB, MyAuctions 8.8 KB, Mint 5.2 KB, NotFound 0.6 KB vs 753 KB shared main — total 4.3 MB dist), `QueryClient` default `staleTime: 15_000` consistent with per-hook refetchIntervals (15 s gallery/detail, 1 s price anchor), FR-017 grep clean (0 `location.reload/assign/replace`, nav is `NavLink`-only); gallery ≤ 2 s wall-clock measured under T072 SC-010 (browser-dependent)
- [X] T069 Run contract quality gates and fix all findings: `forge fmt --check`, `forge coverage --report summary` (100% branch on DutchAuction/AuctionFactory, ≥ 95% lines repo-wide), `npx solhint 'src/**/*.sol'` (0 warnings), `slither .` (no new high/medium), `forge snapshot` vs committed baseline (Constitution I/III/V) — verified 2026-09-27: fmt 0, coverage 100%/100% branch (repo 99.51% stmts / 98.96% lines), solhint `-w 0` 0 warnings on `src/**` + `script/**`, slither 0 findings (27 contracts, 59 detectors), `.gas-snapshot` baseline committed
- [X] T070 Run `npm run test:frontend` and `npm run backend:test` — all Vitest suites green; align assertions with quickstart §6 mapping — verified 2026-09-28: frontend 138/138 (17 files), backend 64/64 (4 files); §6 mapping rows all satisfied (forge test 64/64, coverage gate, snapshot --check, slither/solhint clean, both Vitest suites, production build 0 — recorded in `/tmp/opencode/t072-results.md`)
- [X] T071 Secrets/config audit: `.env` gitignored and absent from VCS, `.env.example` complete, no hardcoded addresses/keys anywhere — addresses only from `deployments/sepolia.json` + env (Constitution Toolchain & Safety) — verified 2026-09-27: `git grep` clean for deployer key + RPC key, `.env`/`frontend/.env.local`/`broadcast/`/`backend/data/` untracked, both `.env.example` files complete, zero hardcoded addresses in `src/`, `backend/src/`, `frontend/src/` prod sources
- [ ] T072 Execute `specs/001-dutch-auction-web-app/quickstart.md` end-to-end: all commands green + scenarios 1–17 validated on Sepolia; record results
- [X] T073 [P] Create `README.md`: architecture overview, local dev commands, Sepolia deploy steps, env vars; rationale: SC-005 (a newcomer completes setup with zero assistance) — verified 2026-09-28: architecture tree + data-flow diagram, Quickstart/Commands tables (all 9 advertised npm scripts verified against `package.json`), Sepolia deploy steps (`forge script --slow`, Sourcify verify, `sync-deployments.mjs`), full env-var tables for root `.env` + `frontend/.env.local` (both `.env.example` files complete; `BUYER_KEY` row added), live production URL `https://dutch-auction-mu.vercel.app` added, inaccurate `mintToken`→`mintNFT` fixed; plus API table, Vercel flow, quality-gate + solhint-policy sections, security notes
- [X] T074 Refactor pass per Constitution V: remove dead/commented code, intent-revealing names only, no logic-hidden-in-comments — reviewed against `checklists/full.md` items — verified 2026-09-28: deleted 3 never-imported components (`GridBackdrop`, `Panel`, `Toast`/`useToast` — zero refs in src/ or tests; FR-016's "hairline grid/border lines" realized by the `border-hairline` system T065 verified) and the dead `.grid-backdrop` CSS block; unexported the internally-only `AUCTION_DETAIL_FAILED`/`GALLERY_LIST_FAILED` constants; repo scans clean (no commented-out code, no `console.*` in frontend prod, no TODO/FIXME/HACK markers, no `debugger`); backend `src/` + `scripts/` contain only server logging/CLI output; kept `RULE` constants, `isPurchasable` (T030), `useAuction` (T061) as tested task deliverables; gates after refactor: frontend 138/138 (17 files), `tsc --noEmit` 0, production build 0 with 6 route chunks
- [ ] T075 Constitution compliance review: walk the full diff against constitution v1.1.0 gates and `checklists/full.md` quality items; record reviewer sign-off notes in the PR description (Constitution I/III/V, §Workflow review requirement)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — starts immediately
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories**
  - Within: T006/T007 [P] → T008 → T009–T011 [P] (red) → T012/T013/T014 [P] (green) → T015 → T016; T017 → T018; frontend shell (T019→T021, T020/T022/T023 [P], T024) and backend shell (T025→T029, T026/T028 [P]) are independent tracks
- **User Stories (Phase 3+)**: All depend on Foundational completion
  - **US1 (P1)**: no dependencies on other stories (uses seed script T044)
  - **US2 (P2)**: no dependencies on other stories (T053 self-sufficient via on-chain fallback)
  - **US3 (P3)**: consumes contracts from Foundational; US1/US2 UI components reused but not required
  - Stories can proceed in parallel or sequentially P1 → P2 → P3
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### Within Each User Story

- RED tests before implementation (constitution II) — test tasks are listed first by design
- lib/hooks before components; components before pages; error mapping before flows
- Story complete before moving to next priority

### Parallel Opportunities

- Setup: T003, T005 alongside T001–T002/T004
- Foundational: T006 ∥ T007; T009 ∥ T010 ∥ T011; T012 ∥ T013 ∥ T014; frontend shell ∥ backend shell; T017 ∥ shell tasks; T020 ∥ T022 ∥ T023; T026 ∥ T028
- US1: T030 ∥ T031 ∥ T032 ∥ T033 (all RED tests); T034 ∥ T044; T040 ∥ T041 ∥ T043
- US2: T045 ∥ T046 (RED); T048 ∥ T052 once T047 done
- US3: T055 ∥ T056 (RED); T061 [P]; T062 ∥ T064 after hooks
- Polish: T065 ∥ T066 ∥ T067 ∥ T073

---

## Parallel Example: User Story 1

```bash
# Launch all RED tests together (different files, no deps):
Task T030: "price.test.ts — formula + boundaries"
Task T031: "useCurrentPrice.test.ts — 1s tick"
Task T032: "useTxFlow.test.ts — state machine"
Task T033: "AuctionPage.test.tsx — fields + guards"

# Then implementation waves:
Wave 1: T034 (lib) ∥ T044 (seed script)
Wave 2: T035, T040, T041, T043 (independent files) ∥
Wave 3: T036 → T037 → T038 → T039 → T042 (page assembly)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — contracts + shells + Sepolia deploy)
3. Complete Phase 3: User Story 1 (RED → GREEN)
4. **STOP and VALIDATE**: run quickstart scenarios 1, 4, 5, 6, 13, 14, 16
5. MVP demo: buy an NFT at a live declining price on a public URL

### Incremental Delivery

1. Setup + Foundational → foundation ready (contracts live on Sepolia)
2. + US1 → test independently → demo (MVP!)
3. + US2 → sellers can mint/list/cancel/reclaim → demo
4. + US3 → discovery, filters, resilience → demo
5. Polish → constitution gates green → quickstart 1–17 → ship

### Parallel Team Strategy

1. Team completes Setup + Foundational together (contract track + shell track)
2. Once Foundational done: Dev A → US1, Dev B → US2, Dev C → US3
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific story for traceability (Setup/Foundational/Polish intentionally unlabeled)
- Every test task MUST be observed failing before its implementation task (Constitution II)
- Commit after each task or logical group (Conventional Commits)
- Stop at any checkpoint to validate that story independently
- `checklists/full.md` (35/35) and `checklists/requirements.md` (19/19) are green — `/speckit.implement` reads them as a gate and must not modify markers

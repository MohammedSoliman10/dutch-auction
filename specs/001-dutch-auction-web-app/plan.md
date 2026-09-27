# Implementation Plan: Dutch Auction NFT Web App

**Branch**: `001-dutch-auction-web-app` | **Date**: 2026-09-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-dutch-auction-web-app/spec.md`

## Summary

Build a publicly hosted Dutch-auction dApp on Sepolia: a fixed, escrow-based
`DutchAuction` contract plus an `AuctionFactory` (creation + on-chain event registry for
discovery) and a fixed ERC-721 collection (from the provided `SolimanWeb3`), fronted by
a React 19 + wagmi v2 + RainbowKit single-page app with the industrial-dark "Forge"
design (ink-black, ember accent, hairline grids), and a Node 24 Fastify service that
indexes factory/auction events into SQLite and serves the gallery API. Contracts are
corrected against the spec (reclaim path, clamped price, parameterized duration,
self-buy block, CEI + reentrancy guards, custom errors); wallet users need only a
browser wallet with Sepolia ETH — no local chain.

**Input summary (user direction for this plan)**: use wagmi and React and Node.js; add
whatever frontend libraries are needed; update the contracts wherever they need it.

## Technical Context

**Language/Version**: Solidity 0.8.31 (pinned in `foundry.toml`); TypeScript 5.9+ on
Node.js 24 LTS; React 19

**Primary Dependencies**: Foundry v1.8.x; OpenZeppelin Contracts v5.7.0 (pinned via
`forge install`); wagmi v2 (latest 2.x) + viem 2.x + @tanstack/react-query v5;
RainbowKit 2.2.11; @wagmi/cli 2.10 (codegen from forge artifacts); Vite 8; Tailwind
CSS 4 (CSS-first `@theme`); React Router; Fastify 5; better-sqlite3 13; solhint 6;
Slither 0.11.x

**Storage**: SQLite (backend index/cache of on-chain events + cached NFT metadata
name/image); all canonical state on-chain; NFT metadata off-chain URIs (HTTP/HTTPS/IPFS)

**Testing**: `forge test` (unit + fuzz + invariant), `forge coverage`, `forge snapshot`;
Vitest + React Testing Library (frontend); Vitest (backend); Slither + solhint as merge
gates

**Target Platform**: Web (desktop-first, dark-only), Sepolia testnet, EIP-1193
browser wallets

**Project Type**: Web application (smart contracts + SPA + Node API)

**Performance Goals**: price display lag ≤ 1 s (SC-002); gallery API p95 < 300 ms;
events visible ≤ 15 s after block confirmation; SPA interactive < 3 s

**Constraints**: constitution gates — TDD (red→green), 100% branch coverage on
critical auction paths (≥ 95% repo-wide), custom errors + full NatSpec, CEI +
reentrancy guards, pinned dependencies, no secrets in repo, no new high/medium Slither
findings; zero fund loss on failed buys (SC-004); no platform fees (FR-012)

**Scale/Scope**: single NFT collection; hundreds of auctions; ~6 screens; 3 contracts;
~8 REST endpoints; small codebase (< ~5k LOC); modest concurrent users

**Unknowns**: none — all resolved in [research.md](./research.md) (no NEEDS
CLARIFICATION remain).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Evidence in this plan |
|------|--------|-----------------------|
| I. Code Quality by Construction | ✅ PASS | solc 0.8.31 pinned; `forge fmt` + solhint; custom errors everywhere (interface contract documents them); CEI ordering + `ReentrancyGuard` in `buy()`; NatSpec on every external/public function; named constants (`MIN_DURATION`, `MAX_DURATION`, `DEFAULT_DURATION`). |
| II. Test-First Development | ✅ PASS | `/speckit.tasks` will sequence red→green: failing tests per behavior written and run before implementation; tests and code land together. |
| III. Testing Rigor & Coverage | ✅ PASS | unit + fuzz (price decay, duration bounds, overpayment, invalid configs) + invariant (escrowed-NFT and ETH conservation); 100% branch coverage target on `DutchAuction`/`AuctionFactory` critical paths, ≥ 95% repo-wide; `forge snapshot` gas review on PRs. |
| IV. Maintainability through Modularity | ✅ PASS | three single-purpose contracts + explicit interfaces (`src/interfaces/`); OZ pinned at v5.7.0; npm lockfiles; YAGNI — no clone proxies, no subgraph, no Postgres (see research alternatives). |
| V. Refactoring & Review Discipline | ✅ PASS | Slither + solhint gates; readability-focused review (intent-revealing names: `startingPrice`, `discountRate`, `expiresAt`); no commented-out code. |
| Toolchain & Safety Constraints | ✅ PASS | solc/optimizer pinned; `.env` gitignored with `.env.example`; deployer key never committed; atomic single-tx settlement explicitly permitted under constitution **v1.1.0** §Toolchain & Safety exception (CEI ordering, `ReentrancyGuard`, fixed recipients, fuzz + invariant coverage — driver FR-012/SC-003). |
| Development Workflow & Quality Gates | ✅ PASS | merge gates: `forge fmt --check`, `forge build`, full `forge test`, coverage thresholds, solhint, Slither (no new high/med), `vitest run`; Conventional Commits. |

**Gate verdict**: PASSED (all gates clean after constitution v1.1.0 amendment; resolution trail below).

**Re-check after Phase 1 design** (post data-model/contracts/quickstart): design keeps
custom errors + NatSpec in the interface contract, maps every FR-00x to a documented
API endpoint or contract function, keeps fuzz/invariant targets in scope, pins every
dependency, and introduces no new deviations. **PASSED**.

## Project Structure

### Documentation (this feature)

```text
specs/001-dutch-auction-web-app/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── api.md                     # REST API contract for the gallery/indexer
│   └── smart-contract-interface.md # ABI surface (functions/events/errors)
├── checklists/
│   └── requirements.md   # spec quality checklist (/speckit.specify output)
├── spec.md              # feature specification
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
dutch-auction/                      # repository root (Foundry + npm workspaces)
├── foundry.toml                    # solc 0.8.31 pinned, optimizer, fmt, coverage
├── remappings.txt
├── .env.example                    # RPC_URL, DEPLOYER_KEY, FACTORY_ADDRESS, PORT…
├── package.json                    # npm workspaces: frontend, backend; root scripts
├── README.md                       # architecture + runbook (SC-005, T073)
├── scripts/seed-demo.sh            # demo auction seeding via cast (T044)
├── src/                            # smart contracts
│   ├── DutchAuctionNFT.sol         # ERC721URIStorage collection (fixed SolimanWeb3)
│   ├── DutchAuction.sol            # per-auction escrow contract (fixed + extended)
│   ├── AuctionFactory.sol          # create + pull-escrow + event registry
│   └── interfaces/
│       ├── IDutchAuction.sol
│       └── IAuctionFactory.sol
├── script/
│   └── Deploy.s.sol                # deploys NFT + factory, writes deployments/<net>.json
├── test/
│   ├── base/AuctionTestBase.sol    # shared fixtures/harness
│   ├── unit/DutchAuction.t.sol     # unit + fuzz (incl. reverts, refund math)
│   ├── unit/AuctionFactory.t.sol   # unit + fuzz (validation, escrow, events)
│   ├── unit/DutchAuctionNFT.t.sol  # unit + fuzz (mint, metadata, ids)
│   └── invariant/AuctionAccounting.invariant.t.sol  # ETH/NFT conservation
├── backend/                        # Node 24 + Fastify + viem indexer/API
│   ├── src/
│   │   ├── server.ts               # bootstrap; serves API + built SPA in prod
│   │   ├── config.ts               # env parsing (fail-fast, no secrets in repo)
│   │   ├── db.ts                   # better-sqlite3 schema + queries
│   │   ├── chain.ts                # viem public client, ABI/event helpers
│   │   ├── indexer.ts              # idempotent log polling → SQLite
│   │   ├── metadata.ts             # bounded tokenURI fetch (http/https/ipfs only)
│   │   ├── routes/health.ts
│   │   ├── routes/auctions.ts      # gallery/detail/seller endpoints
│   │   └── types.ts
│   ├── test/
│   │   ├── api.test.ts
│   │   └── indexer.test.ts
│   ├── package.json
│   └── tsconfig.json
└── frontend/                       # React 19 + Vite 8 + wagmi v2 SPA
    ├── index.html
    ├── vite.config.ts
    ├── wagmi.config.ts             # @wagmi/cli codegen from forge out/
    ├── package.json
    └── src/
        ├── main.tsx
        ├── App.tsx                 # router + providers (wagmi, query, RainbowKit)
        ├── config/
        │   ├── wagmi.ts            # chains (Sepolia), connectors, projectId
        │   └── contracts.ts        # generated addresses + ABIs
        ├── styles/theme.css        # Tailwind 4 @theme tokens (ink/ember/grid)
        ├── components/
        │   ├── layout/             # Header, Footer, GridBackdrop
        │   ├── ui/                 # Button, Badge, Panel, Input, Toast
        │   ├── wallet/             # ConnectButton, TxStatus, NetworkGuard
        │   └── auction/            # AuctionCard, PriceTicker, Countdown, StatusBadge
        ├── hooks/                  # useCurrentPrice, useAuctions, useAuction,
        │                           # useMetadata, useTxFlow
        ├── lib/                    # price.ts, format.ts, errors.ts, ipfs.ts,
        │                           # auctionParams.ts
        ├── pages/                  # GalleryPage, AuctionPage, MintPage,
        │                           # CreateAuctionPage, MyAuctionsPage,
        │                           # NotFoundPage
        └── *.test.ts(x)            # Vitest + RTL tests colocated beside sources
```

**Structure Decision**: "Web application" layout with a Foundry root. Contracts live in
standard Foundry `src/` + `test/` (gates run repo-wide); `frontend/` and `backend/`
are npm workspace packages sharing a root `package.json` for one-command scripts
(`npm run dev`, `npm run build`, `npm test`). The backend doubles as the production
host for the built SPA, so the whole product deploys as one Node service plus one
on-chain deployment.

## Complexity Tracking

> **RESOLVED (2026-09-27)**: constitution amended to **v1.1.0** — §Toolchain & Safety
> now permits atomic single-transaction settlement under documented conditions (CEI
> ordering, `ReentrancyGuard`, transfers only to the immutable seller and
> `msg.sender`, custom revert-on-transfer-failure errors, fuzz + invariant coverage).
> The prior push-settlement deviation is compliant; table retained for traceability.

| (Resolved) Violation | Original Justification | Outcome |
|-----------|------------|------|
| Push settlement in `buy()` (immediate refund to buyer + immediate proceeds to seller) instead of the constitution's preferred pull-payment ledger | Spec mandates atomic outcomes: FR-012, SC-003, SC-007. Mitigations: checks-effects-interactions ordering (`sold` flag set before any transfer), `ReentrancyGuard`, transfers only to the immutable `seller` and to `msg.sender`, custom `TransferFailed()` error, plus fuzz + invariant tests proving conservation of funds. | Compliant under constitution **v1.1.0** exception (all mitigations made mandatory). |

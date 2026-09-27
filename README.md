# Dutch Auction — on-chain NFT auction dApp (Sepolia)

A publicly hosted Dutch-auction platform for NFTs. Sellers mint an ERC-721 and
list it in a descending-price auction; buyers watch the price tick down every
second and can purchase at any instant before expiry. Settlement is a single
atomic on-chain transaction (payment + NFT transfer + refund of any overpay).

Built spec-first with [GitHub Spec Kit](https://github.com/github/spec-kit):
requirements → constitution → plan → tasks → TDD implementation.

## Deployed contracts (Sepolia, chainId `11155111`)

| Contract | Address |
| --- | --- |
| `DutchAuctionNFT` (ERC-721 escrow) | `0x026B70A2016377C1854225C54145Cf3f6953346e` |
| `AuctionFactory` | `0x4E5d69ad5F9c0c0664AF9ab4D79e93de6Ae33215` |

Source verified (exact match) on Sourcify; canonical manifest:
[`deployments/sepolia.json`](deployments/sepolia.json). Per-auction escrow
contracts are deployed by the factory at `createAuction` time.

## Architecture

```
dutch-auction/
├── src/                 Solidity (solc 0.8.31, OpenZeppelin pinned in foundry.toml)
│   ├── DutchAuctionNFT.sol   ERC-721 + mintToken(uri), factory-scoped minter
│   ├── AuctionFactory.sol    createAuction → deploys per-auction escrow
│   └── DutchAuction.sol      price decay, atomic buy/refund, CEI + ReentrancyGuard
├── test/                forge: unit + fuzz + invariant suites (64 tests)
├── script/Deploy.s.sol  deploys both contracts, writes deployments/<network>.json
├── frontend/            React 19 + Vite 8 + wagmi v2 + RainbowKit + Tailwind 4
│                        dark industrial UI, 1 s price ticker, wallet tx flows
├── backend/             Fastify 5 + SQLite indexer/read API (optional)
│                        event sync ≤ 15 s, GET /api/auctions…
├── scripts/             seed-demo.sh, sync-deployments.mjs
├── deployments/         { chainId, nft, factory } manifests
└── specs/               Spec Kit artifacts (spec, plan, tasks, quickstart, checklists)
```

```
Browser ── wagmi/viem ──► Sepolia RPC          (reads + signed writes)
   │
   └─ GET /api/auctions… ──► Fastify + SQLite   (optional read-model cache)
                              │  indexer polls AuctionCreated / Sold / Cancelled
                              └─ RPC (viem)
No backend reachable? ──► frontend falls back to on-chain discovery (FR-020).
```

The web app is fully usable as a static SPA; the backend only accelerates
gallery reads.

## Prerequisites

- **Node.js ≥ 24** and npm ≥ 11
- **Foundry** (`forge`, `cast`) — <https://getfoundry.sh>
- A browser wallet (MetaMask, Rainbow, …) with **Sepolia ETH**
  (faucet: <https://cloud.google.com/application/web3/faucet/ethereum/sepolia>
  or any Sepolia faucet)
- Optional: [uv](https://docs.astral.sh/uv/) for Slither static analysis

## Quickstart

```bash
git clone <repo-url> && cd dutch-auction
npm install                       # workspaces: frontend + backend
forge build                       # contract artifacts (codegen + backend read out/)
cp .env.example .env              # fill RPC_URL (+ DEPLOYER_KEY for deploy/seed)
cp frontend/.env.example frontend/.env.local   # or: node scripts/sync-deployments.mjs
```

Run everything (two terminals):

```bash
npm run dev:backend               # http://localhost:3001  (API + indexer)
npm run dev:frontend              # http://localhost:5173  (proxies /api → :3001)
```

Open <http://localhost:5173>, connect a wallet (Sepolia), and browse the
gallery — it works even without the backend running.

## Environment variables

**Root `.env`** (backend, deploy & seed scripts — gitignored, never commit):

| Variable | Purpose |
| --- | --- |
| `RPC_URL` | Sepolia JSON-RPC endpoint (Alchemy/Infura/public) |
| `DEPLOYER_KEY` | **Testnet-only** key for `forge script` + `seed-demo.sh` |
| `FACTORY_ADDRESS` / `NFT_ADDRESS` | Mirror of `deployments/sepolia.json` |
| `PORT` | Backend port (default `3001`) |
| `DB_PATH` | SQLite file path (fallback name: `DATABASE_PATH`) |

**Frontend `frontend/.env.local`** (build-time, gitignored):

| Variable | Purpose |
| --- | --- |
| `VITE_FACTORY_ADDRESS` / `VITE_NFT_ADDRESS` | Deployed addresses |
| `VITE_RPC_URL` | Optional browser RPC (defaults to a public Sepolia RPC) |
| `VITE_WALLETCONNECT_PROJECT_ID` | Optional WalletConnect Cloud id (injected wallets work without it) |

`.env.example` / `frontend/.env.example` are committed; actual `.env*` files
are ignored by git (audited in task T071).

## Commands

| Where | Command |
| --- | --- |
| Contracts | `npm run test:contracts` · `npm run coverage` · `npm run fmt:check` |
| Contracts | `npm run lint:contracts` (solhint) · `npm run scan` (Slither) |
| Frontend | `npm run dev:frontend` · `npm run test:frontend` · `npm run build --workspace frontend` |
| Backend | `npm run dev:backend` · `npm run backend:test` · `npm run build --workspace backend` · `npm run start --workspace backend` |
| All tests | `npm run test:contracts && npm run test:frontend && npm run backend:test` |
| Quality gates | `npm run build && npm run fmt:check && npm run lint:contracts && npm run scan` |

## Deploying the contracts (Sepolia)

```bash
set -a; . ./.env; set +a
# --slow: providers that cap in-flight txs (e.g. Alchemy delegated accounts)
# reject batched sends; --slow mines tx N before sending tx N+1.
forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" \
  --broadcast --slow
```

Verification (keyless, via Sourcify):

```bash
forge verify-contract <ADDRESS> src/DutchAuctionNFT.sol:DutchAuctionNFT --chain sepolia --verifier sourcify --watch
forge verify-contract <ADDRESS> src/AuctionFactory.sol:AuctionFactory   --chain sepolia --verifier sourcify --watch
```

Then sync runtime env (writes `frontend/.env.local` + root `.env`):

```bash
node scripts/sync-deployments.mjs sepolia
```

`deployments/sepolia.json` is committed — it contains **addresses only**, no
secrets.

## Seeding a demo auction

With `DEPLOYER_KEY` funded on Sepolia:

```bash
./scripts/seed-demo.sh            # mints an NFT, approves, createAuction(300s) → prints auction URL
```

## Read API (optional backend)

| Endpoint | Notes |
| --- | --- |
| `GET /api/health` | `status, chainId, factoryAddress, lastIndexedBlock, headBlock, lagBlocks` |
| `GET /api/auctions?status=&seller=&limit=&cursor=` | `AuctionSummary[]` + `nextCursor`, newest first, wei as decimal strings |
| `GET /api/auctions/:address` | single summary; `404 AUCTION_NOT_FOUND` |

Statuses (`live \| sold \| expired \| cancelled`) are derived **at read time**;
`currentPrice` is re-computed locally per second (never depends on RPC health).
Errors follow `specs/001-dutch-auction-web-app/contracts/api.md`
(`400 INVALID_PARAMETER`, `404 AUCTION_NOT_FOUND`, `500 INTERNAL`).

## Deploying the web app to Vercel

1. Push the repository to GitHub.
2. Vercel → *New Project* → import the repo, **root = repository root**:
   - Build command: `npm run build --workspace frontend`
   - Output directory: `frontend/dist`
   - Framework preset: Vite (override if it rewrites the command)
3. Add the `VITE_FACTORY_ADDRESS`, `VITE_NFT_ADDRESS` (and optionally
   `VITE_RPC_URL`, `VITE_WALLETCONNECT_PROJECT_ID`) env vars — the same values
   printed by `scripts/sync-deployments.mjs`.
4. Deploy. The gallery degrades gracefully to on-chain discovery until/unless a
   backend is hosted separately (Fastify + SQLite needs a persistent host —
   Railway, Fly, a VPS — not Vercel serverless).

## Testing & quality gates

TDD is enforced (red → green, constitution §Workflow):

- **Contracts**: 64 forge tests; **100 % branch coverage** on `DutchAuction`
  (17/17) and `AuctionFactory` (7/7); ≥ 95 % lines repo-wide.
- **Frontend / backend**: Vitest suites (`npm run test:frontend`,
  `npm run backend:test`).
- **Static analysis**: `solhint -w 0` 0 warnings, Slither 0 findings,
  `forge fmt --check`, `forge lint`.

### Solhint policy (justified deviations from `solhint:recommended`)

| Rule setting | Why |
| --- | --- |
| `immutable-vars-naming` → `{ immutablesAsConstants: false }` | Public immutables **are** the spec'd ABI getters (e.g. `address payable public immutable seller`), so mixedCase is intended. |
| `func-name-mixedcase` off | `MIN_DURATION()` / `MAX_DURATION()` are constant getters already deployed + verified; renaming would desync source from the chain. |
| `gas-strict-inequalities` off | `block.timestamp >= expiresAt` is the exact expiry boundary from data-model §1.2 — strict-inequality rewrites risk an off-by-one. |
| `gas-indexed-events` off | `AuctionSold(indexed buyer, price)` topic layout is spec'd and consumed via ABI by the indexer. |
| `function-max-lines: 60` | `createAuction` (57 lines) is one atomic escrow-intake flow (CEI); splitting it post-deploy would break source/deployed parity. |
| `use-natspec` → ignore `seller` return | solhint parses `returns (address payable)` as a return *name* (`payable`) — false positive on a fully documented one-liner. |
| `import-path-check` off | solhint resolves imports node-style from `node_modules` only and cannot read Foundry `remappings.txt`; `forge build` (a PR gate) proves import existence for real. |
- **Lint scope**: `lint:contracts` gates `src/**` + `script/**` (all production Solidity). `test/**` is excluded — constitution III's NatSpec mandate targets the contracts that custody funds; forge-std-style test helpers follow Foundry convention.
- **Secrets**: `.env*` gitignored; addresses only from `deployments/*.json` + env.

## Specification

- [spec.md](specs/001-dutch-auction-web-app/spec.md) — requirements & user stories
- [tasks.md](specs/001-dutch-auction-web-app/tasks.md) — implementation tasks (TDD)
- [quickstart.md](specs/001-dutch-auction-web-app/quickstart.md) — scenario walkthrough
- [constitution.md](.specify/memory/constitution.md) — non-negotiable quality gates
- [contracts/api.md](specs/001-dutch-auction-web-app/contracts/api.md) — REST contract

## Security notes

- Never reuse a key that has touched anything but a testnet; `.env` is ignored
  by git and must stay that way.
- No write endpoints exist on the API — every state change is a wallet-signed
  transaction on-chain.

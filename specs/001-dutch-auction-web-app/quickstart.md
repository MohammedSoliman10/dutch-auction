# Quickstart & Validation Guide: Dutch Auction NFT Web App

**Feature**: 001-dutch-auction-web-app | **Branch**: `001-dutch-auction-web-app`

Runnable validation for the design in this feature folder. Implementation code lives
in the repo, not here — this is the run/verify guide.

## Prerequisites

- **Foundry** (`forge`, `anvil`, `cast`) — `forge --version` ≥ 1.8
- **Node.js 24 LTS** + npm (`node --version`)
- A **Sepolia-funded wallet** (deployer key + a buyer wallet with faucet ETH)
- A Sepolia **RPC URL** (public endpoint or Alchemy/Infura)

## 1. Contracts

```bash
forge install                 # deps (OpenZeppelin pinned at v5.7.0)
forge build                   # compiles with pinned solc 0.8.31
forge fmt --check             # formatting gate
forge test                    # unit + fuzz + invariant suite
forge coverage                # thresholds: 100% branch on auction paths, ≥95% lines
slither .                     # no new high/medium findings
npx solhint 'src/**/*.sol'    # zero warnings on changed files
forge snapshot                # gas snapshot reviewed against committed baseline
```

**Expected**: all commands exit 0; invariant tests report 0 failed runs across the
configured depth; coverage report meets thresholds.

## 2. Deploy to Sepolia

```bash
cp .env.example .env          # fill RPC_URL, DEPLOYER_KEY (never commit .env)
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify
```

**Expected**: `deployments/sepolia.json` written with `DutchAuctionNFT`,
`AuctionFactory` addresses and `chainId: 11155111`.

## 3. Backend (indexer + API)

```bash
npm install
npm run backend:dev           # env: RPC_URL, FACTORY_ADDRESS, PORT=3001
curl -s localhost:3001/api/health
```

**Expected**: `status` is `ok` (or `syncing` on first boot), `chainId` 11155111,
`lagBlocks` small and falling to 0.

## 4. Frontend

```bash
npm run frontend:dev          # Vite dev server, proxies /api → backend
```

**Expected**: app opens on the gallery, "Connect Wallet" prompts (RainbowKit),
network guard shows Sepolia when on the wrong chain (FR-002).

Production check (SC-005): `npm run build` then start the backend — it serves the
built SPA + API from one public URL; verify the flow from that URL with a fresh
browser profile and only a wallet extension installed (no CLI).

## 5. End-to-end validation scenarios

Manual happy/sad paths (wallet on Sepolia), each mapped to spec criteria. Time travel
for long waits uses `cast evm_increaseTime` + `cast evm_mine` against the RPC where
applicable, or short durations (60 s minimum) chosen at creation.

| # | Scenario | Steps | Expected | Covers |
|---|----------|-------|----------|--------|
| 1 | **Mint** | Connect → Mint page → submit a metadata URI | Tx pending → success; NFT appears in wallet; id increments | FR-010, US2.1, FR-003 |
| 2 | **List** | Approve (if prompted) → Create Auction: price, rate, duration | One create tx; auction appears `live` at full starting price; countdown runs | FR-011, US2.2, SC-002 |
| 3 | **Invalid config** | Create with `startingPrice < rate × duration`, or duration > 30 d | Frontend pre-validates; on-chain revert is `PriceWouldGoNegative()` / `InvalidDuration()`; no state change | FR-008, US2.3 |
| 4 | **Live price** | Watch an auction ≥ 30 s without refreshing | Price ticks down ≥ 1×/s, sub-second lag, never negative | FR-005, SC-002 |
| 5 | **Buy with overpay** | Buy sending current price + extra | Single tx: buyer owns NFT, exact overpayment refunded in same tx; seller got exactly `price` | FR-006, US1.2, SC-003 |
| 6 | **Buy — expired** | Wait past `expiresAt`, attempt buy | `AuctionExpired()`; UI disabled; no funds lost | FR-007, US1.3, SC-004 |
| 7 | **Buy — already sold** | Second buyer attempts after a sale | `AlreadySold()`; gallery shows `sold` with winner + price | FR-007, FR-015 |
| 8 | **Seller self-buy** | Seller attempts to buy own auction | `SellerCannotBuy()` with clear message | FR-007, edge case |
| 9 | **Race** | Two funded wallets buy the same live auction | At most one succeeds; the other fails cleanly (integrity shown by invariant tests too) | FR-009, US1.5 |
| 10 | **Cancel** | Seller cancels while live | NFT returns to seller; status `cancelled` in gallery | FR-013, US2.5 |
| 11 | **Reclaim** | Let auction expire unsold → seller reclaims | NFT returns; status `expired`; seller never locked out | FR-013, edge case |
| 12 | **Discovery** | Open app → find the live auction in ≤ 3 clicks, no address pasted | Gallery lists it with preview, price, time remaining; filters work when only ended auctions exist | FR-014, US3, SC-009 |
| 13 | **Wrong network** | Connect on mainnet/Ethereum | Switch-network prompt before any action | FR-002 |
| 14 | **Reject tx** | Reject in wallet during buy | UI returns to idle, no "pending forever", auction unchanged | FR-003, edge cases |
| 15 | **Bad metadata** | Mint with an unfetchable URI | Placeholder image + generic name; auction fully usable | edge case, R13 |
| 16 | **Design review** | Inspect every primary screen against reference image | Ink-black canvas, ember accent only, hairline borders, bold white display type, no light mode | FR-016, SC-008 |
| 17 | **Newcomer timing** | Fresh profile, funded wallet, public URL | First purchase completed < 2 min, no assistance | SC-001, SC-005, SC-006 |

## 6. Automated mapping

| Check | Command | Pass signal |
|-------|---------|-------------|
| Unit/fuzz/invariant | `forge test` | 0 failures |
| Coverage gate | `forge coverage --report summary` | 100% branch on auction paths, ≥ 95% lines |
| Gas regression | `forge snapshot` | no unexplained deltas in PR |
| Static analysis | `slither .` + `npx solhint 'src/**/*.sol'` | no new high/med; 0 warnings |
| Backend | `npm run backend:test` | Vitest green (API contract + indexer idempotency) |
| Frontend | `npm run frontend:test` | Vitest + RTL green (price hook, status derivation, tx flow) |
| Build | `npm run build` | SPA bundles; backend compiles |

## 7. Reset / rerun

- **Indexer rebuild**: stop backend, delete `backend/data/index.db`, restart —
  re-syncs from the factory deployment block (idempotent by design).
- **Fresh chain (optional local dev only)**: `anvil` + deploy + point
  `RPC_URL`/`FACTORY_ADDRESS` at it — supported for development, but the shipped
  validation target is Sepolia per FR-001.

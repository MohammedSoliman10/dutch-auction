# T072 Quickstart Validation Results (quickstart.md §1, §3, §5, §6)

**Executed**: 2026-09-27 (§1/§3/§6 automated gates) · 2026-09-28T01:28Z (§5 scenario battery, Sepolia + anvil) · 2026-09-28T16:00Z (§5 UI scenarios 12–17 + SC-010 browser RUM)
**Operator**: unattended agent run · **Networks**: Sepolia (11155111) + local anvil (31337 for the race)
**Browser-dependent scenarios**: executed in the OpenCode desktop experimental browser session against production (`https://dutch-auction-mu.vercel.app`) — method and evidence in §5b. Wallet interactions used an EIP-6963 mock wallet injected before app boot (mode-selectable: wrong-network / reject / sepolia) with an ethers v6 signer bound to the funded Sepolia buyer key (`0x8E691e…DB47`) — the mock only substitutes for a browser extension; the app, bundle, RPC, and chain are production.

## §1/§3/§6 automated command gates

forge-build: exit=0
fmt-check: exit=0
forge-test: exit=0
Ran 5 test suites in 1.30s (2.63s CPU time): 64 tests passed, 0 failed, 0 skipped (64 total tests)
coverage: exit=0
| src/AuctionFactory.sol | 100.00% (31/31) | 100.00% (36/36) | 100.00% (7/7) | 100.00% (5/5) |
| src/DutchAuction.sol | 100.00% (66/66) | 100.00% (75/75) | 100.00% (17/17) | 100.00% (6/6) |
| Total | 98.96% (191/193) | 99.51% (205/206) | 100.00% (32/32) | 96.77% (30/31) |
snapshot-check: exit=0
solhint: exit=0
slither: exit=0
INFO:Slither:. analyzed (27 contracts with 59 detectors), 0 result(s) found
backend-tests: exit=0
[2m      Tests [22m [1m[32m64 passed[39m[22m[90m (64)[39m
(executed $(date +%FT%T); all green — evidence for T072 §1/§3/§6)

## §5 quickstart scenario battery (run #4, 2026-09-28T01:28:49Z, Sepolia)
Script: /tmp/opencode/t072-scenarios.sh | Log: /tmp/opencode/t072-scenarios.log
Final tally: PASS=47 FAIL=2 (both FAILs = harness bugs, not defects; corrected evidence below)

| # | Scenario | Evidence | Status |
|---|----------|----------|--------|
| 1 | Mint | seed flow green; `minted token #5`; S15 `tokenURI(8)` stored verbatim; id incremented #5->#8 | PASS |
| 2 | List | createAuction green; S2 live at full price (startAt=1790559000 expiresAt=1790559300) | PASS |
| 3 | Invalid config | S3a `InvalidDuration()` 0x76166401 + S3b `PriceWouldGoNegative()` 0xf9561e19 (eth_call + on-chain tx, auctionCount unchanged) | PASS |
| 4 | Live price | battery: monotonic/never-negative PASS, `ticks>=14` FAIL (harness assumed per-second on-chain updates; getPrice advances per ~12s block) -> corrected watch /tmp/opencode/t072-s4.log: PASS=5 FAIL=0 (3 block drops over 45s, each an exact multiple of rate 166666666666666 wei/s, never negative, <= startingPrice; UI 1 tick/s = useCurrentPrice 1s setInterval + unit tests in the 138) | PASS (corrected) |
| 5 | Buy with overpay | S5 conservation exact: sellerGain=buyerExGas=salePrice=19600000000000004 wei (full 0.005 ETH overpay refunded in-tx); buyer owns NFT, sold=true, buyer()=winner | PASS |
| 6 | Buy — expired | S6 `AuctionExpired()` 0x04a5e67c eth_call + on-chain revert, no state change, no funds lost | PASS |
| 7 | Buy — already sold | S7 `AlreadySold()` 0xda17dbf8 eth_call + on-chain revert, winner keeps NFT | PASS |
| 8 | Seller self-buy | S8 `SellerCannotBuy()` 0x2aa3c9e9 eth_call + on-chain revert, auction unchanged | PASS |
| 9 | Race | anvil chain 31337: exactly one racer won, loser's retry `AlreadySold()`, winner recorded in buyer()=0x7099...79C8. 1 FAIL (`no Transfer log`) = receipt written as human text; fixed (`cast send --json`) + token_from verified against real Sepolia receipt -> id 8 exact MATCH | PASS (parse bug fixed) |
| 10 | Cancel | S10 cancel tx, cancelled=true, NFT returned to seller; buy-after-cancel reverted on-chain | PASS |
| 11 | Reclaim | S11 reclaim tx, NFT back to seller, derived status expired; reclaim-twice guard reverted | PASS |
| 12 | Discovery | browser run: gallery renders 12 auctions with status/price/time; LIVE "Ember Descent #1" found by browsing only (no address pasted) — 1 click ≤ 3; detail: preview image loaded (400px), CURRENT PRICE ticking 0.009359→0.009346 ETH, TIME REMAINING 11h 12m, STATUS LIVE, BUY panel; filters: ALL=12, LIVE=1, SOLD=2, EXPIRED=8, CANCELLED=1, every list status-consistent (ended-only lists correct) | PASS |
| 13 | Wrong network | browser run (mock wallet on mainnet 0x1): header shows "Wrong network" dropdown; auction page renders inline panel "WRONG NETWORK — Your wallet is connected to a different network than Sepolia. Switch networks before buying - no transaction can be requested until then" + SWITCH TO SEPOLIA; BUY NOW disabled; clicking switch issues only `wallet_switchEthereumChain` (4902) then `wallet_addEthereumChain` (4001) — **0 `eth_sendTransaction`**; prompt persists while wallet stays wrong-net (switch-prompt unit tests remain as coverage) | PASS |
| 14 | Reject tx | browser run (connected Sepolia, mock rejects `eth_sendTransaction` 4001): pending panel "Confirm in your wallet to continue, or reject to cancel. Nothing has been sent yet."; CONFIRM dialog → exactly 1 `eth_sendTransaction` → terminal "YOU REJECTED THE REQUEST IN YOUR WALLET / Nothing was sent and nothing changed - press retry when you are ready"; BUY NOW re-enabled (retry path), no stuck pending, no hex/raw codes on page, price ticking + STATUS LIVE unchanged, on-chain `sold=false`, buyer balance unchanged (0.019677 ETH) | PASS |
| 15 | Bad metadata | chain half PASS (S15, `tokenURI(8)` = `https://nonexistent.invalid/metadata.json`); UI half PASS in browser: detail + gallery cards show "PREVIEW UNAVAILABLE" placeholder and generic "Unnamed NFT" with full auction details intact (seller, prices, expired/reclaim copy) — auction remains usable | PASS |
| 16 | Design review | browser audit of Gallery / Auction / Mint / Create / My Auctions / 404: body `rgb(5,5,7)`=#050507 ink, accent `rgb(255,90,31)`=#ff5a1f, hairline `rgb(38,38,43)`=#26262b, headings "Archivo Black" `#f5f5f5`; 0 `prefers-color-scheme: light` rules, 0 theme toggles; OS reports light scheme while app stays ink-black (dark-only, no light mode); screenshots captured + T065 theme.test.ts | PASS |
| 17 | Newcomer timing | browser run, fresh profile (wallet storage cleared) → public URL → connect (1 click, correct chain, no switch) → view → BUY → CONFIRM: dialog render 109 ms, wallet sign+broadcast ≈2 s, **on-chain confirmation 26.2 s** (confirm 16:00:33.842Z → block 11801577 at 16:01:00Z), tx `0xf629c29a…6d2cf7` status=1, `sold=true` `buyer=0x8E…DB47`, success panel "BUY NFT CONFIRMED / The result is final on-chain - no further action needed"; active user-side time ≈30 s ≪ 120 s (agent inter-call latency between steps excluded from user time) | PASS |

SC-010 synthetic timing: homepage p50=0.272s p95=0.289s (n=12);
Sepolia eth_call p50=0.737s p95=0.938s (n=12).
SC-010 browser RUM (2026-09-28, production gallery, desktop browser, n=10 reloads): time-to-content
(nav start → "Showing 12 auctions" visible) p50=0.851s p95=0.956s — 10/10 loads < 2s (≥95% target met at 100%);
FCP p50≈0.29s (max 0.46s), DOMContentLoaded p50≈0.21s. Measured from this machine's network; throughput/RTT to
Vercel/RPC well within the profiled-connection assumption, consistent with the synthetic numbers above.

## §5b browser-session run (2026-09-28T15:45–16:05Z)

- **Harness**: OpenCode desktop v2.0.13 experimental browser pane (in-app Chromium), driven by the session's
  browser tools (snapshot/click/fill/evaluate/screenshot/network) + CDP port 9222 for init-script injection
  (`Page.addScriptToEvaluateOnNewDocument`) and forced-frame captures.
- **Wallet stand-in**: EIP-6963 provider announced pre-boot (`eip6963:announceProvider`), mode persisted in
  `localStorage.MOCK_MODE` (`wrongnet` | `reject` | `sepolia`); signer bundle (ethers v6, Sepolia buyer key)
  injected as a second init script. RainbowKit lists it as "MetaMask"; connect/switch/reject/submit all go
  through the normal wagmi path. Every wallet call was recorded in-page (`__CALLS`) for assertions.
- **Evidence**: tool screenshots (`/tmp/opencode-browser-*`), accessibility snapshots, in-page DOM audits,
  `__CALLS` logs, and on-chain `cast`/RPC checks (receipt `0xf629c29a…` status=1, `sold=true`, balances).
- **Note**: the gallery's on-chain battery tokens (#0–#11) intentionally carry unfetchable/odd metadata URIs,
  so "PREVIEW UNAVAILABLE / Unnamed NFT" on those cards is the specified graceful degradation (FR/R13), not a
  gateway failure; token #13's real IPFS metadata loads via the plum gateway (preview 400px, name + description).
Real bug found by battery: scripts/seed-demo.sh `cast balance` missing `--rpc-url` (fixed in working tree).

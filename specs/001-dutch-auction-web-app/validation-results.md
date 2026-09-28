# T072 Quickstart Validation Results (quickstart.md §1, §3, §5, §6)

**Executed**: 2026-09-27 (§1/§3/§6 automated gates) · 2026-09-28T01:28Z (§5 scenario battery, Sepolia + anvil)
**Operator**: unattended agent run · **Networks**: Sepolia (11155111) + local anvil (31337 for the race)
**Browser-dependent scenarios**: see the BLOCKED rows in §5 — they run as soon as the desktop browser session is enabled (one user action in the OpenCode desktop app).

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
| 12 | Discovery | needs browser session | BLOCKED (browser) |
| 13 | Wrong network | needs browser session (switch-prompt logic unit-tested) | BLOCKED (browser) |
| 14 | Reject tx | needs browser session (useTxFlow `rejected` terminal unit-tested) | BLOCKED (browser) |
| 15 | Bad metadata | chain half PASS (S15); UI placeholder half needs browser (AuctionCard/useMetadata tests green) | SPLIT |
| 16 | Design review | needs browser (T065 theme.test.ts + production serve checks are partial evidence) | BLOCKED (browser) |
| 17 | Newcomer timing | needs browser session | BLOCKED (browser) |

SC-010 synthetic timing (browser RUM pending): homepage p50=0.272s p95=0.289s (n=12);
Sepolia eth_call p50=0.737s p95=0.938s (n=12).
Real bug found by battery: scripts/seed-demo.sh `cast balance` missing `--rpc-url` (fixed in working tree).

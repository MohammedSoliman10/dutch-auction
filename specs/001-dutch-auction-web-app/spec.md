# Feature Specification: Dutch Auction NFT Web App

**Feature Branch**: `001-dutch-auction-web-app`

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description: "Build a Dutch auction for an NFT using the two provided
contracts (a `DutchAuction` sale contract and a `SolimanWeb3` NFT collection contract).
The result must be fully functional on its own as a web app that works online — deployed
publicly so anybody can use it with their wallet, not something that only runs on a
local Anvil chain. The frontend must use the provided reference image as its design
guide: an industrial dark design system — ink-black canvas, hairline grids, a single
ember accent, bold white display typography."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Buy an NFT at the live declining price (Priority: P1)

A visitor opens the hosted web app, connects their wallet, opens a live auction, watches
the current price tick down in real time, and purchases the NFT at the current price.
If they send more than the current price, the excess is returned to them instantly as
part of the same purchase. After the purchase, they own the NFT.

**Why this priority**: This is the core value of the product — an NFT changing hands at
a transparent, time-decaying price on a public network. Without it there is nothing for
end users to do.

**Independent Test**: With one live auction seeded, connect a funded wallet on the
public network, confirm the displayed price declines without refreshing, purchase while
slightly overpaying, then verify the wallet owns the NFT and received the exact refund
of the overpayment.

**Acceptance Scenarios**:

1. **Given** a live auction, **When** a visitor views it, **Then** the current price
   shown decreases over time with no manual page refresh.
2. **Given** the current price is P, **When** a connected buyer confirms a payment of
   P or more, **Then** they become the owner of the NFT and receive their overpayment
   (payment − P) back in the same purchase.
3. **Given** an auction that has expired, already sold, or whose current price exceeds
   what the buyer offers, **When** a buyer attempts to purchase, **Then** the purchase
   is rejected with a specific reason (e.g., "auction expired", "already sold",
   "current price is now P") and no funds are lost.
4. **Given** a buyer with insufficient funds or who rejects the confirmation prompt,
   **When** they attempt to purchase, **Then** the attempt fails gracefully with a
   readable message, the auction state is unchanged, and a retry path is available.
5. **Given** two buyers racing for the same auction, **When** both submit purchases,
   **Then** at most one succeeds, the loser is shown the "already sold" failure reason,
   and loses nothing beyond the network fee.
6. **Given** a wallet connected to a network other than the app's target network,
   **When** the visitor initiates any purchase or sale action, **Then** they are
   prompted to switch networks before any transaction is requested.
7. **Given** a connected session, **When** the visitor moves through any core flow
   (connect → view → buy, or mint → create), **Then** state persists across steps with
   no full page reload.
8. **Given** a buyer who initiated a purchase, **When** the wallet signature is
   requested, **Then** the app has already shown a plain-language summary of the
   action and the amount to be paid.
9. **Given** a keyboard-only user, **When** they move through connect → view → buy,
   **Then** every step is reachable and operable without a pointing device, and
   status changes are announced to assistive technology.

---

### User Story 2 - Mint an NFT and put it up for auction (Priority: P2)

A user connects their wallet, mints an NFT with their own metadata link, and creates a
Dutch auction for it by setting the starting price and discount rate. The auction goes
live immediately. If someone buys, the seller automatically receives the full winning
bid and the NFT leaves their wallet. If nobody buys, the seller can always get their
NFT back.

**Why this priority**: Supply side — auctions need sellers. It is the second slice
because buyers are the core experience, and a seeded auction is enough to test P1.

**Independent Test**: Connect a fresh wallet, mint an NFT with a metadata URI, create
an auction, confirm it appears as live; then either let it sell (seller receives exact
bid, buyer receives NFT) or let it expire unsold and reclaim the NFT.

**Acceptance Scenarios**:

1. **Given** a connected wallet, **When** the user mints an NFT with a metadata link,
   **Then** the wallet owns a new NFT whose metadata resolves to what they provided.
2. **Given** a wallet that owns an NFT, **When** the user creates an auction with a
   valid starting price, discount rate, and duration, **Then** the auction starts
   immediately at the starting price with the countdown running and the NFT escrowed
   for sale.
3. **Given** an invalid configuration where the price would fall below zero before the
   auction ends, **When** the user tries to create it, **Then** creation is rejected
   before any transaction with a plain-language reason naming the violated rule.
4. **Given** a live auction, **When** a buyer completes a purchase, **Then** the seller
   receives the full winning bid and the buyer receives the NFT atomically in the same
   purchase.
5. **Given** an unsold auction, **When** the seller cancels (before any sale) or the
   auction expires without a buyer, **Then** the seller can reclaim their NFT — the NFT
   is never permanently locked.
6. **Given** an owner who has not yet granted the one-time authorization required to
   place the NFT for sale, **When** they create an auction, **Then** the app guides
   them through the approval transaction first, and creation completes after approval.

---

### User Story 3 - Browse auctions and track outcomes (Priority: P3)

A visitor browses a list of auctions — live, sold, expired, cancelled — with NFT
previews and status, drills into any auction, and sees who won and at what price after
completion.

**Why this priority**: Discovery and transparency. Buyers can be pointed directly at an
auction link in v1, so the gallery improves reach but is not required for the core
purchase to work.

**Independent Test**: Open the app, find a live auction within a few interactions
without pasting any address, open it, and (after a sale elsewhere) see the completed
auction's final price and winner.

**Acceptance Scenarios**:

1. **Given** the app home, **When** a visitor looks at the auction list, **Then** live
   auctions are visible with NFT preview, current price, and time remaining.
2. **Given** a completed auction, **When** a visitor opens it, **Then** it shows either
   "sold at price P to buyer B" or "expired — unsold".
3. **Given** only ended auctions exist, **When** a visitor browses, **Then** filtering
   by status still works and no dead links or empty crashes occur.
4. **Given** the gallery API is unavailable, **When** a visitor opens the app, **Then**
   they see either on-chain-discovered auctions or a clearly labeled degraded view with
   a retry action — never silently stale data presented as current.

---

### Edge Cases

- **Price floor reached before expiry**: the price declines to zero (its floor) and
  must never display or charge a negative value; the auction remains purchasable at the
  floor until expiry.
- **Expiry with no buyer**: auction ends "expired — unsold"; the seller reclaims the
  NFT; buyers see a clear ended state and the buy action is disabled.
- **Concurrent purchases**: at most one purchase succeeds per auction; losers fail with
  a clear "already sold" message and lose nothing but the network fee.
- **Seller buys their own auction**: rejected with a clear message.
- **Wrong network**: visitor's wallet is on a different network than the app targets →
  the app prompts them to switch before any transaction.
- **Transaction rejected or failed in wallet**: UI returns to a consistent state, no
  partial "pending forever" states, auction data unchanged, retry offered.
- **Double-click / repeated buy taps**: only one purchase executes; duplicates are
  ignored or fail cleanly.
- **Auction expires while the page is open**: countdown reaches zero, current price
  display stops, buy action disables without reload.
- **Missing or unresolvable NFT metadata** (broken/unsupported URI): placeholder image
  and generic name shown; auction remains fully usable.
- **NFT not owned or not approved at auction creation**: creation fails with a clear
  explanation; nothing is escrowed.
- **Empty states**: no auctions exist at all, no live auctions exist, or a status
  filter matches nothing → a friendly empty state that names why it is empty and what
  to do next (e.g., "No live auctions yet — check back soon").

## Requirements *(mandatory)*

### Functional Requirements

**Wallet & network**

- **FR-001**: The app MUST be usable by any visitor with a browser wallet on the target
  public network (Sepolia testnet for v1), with no local blockchain, node, or
  command-line tooling required for end users.
- **FR-002**: Users MUST be able to connect and disconnect their wallet and see their
  address and active network; when connected to the wrong network, the app MUST prompt
  them to switch before allowing transactions; when the connected account holds no test
  ETH, the app MUST show a clear notice with guidance to a testnet faucet.
- **FR-003**: Every user-submitted transaction MUST surface a clear pending /
  success / failure state with a human-readable outcome. Each message MUST be plain
  language (no jargon, hex strings, or raw error codes), MUST state what happened and
  the next step (e.g., retry, return to gallery), and MUST be shown in context near the
  action until dismissed. A rejected or failed transaction MUST leave application and
  auction state unchanged, with a retry path available.

**Auction viewing & buying**

- **FR-004**: For each auction the app MUST display: NFT preview and metadata, seller,
  starting price, current price, discount rate, time remaining, and status
  (live / sold / expired / cancelled).
- **FR-005**: The current price MUST decline automatically over time according to the
  discount rate, update at least once per second (displayed value lags the true price
  by ≤ 1 second), require no manual refresh, and NEVER be displayed or charged below
  zero.
- **FR-006**: A connected buyer MUST be able to purchase a live auction's NFT by
  confirming a single payment of at least the current price; any overpayment MUST be
  returned to the buyer within the same purchase, and on success the NFT ownership
  transfers immediately.
- **FR-007**: A purchase MUST be rejected with a specific, human-readable reason (and
  no loss of funds beyond network fees) when: the auction has expired, the auction has
  already sold, the payment is below the current price, the buyer is the seller, or the
  wallet is on the wrong network.
- **FR-008**: The system MUST reject auction configurations in which the price would
  fall below zero before the auction's end (starting price less than
  discount rate × duration). A configuration that reaches exactly zero at the end
  (starting price == discount rate × duration) is valid.
- **FR-009**: At most one purchase may succeed per auction; concurrent purchase
  attempts MUST resolve with exactly one winner and no fund loss for the others.

**Selling**

- **FR-010**: A user MUST be able to mint an NFT into the collection by providing a
  metadata URI, and MUST end up as the owner of the newly minted token.
- **FR-011**: An owner MUST be able to create an auction for their NFT by setting the
  starting price, discount rate, and duration. Duration MUST be seller-configurable
  within inclusive bounds of 60 seconds to 30 days, defaulting to 5 minutes. The app
  MUST validate all inputs before submitting any transaction and show a plain-language
  reason for any invalid value. The app MUST guide the seller through the one-time NFT
  authorization step when required, before creation can complete. A valid auction goes
  live immediately at the starting price.
- **FR-012**: On a successful sale, the seller MUST receive the entire winning bid
  (no platform fee) and the buyer MUST receive the NFT as one atomic outcome.
- **FR-013**: A seller MUST be able to cancel an unsold auction before any sale, and
  MUST be able to reclaim the NFT after expiry with no buyer — the seller's NFT can
  NEVER be permanently locked by the system.

**Discovery & transparency**

- **FR-014**: The app MUST provide a browsable list of auctions with status
  (live / sold / expired / cancelled) so users can find auctions without pasting
  contract addresses, and MUST show explicit empty states (no auctions, no matches)
  as defined in Edge Cases.
- **FR-015**: After completion the app MUST show the auction outcome: sold price and
  winning buyer, or expired/cancelled with the seller named.

**User interface**

- **FR-016**: The UI MUST follow the reference design direction: ink-black canvas,
  hairline grid/border lines, a single ember-orange accent color reserved for primary
  actions, live status, and key highlights (at most one accent element per card or
  section), large bold white display headings, and clean sans-serif body text — a
  dark-only theme with no light mode in v1.
- **FR-017**: The core flows (connect wallet, view auction, buy, mint, create auction)
  MUST work on a desktop viewport without full page reloads between steps.
- **FR-018**: All core flows MUST be operable by keyboard alone; text and interactive
  controls MUST meet a minimum 4.5:1 contrast ratio against the ink-black background;
  wallet-connection and transaction status changes MUST be programmatically announced
  for screen-reader users.
- **FR-019**: Before requesting any wallet signature, the app MUST display a
  plain-language summary of the action and its value; external links derived from NFT
  metadata MUST open only on explicit user action, in a new tab with safe link
  attributes, and MUST never auto-execute.

**Resilience**

- **FR-020**: If the gallery API is unavailable, the app MUST fall back to on-chain
  discovery or present a clearly labeled degraded view with a retry action; if live
  chain reads fail, affected values MUST be labeled as possibly delayed rather than
  presented as current, and MUST NOT enable a purchase that would fail without
  explanation.

### Key Entities

- **NFT**: A unique token in the app's collection. Attributes: token ID, metadata URI
  (name, description, image), current owner. One token can be the subject of at most
  one active auction at a time.
- **Auction**: A timed sale of exactly one NFT. Attributes: NFT, seller, starting
  price, discount rate (price drop per second), start time, expiry time, status
  (live / sold / expired / cancelled), final sale price, winning buyer.
- **Wallet session**: The visitor's connection — address, active network, and their
  ability to approve transactions. The app never custodies keys or funds.
- **Transaction**: A user-approved action with a lifecycle of pending → success or
  failure, plus a human-readable result shown to the user.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A visitor with a funded wallet can go from opening the public URL (first
  page load) to their wallet being confirmed as owning the auctioned NFT in under
  2 minutes, with no developer tooling and no assistance (no documentation or support
  contact consulted).
- **SC-002**: The displayed current price reflects the true current price within
  1 second of change, with zero manual refreshes required, for 100% of viewing time.
- **SC-003**: 100% of purchases that overpay return the exact overpaid amount to the
  buyer within the same purchase.
- **SC-004**: Across all failed purchase attempts (rejections, races, insufficient
  funds, expiry), 0 users lose any funds beyond network fees.
- **SC-005**: The app is reachable at a public URL and fully usable by a newcomer with
  only a wallet — no local chain, install, or CLI — satisfying "anybody can use it".
- **SC-006**: In a scripted usability run with at least 10 participants who are new to
  the app, ≥ 90% complete their first purchase successfully on the first attempt.
- **SC-007**: Within one minute of a sale's transaction confirming, the app shows the
  completed sale (winner and price) and the buyer's wallet reports NFT ownership — for
  100% of sales. (Funds and the NFT transfer atomically at purchase time per FR-012;
  this criterion measures the visibility of that outcome.)
- **SC-008**: 100% of primary screens pass a design review against the reference:
  ink-black background, ember-orange accent only, hairline borders, bold white display
  type.
- **SC-009**: A user can reach any live auction from app entry in ≤ 3 interactions,
  where an interaction is one deliberate user input (a click or tap on a link or
  button that navigates or reveals the next step).
- **SC-010**: On a profiled test connection (≥ 10 Mbps down, ≤ 100 ms round-trip
  latency), the auction gallery's content appears within 2 seconds of page load in
  95% of loads, and a first-time seller completes mint → listed auction in under
  2 minutes.

## Assumptions

- v1 targets the Sepolia public testnet; any wallet holding Sepolia ETH (from a
  faucet) can participate. Mainnet and other chains are out of scope for v1.
- Auction duration is chosen by the seller at creation: 60 seconds to 30 days,
  defaulting to 5 minutes (the provided contract's original behavior) — see FR-011.
- Payment is in the native currency of the target network (e.g., ETH); no ERC-20
  payments, no platform fees — the seller receives the full winning bid.
- Both provided contracts are in scope: the app supports minting NFTs into the
  provided collection and creating Dutch auctions from them — the full mint → list →
  buy lifecycle.
- The provided contracts are a starting point, not a constraint: where their current
  behavior conflicts with this spec (e.g., no way to reclaim an unsold NFT, price
  calculation past expiry, example constructor values that cannot succeed), this spec
  wins and the behavior is corrected during planning.
- One auction per NFT at a time; a single collection is sufficient for v1.
- The seller flow (mint + create auction) is part of v1, not a later phase.
- NFT metadata URIs are supplied by the minter; the app renders images for resolvable
  HTTP/HTTPS/IPFS URIs and falls back to a placeholder otherwise.
- End users supply their own wallets and funds; the app custodies nothing.
- Supported environment for v1: desktop viewports ≥ 1280 px wide; viewports 768–1279 px
  and mobile are best-effort and not gated.
- Supported browsers/wallets: current desktop Chrome, Edge, Firefox, and Brave with
  EIP-1193 injected wallets (e.g., MetaMask, Rabby, Coinbase Wallet); other wallets via
  WalletConnect are best-effort.
- Chain data comes from third-party RPC providers configured by the app operator
  (trusted endpoints only — never derived from user input or NFT metadata); FR-020
  defines required behavior when they are unavailable or rate-limited.
- Target audience is general wallet-holding users; no accounts, sessions, or KYC.
- Out of scope for v1: mainnet/other chains, ERC-20 payments, platform fees or user
  accounts, multiple NFT collections, native mobile apps, email/push notifications,
  and automated relisting.

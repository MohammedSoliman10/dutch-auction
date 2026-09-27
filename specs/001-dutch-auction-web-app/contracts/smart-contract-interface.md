# Interface Contract: Smart Contracts (ABI Surface)

**Feature**: 001-dutch-auction-web-app | **Date**: 2026-09-27

Authoritative external surface consumed by the frontend (via @wagmi/cli codegen) and
the backend indexer (via viem ABIs). All functions carry NatSpec in source; all errors
are custom (no revert strings — Constitution I). Values are wei unless noted;
timestamps are unix seconds.

Normative source for validation rules, bounds, and error semantics: `data-model.md`
§1 (Validation Rules) — this document mirrors them for ABI consumption; keep in sync
on change.

Generated from forge artifacts (`out/`) — never hand-edited downstream.

---

## `DutchAuctionNFT` (ERC-721 collection)

Collection: name `"Soliman Web3"`, symbol `"SW3"`, OZ v5.7.0 `ERC721URIStorage`.

### Functions

```solidity
function mintNFT(string calldata jsonUri) external returns (uint256 tokenId);
```
- Mints to `msg.sender`, assigns next sequential id (from 0), stores metadata URI.
- Reverts: `EmptyURI()` when `jsonUri` is empty.
- Standard OZ surface also available: `ownerOf`, `balanceOf`, `tokenURI`, `approve`,
  `setApprovalForAll`, `getApproved`, `isApprovedForAll`.

### Events

- `Transfer(address indexed from, address indexed to, uint256 indexed tokenId)` (OZ)

### Errors

- `EmptyURI()`

---

## `AuctionFactory`

Registry + escrow intake. The one address deployed per network
(`deployments/<network>.json` → frontend/backend config).

### Constants

- `MIN_DURATION = 60` (seconds), `MAX_DURATION = 2_592_000` (30 days)

### Functions

```solidity
function createAuction(
    address nft,
    uint256 tokenId,
    uint256 startingPrice,
    uint256 discountRate,
    uint256 duration
) external returns (address auction);
```
- Precondition: caller owns `tokenId` and has approved the factory
  (`approve` or `setApprovalForAll`).
- Pulls the NFT from the caller via `safeTransferFrom` into the newly deployed
  `DutchAuction` (escrow), appends it to the registry, emits `AuctionCreated`.
- FR mapping: FR-008 (validation), FR-011 (seller-set params), FR-014 (registry +
  event).

```solidity
function auctionCount() external view returns (uint256);
function allAuctions(uint256 index) external view returns (address);
```

### Events

```solidity
event AuctionCreated(
    address indexed auction,
    address indexed seller,
    address indexed nft,
    uint256 tokenId,
    uint256 startingPrice,
    uint256 discountRate,
    uint256 duration,
    uint256 startAt,
    uint256 expiresAt
);
```

### Errors

- `InvalidDuration()` — outside `[MIN_DURATION, MAX_DURATION]`
- `InvalidPriceParams()` — `startingPrice == 0` or `discountRate == 0`
- `PriceWouldGoNegative()` — `startingPrice < discountRate × duration`
- `NotNftOwner()` — caller doesn't own `tokenId`
- `NotApproved()` — factory not approved over the NFT
- `ZeroAddress()` — `nft == address(0)`

---

## `DutchAuction` (one per sale, deployed by the factory)

### Immutable / public state

```solidity
address payable public immutable seller;
IERC721     public immutable nft;
uint256     public immutable nftId;
uint256     public immutable startingPrice;
uint256     public immutable discountRate;   // wei per second
uint256     public immutable duration;       // seconds
uint256     public immutable startAt;
uint256     public immutable expiresAt;      // startAt + duration
bool        public sold;                     // set exactly once, in buy()
bool        public cancelled;                // set only by cancel()
address     public buyer;                    // 0 until sold
uint256     public salePrice;                // 0 until sold
```

### Functions

```solidity
function getPrice() external view returns (uint256);
```
- `startingPrice − discountRate × min(now − startAt, duration)`, never below 0.
  Never reverts, including after `expiresAt` (FR-005).

```solidity
function buy() external payable;
```
- Guards, in order: `!sold` → `AlreadySold()`; `!cancelled` → `AlreadyCancelled()`;
  `now < expiresAt` → `AuctionExpired()`; `msg.sender != seller` →
  `SellerCannotBuy()` (FR-007); `msg.value >= getPrice()` →
  `InsufficientPayment(required, sent)` (FR-006).
- Effects then interactions (CEI + `ReentrancyGuard`): sets `sold/buyer/salePrice`,
  transfers the NFT to `msg.sender`, sends `price` to `seller`, refunds
  `msg.value − price` to `msg.sender` — all in one transaction (FR-012, SC-003).
  Either transfer failing reverts with `TransferFailed()` (no partial state —
  SC-004).

```solidity
function cancel() external;   // seller only, while LIVE (FR-013)
```
- Reverts `NotSeller()` / `NotLive()` (already sold, cancelled, or expired).
- Returns the escrowed NFT to the seller; emits `AuctionCancelled()`.

```solidity
function reclaim() external;  // seller only, after expiry (FR-013)
```
- Reverts `NotSeller()` / `AuctionNotExpired()` / `NotLive()`.
- Returns the escrowed NFT to the seller; emits `AuctionReclaimed()`.

```solidity
function onERC721Received(...) external pure returns (bytes4);  // IERC721Receiver
```
- Required because the factory escrows via `safeTransferFrom`.

### Events

```solidity
event AuctionSold(address indexed buyer, uint256 price);
event AuctionCancelled();
event AuctionReclaimed();
```

### Errors

`AlreadySold()`, `AlreadyCancelled()`, `AuctionExpired()`, `SellerCannotBuy()`,
`InsufficientPayment(uint256 required, uint256 sent)`, `NotSeller()`, `NotLive()`,
`AuctionNotExpired()`, `PriceWouldGoNegative()`, `InvalidDuration()`,
`TransferFailed()`

---

## Frontend hook mapping

| Concern | wagmi access |
|---------|--------------|
| Gallery | `GET /api/auctions` (backend); fallback: `readContract(Factory.allAuctions*)` |
| Live price ticker | local computation from immutable reads (R7) + periodic `getPrice()` refetch |
| Buy / cancel / reclaim | `writeContract` + `useTxFlow` transaction state machine |
| Mint / create | `writeContract(mintNFT)` / `writeContract(createAuction)` + approval flow (`approve`/`setApprovalForAll` detected pre-flight) |
| Status badge | derived per [data-model.md](../data-model.md) §1.2 |

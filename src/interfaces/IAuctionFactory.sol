// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

/// @title IAuctionFactory
/// @author Mohammed Soliman
/// @notice Registry + escrow intake for Dutch auctions: validates seller
///         parameters, pulls the NFT into per-auction escrow, deploys the
///         `DutchAuction`, and records it for trustless discovery (FR-014).
interface IAuctionFactory {
    // ────────────────────────────────────────────────────────────────────
    // Errors
    // ────────────────────────────────────────────────────────────────────

    /// @notice `duration` outside `[MIN_DURATION, MAX_DURATION]`.
    error InvalidDuration();

    /// @notice `startingPrice == 0` or `discountRate == 0`.
    error InvalidPriceParams();

    /// @notice `startingPrice < discountRate * duration` — price would decay below zero.
    error PriceWouldGoNegative();

    /// @notice Caller does not own `tokenId`.
    error NotNftOwner();

    /// @notice Factory not approved over the NFT (`approve`/`setApprovalForAll`).
    error NotApproved();

    /// @notice The provided NFT contract address is the zero address.
    error ZeroAddress();

    // ────────────────────────────────────────────────────────────────────
    // Events
    // ────────────────────────────────────────────────────────────────────

    /// @notice Emitted once per auction created — indexer + UI discovery source.
    /// @param auction The freshly deployed auction (escrow) contract.
    /// @param seller The seller (NFT owner at creation).
    /// @param nft The ERC-721 collection address.
    /// @param tokenId The token id being auctioned.
    /// @param startingPrice Price in wei at `startAt`.
    /// @param discountRate Price decay in wei per second.
    /// @param duration Auction length in seconds.
    /// @param startAt Creation timestamp (== block.timestamp at creation).
    /// @param expiresAt `startAt + duration`.
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

    // ────────────────────────────────────────────────────────────────────
    // Constants / registry
    // ────────────────────────────────────────────────────────────────────

    /// @notice Minimum auction duration in seconds (inclusive): 60.
    function MIN_DURATION() external view returns (uint256);

    /// @notice Maximum auction duration in seconds (inclusive): 2_592_000 (30 days).
    function MAX_DURATION() external view returns (uint256);

    /// @notice Number of auctions ever created (append-only registry length).
    function auctionCount() external view returns (uint256);

    /// @notice Address of the auction at registry position `index`.
    /// @param index Zero-based registry position, `< auctionCount()`.
    /// @return auction The auction contract address.
    function allAuctions(uint256 index) external view returns (address);

    // ────────────────────────────────────────────────────────────────────
    // Functions
    // ────────────────────────────────────────────────────────────────────

    /// @notice Validate parameters, pull the NFT into escrow, deploy the auction,
    ///         register it, and emit `AuctionCreated` (FR-008, FR-011, FR-014).
    /// @dev Caller must own `tokenId` and have approved this factory.
    ///      Reverts `ZeroAddress` / `NotNftOwner` / `NotApproved` /
    ///      `InvalidDuration` / `InvalidPriceParams` / `PriceWouldGoNegative`.
    /// @param nft ERC-721 collection of the token (not zero).
    /// @param tokenId Token id to auction.
    /// @param startingPrice Price in wei at creation (> 0).
    /// @param discountRate Decay in wei per second (>= 1).
    /// @param duration Seconds in `[60, 2_592_000]`.
    /// @return auction The newly deployed auction contract.
    function createAuction(
        address nft,
        uint256 tokenId,
        uint256 startingPrice,
        uint256 discountRate,
        uint256 duration
    ) external returns (address auction);
}

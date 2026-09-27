// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title IDutchAuction
/// @author Mohammed Soliman
/// @notice External surface of a single escrowed Dutch auction sale.
/// @dev Linear price decay: `startingPrice - discountRate * min(now - startAt,
///      duration)`, clamped at zero. Settlement is atomic (push refund + push
///      proceeds in `buy()`) under the constitution's settlement exception.
interface IDutchAuction {
    // ────────────────────────────────────────────────────────────────────
    // Errors
    // ────────────────────────────────────────────────────────────────────

    /// @notice The auction has already been sold.
    error AlreadySold();

    /// @notice The auction has already been cancelled by the seller.
    error AlreadyCancelled();

    /// @notice The auction expired; buying is no longer possible.
    error AuctionExpired();

    /// @notice The seller cannot buy their own auction.
    error SellerCannotBuy();

    /// @notice Payment below the current price.
    /// @param required The minimum price in wei at execution time.
    /// @param sent The wei amount sent by the buyer.
    error InsufficientPayment(uint256 required, uint256 sent);

    /// @notice Only the seller may perform this action.
    error NotSeller();

    /// @notice The auction is not in the LIVE state required for this action.
    error NotLive();

    /// @notice The auction has not reached `expiresAt` yet.
    error AuctionNotExpired();

    /// @notice `startingPrice < discountRate * duration` — price would decay below zero.
    error PriceWouldGoNegative();

    /// @notice `duration` outside `[MIN_DURATION, MAX_DURATION]`.
    error InvalidDuration();

    /// @notice An ETH or NFT transfer during settlement failed; the whole
    ///         transaction reverted (no partial state — SC-004).
    error TransferFailed();

    // ────────────────────────────────────────────────────────────────────
    // Events
    // ────────────────────────────────────────────────────────────────────

    /// @notice Emitted exactly once when the auction sells.
    /// @param buyer The winning buyer (recipient of the NFT).
    /// @param price The price paid in wei (already settled).
    event AuctionSold(address indexed buyer, uint256 price);

    /// @notice Emitted when the seller cancels a LIVE auction and reclaims the NFT.
    event AuctionCancelled();

    /// @notice Emitted when the seller reclaims the NFT after expiry.
    event AuctionReclaimed();

    // ────────────────────────────────────────────────────────────────────
    // Immutable / public state
    // ────────────────────────────────────────────────────────────────────

    /// @notice The seller who created the auction; receives proceeds.
    function seller() external view returns (address payable);

    /// @notice The ERC-721 collection being auctioned.
    function nft() external view returns (IERC721);

    /// @notice The token id within `nft`.
    function nftId() external view returns (uint256);

    /// @notice Price in wei at `startAt`.
    function startingPrice() external view returns (uint256);

    /// @notice Price decay in wei per second.
    function discountRate() external view returns (uint256);

    /// @notice Auction length in seconds.
    function duration() external view returns (uint256);

    /// @notice Creation timestamp (auction starts immediately).
    function startAt() external view returns (uint256);

    /// @notice `startAt + duration` — last instant to buy is `expiresAt - 1`.
    function expiresAt() external view returns (uint256);

    /// @notice True exactly once, set by `buy()`.
    function sold() external view returns (bool);

    /// @notice True once the seller cancels a LIVE auction.
    function cancelled() external view returns (bool);

    /// @notice The winner; zero address until sold.
    function buyer() external view returns (address);

    /// @notice Price paid in wei; zero until sold.
    function salePrice() external view returns (uint256);

    // ────────────────────────────────────────────────────────────────────
    // Functions
    // ────────────────────────────────────────────────────────────────────

    /// @notice Current price in wei, clamped at zero; never reverts, including
    ///         after expiry (FR-005).
    /// @return The price buyers must pay at `block.timestamp`.
    function getPrice() external view returns (uint256);

    /// @notice Buy the NFT at the current price; refunds any overpayment in
    ///         the same transaction (FR-006, FR-012).
    /// @dev Checks-effects-interactions with a reentrancy guard. Reverts with
    ///      `AlreadySold`, `AlreadyCancelled`, `AuctionExpired`,
    ///      `SellerCannotBuy`, `InsufficientPayment`, or `TransferFailed`.
    function buy() external payable;

    /// @notice Seller aborts a LIVE auction; escrowed NFT returns to seller (FR-013).
    /// @dev Reverts `NotSeller` / `NotLive`.
    function cancel() external;

    /// @notice Seller reclaims the NFT after expiry without a sale (FR-013).
    /// @dev Reverts `NotSeller` / `NotLive` / `AuctionNotExpired`.
    function reclaim() external;

    /// @notice Accepts the factory's escrow `safeTransferFrom`.
    /// @param operator The address that initiated the safe transfer (the factory).
    /// @param from The previous owner of the escrowed token (the seller).
    /// @param tokenId The id being transferred into escrow.
    /// @param data Extra data accompanying the transfer (empty by the factory).
    /// @return selector Always `this.onERC721Received.selector`.
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        pure
        returns (bytes4);
}

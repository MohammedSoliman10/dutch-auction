// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IDutchAuction} from "./interfaces/IDutchAuction.sol";
import {AuctionBounds} from "./libraries/AuctionBounds.sol";

/// @title DutchAuction
/// @author Mohammed Soliman
/// @notice One escrowed Dutch-auction sale of a single NFT: linear price decay,
///         atomic buy with exact overpay refund, seller cancel/reclaim.
/// @dev Deployed by `AuctionFactory`, which pulls the NFT into this contract at
///      creation. Settlement pushes proceeds/refunds inside `buy()` under the
///      constitution's settlement exception (CEI + reentrancy guard + fuzz and
///      invariant coverage — see constitution v1.1.0 §Toolchain & Safety).
contract DutchAuction is IDutchAuction, IERC721Receiver, ReentrancyGuard {
    // ────────────────────────────────────────────────────────────────────
    // Immutable sale terms
    // ────────────────────────────────────────────────────────────────────

    /// @inheritdoc IDutchAuction
    address payable public immutable override seller;

    /// @inheritdoc IDutchAuction
    IERC721 public immutable override nft;

    /// @inheritdoc IDutchAuction
    uint256 public immutable override nftId;

    /// @inheritdoc IDutchAuction
    uint256 public immutable override startingPrice;

    /// @inheritdoc IDutchAuction
    uint256 public immutable override discountRate;

    /// @inheritdoc IDutchAuction
    uint256 public immutable override duration;

    /// @inheritdoc IDutchAuction
    uint256 public immutable override startAt;

    /// @inheritdoc IDutchAuction
    uint256 public immutable override expiresAt;

    // ────────────────────────────────────────────────────────────────────
    // Mutable sale state
    // ────────────────────────────────────────────────────────────────────

    /// @inheritdoc IDutchAuction
    bool public override sold;

    /// @inheritdoc IDutchAuction
    bool public override cancelled;

    /// @inheritdoc IDutchAuction
    address public override buyer;

    /// @inheritdoc IDutchAuction
    uint256 public override salePrice;

    /// @notice True once the escrowed NFT has left this contract via `cancel()`
    ///         or `reclaim()` — prevents a second return attempt with
    ///         non-custom errors.
    bool private nftReturned;

    // ────────────────────────────────────────────────────────────────────
    // Construction
    // ────────────────────────────────────────────────────────────────────

    /// @notice Deploys an auction that starts immediately at `block.timestamp`.
    /// @dev Revalidates the factory's bounds so the auction is safe even if
    ///      deployed by another (non-conforming) factory.
    /// @param seller_ Seller receiving proceeds; NFT owner at creation.
    /// @param nft_ ERC-721 collection (validated by the factory).
    /// @param nftId_ Token id being auctioned.
    /// @param startingPrice_ Price in wei at creation (> 0).
    /// @param discountRate_ Decay in wei per second (>= 1).
    /// @param duration_ Seconds in `[60, 2_592_000]`.
    constructor(
        address payable seller_,
        IERC721 nft_,
        uint256 nftId_,
        uint256 startingPrice_,
        uint256 discountRate_,
        uint256 duration_
    ) {
        if (duration_ < AuctionBounds.MIN_DURATION || duration_ > AuctionBounds.MAX_DURATION) {
            revert InvalidDuration();
        }
        // Overflowing rate * duration means the product exceeds any possible
        // startingPrice — same semantics as a negative decay floor.
        if (discountRate_ != 0 && duration_ > type(uint256).max / discountRate_) {
            revert PriceWouldGoNegative();
        }
        if (startingPrice_ < discountRate_ * duration_) {
            revert PriceWouldGoNegative();
        }

        seller = seller_;
        nft = nft_;
        nftId = nftId_;
        startingPrice = startingPrice_;
        discountRate = discountRate_;
        duration = duration_;
        startAt = block.timestamp;
        expiresAt = block.timestamp + duration_;
    }

    // ────────────────────────────────────────────────────────────────────
    // Views
    // ────────────────────────────────────────────────────────────────────

    /// @inheritdoc IDutchAuction
    function getPrice() public view returns (uint256) {
        uint256 elapsed = block.timestamp - startAt;
        if (elapsed > duration) {
            elapsed = duration;
        }
        // Constructor guaranteed startingPrice >= discountRate * duration, so
        // this never underflows and the floor is >= 0 (FR-005).
        return startingPrice - discountRate * elapsed;
    }

    // ────────────────────────────────────────────────────────────────────
    // Settlement
    // ────────────────────────────────────────────────────────────────────

    /// @inheritdoc IDutchAuction
    function buy() external payable nonReentrant {
        if (sold) {
            revert AlreadySold();
        }
        if (cancelled) {
            revert AlreadyCancelled();
        }
        if (block.timestamp >= expiresAt) {
            revert AuctionExpired();
        }
        if (msg.sender == seller) {
            revert SellerCannotBuy();
        }

        uint256 price = getPrice();
        if (msg.value < price) {
            revert InsufficientPayment(price, msg.value);
        }

        // ── Effects ─────────────────────────────────────────────────────
        sold = true;
        buyer = msg.sender;
        salePrice = price;
        emit AuctionSold(msg.sender, price);

        // ── Interactions (all-or-nothing; any failure reverts everything,
        //    incl. the effects above — SC-004) ──────────────────────────
        nft.transferFrom(address(this), msg.sender, nftId);

        (bool sellerPaid,) = payable(seller).call{value: price}("");
        if (!sellerPaid) {
            revert TransferFailed();
        }

        uint256 refund = msg.value - price;
        if (refund > 0) {
            (bool refunded,) = payable(msg.sender).call{value: refund}("");
            if (!refunded) {
                revert TransferFailed();
            }
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // Seller recovery
    // ────────────────────────────────────────────────────────────────────

    /// @inheritdoc IDutchAuction
    function cancel() external nonReentrant {
        if (msg.sender != seller) {
            revert NotSeller();
        }
        if (sold || cancelled || nftReturned || block.timestamp >= expiresAt) {
            revert NotLive();
        }

        cancelled = true;
        nftReturned = true;
        nft.transferFrom(address(this), seller, nftId);
        emit AuctionCancelled();
    }

    /// @inheritdoc IDutchAuction
    function reclaim() external nonReentrant {
        if (msg.sender != seller) {
            revert NotSeller();
        }
        if (sold || cancelled || nftReturned) {
            revert NotLive();
        }
        if (block.timestamp < expiresAt) {
            revert AuctionNotExpired();
        }

        nftReturned = true;
        nft.transferFrom(address(this), seller, nftId);
        emit AuctionReclaimed();
    }

    // ────────────────────────────────────────────────────────────────────
    // ERC-721 receiver (factory escrow)
    // ────────────────────────────────────────────────────────────────────

    /// @inheritdoc IDutchAuction
    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        override(IDutchAuction, IERC721Receiver)
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {IAuctionFactory} from "./interfaces/IAuctionFactory.sol";
import {AuctionBounds} from "./libraries/AuctionBounds.sol";
import {DutchAuction} from "./DutchAuction.sol";

/// @title AuctionFactory
/// @author Mohammed Soliman
/// @notice Registry + escrow intake: validates seller parameters, pulls the NFT
///         into a freshly deployed `DutchAuction`, and records it for trustless
///         discovery (FR-008, FR-011, FR-014).
/// @dev One factory per network; its address ships in `deployments/<network>.json`.
contract AuctionFactory is IAuctionFactory {
    // ────────────────────────────────────────────────────────────────────
    // Registry
    // ────────────────────────────────────────────────────────────────────

    /// @dev Append-only registry backing `allAuctions` / `auctionCount`.
    address[] private registry;

    // ────────────────────────────────────────────────────────────────────
    // Constants
    // ────────────────────────────────────────────────────────────────────

    /// @inheritdoc IAuctionFactory
    function MIN_DURATION() external pure returns (uint256) {
        return AuctionBounds.MIN_DURATION;
    }

    /// @inheritdoc IAuctionFactory
    function MAX_DURATION() external pure returns (uint256) {
        return AuctionBounds.MAX_DURATION;
    }

    // ────────────────────────────────────────────────────────────────────
    // Registry views
    // ────────────────────────────────────────────────────────────────────

    /// @inheritdoc IAuctionFactory
    function auctionCount() external view returns (uint256) {
        return registry.length;
    }

    /// @inheritdoc IAuctionFactory
    function allAuctions(uint256 index) external view returns (address) {
        return registry[index];
    }

    // ────────────────────────────────────────────────────────────────────
    // Auction creation
    // ────────────────────────────────────────────────────────────────────

    /// @inheritdoc IAuctionFactory
    function createAuction(
        address nft,
        uint256 tokenId,
        uint256 startingPrice,
        uint256 discountRate,
        uint256 duration
    ) external returns (address auctionAddr) {
        // ── Validation (data-model §1.2, in single-fault order) ─────────
        if (nft == address(0)) {
            revert ZeroAddress();
        }
        if (duration < AuctionBounds.MIN_DURATION || duration > AuctionBounds.MAX_DURATION) {
            revert InvalidDuration();
        }
        if (startingPrice == 0 || discountRate == 0) {
            revert InvalidPriceParams();
        }
        // Overflowing rate * duration exceeds any possible startingPrice —
        // same semantics as PriceWouldGoNegative, before the multiply.
        if (duration > type(uint256).max / discountRate) {
            revert PriceWouldGoNegative();
        }
        if (startingPrice < discountRate * duration) {
            revert PriceWouldGoNegative();
        }

        IERC721 token = IERC721(nft);
        if (token.ownerOf(tokenId) != msg.sender) {
            revert NotNftOwner();
        }
        if (
            token.getApproved(tokenId) != address(this)
                && !token.isApprovedForAll(msg.sender, address(this))
        ) {
            revert NotApproved();
        }

        // ── Deploy auction, then escrow via one seller approval ─────────
        DutchAuction created = new DutchAuction(
            payable(msg.sender), token, tokenId, startingPrice, discountRate, duration
        );
        token.safeTransferFrom(msg.sender, address(created), tokenId);

        // ── Register + announce ─────────────────────────────────────────
        registry.push(address(created));
        emit AuctionCreated(
            address(created),
            msg.sender,
            nft,
            tokenId,
            startingPrice,
            discountRate,
            duration,
            created.startAt(),
            created.expiresAt()
        );

        return address(created);
    }
}

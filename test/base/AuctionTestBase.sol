// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";

import {AuctionFactory} from "../../src/AuctionFactory.sol";
import {DutchAuction} from "../../src/DutchAuction.sol";
import {DutchAuctionNFT} from "../../src/DutchAuctionNFT.sol";

/// @title AuctionTestBase
/// @author Mohammed Soliman
/// @notice Shared fixture: deploys `DutchAuctionNFT` + `AuctionFactory`, sets up
///         actors (seller / buyer / second buyer), and provides helpers for
///         time travel and valid auction creation.
abstract contract AuctionTestBase is Test {
    // Actors (unique labels → unique addresses)
    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");
    address internal buyer2 = makeAddr("buyer2");
    address internal stranger = makeAddr("stranger");

    // Contracts under test
    DutchAuctionNFT internal nft;
    AuctionFactory internal factory;

    // Valid default parameters: startingPrice (1 ETH) fully covers
    // discountRate * duration (0.001 ETH/s * 300 s = 0.3 ETH), floor = 0.7 ETH.
    uint256 internal constant DEFAULT_STARTING_PRICE = 1 ether;
    uint256 internal constant DEFAULT_DISCOUNT_RATE = 0.001 ether; // 1e15 wei/s
    uint256 internal constant DEFAULT_DURATION = 300;
    string internal constant DEFAULT_URI = "ipfs://QmDefault";

    function setUp() public virtual {
        vm.deal(seller, 100 ether);
        vm.deal(buyer, 100 ether);
        vm.deal(buyer2, 100 ether);
        vm.deal(stranger, 100 ether);

        nft = new DutchAuctionNFT();
        factory = new AuctionFactory();
    }

    // ────────────────────────────────────────────────────────────────────
    // Helpers
    // ────────────────────────────────────────────────────────────────────

    /// @notice Mint one token to the seller (next sequential id).
    function mintToSeller() internal returns (uint256 tokenId) {
        vm.startPrank(seller);
        tokenId = nft.mintNFT(DEFAULT_URI);
        vm.stopPrank();
    }

    /// @notice Approve the factory for `tokenId` (held by `owner`).
    function approveFactory(address owner, uint256 tokenId) internal {
        vm.prank(owner);
        nft.approve(address(factory), tokenId);
    }

    /// @notice Create an auction with default valid parameters for `tokenId`
    ///         (caller must already own + have approved it).
    function createAuctionWith(uint256 tokenId) internal returns (address auctionAddr) {
        vm.prank(seller);
        auctionAddr = factory.createAuction(
            address(nft), tokenId, DEFAULT_STARTING_PRICE, DEFAULT_DISCOUNT_RATE, DEFAULT_DURATION
        );
    }

    /// @notice Mint + approve + create in one step; returns the auction address.
    function createDefaultAuction() internal returns (address auctionAddr) {
        uint256 tokenId = mintToSeller();
        approveFactory(seller, tokenId);
        auctionAddr = createAuctionWith(tokenId);
    }

    /// @notice Typed accessor for an auction address.
    function asAuction(address auctionAddr) internal pure returns (DutchAuction) {
        return DutchAuction(auctionAddr);
    }
}

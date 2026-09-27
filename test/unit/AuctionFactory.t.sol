// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Vm} from "forge-std/Vm.sol";

import {AuctionTestBase} from "../base/AuctionTestBase.sol";
import {IAuctionFactory} from "../../src/interfaces/IAuctionFactory.sol";
import {AuctionFactory} from "../../src/AuctionFactory.sol";

/// @title AuctionFactoryTest
/// @notice RED suite for `AuctionFactory`: validation table (data-model §1.2),
///         escrow pull, registry append, and `AuctionCreated` semantics (FR-008,
///         FR-011, FR-014).
contract AuctionFactoryTest is AuctionTestBase {
    bytes32 internal constant AUCTION_CREATED_TOPIC = keccak256(
        "AuctionCreated(address,address,address,uint256,uint256,uint256,uint256,uint256,uint256)"
    );

    // ────────────────────────────────────────────────────────────────────
    // Duration bounds — inclusive [60, 2_592_000] (FR-011)
    // ────────────────────────────────────────────────────────────────────

    function test_Create_RevertsWhenDurationBelowMinimum() public {
        uint256 tokenId = mintToSeller();
        approveFactory(seller, tokenId);

        vm.expectRevert(IAuctionFactory.InvalidDuration.selector);
        vm.prank(seller);
        factory.createAuction(
            address(nft), tokenId, DEFAULT_STARTING_PRICE, DEFAULT_DISCOUNT_RATE, 59
        );
    }

    function test_Create_RevertsWhenDurationAboveMaximum() public {
        uint256 tokenId = mintToSeller();
        approveFactory(seller, tokenId);

        vm.expectRevert(IAuctionFactory.InvalidDuration.selector);
        vm.prank(seller);
        factory.createAuction(
            address(nft), tokenId, DEFAULT_STARTING_PRICE, DEFAULT_DISCOUNT_RATE, 2_592_001
        );
    }

    function test_Create_DurationBoundsAreInclusive() public {
        uint256 idMin = mintToSeller();
        approveFactory(seller, idMin);
        vm.prank(seller);
        address aMin = factory.createAuction(
            address(nft), idMin, DEFAULT_DISCOUNT_RATE * 60, DEFAULT_DISCOUNT_RATE, 60
        );
        assertEq(asAuction(aMin).duration(), 60);

        uint256 idMax = mintToSeller();
        approveFactory(seller, idMax);
        vm.prank(seller);
        address aMax = factory.createAuction(
            address(nft), idMax, DEFAULT_DISCOUNT_RATE * 2_592_000, DEFAULT_DISCOUNT_RATE, 2_592_000
        );
        assertEq(asAuction(aMax).duration(), 2_592_000);
    }

    // ────────────────────────────────────────────────────────────────────
    // Price parameter validation (FR-008, FR-011)
    // ────────────────────────────────────────────────────────────────────

    function test_Create_RevertsWhenStartingPriceZero() public {
        uint256 tokenId = mintToSeller();
        approveFactory(seller, tokenId);

        vm.expectRevert(IAuctionFactory.InvalidPriceParams.selector);
        vm.prank(seller);
        factory.createAuction(address(nft), tokenId, 0, DEFAULT_DISCOUNT_RATE, DEFAULT_DURATION);
    }

    function test_Create_RevertsWhenDiscountRateZero() public {
        uint256 tokenId = mintToSeller();
        approveFactory(seller, tokenId);

        vm.expectRevert(IAuctionFactory.InvalidPriceParams.selector);
        vm.prank(seller);
        factory.createAuction(address(nft), tokenId, DEFAULT_STARTING_PRICE, 0, DEFAULT_DURATION);
    }

    function test_Create_RevertsWhenPriceWouldGoNegative() public {
        uint256 tokenId = mintToSeller();
        approveFactory(seller, tokenId);

        // startingPrice one wei short of full decay.
        vm.expectRevert(IAuctionFactory.PriceWouldGoNegative.selector);
        vm.prank(seller);
        factory.createAuction(
            address(nft),
            tokenId,
            DEFAULT_DISCOUNT_RATE * DEFAULT_DURATION - 1,
            DEFAULT_DISCOUNT_RATE,
            DEFAULT_DURATION
        );
    }

    /// @dev FR-008: equality is VALID — startingPrice == discountRate * duration.
    function test_Create_EqualityStartingPriceIsValid() public {
        uint256 tokenId = mintToSeller();
        approveFactory(seller, tokenId);

        vm.prank(seller);
        address auctionAddr = factory.createAuction(
            address(nft),
            tokenId,
            DEFAULT_DISCOUNT_RATE * DEFAULT_DURATION,
            DEFAULT_DISCOUNT_RATE,
            DEFAULT_DURATION
        );
        assertEq(asAuction(auctionAddr).startingPrice(), DEFAULT_DISCOUNT_RATE * DEFAULT_DURATION);
    }

    // ────────────────────────────────────────────────────────────────────
    // Ownership / approval / zero address
    // ────────────────────────────────────────────────────────────────────

    function test_Create_RevertsWhenCallerDoesNotOwnToken() public {
        uint256 tokenId = mintToSeller();
        approveFactory(seller, tokenId);

        vm.expectRevert(IAuctionFactory.NotNftOwner.selector);
        vm.prank(stranger);
        factory.createAuction(
            address(nft), tokenId, DEFAULT_STARTING_PRICE, DEFAULT_DISCOUNT_RATE, DEFAULT_DURATION
        );
    }

    function test_Create_RevertsWhenNotApproved() public {
        uint256 tokenId = mintToSeller(); // owned by seller, factory NOT approved

        vm.expectRevert(IAuctionFactory.NotApproved.selector);
        vm.prank(seller);
        factory.createAuction(
            address(nft), tokenId, DEFAULT_STARTING_PRICE, DEFAULT_DISCOUNT_RATE, DEFAULT_DURATION
        );
    }

    function test_Create_RevertsWhenNftAddressZero() public {
        vm.expectRevert(IAuctionFactory.ZeroAddress.selector);
        vm.prank(seller);
        factory.createAuction(
            address(0), 0, DEFAULT_STARTING_PRICE, DEFAULT_DISCOUNT_RATE, DEFAULT_DURATION
        );
    }

    // ────────────────────────────────────────────────────────────────────
    // Escrow + registry + event (FR-011, FR-014)
    // ────────────────────────────────────────────────────────────────────

    function test_Create_PullsNftIntoAuctionEscrow() public {
        uint256 tokenId = mintToSeller();
        approveFactory(seller, tokenId);

        vm.prank(seller);
        address auctionAddr = factory.createAuction(
            address(nft), tokenId, DEFAULT_STARTING_PRICE, DEFAULT_DISCOUNT_RATE, DEFAULT_DURATION
        );

        assertEq(nft.ownerOf(tokenId), auctionAddr, "NFT must be escrowed by the auction");
        assertEq(asAuction(auctionAddr).nftId(), tokenId);
        assertEq(asAuction(auctionAddr).seller(), seller);
    }

    function test_Create_AppendsToRegistry() public {
        assertEq(factory.auctionCount(), 0);

        address first = createDefaultAuction();
        assertEq(factory.auctionCount(), 1);
        assertEq(factory.allAuctions(0), first);

        address second = createDefaultAuction();
        assertEq(factory.auctionCount(), 2);
        assertEq(factory.allAuctions(1), second);
    }

    function test_Create_EmitsAuctionCreated_WithExactArguments() public {
        uint256 tokenId = mintToSeller();
        approveFactory(seller, tokenId);

        vm.recordLogs();
        vm.warp(1_000_000);
        vm.prank(seller);
        address auctionAddr = factory.createAuction(
            address(nft), tokenId, DEFAULT_STARTING_PRICE, DEFAULT_DISCOUNT_RATE, DEFAULT_DURATION
        );

        (, uint256 startAt, uint256 expiresAt) = _assertCreatedEvent(auctionAddr, tokenId);

        assertEq(startAt, 1_000_000, "startAt must equal block.timestamp at creation");
        assertEq(expiresAt, 1_000_000 + DEFAULT_DURATION, "expiresAt must equal startAt + duration");
        assertEq(asAuction(auctionAddr).startAt(), startAt);
        assertEq(asAuction(auctionAddr).expiresAt(), expiresAt);
    }

    function test_Create_AuctionStartsImmediatelyLive() public {
        address auctionAddr = createDefaultAuction();
        assertFalse(asAuction(auctionAddr).sold());
        assertFalse(asAuction(auctionAddr).cancelled());
        assertEq(asAuction(auctionAddr).getPrice(), DEFAULT_STARTING_PRICE);
    }

    // ────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ────────────────────────────────────────────────────────────────────

    /// @dev Asserts a single AuctionCreated log with exact indexed args; returns
    ///      (auction, startAt, expiresAt) decoded from data.
    function _assertCreatedEvent(address auctionAddr, uint256 tokenId)
        internal
        view
        returns (address, uint256, uint256)
    {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(factory) || logs[i].topics[0] != AUCTION_CREATED_TOPIC) {
                continue;
            }
            found = true;
            assertEq(logs[i].topics.length, 4, "3 indexed args expected");
            assertEq(address(uint160(uint256(logs[i].topics[1]))), auctionAddr, "topic: auction");
            assertEq(address(uint160(uint256(logs[i].topics[2]))), seller, "topic: seller");
            assertEq(address(uint160(uint256(logs[i].topics[3]))), address(nft), "topic: nft");

            (
                uint256 evTokenId,
                uint256 startingPrice,
                uint256 discountRate,
                uint256 duration,
                uint256 startAt,
                uint256 expiresAt
            ) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256, uint256, uint256));

            assertEq(evTokenId, tokenId, "data: tokenId");
            assertEq(startingPrice, DEFAULT_STARTING_PRICE, "data: startingPrice");
            assertEq(discountRate, DEFAULT_DISCOUNT_RATE, "data: discountRate");
            assertEq(duration, DEFAULT_DURATION, "data: duration");
            return (auctionAddr, startAt, expiresAt);
        }
        assertTrue(found, "AuctionCreated event missing");
        return (auctionAddr, 0, 0);
    }

    // ────────────────────────────────────────────────────────────────────
    // T069 coverage additions: constants, alternate approval, overflow guard
    // ────────────────────────────────────────────────────────────────────

    function test_Constants_ExposeDurationBounds() public view {
        assertEq(factory.MIN_DURATION(), 60);
        assertEq(factory.MAX_DURATION(), 2_592_000);
    }

    function test_Create_SucceedsWithSetApprovalForAll() public {
        uint256 tokenId = mintToSeller();
        vm.prank(seller);
        nft.setApprovalForAll(address(factory), true);

        vm.prank(seller);
        address auctionAddr = factory.createAuction(
            address(nft), tokenId, DEFAULT_STARTING_PRICE, DEFAULT_DISCOUNT_RATE, DEFAULT_DURATION
        );
        assertEq(nft.ownerOf(tokenId), auctionAddr);
        assertEq(asAuction(auctionAddr).seller(), seller);
    }

    function test_Create_RevertsWhenRateDurationProductOverflows() public {
        uint256 tokenId = mintToSeller();
        approveFactory(seller, tokenId);

        vm.expectRevert(IAuctionFactory.PriceWouldGoNegative.selector);
        vm.prank(seller);
        factory.createAuction(address(nft), tokenId, type(uint256).max, type(uint256).max, 60);
    }
}

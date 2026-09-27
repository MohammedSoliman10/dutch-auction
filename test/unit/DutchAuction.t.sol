// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {AuctionTestBase} from "../base/AuctionTestBase.sol";
import {IDutchAuction} from "../../src/interfaces/IDutchAuction.sol";
import {DutchAuction} from "../../src/DutchAuction.sol";

/// @title DutchAuctionTest
/// @notice RED suite for `DutchAuction`: price decay + clamping (FR-005), buy
///         guards (FR-006/007/009), atomic settlement + exact refund (FR-006,
///         SC-003), and cancel/reclaim transitions (FR-013).
contract DutchAuctionTest is AuctionTestBase {
    address internal auctionAddr;
    DutchAuction internal auction;

    function setUp() public override {
        super.setUp();
        auctionAddr = createDefaultAuction();
        auction = asAuction(auctionAddr);
    }

    // ────────────────────────────────────────────────────────────────────
    // Price decay & clamping (FR-005)
    // ────────────────────────────────────────────────────────────────────

    function test_GetPrice_AtStart_EqualsStartingPrice() public view {
        assertEq(auction.getPrice(), DEFAULT_STARTING_PRICE);
    }

    function test_GetPrice_DecaysLinearly() public {
        vm.warp(auction.startAt() + 100);
        uint256 expected = DEFAULT_STARTING_PRICE - DEFAULT_DISCOUNT_RATE * 100;
        assertEq(auction.getPrice(), expected);
    }

    function test_GetPrice_AtFullDecay_EqualsFloor() public {
        vm.warp(auction.startAt() + DEFAULT_DURATION);
        uint256 floorPrice = DEFAULT_STARTING_PRICE - DEFAULT_DISCOUNT_RATE * DEFAULT_DURATION;
        assertEq(auction.getPrice(), floorPrice);
    }

    /// @dev Equality parameters (startingPrice == discountRate * duration) are
    ///      valid (FR-008) and must clamp at exactly zero — never below.
    function test_GetPrice_ClampsAtZero_NeverNegative() public {
        address eqAddr = _createEqualityAuction();
        DutchAuction eqAuction = asAuction(eqAddr);

        vm.warp(eqAuction.expiresAt());
        assertEq(eqAuction.getPrice(), 0);

        vm.warp(eqAuction.expiresAt() + 10_000);
        assertEq(eqAuction.getPrice(), 0);
    }

    function test_GetPrice_AfterExpiry_DoesNotRevert() public {
        vm.warp(auction.expiresAt() + 1 days);
        uint256 floorPrice = DEFAULT_STARTING_PRICE - DEFAULT_DISCOUNT_RATE * DEFAULT_DURATION;
        assertEq(auction.getPrice(), floorPrice);
    }

    // ────────────────────────────────────────────────────────────────────
    // buy() guards — custom errors per data-model §1.2
    // ────────────────────────────────────────────────────────────────────

    function test_Buy_RevertsWhenSold_SecondBuyerGetsAlreadySold() public {
        vm.prank(buyer);
        auction.buy{value: DEFAULT_STARTING_PRICE}();

        vm.expectRevert(IDutchAuction.AlreadySold.selector);
        vm.prank(buyer2);
        auction.buy{value: DEFAULT_STARTING_PRICE}();
    }

    function test_Buy_RevertsWhenCancelled() public {
        vm.prank(seller);
        auction.cancel();

        vm.expectRevert(IDutchAuction.AlreadyCancelled.selector);
        vm.prank(buyer);
        auction.buy{value: DEFAULT_STARTING_PRICE}();
    }

    function test_Buy_RevertsAtAndAfterExpiry() public {
        vm.warp(auction.expiresAt());

        vm.expectRevert(IDutchAuction.AuctionExpired.selector);
        vm.prank(buyer);
        auction.buy{value: DEFAULT_STARTING_PRICE}();
    }

    function test_Buy_RevertsWhenSellerIsBuyer() public {
        vm.expectRevert(IDutchAuction.SellerCannotBuy.selector);
        vm.prank(seller);
        auction.buy{value: DEFAULT_STARTING_PRICE}();
    }

    function test_Buy_RevertsOnInsufficientPayment_WithExactArgs() public {
        vm.warp(auction.startAt() + 100);
        uint256 required = auction.getPrice();
        uint256 sent = required - 1;

        vm.expectRevert(
            abi.encodeWithSelector(IDutchAuction.InsufficientPayment.selector, required, sent)
        );
        vm.prank(buyer);
        auction.buy{value: sent}();
    }

    // ────────────────────────────────────────────────────────────────────
    // Atomic settlement (FR-006, FR-012, SC-003, SC-004)
    // ────────────────────────────────────────────────────────────────────

    function test_Buy_ExactPayment_SettlesAtomically() public {
        vm.warp(auction.startAt() + 50);
        uint256 price = auction.getPrice();

        uint256 sellerBefore = seller.balance;

        vm.prank(buyer);
        auction.buy{value: price}();

        assertTrue(auction.sold());
        assertEq(auction.buyer(), buyer);
        assertEq(auction.salePrice(), price);
        assertEq(nft.ownerOf(auction.nftId()), buyer);
        assertEq(seller.balance, sellerBefore + price);
        assertEq(address(auction).balance, 0);
    }

    function test_Buy_Overpay_RefundsExactlyInSameTransaction() public {
        vm.warp(auction.startAt() + 77);
        uint256 price = auction.getPrice();
        uint256 overpay = 0.5 ether;

        uint256 buyerBefore = buyer.balance;
        uint256 sellerBefore = seller.balance;

        vm.prank(buyer);
        auction.buy{value: price + overpay}();

        // Buyer pays exactly the price; the overpay came back (SC-003).
        assertEq(buyer.balance, buyerBefore - price);
        assertEq(seller.balance, sellerBefore + price);
        assertEq(address(auction).balance, 0);
    }

    function test_Buy_EmitsAuctionSold() public {
        vm.warp(auction.startAt() + 10);
        uint256 price = auction.getPrice();

        vm.expectEmit(true, false, false, true, auctionAddr);
        emit IDutchAuction.AuctionSold(buyer, price);

        vm.prank(buyer);
        auction.buy{value: price}();
    }

    function test_Buy_FloorPricePurchasable_JustBeforeExpiry() public {
        vm.warp(auction.expiresAt() - 1);
        uint256 price = auction.getPrice();

        vm.prank(buyer);
        auction.buy{value: price}();

        assertTrue(auction.sold());
    }

    // ────────────────────────────────────────────────────────────────────
    // cancel() (FR-013)
    // ────────────────────────────────────────────────────────────────────

    function test_Cancel_BySeller_ReturnsNftAndEmits() public {
        vm.expectEmit(true, false, false, true, auctionAddr);
        emit IDutchAuction.AuctionCancelled();

        vm.prank(seller);
        auction.cancel();

        assertTrue(auction.cancelled());
        assertEq(nft.ownerOf(auction.nftId()), seller);
    }

    function test_Cancel_ThenBuy_RevertsAlreadyCancelled() public {
        vm.prank(seller);
        auction.cancel();

        vm.expectRevert(IDutchAuction.AlreadyCancelled.selector);
        vm.prank(buyer);
        auction.buy{value: DEFAULT_STARTING_PRICE}();
    }

    function test_Cancel_ByNonSeller_RevertsNotSeller() public {
        vm.expectRevert(IDutchAuction.NotSeller.selector);
        vm.prank(stranger);
        auction.cancel();
    }

    function test_Cancel_AfterSold_RevertsNotLive() public {
        vm.prank(buyer);
        auction.buy{value: DEFAULT_STARTING_PRICE}();

        vm.expectRevert(IDutchAuction.NotLive.selector);
        vm.prank(seller);
        auction.cancel();
    }

    function test_Cancel_AfterExpiry_RevertsNotLive() public {
        vm.warp(auction.expiresAt());

        vm.expectRevert(IDutchAuction.NotLive.selector);
        vm.prank(seller);
        auction.cancel();
    }

    function test_Cancel_Twice_RevertsNotLive() public {
        vm.prank(seller);
        auction.cancel();

        vm.expectRevert(IDutchAuction.NotLive.selector);
        vm.prank(seller);
        auction.cancel();
    }

    // ────────────────────────────────────────────────────────────────────
    // reclaim() (FR-013)
    // ────────────────────────────────────────────────────────────────────

    function test_Reclaim_BySellerAfterExpiry_ReturnsNftAndEmits() public {
        vm.warp(auction.expiresAt());

        vm.expectEmit(true, false, false, true, auctionAddr);
        emit IDutchAuction.AuctionReclaimed();

        vm.prank(seller);
        auction.reclaim();

        assertEq(nft.ownerOf(auction.nftId()), seller);
        assertFalse(auction.cancelled()); // status stays EXPIRED, not CANCELLED
        assertFalse(auction.sold());
    }

    function test_Reclaim_BeforeExpiry_RevertsAuctionNotExpired() public {
        vm.expectRevert(IDutchAuction.AuctionNotExpired.selector);
        vm.prank(seller);
        auction.reclaim();
    }

    function test_Reclaim_ByNonSeller_RevertsNotSeller() public {
        vm.warp(auction.expiresAt());

        vm.expectRevert(IDutchAuction.NotSeller.selector);
        vm.prank(stranger);
        auction.reclaim();
    }

    function test_Reclaim_AfterCancel_RevertsNotLive() public {
        vm.prank(seller);
        auction.cancel();
        vm.warp(auction.expiresAt());

        vm.expectRevert(IDutchAuction.NotLive.selector);
        vm.prank(seller);
        auction.reclaim();
    }

    function test_Reclaim_AfterSold_RevertsNotLive() public {
        vm.prank(buyer);
        auction.buy{value: DEFAULT_STARTING_PRICE}();
        vm.warp(auction.expiresAt());

        vm.expectRevert(IDutchAuction.NotLive.selector);
        vm.prank(seller);
        auction.reclaim();
    }

    function test_Reclaim_Twice_RevertsNotLive() public {
        vm.warp(auction.expiresAt());
        vm.prank(seller);
        auction.reclaim();

        vm.expectRevert(IDutchAuction.NotLive.selector);
        vm.prank(seller);
        auction.reclaim();
    }

    // ────────────────────────────────────────────────────────────────────
    // Fuzz (constitution III)
    // ────────────────────────────────────────────────────────────────────

    function testFuzz_PriceFormula_UsesClampedLinearDecay(uint64 elapsedSeed) public {
        uint256 elapsed = bound(elapsedSeed, 0, DEFAULT_DURATION + 5_000);
        vm.warp(auction.startAt() + elapsed);

        uint256 clamped = elapsed > DEFAULT_DURATION ? DEFAULT_DURATION : elapsed;
        uint256 expected = DEFAULT_STARTING_PRICE - DEFAULT_DISCOUNT_RATE * clamped;
        assertEq(auction.getPrice(), expected);
    }

    function testFuzz_OverpayRefund_Exact(uint64 elapsedSeed, uint96 extraSeed) public {
        // Last purchasable instant is expiresAt - 1 (edge: at expiresAt buying is disabled).
        uint256 elapsed = bound(elapsedSeed, 0, DEFAULT_DURATION - 1);
        vm.warp(auction.startAt() + elapsed);
        uint256 price = auction.getPrice();
        uint256 extra = bound(extraSeed, 0, 1 ether);

        uint256 buyerBefore = buyer.balance;
        uint256 sellerBefore = seller.balance;

        vm.prank(buyer);
        auction.buy{value: price + extra}();

        assertEq(buyer.balance, buyerBefore - price);
        assertEq(seller.balance, sellerBefore + price);
        assertEq(auction.salePrice(), price);
    }

    // ────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ────────────────────────────────────────────────────────────────────

    /// @dev Auction whose startingPrice == discountRate * duration (equality valid, FR-008).
    function _createEqualityAuction() internal returns (address) {
        uint256 tokenId = mintToSeller();
        approveFactory(seller, tokenId);
        vm.prank(seller);
        return factory.createAuction(
            address(nft),
            tokenId,
            DEFAULT_DISCOUNT_RATE * DEFAULT_DURATION,
            DEFAULT_DISCOUNT_RATE,
            DEFAULT_DURATION
        );
    }
}

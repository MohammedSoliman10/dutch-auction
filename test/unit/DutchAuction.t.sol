// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import {AuctionTestBase} from "../base/AuctionTestBase.sol";
import {IDutchAuction} from "../../src/interfaces/IDutchAuction.sol";
import {AuctionFactory} from "../../src/AuctionFactory.sol";
import {DutchAuction} from "../../src/DutchAuction.sol";
import {DutchAuctionNFT} from "../../src/DutchAuctionNFT.sol";

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

    // ────────────────────────────────────────────────────────────────────
    // T069 coverage additions: getters, direct construction, TransferFailed
    // ────────────────────────────────────────────────────────────────────

    function test_PublicState_AllGettersExposeTerms() public view {
        assertEq(auction.seller(), seller);
        assertEq(address(auction.nft()), address(nft));
        assertEq(auction.nftId(), 0);
        assertEq(auction.startingPrice(), DEFAULT_STARTING_PRICE);
        assertEq(auction.discountRate(), DEFAULT_DISCOUNT_RATE);
        assertEq(auction.duration(), DEFAULT_DURATION);
        assertEq(auction.startAt(), block.timestamp);
        assertEq(auction.expiresAt(), block.timestamp + DEFAULT_DURATION);
        assertFalse(auction.sold());
        assertFalse(auction.cancelled());
        assertEq(auction.buyer(), address(0));
        assertEq(auction.salePrice(), 0);
    }

    function test_Constructor_RevertsOnInvalidDuration() public {
        vm.expectRevert(IDutchAuction.InvalidDuration.selector);
        new DutchAuction(
            payable(seller),
            IERC721(address(nft)),
            0,
            DEFAULT_STARTING_PRICE,
            DEFAULT_DISCOUNT_RATE,
            59
        );
    }

    function test_Constructor_RevertsWhenPriceWouldGoNegative() public {
        vm.expectRevert(IDutchAuction.PriceWouldGoNegative.selector);
        new DutchAuction(
            payable(seller),
            IERC721(address(nft)),
            0,
            DEFAULT_DISCOUNT_RATE * DEFAULT_DURATION - 1,
            DEFAULT_DISCOUNT_RATE,
            DEFAULT_DURATION
        );
    }

    function test_Constructor_RevertsWhenProductOverflows() public {
        vm.expectRevert(IDutchAuction.PriceWouldGoNegative.selector);
        new DutchAuction(
            payable(seller), IERC721(address(nft)), 0, type(uint256).max, type(uint256).max, 60
        );
    }

    function test_Cancel_AfterReclaim_RevertsNotLive() public {
        vm.warp(auction.expiresAt());
        vm.prank(seller);
        auction.reclaim();

        vm.expectRevert(IDutchAuction.NotLive.selector);
        vm.prank(seller);
        auction.cancel();
    }

    function test_Buy_RevertsTransferFailed_WhenSellerRejectsPayment() public {
        RejectingSeller rejector = new RejectingSeller(nft, factory);
        address rejectorAuction = rejector.mintAndAuction();
        vm.warp(block.timestamp + 100);
        uint256 price = asAuction(rejectorAuction).getPrice();

        vm.expectRevert(IDutchAuction.TransferFailed.selector);
        vm.prank(buyer);
        asAuction(rejectorAuction).buy{value: price}();

        // SC-004: failed settlement leaves no partial state.
        assertFalse(asAuction(rejectorAuction).sold(), "state unchanged after failed settlement");
        assertEq(nft.ownerOf(asAuction(rejectorAuction).nftId()), rejectorAuction);
    }

    function test_Buy_RevertsTransferFailed_WhenBuyerRefundRejected() public {
        NonRefundableBuyer buyerContract = new NonRefundableBuyer();
        vm.warp(block.timestamp + 100);
        uint256 price = auction.getPrice();

        vm.expectRevert(IDutchAuction.TransferFailed.selector);
        buyerContract.attemptBuy{value: price + 0.1 ether}(auction);

        assertFalse(auction.sold(), "state unchanged after failed settlement");
        assertEq(nft.ownerOf(auction.nftId()), auctionAddr);
    }
}

/// @notice Seller that rejects ETH payouts (no receive/fallback) — exercises
///         the `TransferFailed` branch for the proceeds transfer.
contract RejectingSeller is IERC721Receiver {
    DutchAuctionNFT public immutable collection;
    AuctionFactory public immutable auctionFactory;

    constructor(DutchAuctionNFT collection_, AuctionFactory auctionFactory_) {
        collection = collection_;
        auctionFactory = auctionFactory_;
    }

    /// @notice Mints to this contract, approves the factory, and lists.
    function mintAndAuction() external returns (address) {
        uint256 tokenId = collection.mintNFT("ipfs://QmRejector");
        collection.approve(address(auctionFactory), tokenId);
        return auctionFactory.createAuction(address(collection), tokenId, 1 ether, 1e15, 300);
    }

    /// @notice Accepts the escrow transfer (callback path), but this contract
    ///         has no receive() — paying proceeds to it fails.
    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }
}

/// @notice Buyer that rejects refunds (no receive/fallback) — exercises the
///         `TransferFailed` branch for the overpay refund.
contract NonRefundableBuyer {
    /// @notice Attempts `buy` forwarding the full msg.value; refund failure bubbles.
    function attemptBuy(IDutchAuction auction) external payable {
        auction.buy{value: msg.value}();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";

import {AuctionFactory} from "../../src/AuctionFactory.sol";
import {DutchAuction} from "../../src/DutchAuction.sol";
import {DutchAuctionNFT} from "../../src/DutchAuctionNFT.sol";

/// @title AuctionHandler
/// @notice Fuzzable action surface for invariant testing: randomly creates,
///         buys (blind, try/catch), warps time, cancels, and reclaims while
///         tracking ghost variables.
contract AuctionHandler is Test {
    DutchAuctionNFT public nft;
    AuctionFactory public factory;

    /// @notice All auctions ever created by this handler.
    address[] public auctions;

    /// @notice Ghost: number of successful `buy()` calls per auction (FR-009).
    mapping(address => uint256) public ghost_soldCount;

    address internal seller = address(0x5e11e2);
    address internal buyerA = address(0xb0b0a);
    address internal buyerB = address(0xb0b0b);

    constructor() {
        nft = new DutchAuctionNFT();
        factory = new AuctionFactory();
        vm.deal(seller, 1_000_000 ether);
        vm.deal(buyerA, 1_000_000 ether);
        vm.deal(buyerB, 1_000_000 ether);
    }

    function auctionsLength() external view returns (uint256) {
        return auctions.length;
    }

    /// @notice Create an auction with seed-derived (always valid) parameters.
    function createAuction(uint256 seed) external {
        uint256 rate = 1e15; // 0.001 ETH/s
        uint256 duration = bound(seed % 1_000, 60, 10_000);
        if (seed % 5 == 0) {
            duration = 59; // deliberately invalid: exercises the catch path
        }
        uint256 starting = rate * duration + (seed % 1 ether);

        vm.startPrank(seller);
        uint256 tokenId = nft.mintNFT("ipfs://QmInvariant");
        nft.approve(address(factory), tokenId);
        try factory.createAuction(address(nft), tokenId, starting, rate, duration) returns (
            address auctionAddr
        ) {
            auctions.push(auctionAddr);
        } catch {
            // Invalid fuzz combination — skip (fail_on_revert = false).
        }
        vm.stopPrank();
    }

    /// @notice Attempt a buy at current price + seed-derived overpay.
    function buy(uint256 idx, uint256 seed) external {
        address auctionAddr = auctions[idx % auctions.length];
        DutchAuction auction = DutchAuction(auctionAddr);

        uint256 price = auction.getPrice();
        uint256 extra = seed % 1 ether;
        address who = seed % 2 == 0 ? buyerA : buyerB;
        vm.deal(who, price + extra + 1 ether);

        vm.prank(who);
        try auction.buy{value: price + extra}() {
            ghost_soldCount[auctionAddr] += 1;
        } catch {
            // Reverted buy (expired/etc.) — invariant still must hold.
        }
    }

    /// @notice Advance time by a seed-derived amount.
    function warpTime(uint256 seed) external {
        vm.warp(block.timestamp + bound(seed, 0, 7 days));
    }

    /// @notice Seller attempts to cancel (succeeds only while LIVE).
    function cancel(uint256 idx) external {
        address auctionAddr = auctions[idx % auctions.length];

        vm.prank(seller);
        try DutchAuction(auctionAddr).cancel() {} catch {}
    }

    /// @notice Seller attempts to reclaim (succeeds only post-expiry, unsold).
    function reclaim(uint256 idx) external {
        address auctionAddr = auctions[idx % auctions.length];
        vm.prank(seller);
        try DutchAuction(auctionAddr).reclaim() {} catch {}
    }
}

/// @title AuctionAccountingInvariant
/// @notice R15 invariant suite: (1) ETH conservation — no ETH ever rests in
///         factory or auctions; (2) NFT conservation — the auction holds the
///         NFT iff it is still escrowed (unsold / uncancelled / unreturned);
///         (3) at most one sale per auction (FR-009, SC-004).
contract AuctionAccountingInvariant is Test {
    AuctionHandler internal handler;

    function setUp() public {
        handler = new AuctionHandler();

        // Deterministic seed states for coverage: #1 sold, #2 cancelled,
        // #3 left live, plus catch paths (pre-expiry reclaim, invalid create).
        handler.createAuction(1);
        handler.buy(0, 7); // sells auction #1
        handler.createAuction(2);
        handler.cancel(1); // cancels auction #2
        handler.createAuction(3); // stays live for fuzz exploration
        handler.reclaim(2); // pre-expiry → revert → catch path
        handler.createAuction(5); // duration 59 → revert → catch path

        targetContract(address(handler));
    }

    /// @notice (1) ETH conservation: settlement is push-only; balances at rest are zero.
    function invariant_EthConservation() public view {
        assertEq(address(handler.factory()).balance, 0, "factory must never hold ETH");
        uint256 count = handler.auctionsLength();
        for (uint256 i = 0; i < count; i++) {
            address auctionAddr = handler.auctions(i);
            assertEq(address(auctionAddr).balance, 0, "auction must never hold ETH");
        }
    }

    /// @notice (2) NFT conservation + terminal-state consistency.
    function invariant_NftConservation() public view {
        DutchAuctionNFT nft = handler.nft();
        uint256 count = handler.auctionsLength();
        for (uint256 i = 0; i < count; i++) {
            address auctionAddr = handler.auctions(i);
            DutchAuction auction = DutchAuction(auctionAddr);
            address owner = nft.ownerOf(auction.nftId());

            assertFalse(auction.sold() && auction.cancelled(), "sold and cancelled are exclusive");

            if (auction.sold()) {
                assertEq(owner, auction.buyer(), "sold auction: NFT must be with buyer");
            } else if (auction.cancelled()) {
                assertEq(owner, auction.seller(), "cancelled auction: NFT must be with seller");
            } else {
                assertTrue(
                    owner == auction.seller() || owner == auctionAddr,
                    "escrowed auction: NFT with seller (reclaimed) or auction"
                );
            }
        }
    }

    /// @notice (3) At most one sale per auction (single-shot `sold` flag).
    function invariant_SingleSalePerAuction() public view {
        uint256 count = handler.auctionsLength();
        for (uint256 i = 0; i < count; i++) {
            address auctionAddr = handler.auctions(i);
            assertLe(handler.ghost_soldCount(auctionAddr), 1, "an auction can sell at most once");
            if (DutchAuction(auctionAddr).sold()) {
                assertEq(
                    handler.ghost_soldCount(auctionAddr),
                    1,
                    "sold implies exactly one successful buy"
                );
            }
        }
    }
}

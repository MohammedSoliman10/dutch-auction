// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {AuctionTestBase} from "../base/AuctionTestBase.sol";
import {DutchAuctionNFT} from "../../src/DutchAuctionNFT.sol";

/// @title DutchAuctionNFTTest
/// @notice RED suite for the collection: sequential ids from 0, tokenURI
///         round-trip, EmptyURI guard, mint-to-self (FR-010).
contract DutchAuctionNFTTest is AuctionTestBase {
    function test_Metadata_NameAndSymbol() public view {
        assertEq(nft.name(), "Soliman Web3");
        assertEq(nft.symbol(), "SW3");
    }

    function test_Mint_AssignsSequentialIdsFromZero() public {
        vm.startPrank(seller);
        assertEq(nft.mintNFT("ipfs://Qm1"), 0);
        assertEq(nft.mintNFT("ipfs://Qm2"), 1);
        assertEq(nft.mintNFT("ipfs://Qm3"), 2);
        vm.stopPrank();
        assertEq(nft.balanceOf(seller), 3);
    }

    function test_Mint_MintsToMsgSender() public {
        uint256 tokenId;
        vm.prank(buyer);
        tokenId = nft.mintNFT("ipfs://QmBuyer");
        assertEq(nft.ownerOf(tokenId), buyer);
    }

    function test_TokenURI_RoundTrip() public {
        string memory uri = "ipfs://QmRoundTrip";
        vm.prank(buyer);
        uint256 tokenId = nft.mintNFT(uri);
        assertEq(nft.tokenURI(tokenId), uri);
    }

    function test_Mint_RevertsOnEmptyURI() public {
        vm.expectRevert(DutchAuctionNFT.EmptyURI.selector);
        vm.prank(buyer);
        nft.mintNFT("");
    }
}

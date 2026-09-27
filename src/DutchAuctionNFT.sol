// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {
    ERC721URIStorage
} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/// @title DutchAuctionNFT
/// @author Mohammed Soliman
/// @notice The auctionable collection: "Soliman Web3" ("SW3"), ERC-721 with
///         per-token metadata URIs and sequential ids from 0 (FR-010).
contract DutchAuctionNFT is ERC721URIStorage {
    /// @notice Mint requires a non-empty metadata URI.
    error EmptyURI();

    /// @notice Next sequential token id (assigned at mint, from 0).
    uint256 private nextTokenId;

    /// @notice Creates the collection ("Soliman Web3" / "SW3").
    constructor() ERC721("Soliman Web3", "SW3") {}

    /// @notice Mints the next token to the caller with its metadata URI set.
    /// @dev Reverts `EmptyURI()` when `jsonUri` is empty.
    /// @param jsonUri Metadata URI (http/https/ipfs) — non-empty.
    /// @return tokenId The freshly minted sequential token id.
    function mintNFT(string calldata jsonUri) external returns (uint256 tokenId) {
        if (bytes(jsonUri).length == 0) {
            revert EmptyURI();
        }

        tokenId = nextTokenId;
        nextTokenId = tokenId + 1;

        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, jsonUri);
    }
}

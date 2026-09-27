// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Script} from "forge-std/Script.sol";

import {AuctionFactory} from "../src/AuctionFactory.sol";
import {DutchAuctionNFT} from "../src/DutchAuctionNFT.sol";

/// @title Deploy
/// @author Mohammed Soliman
/// @notice Deploys the collection + factory and records their addresses in
///         `deployments/<network>.json` as `{ chainId, nft, factory }` — the
///         single source frontend/backend config reads (no hardcoded addresses).
/// @dev Usage: `forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify`
contract Deploy is Script {
    /// @notice Deploys both contracts and writes the deployments manifest
    ///         `{ chainId, nft, factory, startBlock }`. `startBlock` is the
    ///         factory's deploy block — the indexer's safe first-scan floor.
    ///         `DEPLOYMENTS_DIR` overrides the output directory so tests never
    ///         touch live manifests.
    function run() external {
        vm.startBroadcast();
        DutchAuctionNFT nft = new DutchAuctionNFT();
        AuctionFactory factory = new AuctionFactory();
        vm.stopBroadcast();

        string memory dir = vm.envOr("DEPLOYMENTS_DIR", string("deployments"));
        string memory path = string.concat(dir, "/", networkName(block.chainid), ".json");
        string memory json = string.concat(
            '{"chainId":',
            vm.toString(block.chainid),
            ',"nft":"',
            vm.toString(address(nft)),
            '","factory":"',
            vm.toString(address(factory)),
            '","startBlock":',
            vm.toString(block.number),
            "}"
        );
        vm.writeJson(json, path);
    }

    /// @notice Human-readable network name for the manifest filename.
    /// @param chainId The chain id being deployed to.
    /// @return The network slug (`sepolia`, `anvil`, or `chain-<id>`).
    function networkName(uint256 chainId) internal pure returns (string memory) {
        if (chainId == 11155111) {
            return "sepolia";
        }
        if (chainId == 31337) {
            return "anvil";
        }
        return string.concat("chain-", vm.toString(chainId));
    }
}

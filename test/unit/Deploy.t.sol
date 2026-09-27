// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";

import {Deploy} from "../../script/Deploy.s.sol";

/// @title DeployTest
/// @notice Covers the deploy script end-to-end (repo-wide coverage gate) and
///         asserts the `deployments/<network>.json` manifest shape
///         `{ chainId, nft, factory }`. Sepolia/mainnet/unknown manifests are
///         cleaned up so a real T018 deploy is never polluted by tests.
contract DeployTest is Test {
    using stdJson for string;

    function test_Run_DefaultChain_WritesAnvilManifest() public {
        new Deploy().run();

        string memory json = vm.readFile("deployments/anvil.json");
        assertEq(json.readUint(".chainId"), 31337, "anvil chainId");
        assertTrue(json.readAddress(".nft") != address(0), "nft recorded");
        assertTrue(json.readAddress(".factory") != address(0), "factory recorded");
    }

    function test_Run_SepoliaChain_WritesSepoliaManifest() public {
        vm.chainId(11155111);
        new Deploy().run();

        string memory json = vm.readFile("deployments/sepolia.json");
        assertEq(json.readUint(".chainId"), 11155111, "sepolia chainId");
        assertTrue(json.readAddress(".factory") != address(0), "factory recorded");
        vm.removeFile("deployments/sepolia.json");
    }

    function test_Run_MainnetChain_UsesChainPrefixManifest() public {
        vm.chainId(1); // mainnet is out of scope for v1 — falls through to chain-<id>
        new Deploy().run();

        string memory json = vm.readFile("deployments/chain-1.json");
        assertEq(json.readUint(".chainId"), 1, "mainnet chainId");
        vm.removeFile("deployments/chain-1.json");
    }

    function test_Run_UnknownChain_UsesChainPrefixManifest() public {
        vm.chainId(12345);
        new Deploy().run();

        string memory json = vm.readFile("deployments/chain-12345.json");
        assertEq(json.readUint(".chainId"), 12345, "unknown chainId");
        vm.removeFile("deployments/chain-12345.json");
    }
}

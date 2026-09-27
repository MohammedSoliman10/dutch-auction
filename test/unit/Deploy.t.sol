// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";

import {Deploy} from "../../script/Deploy.s.sol";

/// @title DeployTest
/// @notice Covers the deploy script end-to-end (repo-wide coverage gate) and
///         asserts the `deployments/<network>.json` manifest shape
///         `{ chainId, nft, factory, startBlock }`. Manifests are written to
///         `cache/test-deployments/` (gitignored) via the DEPLOYMENTS_DIR env
///         override so a live manifest — especially `deployments/sepolia.json` —
///         is never overwritten or deleted by test runs.
contract DeployTest is Test {
    using stdJson for string;

    string internal constant TMP_DIR = "cache/test-deployments";

    function setUp() public {
        if (!vm.exists(TMP_DIR)) {
            vm.createDir(TMP_DIR, true);
        }
        vm.setEnv("DEPLOYMENTS_DIR", TMP_DIR);
    }

    function test_Run_DefaultChain_WritesAnvilManifest() public {
        new Deploy().run();

        string memory json = vm.readFile(string.concat(TMP_DIR, "/anvil.json"));
        assertEq(json.readUint(".chainId"), 31337, "anvil chainId");
        assertTrue(json.readAddress(".nft") != address(0), "nft recorded");
        assertTrue(json.readAddress(".factory") != address(0), "factory recorded");
        assertEq(json.readUint(".startBlock"), block.number, "anvil startBlock recorded");
    }

    function test_Run_SepoliaChain_WritesSepoliaManifest() public {
        vm.chainId(11155111);
        new Deploy().run();

        string memory json = vm.readFile(string.concat(TMP_DIR, "/sepolia.json"));
        assertEq(json.readUint(".chainId"), 11155111, "sepolia chainId");
        assertTrue(json.readAddress(".factory") != address(0), "factory recorded");
        assertEq(json.readUint(".startBlock"), block.number, "sepolia startBlock recorded");
    }

    function test_Run_MainnetChain_UsesChainPrefixManifest() public {
        vm.chainId(1); // mainnet is out of scope for v1 — falls through to chain-<id>
        new Deploy().run();

        string memory json = vm.readFile(string.concat(TMP_DIR, "/chain-1.json"));
        assertEq(json.readUint(".chainId"), 1, "mainnet chainId");
    }

    function test_Run_UnknownChain_UsesChainPrefixManifest() public {
        vm.chainId(12345);
        new Deploy().run();

        string memory json = vm.readFile(string.concat(TMP_DIR, "/chain-12345.json"));
        assertEq(json.readUint(".chainId"), 12345, "unknown chainId");
    }
}

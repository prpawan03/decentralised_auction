// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {Multicall3} from "../src/vendor/Multicall3.sol";
import {DemoNFT} from "../src/DemoNFT.sol";

/// @notice Proves the vendored Multicall3 does what the web app relies on:
/// aggregate3 batches reads and reports per-call success.
contract Multicall3Test is Test {
    Multicall3 internal multicall;
    DemoNFT internal nft;

    function setUp() public {
        multicall = new Multicall3();
        nft = new DemoNFT();
    }

    function test_aggregate3BatchesReadsAndReportsSuccess() public {
        Multicall3.Call3[] memory calls = new Multicall3.Call3[](2);
        calls[0] = Multicall3.Call3(address(nft), false, abi.encodeCall(nft.totalMinted, ()));
        calls[1] = Multicall3.Call3(address(nft), true, abi.encodeCall(nft.ownerOf, (0)));
        Multicall3.Result[] memory results = multicall.aggregate3(calls);
        assertEq(results.length, 2, "two results");
        assertTrue(results[0].success, "totalMinted succeeds");
        assertEq(abi.decode(results[0].returnData, (uint256)), 0, "nothing minted yet");
        assertFalse(results[1].success, "ownerOf(0) fails on an unminted token and is allowed to");
    }

    function test_aggregate3RevertsWhenAFailureIsNotAllowed() public {
        Multicall3.Call3[] memory calls = new Multicall3.Call3[](1);
        calls[0] = Multicall3.Call3(address(nft), false, abi.encodeCall(nft.ownerOf, (0)));
        vm.expectRevert();
        multicall.aggregate3(calls);
    }

    function test_blockHelpersReadTheChain() public view {
        assertEq(multicall.getBlockNumber(), block.number, "block number");
        assertEq(multicall.getChainId(), block.chainid, "chain id");
        assertEq(multicall.getEthBalance(address(this)), address(this).balance, "balance");
    }
}

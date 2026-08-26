// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";

import {AuctionHouse} from "../src/AuctionHouse.sol";
import {DemoNFT} from "../src/DemoNFT.sol";
import {AuctionHandler} from "./mocks/AuctionHandler.sol";

/**
 * @title AuctionHouseInvariantTest
 * @notice Stateful invariant coverage. The runner drives {AuctionHandler} with
 *         random call sequences and checks every invariant after each step.
 * @dev The solvency invariant is the single most valuable test in this package.
 *      It is the property the contract it replaces broke: that contract pushed
 *      refunds mid-call and paid sellers out of a shared pot, so one auction
 *      could spend another auction's ETH.
 */
contract AuctionHouseInvariantTest is Test {
    AuctionHouse internal house;
    DemoNFT internal nft;
    AuctionHandler internal handler;

    address internal houseOwner;
    address internal feeSink;

    /// @notice Wires the handler up as the only fuzz target.
    function setUp() public {
        houseOwner = makeAddr("invariantOwner");
        feeSink = makeAddr("invariantFeeSink");

        house = new AuctionHouse(houseOwner, feeSink, 250);
        nft = new DemoNFT();
        handler = new AuctionHandler(house, nft, 5);

        targetContract(address(handler));
    }

    /**
     * @notice Invariant 1. The house always holds at least what it owes.
     * @dev `balance >= sum(pendingReturns) + sum(highestBid of Live auctions)`.
     *      A `>=` rather than `==`, because ETH can be forced into any address.
     */
    function invariant_HouseHoldsAtLeastWhatItOwes() public view {
        uint256 liabilities = _sumLiveEscrow() + _sumPendingReturns();
        assertGe(address(house).balance, liabilities, "invariant 1: the house is insolvent");
    }

    /**
     * @notice Invariant 1, restated from the outside.
     * @dev Everything paid in, minus everything pulled back out, is exactly what
     *      the house should be holding. This catches a leak the liability sum
     *      would miss, because it never reads the contract's own accounting.
     */
    function invariant_BalanceEqualsDepositsMinusWithdrawals() public view {
        assertEq(
            address(house).balance,
            handler.totalDeposited() - handler.totalWithdrawn(),
            "wei entered or left the house outside bid, buyNow and withdraw"
        );
    }

    /// @notice Invariant 5. The anti-snipe extension cap is never passed.
    function invariant_ExtensionCountStaysWithinTheCap() public view {
        uint256 count = house.totalAuctions();
        uint32 cap = house.MAX_EXTENSIONS();
        for (uint256 i = 0; i < count; ++i) {
            assertLe(house.getAuction(i).extensionCount, cap, "invariant 5: extension cap breached");
        }
    }

    /**
     * @notice Rule 7. Per-auction escrow always matches that auction's state.
     * @dev A Live auction holds exactly its leading bid. A closed auction holds
     *      nothing, because settlement moved the money into `pendingReturns`.
     */
    function invariant_EscrowMatchesAuctionState() public view {
        uint256 count = house.totalAuctions();
        for (uint256 i = 0; i < count; ++i) {
            AuctionHouse.Auction memory auction = house.getAuction(i);
            if (auction.status == AuctionHouse.Status.Live) {
                assertEq(house.escrowOf(i), auction.highestBid, "rule 7: live escrow drifted from the leading bid");
            } else {
                assertEq(house.escrowOf(i), 0, "rule 7: a closed auction still holds escrow");
            }
        }
    }

    /// @notice Invariant 4. Every closed auction's NFT sits with the right owner.
    function invariant_ClosedAuctionsDeliveredTheNft() public view {
        uint256 count = house.totalAuctions();
        for (uint256 i = 0; i < count; ++i) {
            AuctionHouse.Auction memory auction = house.getAuction(i);
            if (auction.status == AuctionHouse.Status.Settled) {
                assertEq(nft.ownerOf(auction.tokenId), auction.highestBidder, "invariant 4: the winner has no token");
            } else if (auction.status != AuctionHouse.Status.Live) {
                assertEq(nft.ownerOf(auction.tokenId), auction.seller, "invariant 4: the seller has no token back");
            }
        }
    }

    /// @notice A Live auction with a leader always has a non-zero bid, and the
    ///         reverse. The two fields never fall out of step.
    function invariant_LeaderAndBidAgree() public view {
        uint256 count = house.totalAuctions();
        for (uint256 i = 0; i < count; ++i) {
            AuctionHouse.Auction memory auction = house.getAuction(i);
            if (auction.highestBidder == address(0)) {
                assertEq(auction.highestBid, 0, "a bid exists with no bidder");
            } else {
                assertGt(auction.highestBid, 0, "a bidder exists with no bid");
            }
        }
    }

    /**
     * @notice Proves the handler itself can reach every state the invariants
     *         care about.
     * @dev The invariant runner asserts every `invariant_` function once before
     *      it makes any call, so a coverage check cannot live in one: at depth 0
     *      no action has run yet. This unit test carries that job instead. If
     *      the handler ever silently returns early on every path, this fails and
     *      the invariant suite stops being vacuously true.
     */
    function test_HandlerReachesEveryState() public {
        handler.handleCreateAuction(1, 0, 0, 1 hours);
        assertEq(house.totalAuctions(), 1, "the handler could not create an auction");

        handler.handleCreateAuction(2, 0, 1, 1 hours);
        handler.handleBid(3, 0, 0);
        assertEq(handler.bidCalls(), 1, "the handler could not bid");

        handler.handleBuyNow(4, 1);
        assertEq(handler.buyNowCalls(), 1, "the handler could not buy now");

        handler.handleCreateAuction(0, 0, 0, 1 hours);
        handler.handleCancel(2);
        assertEq(handler.cancelCalls(), 1, "the handler could not cancel");

        handler.handleWarp(2 days);
        handler.handleSettle(0, 4);
        assertEq(handler.settleCalls(), 1, "the handler could not settle");

        handler.handleWithdraw(1);
        assertEq(handler.withdrawCalls(), 1, "the handler could not withdraw");

        // And the accounting still lines up after that whole sequence.
        assertEq(address(house).balance, handler.totalDeposited() - handler.totalWithdrawn());
    }

    /// @dev Sums the leading bid of every Live auction.
    /// @return total The live escrow, in wei.
    function _sumLiveEscrow() private view returns (uint256 total) {
        uint256 count = house.totalAuctions();
        for (uint256 i = 0; i < count; ++i) {
            AuctionHouse.Auction memory auction = house.getAuction(i);
            if (auction.status == AuctionHouse.Status.Live) {
                total += auction.highestBid;
            }
        }
    }

    /// @dev Sums everything the house owes: the actors, the fee sink and the owner.
    /// @return total The pending returns, in wei.
    function _sumPendingReturns() private view returns (uint256 total) {
        address[] memory actors = handler.allActors();
        for (uint256 i = 0; i < actors.length; ++i) {
            total += house.pendingReturns(actors[i]);
        }
        total += house.pendingReturns(feeSink);
        total += house.pendingReturns(houseOwner);
        total += house.pendingReturns(address(handler));
    }
}

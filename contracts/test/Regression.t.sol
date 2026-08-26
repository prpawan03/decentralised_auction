// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {AuctionHouseBase} from "./AuctionHouseBase.t.sol";
import {AuctionHouse} from "../src/AuctionHouse.sol";
import {ReentrantBidder} from "./mocks/ReentrantBidder.sol";
import {RevertingReceiver} from "./mocks/RevertingReceiver.sol";
import {SmartWalletSeller} from "./mocks/SmartWalletSeller.sol";
import {HostileNFT} from "./mocks/HostileNFT.sol";

/**
 * @title RegressionTest
 * @notice One named test per finding in the audit of the contract this replaces.
 * @dev Each test runs the real exploit against the new contract and asserts it
 *      now fails. The mocks in `test/mocks` are the attackers, not stand-ins for
 *      them: they hold the same code paths the original exploit used.
 *
 *      Findings covered:
 *      1. Reentrancy drain through the mid-call refund push.
 *      2. The seller cancelling a live auction with a self-buyout.
 *      3. A reverting bidder freezing the auction with itself in the lead.
 *      4. `buyout` with `buyoutPrice == 0`, which handed the item over for free.
 *      5. Seller-only settlement, which let a seller lock a bidder's ETH forever.
 *      6. `seller.transfer(...)`, which could not pay a contract seller.
 *      7. The winner never receiving the NFT at all.
 *      8. A shared ETH pot that let one auction spend another's escrow.
 */
contract RegressionTest is AuctionHouseBase {
    // =====================================================================
    // Finding 1 - reentrancy drain
    // =====================================================================

    /**
     * @notice The attacker re-enters {AuctionHouse.buyNow} from inside its own
     *         withdrawal. The old contract would have let it buy an item with
     *         ETH it had already been refunded.
     */
    function test_RevertWhen_ReentrantBidderReentersBuyNow() public {
        // A second auction, live and buyable, is the target of the re-entry.
        (uint256 victimId, ) = _list(seller, 0, 1 ether, 1 hours);
        (uint256 auctionId, ) = _listSimple(seller);

        ReentrantBidder attacker = new ReentrantBidder(house);
        vm.deal(address(attacker), 10 ether);

        // The attacker bids, is outbid, and so holds a credit.
        attacker.bid{value: 1 ether}(auctionId);
        vm.prank(alice);
        house.bid{value: 2 ether}(auctionId);
        assertEq(house.pendingReturns(address(attacker)), 1 ether);

        uint256 houseBalanceBefore = address(house).balance;
        attacker.arm(ReentrantBidder.Mode.ReenterBuyNow, victimId);

        // The withdrawal itself reverts, because the re-entry inside `receive`
        // is rejected and the attacker's own catch cannot rescue the transfer.
        attacker.withdraw();

        assertEq(attacker.reentryAttempts(), 1, "the attack did not run");
        assertEq(attacker.reentryRejections(), 1, "the re-entrant buyNow was NOT rejected");
        // The victim auction is untouched: no free purchase happened.
        assertEq(uint8(house.getAuction(victimId).status), uint8(AuctionHouse.Status.Live));
        assertEq(house.getAuction(victimId).highestBidder, address(0));
        // The attacker was paid its credit exactly once, and nothing more.
        assertEq(attacker.totalReceived(), 1 ether, "the attacker drained more than it was owed");
        assertEq(address(house).balance, houseBalanceBefore - 1 ether);
        assertEq(house.pendingReturns(address(attacker)), 0);
        _assertSolvent();
    }

    /**
     * @notice The classic double-withdraw. The credit is zeroed before the call,
     *         so the re-entry finds nothing, and `nonReentrant` rejects it anyway.
     */
    function test_RevertWhen_ReentrantBidderReentersWithdraw() public {
        (uint256 auctionId, ) = _listSimple(seller);

        ReentrantBidder attacker = new ReentrantBidder(house);
        vm.deal(address(attacker), 10 ether);

        attacker.bid{value: 1 ether}(auctionId);
        vm.prank(alice);
        house.bid{value: 2 ether}(auctionId);

        attacker.arm(ReentrantBidder.Mode.ReenterWithdraw, auctionId);
        attacker.withdraw();

        assertEq(attacker.reentryRejections(), 1, "the re-entrant withdraw was NOT rejected");
        assertEq(attacker.totalReceived(), 1 ether, "the attacker was paid twice");
        assertEq(house.pendingReturns(address(attacker)), 0);
        _assertSolvent();
    }

    /**
     * @notice The original exploit needed an ETH push inside `bid()` to hook.
     *         There is no push any more, so the hook never fires at all.
     */
    function test_BidMakesNoExternalCallToThePreviousBidder() public {
        (uint256 auctionId, ) = _listSimple(seller);

        ReentrantBidder attacker = new ReentrantBidder(house);
        vm.deal(address(attacker), 10 ether);
        attacker.bid{value: 1 ether}(auctionId);
        attacker.arm(ReentrantBidder.Mode.ReenterBid, auctionId);

        vm.prank(alice);
        house.bid{value: 2 ether}(auctionId);

        // The old contract called into the attacker here. This one does not.
        assertEq(attacker.receiveCount(), 0, "bid() pushed ETH to the outbid account");
        assertEq(attacker.reentryAttempts(), 0);
        assertEq(house.pendingReturns(address(attacker)), 1 ether);
    }

    // =====================================================================
    // Finding 2 - the seller's self-buyout
    // =====================================================================

    /// @notice The seller could previously end their own auction by buying it,
    ///         which was a free cancellation once a bid they disliked arrived.
    function test_RevertWhen_SellerBuysOwnAuction() public {
        (uint256 auctionId, ) = _list(seller, 0, 5 ether, 1 hours);

        vm.prank(alice);
        house.bid{value: 1 ether}(auctionId);

        vm.prank(seller);
        vm.expectRevert(AuctionHouse.SellerCannotBid.selector);
        house.buyNow{value: 5 ether}(auctionId);

        // The bid still stands and the seller is still on the hook for it.
        assertEq(house.getAuction(auctionId).highestBidder, alice);
        assertEq(uint8(house.getAuction(auctionId).status), uint8(AuctionHouse.Status.Live));
    }

    /// @notice Wash trading and bid front-running both start with a seller bid.
    function test_RevertWhen_SellerBidsOnOwnAuction() public {
        (uint256 auctionId, ) = _listSimple(seller);

        vm.prank(seller);
        vm.expectRevert(AuctionHouse.SellerCannotBid.selector);
        house.bid{value: 1 ether}(auctionId);
    }

    /// @notice Once a bid stands, the seller has no exit at all.
    function test_RevertWhen_SellerCancelsAfterABidArrives() public {
        (uint256 auctionId, ) = _listSimple(seller);

        vm.prank(alice);
        house.bid{value: 1 ether}(auctionId);

        vm.prank(seller);
        vm.expectRevert(AuctionHouse.AuctionHasBids.selector);
        house.cancelAuction(auctionId);
    }

    // =====================================================================
    // Finding 3 - the reverting bidder
    // =====================================================================

    /**
     * @notice A bidder that reverts on receiving ETH used to freeze the auction:
     *         every later `bid()` reverted on the refund push, so the griefer
     *         stayed in the lead at its own price.
     */
    function test_MaliciousBidderCannotBlockAuction() public {
        (uint256 auctionId, uint256 tokenId) = _listSimple(seller);

        RevertingReceiver griefer = new RevertingReceiver(house);
        vm.deal(address(griefer), 10 ether);
        griefer.bid{value: 1 ether}(auctionId);
        assertEq(house.getAuction(auctionId).highestBidder, address(griefer));

        // The old contract reverted right here. This one does not.
        vm.prank(alice);
        house.bid{value: 2 ether}(auctionId);
        assertEq(house.getAuction(auctionId).highestBidder, alice, "the griefer blocked the next bid");

        vm.warp(START_TIME + 1 hours);
        house.settle(auctionId);

        assertEq(nft.ownerOf(tokenId), alice);
        // The griefer keeps a credit it can never collect. That is its problem,
        // and only its problem.
        assertEq(house.pendingReturns(address(griefer)), 1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(AuctionHouse.TransferFailed.selector, address(griefer), uint256(1 ether))
        );
        griefer.withdraw();

        // Everyone else is paid in full.
        vm.prank(seller);
        assertGt(house.withdraw(), 0);
        _assertSolvent();
    }

    /**
     * @notice A griefer that wins cannot block settlement either. The handover
     *         uses `transferFrom`, so its reverting `onERC721Received` is never
     *         called.
     */
    function test_MaliciousWinnerCannotBlockSettlement() public {
        (uint256 auctionId, uint256 tokenId) = _listSimple(seller);

        RevertingReceiver griefer = new RevertingReceiver(house);
        vm.deal(address(griefer), 10 ether);
        griefer.bid{value: 3 ether}(auctionId);

        vm.warp(START_TIME + 1 hours);
        house.settle(auctionId);

        assertEq(uint8(house.getAuction(auctionId).status), uint8(AuctionHouse.Status.Settled));
        assertEq(nft.ownerOf(tokenId), address(griefer), "the token was not delivered");
        vm.prank(seller);
        assertGt(house.withdraw(), 0, "the seller could not be paid");
    }

    /**
     * @notice A hostile NFT contract that freezes transfers after listing cannot
     *         trap anyone's ETH. The money still moves; only the token stays put.
     */
    function test_HostileNftCannotBlockSettlement() public {
        HostileNFT hostile = new HostileNFT();
        vm.startPrank(seller);
        uint256 tokenId = hostile.mint(seller);
        hostile.approve(address(house), tokenId);
        uint256 auctionId = house.createAuction(address(hostile), tokenId, 0, 0, 1 hours);
        vm.stopPrank();

        vm.prank(alice);
        house.bid{value: 2 ether}(auctionId);

        // The seller turns the collection hostile, hoping to trap the bid.
        hostile.setBlocking(true);

        vm.warp(START_TIME + 1 hours);
        house.settle(auctionId);

        assertEq(uint8(house.getAuction(auctionId).status), uint8(AuctionHouse.Status.Settled));
        // The ETH moved regardless of the token.
        uint256 fee = house.pendingReturns(feeSink);
        assertEq(fee + house.pendingReturns(seller), 2 ether);
        vm.prank(seller);
        assertGt(house.withdraw(), 0);
    }

    // =====================================================================
    // Finding 4 - the free buyout
    // =====================================================================

    /**
     * @notice The old `buyout` compared `msg.value == buyoutPrice`, so a listing
     *         that left `buyoutPrice` unset could be taken for nothing.
     */
    function test_RevertWhen_BuyNowPriceIsZero() public {
        (uint256 auctionId, uint256 tokenId) = _listSimple(seller);
        assertEq(house.getAuction(auctionId).buyNowPrice, 0, "the fixture must leave buy-now disabled");

        // Sending nothing is the exact old exploit.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AuctionHouse.BuyNowDisabled.selector, auctionId));
        house.buyNow{value: 0}(auctionId);

        // Sending real money does not enable it either.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AuctionHouse.BuyNowDisabled.selector, auctionId));
        house.buyNow{value: 5 ether}(auctionId);

        assertEq(nft.ownerOf(tokenId), address(house), "the token left escrow for free");
        assertEq(uint8(house.getAuction(auctionId).status), uint8(AuctionHouse.Status.Live));
    }

    /// @notice A zero buy-now price cannot even be listed as a real price.
    function test_RevertWhen_ListingAFreeBuyNowPrice() public {
        uint256 tokenId = _mintAndApprove(seller);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AuctionHouse.InvalidBuyNowPrice.selector, uint96(1), uint96(0)));
        house.createAuction(address(nft), tokenId, 0, 1, 1 hours);
    }

    // =====================================================================
    // Finding 5 - seller-only settlement
    // =====================================================================

    /**
     * @notice `manualEndAuction` was seller-only and there was no end time, so a
     *         seller who disliked the result simply never called it and the
     *         bidder's ETH stayed in the contract forever.
     */
    function test_AnyoneCanSettleAfterEndTime() public {
        (uint256 auctionId, uint256 tokenId) = _list(seller, 1 ether, 0, 1 hours);

        vm.prank(alice);
        house.bid{value: 2 ether}(auctionId);

        vm.warp(START_TIME + 1 hours);
        assertTrue(house.isSettleable(auctionId));

        // `stranger` is neither the seller, the bidder, nor the owner.
        vm.prank(stranger);
        house.settle(auctionId);

        assertEq(uint8(house.getAuction(auctionId).status), uint8(AuctionHouse.Status.Settled));
        assertEq(nft.ownerOf(tokenId), alice);

        // And the winner's money reached the seller, not a permanent limbo.
        vm.prank(seller);
        assertEq(house.withdraw(), 2 ether - (2 ether * FEE_BPS) / 10_000);
    }

    /// @notice Pausing cannot be used to recreate the frozen-funds bug.
    function test_PauseCannotTrapABidderMoney() public {
        (uint256 auctionId, ) = _listSimple(seller);
        vm.prank(alice);
        house.bid{value: 2 ether}(auctionId);

        vm.prank(houseOwner);
        house.pause();
        vm.warp(START_TIME + 1 hours);

        // Invariant 7: both of these MUST still work while paused.
        vm.prank(stranger);
        house.settle(auctionId);
        vm.prank(seller);
        assertGt(house.withdraw(), 0);
    }

    // =====================================================================
    // Finding 6 - the seller that could not be paid
    // =====================================================================

    /**
     * @notice The old contract paid with `transfer`, capped at 2300 gas. Any
     *         smart wallet that wrote storage on receive made the settlement
     *         revert, so the item could never be sold at all.
     */
    function test_SmartContractSellerCanBePaid() public {
        SmartWalletSeller wallet = new SmartWalletSeller(house);
        uint256 tokenId = nft.mint(address(wallet), "ipfs://demo/wallet.json");
        uint256 auctionId = wallet.list(address(nft), tokenId, 0, 0, 1 hours);

        vm.prank(alice);
        house.bid{value: 4 ether}(auctionId);

        vm.warp(START_TIME + 1 hours);
        wallet.settle(auctionId);

        uint256 fee = (4 ether * FEE_BPS) / 10_000;
        assertEq(house.pendingReturns(address(wallet)), 4 ether - fee);

        // The pull forwards all remaining gas, so the wallet's storage writes fit.
        uint256 collected = wallet.collect();
        assertEq(collected, 4 ether - fee);
        assertEq(wallet.totalReceived(), 4 ether - fee, "the smart wallet was not paid");
        assertEq(wallet.paymentCount(), 1);
        assertEq(nft.ownerOf(tokenId), alice);
    }

    // =====================================================================
    // Finding 7 - the winner got nothing
    // =====================================================================

    /// @notice The old contract never moved the NFT. The winner paid and the
    ///         seller kept the item.
    function test_WinnerReceivesTheNftAtomicallyWithPayment() public {
        (uint256 auctionId, uint256 tokenId) = _listSimple(seller);
        assertEq(nft.ownerOf(tokenId), address(house), "the NFT was not escrowed at listing");

        vm.prank(alice);
        house.bid{value: 3 ether}(auctionId);
        vm.warp(START_TIME + 1 hours);
        house.settle(auctionId);

        // Invariant 4: the same transaction that credited the seller moved the token.
        assertEq(nft.ownerOf(tokenId), alice);
        assertGt(house.pendingReturns(seller), 0);
    }

    // =====================================================================
    // Finding 8 - the shared ETH pot
    // =====================================================================

    /**
     * @notice The old contract kept one pot and settled from `address(this)`,
     *         so a payout for one item could be funded by another item's bids.
     *         Escrow is now per auction and the boundary holds under settlement,
     *         withdrawal and a hostile winner.
     */
    function test_CrossAuctionDrainIsImpossible() public {
        (uint256 cheapId, ) = _list(seller, 0, 0, 1 hours);
        (uint256 richId, ) = _list(carol, 0, 0, 2 hours);

        vm.prank(alice);
        house.bid{value: 1 ether}(cheapId);
        vm.prank(bob);
        house.bid{value: 20 ether}(richId);

        assertEq(house.escrowOf(cheapId), 1 ether);
        assertEq(house.escrowOf(richId), 20 ether);
        assertEq(address(house).balance, 21 ether);

        // Settle and drain the cheap auction completely.
        vm.warp(START_TIME + 1 hours);
        house.settle(cheapId);
        vm.prank(seller);
        house.withdraw();
        vm.prank(feeSink);
        house.withdraw();

        // The rich auction is exactly as it was, and the house still covers it.
        assertEq(house.escrowOf(richId), 20 ether, "rule 7: escrow crossed an auction boundary");
        assertEq(house.getAuction(richId).highestBid, 20 ether);
        assertEq(address(house).balance, 20 ether);
        _assertSolvent();

        // And it still settles and pays out for its full amount.
        vm.warp(START_TIME + 2 hours);
        house.settle(richId);
        uint256 fee = (20 ether * FEE_BPS) / 10_000;
        vm.prank(carol);
        assertEq(house.withdraw(), 20 ether - fee);
    }

    /// @notice A settled auction has no escrow left to be spent a second time.
    function test_SettledAuctionCannotBePaidTwice() public {
        (uint256 auctionId, ) = _listSimple(seller);
        vm.prank(alice);
        house.bid{value: 5 ether}(auctionId);
        vm.warp(START_TIME + 1 hours);
        house.settle(auctionId);

        assertEq(house.escrowOf(auctionId), 0);
        vm.expectRevert(
            abi.encodeWithSelector(AuctionHouse.AuctionNotLive.selector, auctionId, AuctionHouse.Status.Settled)
        );
        house.settle(auctionId);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {AuctionHouseBase} from "./AuctionHouseBase.t.sol";
import {AuctionHouse} from "../src/AuctionHouse.sol";
import {EnglishAuction} from "../src/formats/EnglishAuction.sol";
import {AuctionCore} from "../src/core/AuctionCore.sol";

/**
 * @title AuctionHouseTest
 * @notice Unit and fuzz coverage of the auction lifecycle.
 * @dev Fuzz cases live here rather than in the TypeScript suite, because this
 *      is the only runner that can drive a Solidity fuzzer.
 */
contract AuctionHouseTest is AuctionHouseBase {
    /// @notice The storage-layout probe could not find the `_auctions` array.
    error AuctionsArrayNotFound();

    // =====================================================================
    // createAuction
    // =====================================================================

    function test_CreateAuction_EscrowsNftAndOpensLive() public {
        (uint256 id, uint256 tokenId) = _listSimple(seller);

        AuctionCore.Auction memory auction = house.getAuction(id);
        assertEq(auction.seller, seller);
        assertEq(auction.nft, address(nft));
        assertEq(auction.tokenId, tokenId);
        assertEq(uint8(auction.status), uint8(AuctionCore.Status.Live));
        assertEq(auction.startTime, uint64(START_TIME));
        assertEq(auction.endTime, uint64(START_TIME + 1 hours));
        assertEq(auction.minIncrementBps, house.DEFAULT_INCREMENT_BPS());
        assertEq(auction.extensionCount, 0);

        // Invariant 4 at listing time: the house holds the token, not the seller.
        assertEq(nft.ownerOf(tokenId), address(house));
        assertEq(house.totalAuctions(), 1);
    }

    function test_RevertWhen_DurationBelowMinimum() public {
        uint256 tokenId = _mintAndApprove(seller);
        // Read the constants BEFORE the prank: an external call in between
        // would consume it and the revert would come from the wrong caller.
        uint64 minDuration = house.MIN_DURATION();
        uint64 maxDuration = house.MAX_DURATION();

        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(AuctionCore.DurationOutOfRange.selector, uint64(59), minDuration, maxDuration)
        );
        house.createAuction(address(nft), tokenId, 0, 0, 59);
    }

    function test_RevertWhen_DurationAboveMaximum() public {
        uint256 tokenId = _mintAndApprove(seller);
        uint64 minDuration = house.MIN_DURATION();
        uint64 maxDuration = house.MAX_DURATION();
        uint64 tooLong = maxDuration + 1;

        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(AuctionCore.DurationOutOfRange.selector, tooLong, minDuration, maxDuration)
        );
        house.createAuction(address(nft), tokenId, 0, 0, tooLong);
    }

    function test_RevertWhen_BuyNowIsBelowReserve() public {
        uint256 tokenId = _mintAndApprove(seller);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AuctionCore.InvalidBuyNowPrice.selector, uint96(1 ether), uint96(2 ether)));
        house.createAuction(address(nft), tokenId, 2 ether, 1 ether, 1 hours);
    }

    function test_RevertWhen_BuyNowIsBelowMinIncrement() public {
        uint256 tokenId = _mintAndApprove(seller);
        uint96 dust = house.MIN_INCREMENT() - 1;
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AuctionCore.InvalidBuyNowPrice.selector, dust, uint96(0)));
        house.createAuction(address(nft), tokenId, 0, dust, 1 hours);
    }

    function test_RevertWhen_AuctionIdDoesNotExist() public {
        vm.expectRevert(abi.encodeWithSelector(AuctionCore.AuctionNotFound.selector, uint256(7)));
        house.getAuction(7);
    }

    // =====================================================================
    // bid
    // =====================================================================

    function test_Bid_CreditsThePreviousBidderAndNeverSends() public {
        (uint256 id, ) = _listSimple(seller);

        vm.prank(alice);
        house.bid{value: 1 ether}(id);

        uint256 aliceBalanceBefore = alice.balance;

        vm.prank(bob);
        house.bid{value: 2 ether}(id);

        // Rule 1: the refund is credited, not sent. Alice's wallet is untouched.
        assertEq(alice.balance, aliceBalanceBefore, "ETH was pushed to the outbid account");
        assertEq(house.pendingReturns(alice), 1 ether);
        assertEq(house.getAuction(id).highestBidder, bob);
        assertEq(house.getAuction(id).highestBid, 2 ether);
        // Rule 7: the escrow tracks only this auction's live bid.
        assertEq(house.escrowOf(id), 2 ether);
        assertEq(address(house).balance, 3 ether);
        _assertSolvent();
    }

    function test_RevertWhen_BidBelowMinimumIncrement() public {
        (uint256 id, ) = _listSimple(seller);

        vm.prank(alice);
        house.bid{value: 1 ether}(id);

        // 5% of 1 ether is the required step, so 1.04 ether must fail.
        uint256 required = house.minimumBid(id);
        assertEq(required, 1.05 ether);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(AuctionCore.BidTooLow.selector, required, uint256(1.04 ether)));
        house.bid{value: 1.04 ether}(id);
    }

    function test_RevertWhen_BidLandsAtEndTime() public {
        (uint256 id, ) = _listSimple(seller);
        // Invariant 3: at endTime, bidding is already closed.
        vm.warp(START_TIME + 1 hours);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AuctionCore.AuctionAlreadyEnded.selector, id));
        house.bid{value: 1 ether}(id);
    }

    function test_RevertWhen_LeaderBidsAgainstThemselves() public {
        (uint256 id, ) = _listSimple(seller);

        vm.prank(alice);
        house.bid{value: 1 ether}(id);

        vm.prank(alice);
        vm.expectRevert(AuctionCore.AlreadyHighestBidder.selector);
        house.bid{value: 2 ether}(id);
    }

    function test_HighestBidNeverDecreases() public {
        (uint256 id, ) = _listSimple(seller);

        uint256 previous = 0;
        address[3] memory bidders = [alice, bob, carol];
        for (uint256 i = 0; i < bidders.length; ++i) {
            _bidMinimum(bidders[i], id);
            uint256 current = house.getAuction(id).highestBid;
            // Invariant 2.
            assertGt(current, previous, "invariant 2: highestBid decreased");
            previous = current;
        }
    }

    function test_MinimumBid_StartsAtMinIncrement() public {
        (uint256 id, ) = _list(seller, 5 ether, 0, 1 hours);
        // The reserve is not a bid floor. A bid below it is legal and refundable.
        assertEq(house.minimumBid(id), house.MIN_INCREMENT());
    }

    // =====================================================================
    // Anti-snipe
    // =====================================================================

    function test_AntiSnipe_ExtendsEndTime() public {
        (uint256 id, ) = _list(seller, 0, 0, 1 hours);
        uint256 snipeAt = START_TIME + 1 hours - 30;
        vm.warp(snipeAt);

        vm.prank(alice);
        house.bid{value: 1 ether}(id);

        AuctionCore.Auction memory auction = house.getAuction(id);
        assertEq(auction.endTime, uint64(snipeAt + house.ANTI_SNIPE_WINDOW()));
        assertEq(auction.extensionCount, 1);
    }

    function test_AntiSnipe_DoesNotExtendAnEarlyBid() public {
        (uint256 id, ) = _list(seller, 0, 0, 1 hours);

        vm.prank(alice);
        house.bid{value: 1 ether}(id);

        AuctionCore.Auction memory auction = house.getAuction(id);
        assertEq(auction.endTime, uint64(START_TIME + 1 hours));
        assertEq(auction.extensionCount, 0);
    }

    function test_AntiSnipe_StopsAtMaxExtensions() public {
        // A one minute auction sits entirely inside the anti-snipe window, so
        // every bid extends it.
        (uint256 id, ) = _list(seller, 0, 0, 60);

        uint32 cap = house.MAX_EXTENSIONS();
        for (uint256 i = 0; i < cap + 3; ++i) {
            address bidder = i % 2 == 0 ? alice : bob;
            vm.warp(house.getAuction(id).endTime - 1);
            _bidMinimum(bidder, id);
            // Invariant 5, checked on every single step.
            assertLe(house.getAuction(id).extensionCount, cap, "invariant 5: extension cap breached");
        }

        assertEq(house.getAuction(id).extensionCount, cap);

        // Past the cap the clock no longer moves, so the auction terminates.
        uint64 frozenEnd = house.getAuction(id).endTime;
        vm.warp(frozenEnd - 1);
        _bidMinimum(carol, id);
        assertEq(house.getAuction(id).endTime, frozenEnd, "a capped auction was extended again");
    }

    /**
     * @notice A bid at exactly `endTime - ANTI_SNIPE_WINDOW` MUST NOT burn an
     *         extension, because it cannot move the clock.
     * @dev At that instant the candidate end time is exactly the current one, so
     *      the old code applied a zero-length extension and still counted it. An
     *      attacker could therefore spend all {EnglishAuction.MAX_EXTENSIONS}
     *      slots from as many addresses in a single block, for the price of gas
     *      alone - every losing bid is refunded in full - and then snipe the
     *      auction with anti-snipe switched off.
     *
     *      The rest of the suite only ever warped to `endTime - 1`, which is
     *      strictly inside the window, so this boundary was never exercised.
     */
    function test_AntiSnipe_ExactWindowBoundaryDoesNotBurnAnExtension() public {
        (uint256 id, ) = _list(seller, 0, 0, 1 hours);

        uint64 endTime = house.getAuction(id).endTime;
        uint64 window = house.ANTI_SNIPE_WINDOW();
        // Precisely the boundary, not one second inside it.
        vm.warp(endTime - window);

        vm.prank(alice);
        house.bid{value: 1 ether}(id);

        AuctionCore.Auction memory auction = house.getAuction(id);
        assertEq(auction.endTime, endTime, "a zero-length extension moved the clock");
        assertEq(auction.extensionCount, 0, "the boundary bid burned an extension for free");

        // One second later is genuinely inside the window, and that one counts.
        vm.warp(endTime - window + 1);
        _bidMinimum(bob, id);
        assertEq(house.getAuction(id).extensionCount, 1, "a bid inside the window did not extend");
    }

    /**
     * @notice The whole cap cannot be drained at the boundary in one block.
     * @dev The attack in full: {EnglishAuction.MAX_EXTENSIONS} + 1 addresses, one
     *      block, every bid landing on the boundary. Not one of them may count.
     */
    function test_AntiSnipe_CannotBeExhaustedAtTheBoundary() public {
        (uint256 id, ) = _list(seller, 0, 0, 1 hours);

        uint64 endTime = house.getAuction(id).endTime;
        vm.warp(endTime - house.ANTI_SNIPE_WINDOW());

        uint32 cap = house.MAX_EXTENSIONS();
        for (uint256 i = 0; i <= cap; ++i) {
            _bidMinimum(makeAddr(string(abi.encodePacked("snipeMule", vm.toString(i)))), id);
        }

        AuctionCore.Auction memory auction = house.getAuction(id);
        assertEq(auction.extensionCount, 0, "the anti-snipe budget was burned for free");
        assertEq(auction.endTime, endTime);
    }

    // =====================================================================
    // buyNow
    // =====================================================================

    function test_BuyNow_SettlesImmediately() public {
        (uint256 id, uint256 tokenId) = _list(seller, 1 ether, 5 ether, 1 hours);

        vm.prank(alice);
        house.buyNow{value: 5 ether}(id);

        AuctionCore.Auction memory auction = house.getAuction(id);
        assertEq(uint8(auction.status), uint8(AuctionCore.Status.Settled));
        assertEq(auction.highestBidder, alice);
        // Invariant 4.
        assertEq(nft.ownerOf(tokenId), alice);

        uint256 fee = (5 ether * FEE_BPS) / 10_000;
        assertEq(house.pendingReturns(feeSink), fee);
        assertEq(house.pendingReturns(seller), 5 ether - fee);
        assertEq(house.escrowOf(id), 0);
        _assertSolvent();
    }

    function test_BuyNow_RefundsTheStandingBidder() public {
        (uint256 id, ) = _list(seller, 0, 5 ether, 1 hours);

        vm.prank(alice);
        house.bid{value: 1 ether}(id);

        vm.prank(bob);
        house.buyNow{value: 5 ether}(id);

        assertEq(house.pendingReturns(alice), 1 ether, "the outbid account was not made whole");
        _assertSolvent();
    }

    function test_RevertWhen_BuyNowPaymentIsWrong() public {
        (uint256 id, ) = _list(seller, 0, 5 ether, 1 hours);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(AuctionCore.IncorrectPayment.selector, uint256(5 ether), uint256(4 ether))
        );
        house.buyNow{value: 4 ether}(id);
    }

    function test_RevertWhen_BuyNowIsOutrunByBidding() public {
        (uint256 id, ) = _list(seller, 0, 5 ether, 1 hours);

        vm.prank(alice);
        house.bid{value: 6 ether}(id);

        // Buy-now closes once bidding passes it, so nobody can take the item
        // for less than the standing bid.
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(AuctionCore.BuyNowDisabled.selector, id));
        house.buyNow{value: 5 ether}(id);
    }

    // =====================================================================
    // settle
    // =====================================================================

    function test_Settle_PaysSellerAndFeeExactly() public {
        (uint256 id, uint256 tokenId) = _list(seller, 1 ether, 0, 1 hours);

        vm.prank(alice);
        house.bid{value: 3 ether}(id);
        vm.warp(START_TIME + 1 hours);

        house.settle(id);

        uint256 fee = house.pendingReturns(feeSink);
        uint256 proceeds = house.pendingReturns(seller);
        // Invariant 6: the split is exact, and the dust stays with the seller.
        assertEq(fee + proceeds, 3 ether, "invariant 6: the split lost or created wei");
        assertEq(fee, (3 ether * FEE_BPS) / 10_000);
        assertEq(nft.ownerOf(tokenId), alice);
        assertEq(house.escrowOf(id), 0);
        _assertSolvent();
    }

    function test_Settle_BelowReserveRefundsInFullAndReturnsTheNft() public {
        (uint256 id, uint256 tokenId) = _list(seller, 10 ether, 0, 1 hours);

        vm.prank(alice);
        house.bid{value: 1 ether}(id);
        vm.warp(START_TIME + 1 hours);

        house.settle(id);

        AuctionCore.Auction memory auction = house.getAuction(id);
        assertEq(uint8(auction.status), uint8(AuctionCore.Status.ReserveNotMet));
        assertEq(house.pendingReturns(alice), 1 ether, "the bidder was not refunded in full");
        assertEq(house.pendingReturns(seller), 0);
        assertEq(house.pendingReturns(feeSink), 0);
        // Invariant 4.
        assertEq(nft.ownerOf(tokenId), seller);
        _assertSolvent();
    }

    function test_Settle_WithNoBidsReturnsTheNft() public {
        (uint256 id, uint256 tokenId) = _listSimple(seller);
        vm.warp(START_TIME + 1 hours);

        house.settle(id);

        assertEq(uint8(house.getAuction(id).status), uint8(AuctionCore.Status.ReserveNotMet));
        assertEq(nft.ownerOf(tokenId), seller);
    }

    function test_RevertWhen_SettlingBeforeEndTime() public {
        (uint256 id, ) = _listSimple(seller);
        vm.expectRevert(
            abi.encodeWithSelector(AuctionCore.AuctionStillRunning.selector, id, uint64(START_TIME + 1 hours))
        );
        house.settle(id);
    }

    function test_RevertWhen_SettlingTwice() public {
        (uint256 id, ) = _listSimple(seller);
        vm.warp(START_TIME + 1 hours);
        house.settle(id);

        vm.expectRevert(
            abi.encodeWithSelector(AuctionCore.AuctionNotLive.selector, id, AuctionCore.Status.ReserveNotMet)
        );
        house.settle(id);
    }

    function test_IsSettleable_TracksTheClock() public {
        (uint256 id, ) = _listSimple(seller);
        assertFalse(house.isSettleable(id));
        vm.warp(START_TIME + 1 hours);
        assertTrue(house.isSettleable(id));
        house.settle(id);
        assertFalse(house.isSettleable(id));
        // A missing auction is never settleable, and never reverts here.
        assertFalse(house.isSettleable(999));
    }

    // =====================================================================
    // cancelAuction
    // =====================================================================

    function test_Cancel_ReturnsTheNftWhenThereAreNoBids() public {
        (uint256 id, uint256 tokenId) = _listSimple(seller);

        vm.prank(seller);
        house.cancelAuction(id);

        assertEq(uint8(house.getAuction(id).status), uint8(AuctionCore.Status.Cancelled));
        assertEq(nft.ownerOf(tokenId), seller);
    }

    function test_RevertWhen_CancellingWithAStandingBid() public {
        (uint256 id, ) = _listSimple(seller);

        vm.prank(alice);
        house.bid{value: 1 ether}(id);

        vm.prank(seller);
        vm.expectRevert(AuctionCore.AuctionHasBids.selector);
        house.cancelAuction(id);
    }

    function test_RevertWhen_NonSellerCancels() public {
        (uint256 id, ) = _listSimple(seller);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AuctionCore.NotSeller.selector, alice, seller));
        house.cancelAuction(id);
    }

    /**
     * @notice A dust bid below the reserve MUST NOT freeze the listing.
     * @dev A bid of {EnglishAuction.MIN_INCREMENT} is refunded in full at
     *      settlement, so it costs the bidder nothing but gas. While cancelling
     *      required `highestBidder == address(0)`, that one bid locked the
     *      seller's token in escrow for the whole duration - up to
     *      {AuctionCore.MAX_DURATION}, thirty days.
     *
     *      Cancelling below the reserve is now allowed, and the standing bidder
     *      is credited exactly what settlement would have credited them.
     */
    function test_DustBidDoesNotFreezeTheListing() public {
        (uint256 id, uint256 tokenId) = _list(seller, 10 ether, 0, house.MAX_DURATION());

        uint96 dust = house.MIN_INCREMENT();
        vm.prank(alice);
        house.bid{value: dust}(id);
        assertEq(house.escrowOf(id), dust);

        vm.prank(seller);
        house.cancelAuction(id);

        assertEq(uint8(house.getAuction(id).status), uint8(AuctionCore.Status.Cancelled));
        assertEq(nft.ownerOf(tokenId), seller, "the token stayed frozen in escrow");
        // The dust bidder is made whole, to the wei, out of this auction's escrow.
        assertEq(house.pendingReturns(alice), dust, "the standing bidder was not refunded");
        assertEq(house.escrowOf(id), 0, "rule 7: escrow survived the cancellation");
        assertEq(house.pendingReturns(seller), 0);

        vm.prank(alice);
        assertEq(house.withdraw(), dust);
        _assertSolvent();
    }

    /// @notice A bid that meets the reserve is a real sale, and still blocks the exit.
    function test_RevertWhen_CancellingAtOrAboveTheReserve() public {
        (uint256 id, ) = _list(seller, 1 ether, 0, 1 hours);

        // Exactly the reserve, not a wei above it.
        vm.prank(alice);
        house.bid{value: 1 ether}(id);

        vm.prank(seller);
        vm.expectRevert(AuctionCore.AuctionHasBids.selector);
        house.cancelAuction(id);
    }

    /// @notice With no reserve every bid meets it, so no bid can ever be shaken off.
    function test_RevertWhen_CancellingWithNoReserveAndADustBid() public {
        (uint256 id, ) = _listSimple(seller);

        vm.prank(alice);
        house.bid{value: house.MIN_INCREMENT()}(id);

        vm.prank(seller);
        vm.expectRevert(AuctionCore.AuctionHasBids.selector);
        house.cancelAuction(id);
    }

    // =====================================================================
    // withdraw
    // =====================================================================

    function test_Withdraw_PaysOnceAndZeroesTheCredit() public {
        (uint256 id, ) = _listSimple(seller);

        vm.prank(alice);
        house.bid{value: 1 ether}(id);
        vm.prank(bob);
        house.bid{value: 2 ether}(id);

        uint256 before = alice.balance;
        vm.prank(alice);
        uint256 paid = house.withdraw();

        assertEq(paid, 1 ether);
        assertEq(alice.balance, before + 1 ether);
        assertEq(house.pendingReturns(alice), 0);

        vm.prank(alice);
        vm.expectRevert(AuctionCore.NothingToWithdraw.selector);
        house.withdraw();
    }

    function test_RevertWhen_WithdrawingWithNoCredit() public {
        vm.prank(stranger);
        vm.expectRevert(AuctionCore.NothingToWithdraw.selector);
        house.withdraw();
    }

    // =====================================================================
    // Pausing (invariant 7)
    // =====================================================================

    function test_Pause_BlocksBiddingButNeverTrapsMoney() public {
        (uint256 id, ) = _listSimple(seller);
        vm.prank(alice);
        house.bid{value: 1 ether}(id);
        vm.prank(bob);
        house.bid{value: 2 ether}(id);

        vm.prank(houseOwner);
        house.pause();

        vm.prank(carol);
        vm.expectRevert();
        house.bid{value: 3 ether}(id);

        // Invariant 7: settle and withdraw MUST keep working while paused.
        vm.warp(START_TIME + 1 hours);
        house.settle(id);
        assertEq(uint8(house.getAuction(id).status), uint8(AuctionCore.Status.Settled));

        vm.prank(alice);
        assertEq(house.withdraw(), 1 ether);
        vm.prank(seller);
        assertGt(house.withdraw(), 0);

        vm.prank(houseOwner);
        house.unpause();
    }

    // =====================================================================
    // Admin
    // =====================================================================

    function test_RevertWhen_FeeExceedsTheHardCap() public {
        uint16 cap = house.MAX_FEE_BPS();
        uint16 tooMuch = cap + 1;

        vm.prank(houseOwner);
        vm.expectRevert(abi.encodeWithSelector(AuctionCore.FeeTooHigh.selector, tooMuch, cap));
        house.setPlatformFee(tooMuch);
    }

    function test_SetPlatformFee() public {
        vm.prank(houseOwner);
        house.setPlatformFee(1000);
        assertEq(house.platformFeeBps(), 1000);
    }

    function test_RevertWhen_NonOwnerSetsFee() public {
        vm.prank(alice);
        vm.expectRevert();
        house.setPlatformFee(100);
    }

    function test_ZeroFeeRecipientDisablesTheFee() public {
        vm.prank(houseOwner);
        house.setFeeRecipient(address(0));

        (uint256 id, ) = _listSimple(seller);
        vm.prank(alice);
        house.bid{value: 4 ether}(id);
        vm.warp(START_TIME + 1 hours);
        house.settle(id);

        // Nothing is credited to address(0), so no wei is ever stranded.
        assertEq(house.pendingReturns(address(0)), 0);
        assertEq(house.pendingReturns(seller), 4 ether);
    }

    /**
     * @notice The owner MUST NOT be able to reprice an auction that is already
     *         taking bids.
     * @dev The fee used at settlement is the one snapshotted into the auction at
     *      listing, not whatever the owner has set by the time it closes. Reading
     *      the live `platformFeeBps` let the owner watch a bid land and then take
     *      up to {AuctionCore.MAX_FEE_BPS} of it retroactively.
     */
    function test_OwnerCannotRepriceALiveAuction() public {
        // Listed at the fixture's 2.5%.
        (uint256 id, ) = _listSimple(seller);
        assertEq(house.getAuction(id).platformFeeBps, uint16(FEE_BPS), "the fee was not snapshotted");

        vm.prank(alice);
        house.bid{value: 10 ether}(id);

        // The owner sees the bid land and raises the fee to the hard cap. The cap
        // is read BEFORE the prank: an external call in between consumes it.
        uint16 cap = house.MAX_FEE_BPS();
        vm.prank(houseOwner);
        house.setPlatformFee(cap);
        assertEq(house.platformFeeBps(), cap);

        vm.warp(START_TIME + 1 hours);
        house.settle(id);

        // The auction pays the fee it was listed with, not the new one.
        uint256 expectedFee = (10 ether * FEE_BPS) / 10_000;
        assertEq(house.pendingReturns(feeSink), expectedFee, "the fee was repriced under a live auction");
        assertEq(house.pendingReturns(seller), 10 ether - expectedFee);
        assertEq(house.getAuction(id).platformFeeBps, uint16(FEE_BPS));
        _assertSolvent();
    }

    /// @notice A new fee still applies to everything listed after it is set.
    function test_NewFeeAppliesToAuctionsListedAfterIt() public {
        vm.prank(houseOwner);
        house.setPlatformFee(1000);

        (uint256 id, ) = _listSimple(seller);
        assertEq(house.getAuction(id).platformFeeBps, 1000);

        vm.prank(alice);
        house.bid{value: 10 ether}(id);
        vm.warp(START_TIME + 1 hours);
        house.settle(id);

        assertEq(house.pendingReturns(feeSink), (10 ether * 1000) / 10_000);
    }

    /**
     * @notice The fee recipient MUST NOT be the house itself.
     * @dev {AuctionHouse.withdraw} pays `msg.sender`, and the house can never be
     *      the caller, so a fee credited to it could never be pulled back out.
     */
    function test_RevertWhen_FeeRecipientIsTheHouseItself() public {
        vm.prank(houseOwner);
        vm.expectRevert(abi.encodeWithSelector(AuctionCore.InvalidFeeRecipient.selector, address(house)));
        house.setFeeRecipient(address(house));

        // The old recipient is untouched.
        assertEq(house.feeRecipient(), feeSink);
    }

    /// @notice Any other address, including address(0), is still accepted.
    function test_SetFeeRecipient() public {
        vm.prank(houseOwner);
        house.setFeeRecipient(carol);
        assertEq(house.feeRecipient(), carol);

        vm.prank(houseOwner);
        house.setFeeRecipient(address(0));
        assertEq(house.feeRecipient(), address(0));
    }

    function test_OwnershipTransferIsTwoStep() public {
        vm.prank(houseOwner);
        house.transferOwnership(alice);
        // Still the old owner until the new one accepts.
        assertEq(house.owner(), houseOwner);
        assertEq(house.pendingOwner(), alice);

        vm.prank(alice);
        house.acceptOwnership();
        assertEq(house.owner(), alice);
    }

    // =====================================================================
    // Pagination
    // =====================================================================

    function test_GetAuctions_ClampsInsteadOfReverting() public {
        for (uint256 i = 0; i < 5; ++i) {
            _listSimple(seller);
        }

        // A limit above MAX_PAGE_SIZE is clamped, not rejected.
        assertEq(house.getAuctions(0, 10_000).length, 5);
        assertEq(house.getAuctions(2, 2).length, 2);
        // An offset past the end returns an empty page.
        assertEq(house.getAuctions(99, 10).length, 0);
    }

    // =====================================================================
    // Storage layout
    // =====================================================================

    /**
     * @notice The `Auction` struct MUST still pack into five storage slots.
     * @dev The platform fee snapshot went into the spare bytes of slot 4, which
     *      had 23 of its 32 bytes in use and now has 25. If it ever spills into a
     *      sixth slot, every listing and every bid gets more expensive, so the
     *      claim is worth pinning down rather than trusting a comment.
     *
     *      The proof is positional: element 1 of `_auctions` starts exactly five
     *      slots after element 0, and slot 0 of a packed `Auction` holds that
     *      auction's seller in its low 20 bytes.
     */
    function test_AuctionStructStillPacksIntoFiveSlots() public {
        _listSimple(seller);
        _listSimple(alice);

        uint256 dataStart = uint256(keccak256(abi.encode(_auctionsArraySlot())));

        assertEq(_sellerAtSlot(dataStart), seller, "element 0 is not where it was expected");
        assertEq(
            _sellerAtSlot(dataStart + 5),
            alice,
            "the Auction struct no longer packs into five storage slots"
        );
    }

    /// @notice Locates `_auctions` by its length, which is the only state
    ///         variable holding exactly 2 after two listings.
    /// @return The storage slot of the `_auctions` array.
    function _auctionsArraySlot() private view returns (uint256) {
        for (uint256 slot = 0; slot < 16; ++slot) {
            if (uint256(vm.load(address(house), bytes32(slot))) == 2) return slot;
        }
        revert AuctionsArrayNotFound();
    }

    /// @notice Reads the low 20 bytes of one storage slot as an address.
    /// @param slot The slot to read.
    /// @return The address packed into that slot.
    function _sellerAtSlot(uint256 slot) private view returns (address) {
        return address(uint160(uint256(vm.load(address(house), bytes32(slot)))));
    }

    // =====================================================================
    // Fuzz
    // =====================================================================

    /// @dev Fuzzes bid() across the full range the uint96 field can hold.
    function testFuzz_BidAcceptsAnyValueAtOrAboveTheMinimum(uint96 amount) public {
        (uint256 id, ) = _listSimple(seller);
        amount = uint96(bound(amount, house.MIN_INCREMENT(), type(uint96).max));

        vm.deal(alice, amount);
        vm.prank(alice);
        house.bid{value: amount}(id);

        AuctionCore.Auction memory auction = house.getAuction(id);
        assertEq(auction.highestBid, amount, "the stored bid does not match the value sent");
        assertEq(auction.highestBidder, alice);
        assertEq(house.escrowOf(id), amount);
        assertEq(address(house).balance, amount);
        _assertSolvent();
    }

    /// @dev Fuzzes bid() below the minimum. Every case MUST be rejected.
    function testFuzz_RevertWhen_BidIsBelowTheMinimum(uint96 amount) public {
        (uint256 id, ) = _listSimple(seller);
        uint256 floor = house.MIN_INCREMENT();
        amount = uint96(bound(amount, 0, floor - 1));

        vm.deal(alice, uint256(amount) + 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AuctionCore.BidTooLow.selector, floor, uint256(amount)));
        house.bid{value: amount}(id);
    }

    /// @dev Fuzzes a two-bid sequence. The escrow MUST follow the leader exactly.
    function testFuzz_OutbiddingMovesEscrowIntoPendingReturns(uint96 first, uint96 extra) public {
        (uint256 id, ) = _listSimple(seller);

        first = uint96(bound(first, house.MIN_INCREMENT(), 1_000 ether));
        vm.deal(alice, first);
        vm.prank(alice);
        house.bid{value: first}(id);

        uint256 required = house.minimumBid(id);
        uint256 second = required + bound(extra, 0, 1_000 ether);
        vm.deal(bob, second);
        vm.prank(bob);
        house.bid{value: second}(id);

        assertEq(house.pendingReturns(alice), first, "the outbid amount was not credited in full");
        assertEq(house.escrowOf(id), second);
        assertEq(address(house).balance, uint256(first) + second);
        _assertSolvent();
    }

    /// @dev Fuzzes createAuction across every legal duration and price.
    function testFuzz_CreateAuctionAcceptsTheWholeLegalRange(
        uint64 duration,
        uint96 reserve,
        uint96 buyNowSeed
    ) public {
        duration = uint64(bound(duration, house.MIN_DURATION(), house.MAX_DURATION()));
        reserve = uint96(bound(reserve, 0, 1_000 ether));

        uint96 floor = reserve > house.MIN_INCREMENT() ? reserve : house.MIN_INCREMENT();
        uint96 buyNow = uint96(bound(buyNowSeed, floor, uint256(floor) + 1_000 ether));

        uint256 tokenId = _mintAndApprove(seller);
        vm.prank(seller);
        uint256 id = house.createAuction(address(nft), tokenId, reserve, buyNow, duration);

        AuctionCore.Auction memory auction = house.getAuction(id);
        assertEq(auction.reservePrice, reserve);
        assertEq(auction.buyNowPrice, buyNow);
        assertEq(auction.endTime - auction.startTime, duration);
        assertEq(house.timeRemaining(id), duration);
        assertEq(nft.ownerOf(tokenId), address(house));
    }

    /// @dev Fuzzes createAuction outside the legal duration range.
    function testFuzz_RevertWhen_DurationIsOutOfRange(uint64 duration) public {
        uint64 minDuration = house.MIN_DURATION();
        uint64 maxDuration = house.MAX_DURATION();
        vm.assume(duration < minDuration || duration > maxDuration);
        uint256 tokenId = _mintAndApprove(seller);

        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(AuctionCore.DurationOutOfRange.selector, duration, minDuration, maxDuration)
        );
        house.createAuction(address(nft), tokenId, 0, 0, duration);
    }

    /// @dev Invariant 6 as a fuzz case: the split is exact at every fee and price.
    function testFuzz_FeeSplitIsExact(uint96 winningBid, uint16 feeBps) public {
        winningBid = uint96(bound(winningBid, house.MIN_INCREMENT(), 10_000 ether));
        feeBps = uint16(bound(feeBps, 0, house.MAX_FEE_BPS()));

        vm.prank(houseOwner);
        house.setPlatformFee(feeBps);

        (uint256 id, ) = _listSimple(seller);
        vm.deal(alice, winningBid);
        vm.prank(alice);
        house.bid{value: winningBid}(id);

        vm.warp(START_TIME + 1 hours);
        house.settle(id);

        uint256 fee = house.pendingReturns(feeSink);
        uint256 proceeds = house.pendingReturns(seller);
        assertEq(fee, (uint256(winningBid) * feeBps) / 10_000, "the fee was not rounded down");
        assertEq(fee + proceeds, winningBid, "invariant 6: the split is not exact");
        _assertSolvent();
    }

    /// @dev The minimum bid always clears the current leader by at least the floor.
    function testFuzz_MinimumBidAlwaysBeatsTheLeader(uint96 amount) public {
        (uint256 id, ) = _listSimple(seller);
        amount = uint96(bound(amount, house.MIN_INCREMENT(), 100_000 ether));

        vm.deal(alice, amount);
        vm.prank(alice);
        house.bid{value: amount}(id);

        uint256 next = house.minimumBid(id);
        assertGe(next, uint256(amount) + house.MIN_INCREMENT(), "the step fell below the floor");
    }
    // ---------------------------------------------------------------------
    // Per-auction minimum increment
    // ---------------------------------------------------------------------

    /**
     * @notice A seller can set their own bid step, and the ladder honours it.
     * @dev The whole point of the feature: 500 bps was applied to every
     *      listing, so a seller who wanted 20% steps could not ask for them.
     */
    function test_SellerCanChooseTheBidStep() public {
        uint256 tokenId = _mintAndApprove(seller);
        vm.prank(seller);
        // 2000 bps = 20%.
        uint256 id = house.createAuctionWithIncrement(address(nft), tokenId, 0, 0, 1 hours, 2000);

        assertEq(house.getAuction(id).minIncrementBps, 2000, "the step was not stored");

        vm.deal(alice, 100 ether);
        vm.prank(alice);
        house.bid{value: 10 ether}(id);

        // 10 ETH + 20% = 12 ETH, not the 10.5 ETH the default would have asked.
        assertEq(house.minimumBid(id), 12 ether, "the ladder ignored the seller's step");
    }

    /// @notice The default entry point is unchanged by the new one existing.
    function test_CreateAuctionStillUsesTheDefaultStep() public {
        (uint256 id,) = _listSimple(seller);
        assertEq(
            house.getAuction(id).minIncrementBps,
            house.DEFAULT_INCREMENT_BPS(),
            "createAuction stopped applying the default"
        );
    }

    /**
     * @notice A zero step is legal and falls back to the flat floor.
     * @dev Not a disabled increment: {_minimumBid} already floors every step at
     *      {MIN_INCREMENT}, so 0 bps means "any bid at least MIN_INCREMENT
     *      higher", which is a coherent thing for a seller to want.
     */
    function test_ZeroStepFallsBackToTheFlatFloor() public {
        uint256 tokenId = _mintAndApprove(seller);
        vm.prank(seller);
        uint256 id = house.createAuctionWithIncrement(address(nft), tokenId, 0, 0, 1 hours, 0);

        vm.deal(alice, 100 ether);
        vm.prank(alice);
        house.bid{value: 10 ether}(id);

        assertEq(house.minimumBid(id), 10 ether + house.MIN_INCREMENT(), "0 bps lost the floor");
    }

    /// @notice A step above the cap is refused at listing time.
    function test_RevertWhen_StepIsAboveTheCap() public {
        uint256 tokenId = _mintAndApprove(seller);
        uint16 cap = house.MAX_INCREMENT_BPS();
        uint16 tooBig = cap + 1;

        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(AuctionCore.IncrementOutOfRange.selector, tooBig, cap)
        );
        house.createAuctionWithIncrement(address(nft), tokenId, 0, 0, 1 hours, tooBig);
    }

    /// @notice The cap itself is allowed: the boundary is inclusive.
    function test_StepAtTheCapIsAccepted() public {
        uint256 tokenId = _mintAndApprove(seller);
        uint16 cap = house.MAX_INCREMENT_BPS();
        vm.prank(seller);
        uint256 id = house.createAuctionWithIncrement(address(nft), tokenId, 0, 0, 1 hours, cap);
        assertEq(house.getAuction(id).minIncrementBps, cap);
    }

    /// @notice The new entry point enforces every rule the old one does.
    function test_RevertWhen_NewEntryPointGetsABadBuyNow() public {
        uint256 tokenId = _mintAndApprove(seller);
        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(
                AuctionCore.InvalidBuyNowPrice.selector, uint96(1 ether), uint96(2 ether)
            )
        );
        house.createAuctionWithIncrement(address(nft), tokenId, 2 ether, 1 ether, 1 hours, 500);
    }

    /// @notice Any step in range produces a ladder that still beats the leader.
    /// @param stepSeed The requested step, bounded into the legal range.
    function testFuzz_AnyLegalStepStillBeatsTheLeader(uint16 stepSeed) public {
        uint16 step = uint16(bound(stepSeed, 0, house.MAX_INCREMENT_BPS()));
        uint256 tokenId = _mintAndApprove(seller);
        vm.prank(seller);
        uint256 id = house.createAuctionWithIncrement(address(nft), tokenId, 0, 0, 1 hours, step);

        vm.deal(alice, 1000 ether);
        vm.prank(alice);
        house.bid{value: 5 ether}(id);

        // Whatever the seller chose, the next bid must be strictly higher than
        // the standing one. A step that rounded to zero would let a bidder tie.
        assertGt(house.minimumBid(id), 5 ether, "the ladder stopped rising");
    }

}

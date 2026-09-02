// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {AuctionHouseBase} from "./AuctionHouseBase.t.sol";
import {AuctionCore} from "../src/core/AuctionCore.sol";

/**
 * @title DutchAuctionTest
 * @notice The descending-price format: the decay curve, the sale, and the ways
 *         it must refuse to behave like the ascending one.
 * @dev The invariants that matter here are the ones a falling price makes easy
 *      to get wrong: that the price never drops below the floor, that a buyer
 *      cannot be charged more than the clock is showing, that overpayment is
 *      returned rather than kept, and that the two formats cannot be operated
 *      through each other's entry points.
 */
contract DutchAuctionTest is AuctionHouseBase {
    uint96 internal constant START_PRICE = 10 ether;
    uint96 internal constant FLOOR_PRICE = 2 ether;
    uint64 internal constant SPAN = 8 hours;

    /// @dev Mints a token to `from` and opens a descending auction on it.
    function _listDutch(
        address from,
        uint96 startPrice,
        uint96 floorPrice,
        uint64 duration
    ) internal returns (uint256 auctionId, uint256 tokenId) {
        tokenId = _mintAndApprove(from);
        vm.prank(from);
        auctionId = house.createDutchAuction(address(nft), tokenId, startPrice, floorPrice, duration);
    }

    function _listDefault() internal returns (uint256 auctionId, uint256 tokenId) {
        return _listDutch(seller, START_PRICE, FLOOR_PRICE, SPAN);
    }

    // -----------------------------------------------------------------------
    // The decay curve
    // -----------------------------------------------------------------------

    function test_priceStartsAtTheOpeningPriceAndEndsAtTheFloor() public {
        (uint256 id, ) = _listDefault();

        assertEq(house.currentPrice(id), START_PRICE, "should open at the start price");

        vm.warp(START_TIME + SPAN);
        assertEq(house.currentPrice(id), FLOOR_PRICE, "should land exactly on the floor");
    }

    function test_priceFallsInAStraightLine() public {
        (uint256 id, ) = _listDefault();

        // Half the span elapsed means half the distance travelled.
        vm.warp(START_TIME + SPAN / 2);
        assertEq(house.currentPrice(id), (uint256(START_PRICE) + FLOOR_PRICE) / 2, "midpoint");

        // A quarter in, a quarter of the way down.
        vm.warp(START_TIME + SPAN / 4);
        assertEq(house.currentPrice(id), START_PRICE - (uint256(START_PRICE - FLOOR_PRICE) / 4), "quarter");
    }

    function test_priceNeverFallsBelowTheFloorHoweverLongItSits() public {
        // The clamp is what stops a stale listing being sold for nothing. The
        // linear formula alone would keep going negative past the deadline.
        (uint256 id, ) = _listDefault();

        vm.warp(START_TIME + SPAN * 100);
        assertEq(house.currentPrice(id), FLOOR_PRICE, "must clamp at the floor");
    }

    function test_priceIsMonotonicallyNonIncreasing() public {
        (uint256 id, ) = _listDefault();

        uint256 previous = type(uint256).max;
        for (uint256 t = 0; t <= SPAN; t += SPAN / 40) {
            vm.warp(START_TIME + t);
            uint256 price = house.currentPrice(id);
            assertLe(price, previous, "price rose between two moments");
            assertGe(price, FLOOR_PRICE, "price fell through the floor");
            previous = price;
        }
    }

    // -----------------------------------------------------------------------
    // Buying
    // -----------------------------------------------------------------------

    function test_buyingSettlesImmediatelyAndMovesTheTokenAndTheMoney() public {
        (uint256 id, uint256 tokenId) = _listDefault();

        vm.warp(START_TIME + SPAN / 2);
        uint256 price = house.currentPrice(id);

        vm.prank(alice);
        house.buy{value: price}(id);

        AuctionCore.Auction memory auction = house.getAuction(id);
        assertEq(uint8(auction.status), uint8(AuctionCore.Status.Settled), "sale settles in the same call");
        assertEq(auction.highestBidder, alice, "buyer recorded as the winner");
        assertEq(auction.highestBid, price, "recorded at the price actually paid");
        assertEq(nft.ownerOf(tokenId), alice, "token handed to the buyer");

        uint256 fee = (price * FEE_BPS) / 10_000;
        assertEq(house.pendingReturns(feeSink), fee, "fee credited");
        assertEq(house.pendingReturns(seller), price - fee, "seller credited the remainder");
        assertEq(house.escrowOf(id), 0, "escrow emptied by settlement");
        _assertSolvent();
    }

    function test_overpaymentIsCreditedBackAndNotTreatedAsThePrice() public {
        // The price falls every second, so a buyer cannot know the exact figure
        // their transaction will be mined against. Overpaying MUST be safe, and
        // the excess must not reach the seller or the fee.
        (uint256 id, ) = _listDefault();

        vm.warp(START_TIME + SPAN / 2);
        uint256 price = house.currentPrice(id);
        uint256 overpay = 3 ether;

        vm.prank(alice);
        house.buy{value: price + overpay}(id);

        assertEq(house.pendingReturns(alice), overpay, "excess credited to the buyer");

        uint256 fee = (price * FEE_BPS) / 10_000;
        assertEq(house.pendingReturns(feeSink), fee, "fee computed on the price, not the payment");
        assertEq(house.pendingReturns(seller), price - fee, "seller paid the price, not the payment");
        _assertSolvent();
    }

    function test_theBuyerCanWithdrawTheirOverpayment() public {
        (uint256 id, ) = _listDefault();
        vm.warp(START_TIME + SPAN / 2);
        uint256 price = house.currentPrice(id);

        vm.prank(alice);
        house.buy{value: price + 1 ether}(id);

        uint256 before = alice.balance;
        vm.prank(alice);
        house.withdraw();
        assertEq(alice.balance, before + 1 ether, "overpayment is really recoverable");
    }

    function test_payingLessThanTheClockShowsIsRejected() public {
        (uint256 id, ) = _listDefault();
        vm.warp(START_TIME + SPAN / 2);
        uint256 price = house.currentPrice(id);

        vm.expectRevert(abi.encodeWithSelector(AuctionCore.BidTooLow.selector, price, price - 1));
        vm.prank(alice);
        house.buy{value: price - 1}(id);
    }

    function test_theSellerCannotBuyTheirOwnListing() public {
        (uint256 id, ) = _listDefault();

        vm.expectRevert(AuctionCore.SellerCannotBid.selector);
        vm.prank(seller);
        house.buy{value: START_PRICE}(id);
    }

    function test_buyingIsRefusedOnceTheDeadlinePasses() public {
        // Past the deadline the item is UNSOLD, not permanently on offer at the
        // floor. Anything else would let a listing be bought years later.
        (uint256 id, ) = _listDefault();

        vm.warp(START_TIME + SPAN);
        vm.expectRevert(abi.encodeWithSelector(AuctionCore.AuctionAlreadyEnded.selector, id));
        vm.prank(alice);
        house.buy{value: START_PRICE}(id);
    }

    function test_asecondBuyerCannotBuyAnAlreadySoldListing() public {
        (uint256 id, ) = _listDefault();
        vm.warp(START_TIME + SPAN / 2);

        vm.prank(alice);
        house.buy{value: house.currentPrice(id)}(id);

        vm.expectRevert(
            abi.encodeWithSelector(AuctionCore.AuctionNotLive.selector, id, AuctionCore.Status.Settled)
        );
        vm.prank(bob);
        house.buy{value: START_PRICE}(id);
    }

    // -----------------------------------------------------------------------
    // Listing validation
    // -----------------------------------------------------------------------

    function test_refusesAListingWhosePriceWouldRise() public {
        uint256 tokenId = _mintAndApprove(seller);
        vm.expectRevert(abi.encodeWithSelector(AuctionCore.InvalidDutchPrices.selector, uint96(1 ether), uint96(2 ether)));
        vm.prank(seller);
        house.createDutchAuction(address(nft), tokenId, 1 ether, 2 ether, SPAN);
    }

    function test_refusesAZeroOpeningPrice() public {
        uint256 tokenId = _mintAndApprove(seller);
        vm.expectRevert(abi.encodeWithSelector(AuctionCore.InvalidDutchPrices.selector, uint96(0), uint96(0)));
        vm.prank(seller);
        house.createDutchAuction(address(nft), tokenId, 0, 0, SPAN);
    }

    function test_aFlatListingIsAllowedAndIsSimplyAFixedPrice() public {
        (uint256 id, ) = _listDutch(seller, 5 ether, 5 ether, SPAN);

        assertEq(house.currentPrice(id), 5 ether, "flat at the start");
        vm.warp(START_TIME + SPAN / 2);
        assertEq(house.currentPrice(id), 5 ether, "still flat halfway");
    }

    // -----------------------------------------------------------------------
    // Settlement of an unsold listing
    // -----------------------------------------------------------------------

    function test_anUnsoldListingReturnsTheTokenAndPaysNobody() public {
        (uint256 id, uint256 tokenId) = _listDefault();

        vm.warp(START_TIME + SPAN + 1);
        house.settle(id);

        AuctionCore.Auction memory auction = house.getAuction(id);
        assertEq(uint8(auction.status), uint8(AuctionCore.Status.ReserveNotMet), "unsold, not settled");
        assertEq(nft.ownerOf(tokenId), seller, "token returns to the seller");
        assertEq(house.pendingReturns(seller), 0, "seller is paid nothing");
        assertEq(house.escrowOf(id), 0, "no escrow to leave behind");
        _assertSolvent();
    }

    function test_theSellerCanCancelBeforeAnyoneBuys() public {
        (uint256 id, uint256 tokenId) = _listDefault();

        vm.prank(seller);
        house.cancelAuction(id);

        assertEq(uint8(house.getAuction(id).status), uint8(AuctionCore.Status.Cancelled));
        assertEq(nft.ownerOf(tokenId), seller, "token returns on cancel");
    }

    // -----------------------------------------------------------------------
    // The two formats must not be operable through each other
    // -----------------------------------------------------------------------

    function test_theAscendingEntryPointsRefuseADescendingListing() public {
        // Without the format guard, bid() would walk an increment ladder over a
        // listing whose reservePrice field means "floor" and whose buyNowPrice
        // field means "opening price" - and would sell it under rules its
        // seller never agreed to.
        (uint256 id, ) = _listDefault();

        vm.expectRevert(
            abi.encodeWithSelector(
                AuctionCore.WrongFormat.selector, id, AuctionCore.Format.English, AuctionCore.Format.Dutch
            )
        );
        vm.prank(alice);
        house.bid{value: 20 ether}(id);

        vm.expectRevert(
            abi.encodeWithSelector(
                AuctionCore.WrongFormat.selector, id, AuctionCore.Format.English, AuctionCore.Format.Dutch
            )
        );
        vm.prank(alice);
        house.buyNow{value: START_PRICE}(id);
    }

    function test_theDescendingEntryPointsRefuseAnAscendingListing() public {
        (uint256 id, ) = _list(seller, 1 ether, 5 ether, 1 hours);

        vm.expectRevert(
            abi.encodeWithSelector(
                AuctionCore.WrongFormat.selector, id, AuctionCore.Format.Dutch, AuctionCore.Format.English
            )
        );
        vm.prank(alice);
        house.buy{value: 5 ether}(id);

        vm.expectRevert(
            abi.encodeWithSelector(
                AuctionCore.WrongFormat.selector, id, AuctionCore.Format.Dutch, AuctionCore.Format.English
            )
        );
        house.currentPrice(id);
    }

    function test_theTwoFormatsShareOneIdSpaceAndOnePage() public {
        // One deployment, one numbering, one paged read. This is what the
        // frontend depends on and what separate per-format deployments would
        // have cost.
        (uint256 englishId, ) = _list(seller, 1 ether, 0, 1 hours);
        (uint256 dutchId, ) = _listDefault();

        assertEq(dutchId, englishId + 1, "ids continue across formats");

        AuctionCore.Auction[] memory page = house.getAuctions(0, 10);
        assertEq(page.length, 2, "one page covers both");
        assertEq(uint8(page[englishId].format), uint8(AuctionCore.Format.English));
        assertEq(uint8(page[dutchId].format), uint8(AuctionCore.Format.Dutch));
    }

    // -----------------------------------------------------------------------
    // Property
    // -----------------------------------------------------------------------

    function testFuzz_aBuyerIsNeverChargedMoreThanTheQuoteTheySaw(uint96 startPrice, uint96 floorPrice, uint32 elapsed)
        public
    {
        startPrice = uint96(bound(startPrice, 1, 1_000 ether));
        floorPrice = uint96(bound(floorPrice, 0, startPrice));
        elapsed = uint32(bound(elapsed, 0, SPAN - 1));

        (uint256 id, ) = _listDutch(seller, startPrice, floorPrice, SPAN);

        vm.warp(START_TIME + elapsed);
        uint256 quote = house.currentPrice(id);
        assertLe(quote, startPrice, "quote above the opening price");
        assertGe(quote, floorPrice, "quote below the floor");

        vm.deal(alice, uint256(startPrice) + 1 ether);
        vm.prank(alice);
        house.buy{value: quote}(id);

        // Paid exactly the quote: nothing was skimmed, nothing was credited back.
        assertEq(house.getAuction(id).highestBid, quote, "charged something other than the quote");
        assertEq(house.pendingReturns(alice), 0, "no excess when paying the exact quote");
        _assertSolvent();
    }
}

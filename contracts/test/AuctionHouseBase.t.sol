// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";

import {AuctionHouse} from "../src/AuctionHouse.sol";
import {DemoNFT} from "../src/DemoNFT.sol";

/**
 * @title AuctionHouseBase
 * @notice Shared fixture for every Solidity test in this package.
 * @dev Abstract, so the test runner does not collect it as a suite.
 */
abstract contract AuctionHouseBase is Test {
    /// @dev The default platform fee used by the fixture: 2.5%.
    uint256 internal constant FEE_BPS = 250;
    /// @dev A fixed starting time, so every test reads the same clock.
    uint256 internal constant START_TIME = 1_700_000_000;

    AuctionHouse internal house;
    DemoNFT internal nft;

    address internal houseOwner;
    address internal feeSink;
    address internal seller;
    address internal alice;
    address internal bob;
    address internal carol;
    address internal stranger;

    /// @notice Deploys a fresh house and a fresh collection, and funds the actors.
    function setUp() public virtual {
        houseOwner = makeAddr("houseOwner");
        feeSink = makeAddr("feeSink");
        seller = makeAddr("seller");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        stranger = makeAddr("stranger");

        vm.warp(START_TIME);

        house = new AuctionHouse(houseOwner, feeSink, uint16(FEE_BPS));
        nft = new DemoNFT();

        vm.deal(seller, 100 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
        vm.deal(stranger, 100 ether);
    }

    /// @dev Mints a token to `to` and approves the house for it.
    /// @param to The owner of the new token.
    /// @return tokenId The new token id.
    function _mintAndApprove(address to) internal returns (uint256 tokenId) {
        vm.startPrank(to);
        tokenId = nft.mint(to, "ipfs://demo/item.json");
        nft.approve(address(house), tokenId);
        vm.stopPrank();
    }

    /// @dev Mints a token to `from` and lists it.
    /// @param from The seller.
    /// @param reservePrice The reserve price.
    /// @param buyNowPrice The buy-now price. 0 disables it.
    /// @param duration The duration, in seconds.
    /// @return auctionId The new auction id.
    /// @return tokenId The escrowed token id.
    function _list(
        address from,
        uint96 reservePrice,
        uint96 buyNowPrice,
        uint64 duration
    ) internal returns (uint256 auctionId, uint256 tokenId) {
        tokenId = _mintAndApprove(from);
        vm.prank(from);
        auctionId = house.createAuction(address(nft), tokenId, reservePrice, buyNowPrice, duration);
    }

    /// @dev Lists with no reserve, no buy-now and a one hour duration.
    /// @param from The seller.
    /// @return auctionId The new auction id.
    /// @return tokenId The escrowed token id.
    function _listSimple(address from) internal returns (uint256 auctionId, uint256 tokenId) {
        return _list(from, 0, 0, 1 hours);
    }

    /// @dev Places a bid from `bidder` at exactly the current minimum.
    /// @param bidder The account to bid from.
    /// @param auctionId The auction.
    /// @return amount The amount bid, in wei.
    function _bidMinimum(address bidder, uint256 auctionId) internal returns (uint256 amount) {
        amount = house.minimumBid(auctionId);
        vm.deal(bidder, bidder.balance + amount);
        vm.prank(bidder);
        house.bid{value: amount}(auctionId);
    }

    /// @dev Sums everything the house owes the fixture's actors.
    /// @return total The total liability, in wei.
    function _totalPending() internal view returns (uint256 total) {
        address[7] memory accounts = [feeSink, seller, alice, bob, carol, stranger, houseOwner];
        for (uint256 i = 0; i < accounts.length; ++i) {
            total += house.pendingReturns(accounts[i]);
        }
    }

    /// @dev Sums the escrow held for every live auction.
    /// @return total The total escrow, in wei.
    function _totalLiveEscrow() internal view returns (uint256 total) {
        uint256 count = house.totalAuctions();
        for (uint256 i = 0; i < count; ++i) {
            if (house.getAuction(i).status == AuctionHouse.Status.Live) {
                total += house.getAuction(i).highestBid;
            }
        }
    }

    /// @dev Asserts invariant 1 for the fixture's actors.
    function _assertSolvent() internal view {
        assertGe(
            address(house).balance,
            _totalPending() + _totalLiveEscrow(),
            "invariant 1: house holds less than it owes"
        );
    }
}

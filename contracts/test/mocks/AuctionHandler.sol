// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {CommonBase} from "forge-std/Base.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {AuctionHouse} from "../../src/AuctionHouse.sol";
import {DemoNFT} from "../../src/DemoNFT.sol";

/**
 * @title AuctionHandler
 * @notice The state machine the invariant runner drives.
 * @dev The runner calls these functions in random order with random arguments.
 *      Each one either performs a legal action or returns without doing
 *      anything, so a run keeps making progress instead of piling up reverts.
 *      Every wei that enters the house passes through {totalDeposited}, and
 *      every wei that leaves passes through {totalWithdrawn}, which gives the
 *      invariant test a second, independent way to check solvency.
 */
contract AuctionHandler is CommonBase, StdUtils {
    /// @notice The contract under test.
    AuctionHouse public immutable HOUSE;
    /// @notice The collection the handler mints from.
    DemoNFT public immutable NFT;

    /// @notice Every account the handler acts as.
    address[] public actors;

    /// @notice Total wei sent into the house by this handler.
    uint256 public totalDeposited;
    /// @notice Total wei pulled back out of the house by this handler.
    uint256 public totalWithdrawn;

    /// @notice How many times each action actually ran, for run-quality checks.
    uint256 public createCalls;
    uint256 public bidCalls;
    uint256 public buyNowCalls;
    uint256 public settleCalls;
    uint256 public cancelCalls;
    uint256 public withdrawCalls;

    /// @param house The auction house to drive.
    /// @param nft The collection to mint listable tokens from.
    /// @param actorCount How many distinct accounts to act as.
    constructor(AuctionHouse house, DemoNFT nft, uint256 actorCount) {
        HOUSE = house;
        NFT = nft;
        for (uint256 i = 0; i < actorCount; ++i) {
            address actor = address(uint160(0xA11CE00 + i));
            actors.push(actor);
            vm.deal(actor, 1000 ether);
        }
    }

    /// @notice Every account the handler acts as.
    /// @return The actor list.
    function allActors() external view returns (address[] memory) {
        return actors;
    }

    /// @notice Mints a token and lists it.
    /// @param actorSeed Picks the seller.
    /// @param reserveSeed Picks the reserve price.
    /// @param buyNowSeed Picks the buy-now price, and whether to set one at all.
    /// @param durationSeed Picks the duration.
    function handleCreateAuction(
        uint256 actorSeed,
        uint256 reserveSeed,
        uint256 buyNowSeed,
        uint256 durationSeed
    ) external {
        // Keep the book small enough that the invariant loop stays cheap.
        if (HOUSE.totalAuctions() >= 24) return;

        address actor = _actor(actorSeed);
        uint64 duration = uint64(bound(durationSeed, HOUSE.MIN_DURATION(), HOUSE.MAX_DURATION()));
        uint96 reserve = uint96(bound(reserveSeed, 0, 50 ether));

        uint96 buyNow = 0;
        if (buyNowSeed % 2 == 1) {
            uint256 floor = reserve > HOUSE.MIN_INCREMENT() ? reserve : HOUSE.MIN_INCREMENT();
            buyNow = uint96(bound(buyNowSeed, floor, floor + 100 ether));
        }

        vm.startPrank(actor);
        uint256 tokenId = NFT.mint(actor, "ipfs://invariant");
        NFT.approve(address(HOUSE), tokenId);
        HOUSE.createAuction(address(NFT), tokenId, reserve, buyNow, duration);
        vm.stopPrank();

        createCalls += 1;
    }

    /// @notice Places a legal bid on a random live auction.
    /// @param actorSeed Picks the bidder.
    /// @param auctionSeed Picks the auction.
    /// @param extraSeed How far above the minimum to bid.
    function handleBid(uint256 actorSeed, uint256 auctionSeed, uint256 extraSeed) external {
        uint256 total = HOUSE.totalAuctions();
        if (total == 0) return;

        uint256 id = auctionSeed % total;
        AuctionHouse.Auction memory auction = HOUSE.getAuction(id);
        if (auction.status != AuctionHouse.Status.Live) return;
        if (block.timestamp >= auction.endTime) return;

        address actor = _actor(actorSeed);
        if (actor == auction.seller || actor == auction.highestBidder) return;

        uint256 amount = HOUSE.minimumBid(id) + bound(extraSeed, 0, 5 ether);
        if (amount > type(uint96).max) return;

        vm.deal(actor, actor.balance + amount);
        vm.prank(actor);
        HOUSE.bid{value: amount}(id);

        totalDeposited += amount;
        bidCalls += 1;
    }

    /// @notice Buys a random live auction outright, when buy-now is open.
    /// @param actorSeed Picks the buyer.
    /// @param auctionSeed Picks the auction.
    function handleBuyNow(uint256 actorSeed, uint256 auctionSeed) external {
        uint256 total = HOUSE.totalAuctions();
        if (total == 0) return;

        uint256 id = auctionSeed % total;
        AuctionHouse.Auction memory auction = HOUSE.getAuction(id);
        if (auction.status != AuctionHouse.Status.Live) return;
        if (block.timestamp >= auction.endTime) return;
        if (auction.buyNowPrice == 0 || auction.highestBid >= auction.buyNowPrice) return;

        address actor = _actor(actorSeed);
        if (actor == auction.seller) return;

        uint256 price = auction.buyNowPrice;
        vm.deal(actor, actor.balance + price);
        vm.prank(actor);
        HOUSE.buyNow{value: price}(id);

        totalDeposited += price;
        buyNowCalls += 1;
    }

    /// @notice Settles a random auction whose time has run out.
    /// @param auctionSeed Picks the auction.
    /// @param actorSeed Picks the caller, to prove anyone may settle.
    function handleSettle(uint256 auctionSeed, uint256 actorSeed) external {
        uint256 total = HOUSE.totalAuctions();
        if (total == 0) return;

        uint256 id = auctionSeed % total;
        if (!HOUSE.isSettleable(id)) return;

        vm.prank(_actor(actorSeed));
        HOUSE.settle(id);
        settleCalls += 1;
    }

    /// @notice Cancels a random auction that has no bids.
    /// @param auctionSeed Picks the auction.
    function handleCancel(uint256 auctionSeed) external {
        uint256 total = HOUSE.totalAuctions();
        if (total == 0) return;

        uint256 id = auctionSeed % total;
        AuctionHouse.Auction memory auction = HOUSE.getAuction(id);
        if (auction.status != AuctionHouse.Status.Live) return;
        // The same rule the contract applies: no bids at all, or a standing bid
        // that is below the reserve and so was never going to win anyway. This
        // path moves escrow into a refund, so the fuzzer must reach it.
        if (auction.highestBidder != address(0) && auction.highestBid >= auction.reservePrice) return;

        vm.prank(auction.seller);
        HOUSE.cancelAuction(id);
        cancelCalls += 1;
    }

    /// @notice Pulls whatever a random actor is owed.
    /// @param actorSeed Picks the actor.
    function handleWithdraw(uint256 actorSeed) external {
        address actor = _actor(actorSeed);
        uint256 owed = HOUSE.pendingReturns(actor);
        if (owed == 0) return;

        vm.prank(actor);
        uint256 paid = HOUSE.withdraw();

        totalWithdrawn += paid;
        withdrawCalls += 1;
    }

    /// @notice Moves the clock forward, so auctions can reach their end time.
    /// @param secondsSeed How far to jump.
    function handleWarp(uint256 secondsSeed) external {
        vm.warp(block.timestamp + bound(secondsSeed, 1, 2 days));
    }

    /// @dev Picks one actor from the seed.
    /// @param seed The fuzzed seed.
    /// @return The chosen actor.
    function _actor(uint256 seed) private view returns (address) {
        return actors[seed % actors.length];
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {AuctionCore} from "../core/AuctionCore.sol";

/**
 * @title DutchAuction
 * @author decentralised-auction
 * @notice The descending-price format: the price starts high, falls in a
 *         straight line toward a floor, and the first buyer to accept it takes
 *         the item immediately.
 * @dev The mirror image of {EnglishAuction}, and almost none of that contract
 *      applies here:
 *
 *      - There is no bidding ladder. There is one price at any instant and it
 *        is the same for everybody, so `minIncrementBps` is 0 on these
 *        listings and {bid} refuses them outright.
 *      - There is no anti-snipe rule. Sniping is waiting for the last moment
 *        to outbid someone; here waiting only lowers the price you pay, and
 *        anyone who wants the item sooner simply buys it sooner. The whole
 *        mechanism has nothing to extend.
 *      - There is never a standing bid. A purchase settles in the same
 *        transaction it is made, so a Live descending auction is by definition
 *        one that has not sold.
 *
 *      TWO STRUCT FIELDS ARE READ UNDER DIFFERENT NAMES HERE, which is worth
 *      being explicit about because it is the one genuinely surprising thing
 *      in this file:
 *
 *          reservePrice  ->  the FLOOR: where the decay stops.
 *          buyNowPrice   ->  the START: the opening price at `startTime`.
 *
 *      Both readings are faithful to the original meaning. The floor is the
 *      lowest price the seller will accept, which is exactly what a reserve
 *      is. And in a descending auction every purchase happens at the quoted
 *      price with no bidding, which is exactly what buy-now means. Reusing the
 *      slots keeps the record at five storage words and keeps one struct for
 *      every format, so the paging reads and the frontend stay uniform.
 */
abstract contract DutchAuction is AuctionCore {
    // ---------------------------------------------------------------------
    // Write - listing and buying
    // ---------------------------------------------------------------------

    /**
     * @notice Escrows the NFT and opens a Live descending-price auction.
     * @dev The caller MUST have approved this contract for `tokenId` first.
     *
     *      `startPrice` MUST NOT be below `floorPrice`, or the price would
     *      climb rather than fall and the format would be a slow English
     *      auction with one bidder. Equal prices are allowed and are a plain
     *      fixed-price listing with a deadline, which is a legitimate thing to
     *      want and needs no separate code path.
     * @param nft The ERC-721 contract.
     * @param tokenId The token to sell.
     * @param startPrice The price at `startTime`. MUST be above zero.
     * @param floorPrice The price at `endTime`. MUST NOT exceed `startPrice`.
     * @param duration Seconds of decay, from {MIN_DURATION} to {MAX_DURATION}.
     * @return auctionId The id of the new auction.
     */
    function createDutchAuction(
        address nft,
        uint256 tokenId,
        uint96 startPrice,
        uint96 floorPrice,
        uint64 duration
    ) external nonReentrant whenNotPaused returns (uint256 auctionId) {
        // A zero start would put the item on sale for nothing from the first
        // second; an inverted pair would make the price rise.
        if (startPrice == 0 || startPrice < floorPrice) {
            revert InvalidDutchPrices(startPrice, floorPrice);
        }

        // The floor goes in `reservePrice` and the start in `buyNowPrice`.
        // `minIncrementBps` is 0: there is no ladder to step up.
        auctionId = _openAuction(nft, tokenId, floorPrice, startPrice, duration, 0, Format.Dutch);
    }

    /**
     * @notice Buys the item at the price the clock is showing, and settles.
     * @dev Overpayment is CREDITED, never handed back inside this call, which
     *      keeps rule 1 intact. It is also why the check is `>=` rather than an
     *      exact match: the price falls every second, so between the moment a
     *      buyer reads a quote and the moment their transaction is mined the
     *      price has almost always moved. Demanding the exact figure would make
     *      every purchase a race against block time and most of them would
     *      revert. Sending more than the current price is therefore normal, and
     *      the difference comes back through {withdraw}.
     *
     *      The auction is finalised in this same transaction. There is nothing
     *      to wait for: the price was accepted, so the sale is complete.
     * @param auctionId The auction to buy.
     */
    function buy(uint256 auctionId) external payable nonReentrant whenNotPaused {
        Auction storage auction = _auctionAt(auctionId);

        _requireFormat(auctionId, auction, Format.Dutch);
        if (auction.status != Status.Live) revert AuctionNotLive(auctionId, auction.status);
        // The clock stops at endTime. Past it the item is unsold, not free at
        // the floor forever, so {settle} closes it rather than this function.
        if (block.timestamp >= auction.endTime) revert AuctionAlreadyEnded(auctionId);
        // Prevents the seller retiring their own listing through a fake sale,
        // and prevents wash trading. Same rule 5 as the ascending format.
        if (msg.sender == auction.seller) revert SellerCannotBid();

        uint256 price = _currentPrice(auction);
        if (msg.value < price) revert BidTooLow(price, msg.value);

        // --- Effects. Every write happens before any external call. ---
        // Rule 7: the sale price is escrowed against THIS auction, and only
        // that amount is ever paid out of it.
        _escrowOf[auctionId] += price;

        auction.highestBidder = msg.sender;
        // `price` is derived from two uint96 fields and is bounded above by
        // `startPrice`, so it cannot overflow the field it is stored in.
        auction.highestBid = uint96(price);
        auction.endTime = uint64(block.timestamp);

        // The excess is NOT part of this auction's escrow. It never belonged to
        // the sale, so it is credited straight to the buyer and left out of the
        // amount the seller and the fee are computed from.
        uint256 excess = msg.value - price;
        if (excess != 0) _credit(msg.sender, auctionId, excess);

        // There is no previous bidder to report: a descending auction that is
        // still Live has never had one.
        emit BidPlaced(auctionId, msg.sender, uint96(price), address(0), 0, auction.endTime, false);

        _finalise(auctionId, auction, Status.Settled);
    }

    // ---------------------------------------------------------------------
    // Read
    // ---------------------------------------------------------------------

    /**
     * @notice The price this auction is asking right now.
     * @dev A quote, not a promise. It falls with the block timestamp, so the
     *      figure a caller reads is the price at the CURRENT block and the
     *      transaction they send will be mined against a later, lower one.
     *      {buy} accounts for that by accepting any payment at or above its own
     *      reading and crediting the difference.
     * @param auctionId The auction.
     * @return The current asking price, in wei.
     */
    function currentPrice(uint256 auctionId) external view returns (uint256) {
        Auction storage auction = _auctionAt(auctionId);
        _requireFormat(auctionId, auction, Format.Dutch);
        return _currentPrice(auction);
    }

    // ---------------------------------------------------------------------
    // Settlement rule
    // ---------------------------------------------------------------------

    /**
     * @notice The outcome for a descending auction that reached its deadline.
     * @dev Always `ReserveNotMet`, and there is nothing to compare to decide
     *      it. A purchase settles in the same transaction it is made, so an
     *      auction still `Live` when {settle} runs is one that nobody bought at
     *      any price down to the floor. `ReserveNotMet` is precisely that: no
     *      sale, no money to move, and the token goes back to the seller.
     * @return `ReserveNotMet`, always.
     */
    function _dutchSettlementOutcome() internal pure returns (Status) {
        return Status.ReserveNotMet;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    /**
     * @notice The linear decay from the opening price to the floor.
     * @dev Clamped at both ends, so the price is defined for any timestamp:
     *      the start before the auction opens, the floor at or after the
     *      deadline. Between them it falls in a straight line.
     *
     *      Arithmetic is done in `uint256` even though both prices are `uint96`.
     *      The product of a price and an elapsed time overflows 96 bits easily,
     *      and widening first costs nothing. Neither subtraction can underflow:
     *      `startPrice >= floorPrice` is enforced at listing, and `elapsed` is
     *      strictly less than `span` on the only branch that uses it.
     * @param auction The auction storage pointer.
     * @return The asking price at `block.timestamp`, in wei.
     */
    function _currentPrice(Auction storage auction) private view returns (uint256) {
        uint256 start = auction.buyNowPrice;
        uint256 floor = auction.reservePrice;
        uint256 startTime = auction.startTime;
        uint256 endTime = auction.endTime;

        if (block.timestamp <= startTime) return start;
        if (block.timestamp >= endTime) return floor;

        uint256 elapsed = block.timestamp - startTime;
        uint256 span = endTime - startTime;
        return start - ((start - floor) * elapsed) / span;
    }
}

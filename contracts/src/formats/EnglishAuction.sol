// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {AuctionCore} from "../core/AuctionCore.sol";

/**
 * @title EnglishAuction
 * @author decentralised-auction
 * @notice The ascending-price format: bidders raise each other against a
 *         deadline, the highest bid at the close wins, and a bid placed inside
 *         the closing window pushes the deadline out.
 * @dev Everything here is about DISCOVERING A PRICE. Nothing here moves a
 *      token, decides a payout split or touches `pendingReturns` - that all
 *      belongs to {AuctionCore}, and keeping the two apart is the point of the
 *      split. The only state this module writes directly is the auction record
 *      itself and `_escrowOf`, and it writes the second only to keep rule 7
 *      true: a refunded bid leaves the escrow of the auction it was made on.
 *
 *      Two rules from the audit are enforced here rather than in the core,
 *      because both are properties of bidding:
 *
 *      5. The seller MUST NOT bid on or buy their own auction.
 *      6. `buyNowPrice == 0` means "disabled". It never means "free".
 *
 *      The anti-snipe rule is this format's alone. A descending-price auction
 *      has nothing to snipe, so it inherits none of this.
 */
abstract contract EnglishAuction is AuctionCore {

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice A bid inside this window before `endTime` pushes `endTime` out.
    uint64 public constant ANTI_SNIPE_WINDOW = 5 minutes;
    /// @notice The cap on anti-snipe extensions, so an auction always terminates.
    uint32 public constant MAX_EXTENSIONS = 20;
    /// @notice The default minimum bid step, in basis points. 500 bps is 5%.
    uint16 public constant DEFAULT_INCREMENT_BPS = 500;
    /// @notice The floor on the bid step, and the smallest first bid allowed.
    uint96 public constant MIN_INCREMENT = 0.0001 ether;

    // ---------------------------------------------------------------------
    // Write - listing and bidding
    // ---------------------------------------------------------------------

    /**
     * @notice Escrows the NFT and opens a Live auction.
     * @dev The caller MUST have approved this contract for `tokenId` first.
     *      The NFT moves in the same call, so a listing always has a real token
     *      behind it. `nonReentrant` stops a hostile ERC-721 from re-entering
     *      through the `onERC721Received` hook.
     * @param nft The ERC-721 contract.
     * @param tokenId The token to sell.
     * @param reservePrice The lowest winning price. 0 means no reserve.
     * @param buyNowPrice The instant purchase price. 0 disables buy-now.
     * @param duration Seconds of bidding, from {MIN_DURATION} to {MAX_DURATION}.
     * @return auctionId The id of the new auction.
     */
    function createAuction(
        address nft,
        uint256 tokenId,
        uint96 reservePrice,
        uint96 buyNowPrice,
        uint64 duration
    ) external nonReentrant whenNotPaused returns (uint256 auctionId) {
        if (duration < MIN_DURATION || duration > MAX_DURATION) {
            revert DurationOutOfRange(duration, MIN_DURATION, MAX_DURATION);
        }
        // Prevents a listing whose buy-now price is free or below the reserve.
        if (buyNowPrice != 0 && (buyNowPrice < MIN_INCREMENT || buyNowPrice < reservePrice)) {
            revert InvalidBuyNowPrice(buyNowPrice, reservePrice);
        }

        uint64 startTime = uint64(block.timestamp);
        uint64 endTime = startTime + duration;

        auctionId = _auctions.length;
        _auctions.push(
            Auction({
                seller: msg.sender,
                reservePrice: reservePrice,
                highestBidder: address(0),
                highestBid: 0,
                nft: nft,
                buyNowPrice: buyNowPrice,
                tokenId: tokenId,
                endTime: endTime,
                startTime: startTime,
                extensionCount: 0,
                minIncrementBps: DEFAULT_INCREMENT_BPS,
                // Snapshotted here, and read from here at settlement. Prevents
                // the owner repricing an auction that is already taking bids.
                platformFeeBps: platformFeeBps,
                status: Status.Live
            })
        );

        emit AuctionCreated(auctionId, msg.sender, nft, tokenId, reservePrice, buyNowPrice, startTime, endTime);

        // Interaction last. State is already final when the token moves.
        IERC721(nft).safeTransferFrom(msg.sender, address(this), tokenId);

        // Prevents a fake ERC-721 from accepting the call without moving the
        // token, which would list an item this contract cannot deliver.
        if (IERC721(nft).ownerOf(tokenId) != address(this)) {
            revert TransferFailed(address(this), tokenId);
        }
    }

    /**
     * @notice Places a bid. The previous leader is credited, never paid.
     * @dev No ETH leaves the contract here, so a bidder that reverts on receive
     *      cannot block the auction, and a reentrant bidder has nothing to
     *      re-enter into. A bid inside {ANTI_SNIPE_WINDOW} pushes `endTime` out.
     * @param auctionId The auction to bid on.
     */
    function bid(uint256 auctionId) external payable nonReentrant whenNotPaused {
        Auction storage auction = _auctionAt(auctionId);

        if (auction.status != Status.Live) revert AuctionNotLive(auctionId, auction.status);
        // Invariant 3: no bid is accepted at or after endTime.
        if (block.timestamp >= auction.endTime) revert AuctionAlreadyEnded(auctionId);
        // Prevents the seller from cancelling via a self-buyout, and from wash trading.
        if (msg.sender == auction.seller) revert SellerCannotBid();
        // Prevents the leader from bidding against themselves and locking extra ETH.
        if (msg.sender == auction.highestBidder) revert AlreadyHighestBidder();
        // Prevents a bid that the uint96 field would silently truncate.
        if (msg.value > type(uint96).max) revert ValueTooLarge(msg.value);

        uint256 required = _minimumBid(auction);
        if (msg.value < required) revert BidTooLow(required, msg.value);

        address previousBidder = auction.highestBidder;
        uint96 previousAmount = auction.highestBid;

        // --- Effects. Every write below happens before any external call. ---
        if (previousBidder != address(0)) {
            // Rule 7: the refund is taken out of THIS auction's escrow.
            _escrowOf[auctionId] -= previousAmount;
            _credit(previousBidder, auctionId, previousAmount);
        }
        _escrowOf[auctionId] += msg.value;

        auction.highestBidder = msg.sender;
        auction.highestBid = uint96(msg.value);

        uint64 endTime = auction.endTime;
        // Anti-snipe. The extension count is capped so the auction always ends.
        //
        // The candidate is computed FIRST and the clock only moves when the
        // candidate is genuinely later. At exactly `endTime - ANTI_SNIPE_WINDOW`
        // the candidate equals `endTime`, and burning an extension there would
        // be a zero-length extension: an attacker could exhaust all
        // {MAX_EXTENSIONS} slots in one block from as many addresses, for the
        // price of gas alone, and then snipe an auction with no anti-snipe left.
        uint64 candidate = uint64(block.timestamp) + ANTI_SNIPE_WINDOW;
        if (candidate > endTime && auction.extensionCount < MAX_EXTENSIONS) {
            endTime = candidate;
            auction.endTime = endTime;
            // Invariant 5: the guard above keeps extensionCount <= MAX_EXTENSIONS.
            unchecked {
                auction.extensionCount += 1;
            }
            emit AuctionExtended(auctionId, endTime, auction.extensionCount);
        }

        emit BidPlaced(auctionId, msg.sender, uint96(msg.value), previousBidder, previousAmount, endTime);
        // --- No interaction. This function makes no external call at all. ---
    }

    /**
     * @notice Buys the NFT immediately at `buyNowPrice` and settles at once.
     * @dev The exact price MUST be sent. Buy-now closes once a bid reaches the
     *      buy-now price, so a buyer can never take an item for less than the
     *      standing bid.
     * @param auctionId The auction to buy.
     */
    function buyNow(uint256 auctionId) external payable nonReentrant whenNotPaused {
        Auction storage auction = _auctionAt(auctionId);

        if (auction.status != Status.Live) revert AuctionNotLive(auctionId, auction.status);
        if (block.timestamp >= auction.endTime) revert AuctionAlreadyEnded(auctionId);

        uint96 price = auction.buyNowPrice;
        // Prevents free item theft: buyNowPrice == 0 means disabled, never "free".
        if (price == 0) revert BuyNowDisabled(auctionId);
        // Prevents buying below the standing bid once bidding has passed buy-now.
        if (auction.highestBid >= price) revert BuyNowDisabled(auctionId);
        // Prevents the seller from ending their own auction by buying it back.
        if (msg.sender == auction.seller) revert SellerCannotBid();
        if (msg.value != price) revert IncorrectPayment(price, msg.value);

        address previousBidder = auction.highestBidder;
        uint96 previousAmount = auction.highestBid;

        // --- Effects ---
        if (previousBidder != address(0)) {
            _escrowOf[auctionId] -= previousAmount;
            _credit(previousBidder, auctionId, previousAmount);
        }
        _escrowOf[auctionId] += price;

        auction.highestBidder = msg.sender;
        auction.highestBid = price;
        auction.endTime = uint64(block.timestamp);

        emit BidPlaced(auctionId, msg.sender, price, previousBidder, previousAmount, auction.endTime);

        // The buy-now price is never below the reserve, so the outcome is Settled.
        _finalise(auctionId, auction, Status.Settled);
    }

    // ---------------------------------------------------------------------
    // Read
    // ---------------------------------------------------------------------

    /**
     * @notice The smallest bid the auction accepts right now.
     * @dev With no bids this is {MIN_INCREMENT}. The reserve is NOT a bid floor:
     *      bids below the reserve are accepted and refunded in full at settlement.
     * @param auctionId The auction.
     * @return The minimum acceptable `msg.value`, in wei.
     */
    function minimumBid(uint256 auctionId) external view returns (uint256) {
        return _minimumBid(_auctionAt(auctionId));
    }

    // ---------------------------------------------------------------------
    // Settlement rule
    // ---------------------------------------------------------------------

    /**
     * @notice Whether a closed English auction sold.
     * @dev The reserve is the whole question. A bid below it was always going
     *      to be refunded in full, so an auction that never cleared its reserve
     *      did not sell, however many bids it took. `highestBidder == 0` covers
     *      the no-bids case, where `highestBid` is 0 and a zero reserve would
     *      otherwise read as met.
     *
     *      This is the exact expression {settle} used before the format split,
     *      moved rather than rewritten.
     * @param auction The auction storage pointer.
     * @return `Settled` when the reserve was met, `ReserveNotMet` otherwise.
     */
    function _settlementOutcome(Auction storage auction) internal view virtual override returns (Status) {
        bool reserveMet = auction.highestBidder != address(0) && auction.highestBid >= auction.reservePrice;
        return reserveMet ? Status.Settled : Status.ReserveNotMet;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    /**
     * @notice The smallest acceptable bid for `auction`.
     * @dev
     * @param auction The auction storage pointer.
     * @return The minimum `msg.value`, in wei.
     */
    function _minimumBid(Auction storage auction) private view returns (uint256) {
        uint256 highest = auction.highestBid;
        if (highest == 0) return MIN_INCREMENT;

        uint256 step = (highest * auction.minIncrementBps) / BPS_DENOMINATOR;
        if (step < MIN_INCREMENT) step = MIN_INCREMENT;
        return highest + step;
    }
}

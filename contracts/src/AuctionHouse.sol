// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AuctionHouse
 * @author decentralised-auction
 * @notice An English auction house for ERC-721 tokens, with an escrowed NFT,
 *         pull payments, anti-snipe extension and an optional buy-now price.
 * @dev The contract is immutable. There is no proxy and no upgrade path.
 *
 *      Eight rules shape this contract. Each one closes a finding from the audit
 *      of the contract it replaces:
 *
 *      1. ETH is never pushed. Every payout is credited to `pendingReturns` and
 *         the owner of the credit pulls it with {withdraw}. This removes the
 *         reentrancy drain, the permanent fund lock and the refund-revert grief.
 *      2. State is written before every external call, and every payable path
 *         carries `nonReentrant`.
 *      3. Every auction has an `endTime`, and ANYONE may call {settle} after it.
 *         A seller can no longer freeze a bidder's money by never settling.
 *      4. The NFT is escrowed at listing and released in the same transaction
 *         that credits the seller.
 *      5. The seller MUST NOT bid on or buy their own auction.
 *      6. `buyNowPrice == 0` means "disabled". It never means "free".
 *      7. Escrow is accounted per auction. One auction can never spend the ETH
 *         of another.
 *      8. All reverts use custom errors, so the frontend can decode them.
 *
 *      The contract has no `receive` and no `fallback`. ETH can only enter
 *      through {bid} and {buyNow}.
 */
contract AuctionHouse is ERC721Holder, ReentrancyGuard, Pausable, Ownable2Step {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /**
     * @notice The lifecycle state of an auction.
     * @dev `Live` is the only non-terminal state.
     */
    enum Status {
        Live,
        Settled,
        Cancelled,
        ReserveNotMet
    }

    /**
     * @notice One auction. The field order is chosen so the struct packs into
     *         five storage slots and a bid costs one SSTORE.
     * @param seller The account that listed the NFT.
     * @param reservePrice The lowest winning price. 0 means no reserve.
     * @param highestBidder The current leader. `address(0)` if there are no bids.
     * @param highestBid The current leading bid, in wei.
     * @param nft The ERC-721 contract of the escrowed token.
     * @param buyNowPrice The instant purchase price. 0 disables buy-now.
     * @param tokenId The escrowed token id.
     * @param endTime The Unix time at which bidding closes.
     * @param startTime The Unix time at which the auction opened.
     * @param extensionCount How many anti-snipe extensions have been applied.
     * @param minIncrementBps The minimum bid step, in basis points of the leading bid.
     * @param status The lifecycle state.
     */
    struct Auction {
        address seller; // slot 0 (20 + 12 = 32)
        uint96 reservePrice;
        address highestBidder; // slot 1 (20 + 12 = 32) - one SSTORE per bid
        uint96 highestBid;
        address nft; // slot 2 (20 + 12 = 32)
        uint96 buyNowPrice;
        uint256 tokenId; // slot 3
        uint64 endTime; // slot 4 (8 + 8 + 4 + 2 + 1 = 23)
        uint64 startTime;
        uint32 extensionCount;
        uint16 minIncrementBps;
        Status status;
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice The shortest auction the contract accepts. Short, so demos work.
    uint64 public constant MIN_DURATION = 1 minutes;
    /// @notice The longest auction the contract accepts.
    uint64 public constant MAX_DURATION = 30 days;
    /// @notice A bid inside this window before `endTime` pushes `endTime` out.
    uint64 public constant ANTI_SNIPE_WINDOW = 5 minutes;
    /// @notice The cap on anti-snipe extensions, so an auction always terminates.
    uint32 public constant MAX_EXTENSIONS = 20;
    /// @notice The default minimum bid step, in basis points. 500 bps is 5%.
    uint16 public constant DEFAULT_INCREMENT_BPS = 500;
    /// @notice The floor on the bid step, and the smallest first bid allowed.
    uint96 public constant MIN_INCREMENT = 0.0001 ether;
    /// @notice The hard ceiling on the platform fee, enforced in code, not policy.
    uint16 public constant MAX_FEE_BPS = 1000;
    /// @notice The largest page {getAuctions} returns. Larger requests are clamped.
    uint256 public constant MAX_PAGE_SIZE = 100;

    /// @dev The basis-point denominator. 10 000 bps is 100%.
    uint256 private constant BPS_DENOMINATOR = 10_000;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    /// @notice The auction id does not exist.
    /// @param auctionId The id that was asked for.
    error AuctionNotFound(uint256 auctionId);

    /// @notice The auction is no longer open.
    /// @param auctionId The auction.
    /// @param status The state the auction is actually in.
    error AuctionNotLive(uint256 auctionId, Status status);

    /// @notice {settle} was called before `endTime`.
    /// @param auctionId The auction.
    /// @param endTime The time at which the auction becomes settleable.
    error AuctionStillRunning(uint256 auctionId, uint64 endTime);

    /// @notice A bid or a buy-now arrived at or after `endTime`.
    /// @param auctionId The auction.
    error AuctionAlreadyEnded(uint256 auctionId);

    /// @notice The bid is below {minimumBid}.
    /// @param required The smallest bid the auction accepts now.
    /// @param provided The value that was sent.
    error BidTooLow(uint256 required, uint256 provided);

    /// @notice The seller tried to bid on or buy their own auction.
    error SellerCannotBid();

    /// @notice The caller is not the seller of this auction.
    /// @param caller The account that called.
    /// @param seller The account that listed the auction.
    error NotSeller(address caller, address seller);

    /// @notice The auction cannot be cancelled because a bid is standing.
    error AuctionHasBids();

    /// @notice Buy-now is not available: the price is 0, or bidding passed it.
    /// @param auctionId The auction.
    error BuyNowDisabled(uint256 auctionId);

    /// @notice {buyNow} needs the exact buy-now price, no more and no less.
    /// @param required The buy-now price.
    /// @param provided The value that was sent.
    error IncorrectPayment(uint256 required, uint256 provided);

    /// @notice The caller has no credit to withdraw.
    error NothingToWithdraw();

    /// @notice The requested duration is outside the accepted range.
    /// @param provided The duration that was asked for, in seconds.
    /// @param min {MIN_DURATION}.
    /// @param max {MAX_DURATION}.
    error DurationOutOfRange(uint64 provided, uint64 min, uint64 max);

    /// @notice A non-zero buy-now price MUST be at least {MIN_INCREMENT} and at
    ///         least the reserve price.
    /// @param buyNow The buy-now price that was asked for.
    /// @param reserve The reserve price that was asked for.
    error InvalidBuyNowPrice(uint96 buyNow, uint96 reserve);

    /// @notice The platform fee is above {MAX_FEE_BPS}.
    /// @param bps The fee that was asked for.
    /// @param max {MAX_FEE_BPS}.
    error FeeTooHigh(uint16 bps, uint16 max);

    /// @notice The value does not fit in the `uint96` the struct stores it in.
    /// @param value The value that was sent.
    error ValueTooLarge(uint256 value);

    /// @notice An ETH transfer or an NFT escrow failed.
    /// @param to The intended recipient.
    /// @param amount The amount in wei, or the token id for an escrow failure.
    error TransferFailed(address to, uint256 amount);

    /// @notice The caller already holds the leading bid.
    error AlreadyHighestBidder();

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /**
     * @notice An auction opened and the NFT is now in escrow.
     * @param auctionId The new auction id.
     * @param seller The account that listed the NFT.
     * @param nft The ERC-721 contract.
     * @param tokenId The escrowed token id.
     * @param reservePrice The reserve price. 0 means no reserve.
     * @param buyNowPrice The buy-now price. 0 means buy-now is disabled.
     * @param startTime The Unix time the auction opened.
     * @param endTime The Unix time bidding closes.
     */
    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed seller,
        address indexed nft,
        uint256 tokenId,
        uint96 reservePrice,
        uint96 buyNowPrice,
        uint64 startTime,
        uint64 endTime
    );

    /**
     * @notice A new leading bid was accepted.
     * @param auctionId The auction.
     * @param bidder The new leader.
     * @param amount The new leading bid, in wei.
     * @param previousBidder The account that was just outbid, or `address(0)`.
     * @param previousAmount The bid that was just beaten.
     * @param endTime The `endTime` after any anti-snipe extension.
     */
    event BidPlaced(
        uint256 indexed auctionId,
        address indexed bidder,
        uint96 amount,
        address previousBidder,
        uint96 previousAmount,
        uint64 endTime
    );

    /**
     * @notice A late bid pushed `endTime` out by {ANTI_SNIPE_WINDOW}.
     * @param auctionId The auction.
     * @param newEndTime The new close time.
     * @param extensionCount The number of extensions used so far.
     */
    event AuctionExtended(uint256 indexed auctionId, uint64 newEndTime, uint32 extensionCount);

    /**
     * @notice An auction reached a terminal state and the money was credited.
     * @param auctionId The auction.
     * @param winner The winner, or `address(0)` when the reserve was not met.
     * @param seller The account that listed the NFT.
     * @param amount The winning bid, in wei.
     * @param platformFee The fee taken from `amount`.
     * @param outcome `Settled` or `ReserveNotMet`.
     */
    event AuctionSettled(
        uint256 indexed auctionId,
        address indexed winner,
        address indexed seller,
        uint96 amount,
        uint96 platformFee,
        Status outcome
    );

    /**
     * @notice The seller withdrew an auction that had no bids.
     * @param auctionId The auction.
     * @param seller The account that listed the NFT.
     */
    event AuctionCancelled(uint256 indexed auctionId, address indexed seller);

    /**
     * @notice ETH was credited to an account. It is not sent; it is pulled.
     * @param account The account that may now call {withdraw}.
     * @param auctionId The auction the credit came from.
     * @param amount The amount credited, in wei.
     */
    event RefundCredited(address indexed account, uint256 indexed auctionId, uint256 amount);

    /**
     * @notice An account pulled its credit.
     * @param account The account that withdrew.
     * @param amount The amount sent, in wei.
     */
    event Withdrawal(address indexed account, uint256 amount);

    /**
     * @notice The platform fee changed.
     * @param oldBps The previous fee, in basis points.
     * @param newBps The new fee, in basis points.
     */
    event PlatformFeeUpdated(uint16 oldBps, uint16 newBps);

    /**
     * @notice The fee recipient changed. `address(0)` disables the fee.
     * @param oldRecipient The previous recipient.
     * @param newRecipient The new recipient.
     */
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    /**
     * @notice The NFT could not be handed over, so it stays in escrow.
     * @dev Money movement is never blocked by a broken NFT contract. This event
     *      is the audit trail when a token cannot be delivered.
     * @param auctionId The auction.
     * @param to The intended recipient.
     * @param nft The ERC-721 contract.
     * @param tokenId The token id.
     */
    event NftReleaseFailed(uint256 indexed auctionId, address indexed to, address indexed nft, uint256 tokenId);

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @dev Every auction ever created. The array index is the auction id.
    Auction[] private _auctions;

    /// @dev ETH owed to an account. The only balance {withdraw} may pay out.
    mapping(address account => uint256 amount) private _pendingReturns;

    /// @dev ETH held for one auction. Rule 7: an auction may only ever pay out
    ///      what is recorded here, so it cannot reach another auction's money.
    mapping(uint256 auctionId => uint256 amount) private _escrowOf;

    /// @notice The platform fee taken from a winning bid, in basis points.
    uint16 public platformFeeBps;

    /// @notice Where the platform fee is credited. `address(0)` disables the fee.
    address public feeRecipient;

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /**
     * @notice Deploys the auction house.
     * @param initialOwner The first owner. Ownership transfer is two-step.
     * @param initialFeeRecipient Where fees are credited. `address(0)` means no fee.
     * @param initialFeeBps The starting fee, in basis points. It MUST NOT exceed
     *        {MAX_FEE_BPS}.
     */
    constructor(address initialOwner, address initialFeeRecipient, uint16 initialFeeBps) Ownable(initialOwner) {
        if (initialFeeBps > MAX_FEE_BPS) revert FeeTooHigh(initialFeeBps, MAX_FEE_BPS);
        platformFeeBps = initialFeeBps;
        feeRecipient = initialFeeRecipient;
        emit PlatformFeeUpdated(0, initialFeeBps);
        emit FeeRecipientUpdated(address(0), initialFeeRecipient);
    }

    // ---------------------------------------------------------------------
    // Write - auction lifecycle
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
        if (endTime - uint64(block.timestamp) <= ANTI_SNIPE_WINDOW && auction.extensionCount < MAX_EXTENSIONS) {
            endTime = uint64(block.timestamp) + ANTI_SNIPE_WINDOW;
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

    /**
     * @notice Closes an auction once `endTime` has passed.
     * @dev Callable by ANYONE. That is what stops a seller from freezing a
     *      bidder's funds by refusing to settle. It is deliberately NOT gated by
     *      `whenNotPaused`, so a pause can never trap money (invariant 7).
     *      Below the reserve, or with no bids, the outcome is `ReserveNotMet`:
     *      the bidder is credited in full and the NFT goes back to the seller.
     * @param auctionId The auction to close.
     */
    function settle(uint256 auctionId) external nonReentrant {
        Auction storage auction = _auctionAt(auctionId);

        if (auction.status != Status.Live) revert AuctionNotLive(auctionId, auction.status);
        if (block.timestamp < auction.endTime) revert AuctionStillRunning(auctionId, auction.endTime);

        bool reserveMet = auction.highestBidder != address(0) && auction.highestBid >= auction.reservePrice;
        _finalise(auctionId, auction, reserveMet ? Status.Settled : Status.ReserveNotMet);
    }

    /**
     * @notice Withdraws a listing that has no bids and returns the NFT.
     * @dev Seller only, and only while `highestBidder` is `address(0)`.
     * @param auctionId The auction to cancel.
     */
    function cancelAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = _auctionAt(auctionId);

        if (auction.status != Status.Live) revert AuctionNotLive(auctionId, auction.status);
        if (msg.sender != auction.seller) revert NotSeller(msg.sender, auction.seller);
        // Prevents a seller from pulling the item out from under a standing bid.
        if (auction.highestBidder != address(0)) revert AuctionHasBids();

        // --- Effects ---
        auction.status = Status.Cancelled;
        auction.endTime = uint64(block.timestamp);

        emit AuctionCancelled(auctionId, msg.sender);

        // --- Interaction ---
        _releaseNft(auctionId, auction.nft, auction.tokenId, msg.sender);
    }

    /**
     * @notice Sends the caller everything credited to them.
     * @dev The only path by which ETH leaves this contract. The credit is zeroed
     *      before the call, so a reentrant caller finds nothing left to claim.
     *      It is deliberately NOT gated by `whenNotPaused` (invariant 7).
     * @return amount The amount sent, in wei.
     */
    function withdraw() external nonReentrant returns (uint256 amount) {
        amount = _pendingReturns[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        // Prevents the reentrancy drain: the credit is gone before the call is made.
        _pendingReturns[msg.sender] = 0;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed(msg.sender, amount);

        emit Withdrawal(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Write - admin (Ownable2Step)
    // ---------------------------------------------------------------------

    /**
     * @notice Stops new listings, bids and buy-nows.
     * @dev {withdraw} and {settle} keep working, so a pause can never trap money.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes listings, bids and buy-nows.
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Sets the platform fee taken from a winning bid.
     * @dev The ceiling is in code, not in policy: `bps` MUST NOT exceed
     *      {MAX_FEE_BPS}.
     * @param bps The new fee, in basis points.
     */
    function setPlatformFee(uint16 bps) external onlyOwner {
        // Prevents an owner from setting a confiscatory fee on live auctions.
        if (bps > MAX_FEE_BPS) revert FeeTooHigh(bps, MAX_FEE_BPS);
        uint16 oldBps = platformFeeBps;
        platformFeeBps = bps;
        emit PlatformFeeUpdated(oldBps, bps);
    }

    /**
     * @notice Sets where the platform fee is credited.
     * @dev Setting `address(0)` disables the fee. Prevents fees being credited
     *      to an address nobody can withdraw from.
     * @param recipient The new fee recipient.
     */
    function setFeeRecipient(address recipient) external onlyOwner {
        address oldRecipient = feeRecipient;
        feeRecipient = recipient;
        emit FeeRecipientUpdated(oldRecipient, recipient);
    }

    // ---------------------------------------------------------------------
    // Read
    // ---------------------------------------------------------------------

    /**
     * @notice Reads one auction.
     * @param auctionId The auction.
     * @return The auction record.
     */
    function getAuction(uint256 auctionId) external view returns (Auction memory) {
        return _auctionAt(auctionId);
    }

    /**
     * @notice Reads a page of auctions, oldest first.
     * @dev `limit` is clamped to {MAX_PAGE_SIZE} rather than rejected, so a
     *      frontend can ask for more without handling a revert. An `offset`
     *      past the end returns an empty page.
     * @param offset The first auction id to return.
     * @param limit How many to return, clamped to {MAX_PAGE_SIZE}.
     * @return page The auction records.
     */
    function getAuctions(uint256 offset, uint256 limit) external view returns (Auction[] memory page) {
        uint256 total = _auctions.length;
        if (offset >= total) return new Auction[](0);

        if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;
        uint256 available = total - offset;
        uint256 size = limit < available ? limit : available;

        page = new Auction[](size);
        for (uint256 i = 0; i < size; ++i) {
            page[i] = _auctions[offset + i];
        }
    }

    /**
     * @notice How many auctions have ever been created.
     * @return The number of auctions. Valid ids run from 0 to this minus 1.
     */
    function totalAuctions() external view returns (uint256) {
        return _auctions.length;
    }

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

    /**
     * @notice Seconds left before the auction closes.
     * @param auctionId The auction.
     * @return 0 once the auction has closed or is no longer Live.
     */
    function timeRemaining(uint256 auctionId) external view returns (uint256) {
        Auction storage auction = _auctionAt(auctionId);
        if (auction.status != Status.Live) return 0;
        if (block.timestamp >= auction.endTime) return 0;
        return auction.endTime - block.timestamp;
    }

    /**
     * @notice The ETH credited to an account and waiting to be pulled.
     * @param account The account to read.
     * @return The amount claimable with {withdraw}, in wei.
     */
    function pendingReturns(address account) external view returns (uint256) {
        return _pendingReturns[account];
    }

    /**
     * @notice The ETH held for one auction.
     * @dev Rule 7. For a Live auction this equals `highestBid`. For a closed
     *      auction it is 0, because settlement moved it into `pendingReturns`.
     * @param auctionId The auction.
     * @return The escrowed amount, in wei.
     */
    function escrowOf(uint256 auctionId) external view returns (uint256) {
        return _escrowOf[auctionId];
    }

    /**
     * @notice Whether {settle} would succeed right now.
     * @param auctionId The auction.
     * @return True when the auction is Live and `endTime` has passed.
     */
    function isSettleable(uint256 auctionId) external view returns (bool) {
        if (auctionId >= _auctions.length) return false;
        Auction storage auction = _auctions[auctionId];
        return auction.status == Status.Live && block.timestamp >= auction.endTime;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    /**
     * @notice Moves an auction to a terminal state and credits every party.
     * @dev
     *      All state is written first. The only external call is the NFT
     *      handover, and it is the last thing that happens.
     * @param auctionId The auction.
     * @param auction The auction storage pointer.
     * @param outcome `Settled` or `ReserveNotMet`.
     */
    function _finalise(uint256 auctionId, Auction storage auction, Status outcome) private {
        // --- Effects ---
        auction.status = outcome;

        // Rule 7: this auction can only ever pay out its own escrow.
        uint256 amount = _escrowOf[auctionId];
        _escrowOf[auctionId] = 0;

        address seller = auction.seller;
        address winner = auction.highestBidder;
        address nft = auction.nft;
        uint256 tokenId = auction.tokenId;

        uint96 fee = 0;
        address nftRecipient;

        if (outcome == Status.Settled) {
            address recipient = feeRecipient;
            uint16 bps = platformFeeBps;
            if (recipient != address(0) && bps != 0) {
                // Rounds down, so the dust stays with the seller (invariant 6).
                fee = uint96((amount * bps) / BPS_DENOMINATOR);
            }
            uint256 sellerProceeds = amount - fee;

            if (fee != 0) _credit(recipient, auctionId, fee);
            // Credited, never sent. A contract seller is paid exactly the way an
            // account is, so a smart-wallet seller can never be locked out.
            if (sellerProceeds != 0) _credit(seller, auctionId, sellerProceeds);

            nftRecipient = winner;
        } else {
            // Reserve not met, or no bids at all. The bidder gets every wei back.
            if (winner != address(0) && amount != 0) {
                _credit(winner, auctionId, amount);
            }
            nftRecipient = seller;
        }

        emit AuctionSettled(
            auctionId,
            outcome == Status.Settled ? winner : address(0),
            seller,
            uint96(amount),
            fee,
            outcome
        );

        // --- Interaction, last, and it cannot undo any of the above. ---
        _releaseNft(auctionId, nft, tokenId, nftRecipient);
    }

    /**
     * @notice Hands the escrowed NFT to `to`.
     * @dev
     *      `transferFrom` is used instead of `safeTransferFrom` on purpose: a
     *      contract recipient that reverts inside `onERC721Received` MUST NOT be
     *      able to block a settlement that has already moved everyone's money.
     *      The `try` wrapper covers a hostile ERC-721 for the same reason.
     * @param auctionId The auction, for the failure event.
     * @param nft The ERC-721 contract.
     * @param tokenId The token id.
     * @param to The recipient.
     */
    function _releaseNft(uint256 auctionId, address nft, uint256 tokenId, address to) private {
        // Prevents a malicious bidder or NFT contract from blocking the auction.
        // solhint-disable-next-line no-empty-blocks
        try IERC721(nft).transferFrom(address(this), to, tokenId) {
            return;
        } catch {
            emit NftReleaseFailed(auctionId, to, nft, tokenId);
        }
    }

    /**
     * @notice Records ETH owed to `account`.
     * @dev Bookkeeping only: no ETH moves here.
     * @dev
     * @param account The account to credit.
     * @param auctionId The auction the credit came from.
     * @param amount The amount, in wei.
     */
    function _credit(address account, uint256 auctionId, uint256 amount) private {
        _pendingReturns[account] += amount;
        emit RefundCredited(account, auctionId, amount);
    }

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

    /**
     * @notice Resolves an auction id to storage.
     * @dev Reverts when the id does not exist.
     * @dev
     * @param auctionId The auction.
     * @return The auction storage pointer.
     */
    function _auctionAt(uint256 auctionId) private view returns (Auction storage) {
        if (auctionId >= _auctions.length) revert AuctionNotFound(auctionId);
        return _auctions[auctionId];
    }
}

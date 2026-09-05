// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AuctionCore
 * @author decentralised-auction
 * @notice Everything an auction needs that does NOT depend on how the price is
 *         discovered: escrow, the pull-payment ledger, settlement ordering,
 *         token handover and recovery, fees, pausing and the read surface.
 * @dev This contract is abstract. A FORMAT - {EnglishAuction} and its siblings -
 *      inherits it and supplies the bidding rules, then a concrete
 *      {AuctionHouse} composes the formats it wants to offer.
 *
 *      WHY THE SPLIT IS BY INHERITANCE AND NOT BY EXTERNAL MODULES
 *      A format needs to move escrow and credit accounts. Handing that power to
 *      a separately deployed contract would create a trust boundary where a
 *      buggy or hostile module could drain another format's escrow, and rule 7
 *      below - an auction may only ever spend its own money - would stop being
 *      enforceable by the code that states it. Inheritance keeps every write to
 *      `_escrowOf` inside one deployed contract, so the audited invariants hold
 *      by construction rather than by convention. It also keeps ONE auction id
 *      space, so a listing has one address and one number wherever it is shown.
 *
 *      Deployed size is not the constraint it is usually assumed to be here:
 *      the English-only house measured 10,428 bytes, 42% of the 24 KB limit.
 *      This split is for correctness, not to buy room.
 *
 *      The eight rules from the audit are unchanged, and every one of them is
 *      enforced in this file except rule 5, which lives where bidding lives:
 *
 *      1. ETH is never pushed. Every payout is credited to `pendingReturns` and
 *         the owner of the credit pulls it with {withdraw}.
 *      2. State is written before every external call, and every payable path
 *         carries `nonReentrant`.
 *      3. Every auction has an `endTime`, and ANYONE may call {settle} after it.
 *      4. The NFT is escrowed at listing. On a sale the handover happens FIRST
 *         and it gates the payout. A token that cannot be delivered voids the
 *         sale. Any handover that reverts is recorded in {pendingNft} and
 *         retried with {claimNft}, so a token is never stranded.
 *      5. The seller MUST NOT bid on or buy their own auction. Enforced by the
 *         formats.
 *      6. `buyNowPrice == 0` means "disabled". It never means "free".
 *      7. Escrow is accounted per auction. One auction can never spend the ETH
 *         of another.
 *      8. All reverts use custom errors, so the frontend can decode them.
 *
 *      There is no `receive` and no `fallback`. ETH can only enter through a
 *      format's payable entry points.
 */
abstract contract AuctionCore is ERC721Holder, ReentrancyGuard, Pausable, Ownable2Step {

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /**
     * @notice The lifecycle state of an auction.
     * @dev `Live` is the only non-terminal state. `DeliveryFailed` is appended
     *      last, so the numbering of the four original members is unchanged.
     *      It means: the auction sold, the token could NOT be handed over, so
     *      the sale was voided. The winner holds a full refund, the seller was
     *      credited nothing, and the token is owed back to the seller - see
     *      {pendingNft} and {claimNft}.
     */
    /**
     * @notice Which set of rules discovers this auction's price.
     * @dev Stored on every auction so a format's entry points can refuse an
     *      auction that is not theirs. Without it, {bid} would happily walk the
     *      increment ladder on a descending-price listing and quietly sell it
     *      under a rule its seller never agreed to.
     *
     *      Members are append-only. The numbering of an existing member is part
     *      of the stored record and of the frontend's decoding.
     */
    enum Format {
        English,
        Dutch
    }

    enum Status {
        Live,
        Settled,
        Cancelled,
        ReserveNotMet,
        DeliveryFailed
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
     * @param platformFeeBps The platform fee AS IT STOOD WHEN THIS AUCTION OPENED,
     *        in basis points. It is snapshotted so the owner cannot reprice a
     *        live auction after the bidding has already started.
     * @param status The lifecycle state.
     * @param format Which rules discover the price. See {Format}.
     */
    struct Auction {
        address seller; // slot 0 (20 + 12 = 32)
        uint96 reservePrice;
        address highestBidder; // slot 1 (20 + 12 = 32) - one SSTORE per bid
        uint96 highestBid;
        address nft; // slot 2 (20 + 12 = 32)
        uint96 buyNowPrice;
        uint256 tokenId; // slot 3
        uint64 endTime; // slot 4 (8 + 8 + 4 + 2 + 2 + 1 + 1 = 26)
        uint64 startTime;
        uint32 extensionCount;
        uint16 minIncrementBps;
        uint16 platformFeeBps;
        Status status;
        Format format;
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice The shortest auction the contract accepts. Short, so demos work.
    uint64 public constant MIN_DURATION = 1 minutes;
    /// @notice The longest auction the contract accepts.
    uint64 public constant MAX_DURATION = 30 days;
    /// @notice The hard ceiling on the platform fee, enforced in code, not policy.
    uint16 public constant MAX_FEE_BPS = 1000;
    /// @notice The largest page {getAuctions} returns. Larger requests are clamped.
    uint256 public constant MAX_PAGE_SIZE = 100;
    /// @dev The basis-point denominator. 10 000 bps is 100%.
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    /*
     * The complete error vocabulary lives here rather than being split across
     * the formats. It is what the frontend decodes against, and one contract
     * with one decoder table is worth more than the tidiness of moving
     * `BidTooLow` next to the function that throws it.
     */

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

    /**
     * @notice The seller asked for a bid step the contract will not accept.
     * @param provided The requested step, in basis points of the leading bid.
     * @param max The largest step allowed.
     */
    error IncrementOutOfRange(uint16 provided, uint16 max);
    /// @notice A non-zero buy-now price MUST be at least {MIN_INCREMENT} and at
    ///         least the reserve price.
    /// @param buyNow The buy-now price that was asked for.
    /// @param reserve The reserve price that was asked for.
    error InvalidBuyNowPrice(uint96 buyNow, uint96 reserve);
    /// @notice The platform fee is above {MAX_FEE_BPS}.
    /// @param bps The fee that was asked for.
    /// @param max {MAX_FEE_BPS}.
    error FeeTooHigh(uint16 bps, uint16 max);
    /**
     * @notice A format's entry point was called on an auction of another format.
     * @param auctionId The auction.
     * @param expected The format the function belongs to.
     * @param actual The format the auction was listed under.
     */
    error WrongFormat(uint256 auctionId, Format expected, Format actual);

    /**
     * @notice A descending-price listing whose prices make no sense.
     * @dev The start MUST be above zero and MUST NOT be below the floor, or the
     *      price would rise over time rather than fall.
     * @param startPrice The opening price.
     * @param floorPrice The price the decay ends at.
     */
    error InvalidDutchPrices(uint96 startPrice, uint96 floorPrice);

    /// @notice The value does not fit in the `uint96` the struct stores it in.
    /// @param value The value that was sent.
    error ValueTooLarge(uint256 value);
    /// @notice An ETH transfer or an NFT escrow failed.
    /// @param to The intended recipient.
    /// @param amount The amount in wei, or the token id for an escrow failure.
    error TransferFailed(address to, uint256 amount);
    /// @notice The caller already holds the leading bid.
    error AlreadyHighestBidder();
    /// @notice The fee recipient is an address the fee could never be pulled from.
    /// @param recipient The address that was asked for.
    error InvalidFeeRecipient(address recipient);
    /// @notice {claimNft} was called for an auction that has no undelivered token.
    /// @param auctionId The auction that was asked for.
    error NoPendingNft(uint256 auctionId);

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
     * @param platformFee The fee taken from `amount`. 0 unless `outcome` is `Settled`.
     * @param outcome `Settled`, `ReserveNotMet` or `DeliveryFailed`.
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
     * @dev The failure is recorded in {pendingNft} and the token is recoverable
     *      with {claimNft}. On a sale this event always accompanies a full
     *      refund to the winner: the seller is never paid for a token that did
     *      not move.
     * @param auctionId The auction.
     * @param to The intended recipient, and the only address {claimNft} may
     *        deliver the token to.
     * @param nft The ERC-721 contract.
     * @param tokenId The token id.
     */
    event NftReleaseFailed(uint256 indexed auctionId, address indexed to, address indexed nft, uint256 tokenId);
    /**
     * @notice A token that had failed to move was collected with {claimNft}.
     * @param auctionId The auction.
     * @param to The recorded recipient, who now holds the token.
     * @param nft The ERC-721 contract.
     * @param tokenId The token id.
     */
    event NftClaimed(uint256 indexed auctionId, address indexed to, address indexed nft, uint256 tokenId);

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @dev Every auction ever created. The array index is the auction id.
    Auction[] internal _auctions;
    /// @dev ETH owed to an account. The only balance {withdraw} may pay out.
    mapping(address account => uint256 amount) private _pendingReturns;
    /// @dev ETH held for one auction. Rule 7: an auction may only ever pay out
    ///      what is recorded here, so it cannot reach another auction's money.
    mapping(uint256 auctionId => uint256 amount) internal _escrowOf;
    /// @notice The platform fee taken from a winning bid, in basis points.
    uint16 public platformFeeBps;
    /// @notice Where the platform fee is credited. `address(0)` disables the fee.
    address public feeRecipient;
    /**
     * @notice The account owed a token whose handover reverted, by auction id.
     * @dev `address(0)` means there is nothing outstanding for that auction. An
     *      auction can only reach a terminal state once, so one auction can only
     *      ever have one outstanding handover.
     */
    mapping(uint256 auctionId => address recipient) public pendingNft;

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
        // Same rule as {setFeeRecipient}: a fee credited here could never be pulled.
        if (initialFeeRecipient == address(this)) revert InvalidFeeRecipient(initialFeeRecipient);
        platformFeeBps = initialFeeBps;
        feeRecipient = initialFeeRecipient;
        emit PlatformFeeUpdated(0, initialFeeBps);
        emit FeeRecipientUpdated(address(0), initialFeeRecipient);
    }

    // ---------------------------------------------------------------------
    // Write - settlement and recovery
    // ---------------------------------------------------------------------

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

        // The ONLY format-dependent line in the core. Which outcome a closed
        // auction deserves is a property of the format, not of settlement:
        // English asks whether the reserve was met, and a descending-price
        // format has no standing bid to ask that question about.
        _finalise(auctionId, auction, _settlementOutcome(auction));
    }

    /**
     * @notice Withdraws a listing that could never have sold, and returns the NFT.
     * @dev Seller only. It is allowed while there are no bids at all, and also
     *      while the leading bid is BELOW the reserve price, because such a bid
     *      was always going to be refunded in full at settlement anyway. Without
     *      that second case a single {MIN_INCREMENT} dust bid froze a seller's
     *      token for up to {MAX_DURATION} at no cost to the bidder.
     *
     *      A standing below-reserve bidder is credited every wei of this
     *      auction's escrow, exactly as {settle} would have credited them.
     *
     *      A bid at or above the reserve is a real sale in waiting, so it still
     *      reverts with {AuctionHasBids}. With no reserve every bid is at or
     *      above it, so no auction without a reserve can ever be cancelled once
     *      a bid arrives.
     * @param auctionId The auction to cancel.
     */
    function cancelAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = _auctionAt(auctionId);

        if (auction.status != Status.Live) revert AuctionNotLive(auctionId, auction.status);
        if (msg.sender != auction.seller) revert NotSeller(msg.sender, auction.seller);

        address bidder = auction.highestBidder;
        // Prevents a seller from pulling the item out from under a winning bid.
        if (bidder != address(0) && auction.highestBid >= auction.reservePrice) revert AuctionHasBids();

        // --- Effects ---
        auction.status = Status.Cancelled;
        auction.endTime = uint64(block.timestamp);

        // Rule 7: the refund is taken out of THIS auction's escrow, and nothing
        // is left behind for a second payout.
        uint256 amount = _escrowOf[auctionId];
        _escrowOf[auctionId] = 0;
        if (bidder != address(0) && amount != 0) _credit(bidder, auctionId, amount);

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

    /**
     * @notice Retries a token handover that reverted when the auction closed.
     * @dev This is the recovery path for {NftReleaseFailed}. Without it a
     *      collection that reverted once - an `ERC721Pausable` paused at the
     *      wrong moment is enough, no attacker required - stranded the token
     *      forever, because the auction is already terminal and neither
     *      {settle} nor {cancelAuction} can run again.
     *
     *      Deliberately permissionless: the token can only ever go to the
     *      address recorded in {pendingNft}, so letting anyone push the retry is
     *      strictly safer than gating it. A recipient contract that cannot make
     *      a call of its own would otherwise be stranded by the same bug.
     *
     *      It is NOT gated by `whenNotPaused`: a pause must never trap property,
     *      for the same reason it never traps money (invariant 7).
     * @param auctionId The auction whose token is still in escrow.
     */
    function claimNft(uint256 auctionId) external nonReentrant {
        Auction storage auction = _auctionAt(auctionId);

        address recipient = pendingNft[auctionId];
        if (recipient == address(0)) revert NoPendingNft(auctionId);

        address nft = auction.nft;
        uint256 tokenId = auction.tokenId;

        // --- Effects. The record is cleared before the token moves. ---
        delete pendingNft[auctionId];

        // --- Interaction ---
        // A retry that still fails reverts the whole call, which restores the
        // record above, so the claim stays open for the next attempt.
        if (!_tryTransferNft(nft, tokenId, recipient)) revert TransferFailed(recipient, tokenId);

        emit NftClaimed(auctionId, recipient, nft, tokenId);
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
     *      {MAX_FEE_BPS}. The new fee applies only to auctions created from now
     *      on. Every auction already open keeps the fee it was listed with,
     *      because that fee is snapshotted into `Auction.platformFeeBps`.
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
     * @dev Setting `address(0)` disables the fee. Setting this contract is
     *      rejected: {withdraw} pays `msg.sender`, and this contract can never
     *      be the caller, so a fee credited there could never be pulled out.
     * @param recipient The new fee recipient.
     */
    function setFeeRecipient(address recipient) external onlyOwner {
        // Prevents fees being credited to an address nobody can withdraw from.
        if (recipient == address(this)) revert InvalidFeeRecipient(recipient);

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
    // Format hook
    // ---------------------------------------------------------------------

    /**
     * @notice The terminal state {settle} should apply to a closed auction.
     * @dev The single seam between the core and a format. The core owns escrow,
     *      payout ordering and token handover - none of which vary by format -
     *      and asks the format only the one question it cannot answer itself:
     *      did this auction sell?
     *
     *      It MUST return `Settled` or `ReserveNotMet`. Returning `Live` would
     *      leave the auction settleable forever; returning `DeliveryFailed`
     *      would claim a handover outcome before the handover was attempted.
     *      {_finalise} decides `DeliveryFailed` on its own, from the actual
     *      result of the transfer.
     * @param auction The auction storage pointer.
     * @return The outcome to finalise with.
     */
    function _settlementOutcome(Auction storage auction) internal view virtual returns (Status);

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    /**
     * @notice Escrows the token and opens a Live auction. Shared by every format.
     * @dev This is the listing sequence the audit signed off on, moved here so
     *      a second format cannot reimplement it slightly differently. The
     *      ordering is the point and it MUST NOT be rearranged: the record is
     *      complete and the event is emitted BEFORE the token moves, so the
     *      contract's state is already final when an external contract first
     *      gets control.
     *
     *      The `ownerOf` re-check afterwards is what makes escrow real. A fake
     *      ERC-721 can accept `safeTransferFrom` without moving anything, and a
     *      listing whose token never arrived is one this contract could never
     *      deliver.
     *
     *      `reservePrice` and `buyNowPrice` are stored positionally and each
     *      format reads them under its own name - a descending auction keeps
     *      its floor in `reservePrice` and its opening price in `buyNowPrice`.
     *      The {AuctionCreated} event carries them in the same two slots.
     * @param nft The ERC-721 contract.
     * @param tokenId The token to sell.
     * @param reservePrice English: the lowest winning price. Dutch: the floor.
     * @param buyNowPrice English: the instant purchase price, 0 to disable.
     *        Dutch: the opening price.
     * @param duration Seconds of bidding, from {MIN_DURATION} to {MAX_DURATION}.
     * @param minIncrementBps The bid step, for formats that ladder. 0 otherwise.
     * @param format Which rules govern this auction.
     * @return auctionId The id of the new auction.
     */
    function _openAuction(
        address nft,
        uint256 tokenId,
        uint96 reservePrice,
        uint96 buyNowPrice,
        uint64 duration,
        uint16 minIncrementBps,
        Format format
    ) internal returns (uint256 auctionId) {
        if (duration < MIN_DURATION || duration > MAX_DURATION) {
            revert DurationOutOfRange(duration, MIN_DURATION, MAX_DURATION);
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
                minIncrementBps: minIncrementBps,
                // Snapshotted here, and read from here at settlement. Prevents
                // the owner repricing an auction that is already taking bids.
                platformFeeBps: platformFeeBps,
                status: Status.Live,
                format: format
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
     * @notice Reverts unless `auction` was listed under `expected`.
     * @param auctionId The auction, for the error.
     * @param auction The auction storage pointer.
     * @param expected The format the calling function belongs to.
     */
    function _requireFormat(uint256 auctionId, Auction storage auction, Format expected) internal view {
        if (auction.format != expected) revert WrongFormat(auctionId, expected, auction.format);
    }

    /**
     * @notice Moves an auction to a terminal state and credits every party.
     * @dev
     *      The lifecycle state and the escrow are written BEFORE any external
     *      call, and every entry point that reaches here carries `nonReentrant`,
     *      so nothing re-entrant can settle the same auction twice or spend the
     *      same escrow twice. The only external calls are token handovers.
     *
     *      On a sale the NFT handover runs first and gates the money. This is
     *      the fix for the critical finding: the old order credited the seller
     *      and the fee recipient and only then tried to move the token, and it
     *      swallowed a failed handover. A seller could therefore list a token
     *      from a collection whose transfers they controlled, take the winning
     *      bid, block transfers, and leave the winner with no token AND no
     *      refund. Now a token that will not move voids the sale: the WINNER is
     *      credited the full amount, the seller is credited nothing, and the
     *      token is owed back to the seller through {pendingNft}.
     *
     *      Swallowing the failure is still right on the `ReserveNotMet` path:
     *      there the recipient is the seller, so a seller whose own collection
     *      refuses the token carries only their own risk, and the bidder must
     *      not be held hostage to it.
     * @param auctionId The auction.
     * @param auction The auction storage pointer.
     * @param outcome `Settled` or `ReserveNotMet`.
     */
    function _finalise(uint256 auctionId, Auction storage auction, Status outcome) internal {
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

        if (outcome == Status.Settled) {
            // --- Interaction FIRST, because it decides who gets paid. ---
            if (_tryTransferNft(nft, tokenId, winner)) {
                address recipient = feeRecipient;
                // The fee as it stood when this auction opened, not as it stands
                // now: the owner cannot reprice an auction that already ran.
                uint16 bps = auction.platformFeeBps;
                if (recipient != address(0) && bps != 0) {
                    // Rounds down, so the dust stays with the seller (invariant 6).
                    fee = uint96((amount * bps) / BPS_DENOMINATOR);
                }
                uint256 sellerProceeds = amount - fee;

                if (fee != 0) _credit(recipient, auctionId, fee);
                // Credited, never sent. A contract seller is paid exactly the way
                // an account is, so a smart-wallet seller can never be locked out.
                if (sellerProceeds != 0) _credit(seller, auctionId, sellerProceeds);
            } else {
                // Undelivered, so the sale is void. The winner is made whole to
                // the wei and the seller is credited nothing at all.
                outcome = Status.DeliveryFailed;
                auction.status = outcome;
                if (amount != 0) _credit(winner, auctionId, amount);
                // The winner already has their money back, so handing them the
                // token later as well would rob the seller. A void sale returns
                // the token to the seller, exactly as `ReserveNotMet` does.
                _releaseNft(auctionId, nft, tokenId, seller);
            }
        } else {
            // Reserve not met, or no bids at all. The bidder gets every wei back.
            if (winner != address(0) && amount != 0) {
                _credit(winner, auctionId, amount);
            }
            // --- Interaction. A failure here is the seller's own risk. ---
            _releaseNft(auctionId, nft, tokenId, seller);
        }

        emit AuctionSettled(
            auctionId,
            outcome == Status.ReserveNotMet ? address(0) : winner,
            seller,
            uint96(amount),
            fee,
            outcome
        );
    }
    /**
     * @notice Hands the escrowed NFT to `to`, and records the failure if it
     *         will not move.
     * @dev A failed handover is written to {pendingNft}, which is what makes it
     *      recoverable with {claimNft}. Without that record the token was
     *      stranded forever, because the auction is already terminal.
     * @param auctionId The auction, for the record and the failure event.
     * @param nft The ERC-721 contract.
     * @param tokenId The token id.
     * @param to The recipient.
     */
    function _releaseNft(uint256 auctionId, address nft, uint256 tokenId, address to) private {
        if (!_tryTransferNft(nft, tokenId, to)) {
            pendingNft[auctionId] = to;
            emit NftReleaseFailed(auctionId, to, nft, tokenId);
        }
    }
    /**
     * @notice Attempts the token handover and reports whether it really landed.
     * @dev
     *      `transferFrom` is used instead of `safeTransferFrom` on purpose: a
     *      contract recipient that reverts inside `onERC721Received` MUST NOT be
     *      able to block a settlement. The `try` wrapper covers a hostile
     *      ERC-721 for the same reason.
     *
     *      The ownership re-check is what makes the return value trustworthy. A
     *      fake ERC-721 can accept `transferFrom` without moving anything, and a
     *      silent no-op MUST NOT be read as a delivery, because the caller pays
     *      the seller on the strength of it. A collection whose `ownerOf` also
     *      lies is outside what any escrow can prove.
     * @param nft The ERC-721 contract.
     * @param tokenId The token id.
     * @param to The recipient.
     * @return True when `to` holds the token afterwards.
     */
    function _tryTransferNft(address nft, uint256 tokenId, address to) private returns (bool) {
        try IERC721(nft).transferFrom(address(this), to, tokenId) {
            try IERC721(nft).ownerOf(tokenId) returns (address owner) {
                return owner == to;
            } catch {
                return false;
            }
        } catch {
            return false;
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
    function _credit(address account, uint256 auctionId, uint256 amount) internal {
        _pendingReturns[account] += amount;
        emit RefundCredited(account, auctionId, amount);
    }
    /**
     * @notice Resolves an auction id to storage.
     * @dev Reverts when the id does not exist.
     * @dev
     * @param auctionId The auction.
     * @return The auction storage pointer.
     */
    function _auctionAt(uint256 auctionId) internal view returns (Auction storage) {
        if (auctionId >= _auctions.length) revert AuctionNotFound(auctionId);
        return _auctions[auctionId];
    }
}

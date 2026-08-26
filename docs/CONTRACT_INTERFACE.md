# AuctionHouse — interface contract

This document is the single source of truth for the on-chain API. The contract
team implements it. The web team builds against it. Do not change a signature
here without telling both.

Solidity 0.8.36. OpenZeppelin 5.6. No proxy: the contract is immutable by design.

## Design rules (each one closes an audited finding)

| Rule | Closes |
| --- | --- |
| No ETH is ever pushed. All value is credited and pulled with `withdraw()`. | Reentrancy drain, permanent fund lock, refund-revert griefing |
| State is written before any external call. `nonReentrant` on every payable path. | Reentrancy drain |
| Every auction has an `endTime`. Anyone may `settle()` after it passes. | Seller-only settlement locking bidder funds |
| The NFT is escrowed at listing and released atomically with payment. | Winner previously received nothing |
| The seller cannot bid on or buy their own auction. | Free cancellation, wash trading, bid front-running |
| `buyNowPrice == 0` means "disabled", never "free". | Free item theft |
| Per-auction escrow accounting. One auction can never spend another's ETH. | Cross-auction drain |
| Custom errors, not revert strings. | Gas, and decodable frontend messages |

## Types

```solidity
enum Status { Live, Settled, Cancelled, ReserveNotMet }

struct Auction {
    address seller;           // slot 0 (20 + 12 = 32)
    uint96  reservePrice;     // 0 means no reserve
    address highestBidder;    // slot 1 (20 + 12 = 32) — one SSTORE per bid
    uint96  highestBid;
    address nft;              // slot 2 (20 + 12 = 32)
    uint96  buyNowPrice;      // 0 means buy-now disabled
    uint256 tokenId;          // slot 3
    uint64  endTime;          // slot 4 (8 + 8 + 4 + 2 + 1 = 23)
    uint64  startTime;
    uint32  extensionCount;
    uint16  minIncrementBps;
    Status  status;
}
```

## Errors

```solidity
error AuctionNotFound(uint256 auctionId);
error AuctionNotLive(uint256 auctionId, Status status);
error AuctionStillRunning(uint256 auctionId, uint64 endTime);
error AuctionAlreadyEnded(uint256 auctionId);
error BidTooLow(uint256 required, uint256 provided);
error SellerCannotBid();
error NotSeller(address caller, address seller);
error AuctionHasBids();
error BuyNowDisabled(uint256 auctionId);
error IncorrectPayment(uint256 required, uint256 provided);
error NothingToWithdraw();
error DurationOutOfRange(uint64 provided, uint64 min, uint64 max);
error InvalidBuyNowPrice(uint96 buyNow, uint96 reserve);
error FeeTooHigh(uint16 bps, uint16 max);
error ValueTooLarge(uint256 value);
error TransferFailed(address to, uint256 amount);
error AlreadyHighestBidder();
```

## Write functions

```solidity
/// Escrows the NFT and opens a Live auction. Caller MUST have approved this
/// contract for `tokenId` first.
function createAuction(
    address nft,
    uint256 tokenId,
    uint96  reservePrice,
    uint96  buyNowPrice,   // 0 disables buy-now
    uint64  duration       // seconds; MIN_DURATION..MAX_DURATION
) external whenNotPaused returns (uint256 auctionId);

/// Places a bid. Credits the previous bidder's refund; never sends it.
/// Extends `endTime` when it lands inside the anti-snipe window.
function bid(uint256 auctionId) external payable nonReentrant whenNotPaused;

/// Buys immediately at `buyNowPrice`. Settles in the same transaction.
function buyNow(uint256 auctionId) external payable nonReentrant whenNotPaused;

/// Settles after `endTime`. Callable by ANYONE, which is what stops a seller
/// from freezing a bidder's funds. Below reserve, the outcome is
/// ReserveNotMet: the bidder is credited in full and the NFT returns.
function settle(uint256 auctionId) external nonReentrant;

/// Seller-only, and only while there are no bids. Returns the NFT.
function cancelAuction(uint256 auctionId) external nonReentrant;

/// Withdraws everything credited to the caller. The only way ETH leaves.
function withdraw() external nonReentrant returns (uint256 amount);
```

## Read functions

```solidity
function getAuction(uint256 auctionId) external view returns (Auction memory);
function getAuctions(uint256 offset, uint256 limit) external view returns (Auction[] memory);
function totalAuctions() external view returns (uint256);
function minimumBid(uint256 auctionId) external view returns (uint256);
function timeRemaining(uint256 auctionId) external view returns (uint256);
function pendingReturns(address account) external view returns (uint256);
function isSettleable(uint256 auctionId) external view returns (bool);
```

`getAuctions` MUST clamp `limit` to `MAX_PAGE_SIZE` (100) rather than revert.

## Admin — Ownable2Step

```solidity
function pause() external onlyOwner;      // MUST NOT block withdraw or settle
function unpause() external onlyOwner;
function setPlatformFee(uint16 bps) external onlyOwner;  // hard cap MAX_FEE_BPS
function setFeeRecipient(address recipient) external onlyOwner;
```

## Events — all join keys indexed, so a log consumer can reconstruct state

```solidity
event AuctionCreated(
    uint256 indexed auctionId, address indexed seller, address indexed nft,
    uint256 tokenId, uint96 reservePrice, uint96 buyNowPrice,
    uint64 startTime, uint64 endTime
);
event BidPlaced(
    uint256 indexed auctionId, address indexed bidder, uint96 amount,
    address previousBidder, uint96 previousAmount, uint64 endTime
);
event AuctionExtended(uint256 indexed auctionId, uint64 newEndTime, uint32 extensionCount);
event AuctionSettled(
    uint256 indexed auctionId, address indexed winner, address indexed seller,
    uint96 amount, uint96 platformFee, Status outcome
);
event AuctionCancelled(uint256 indexed auctionId, address indexed seller);
event RefundCredited(address indexed account, uint256 indexed auctionId, uint256 amount);
event Withdrawal(address indexed account, uint256 amount);
event PlatformFeeUpdated(uint16 oldBps, uint16 newBps);
```

## Constants

```solidity
uint64  public constant MIN_DURATION      = 1 minutes;   // short, so demos work
uint64  public constant MAX_DURATION      = 30 days;
uint64  public constant ANTI_SNIPE_WINDOW = 5 minutes;
uint32  public constant MAX_EXTENSIONS    = 20;
uint16  public constant DEFAULT_INCREMENT_BPS = 500;     // 5%
uint96  public constant MIN_INCREMENT     = 0.0001 ether;
uint16  public constant MAX_FEE_BPS       = 1000;        // 10% ceiling in code
uint256 public constant MAX_PAGE_SIZE     = 100;
```

## Invariants the tests MUST prove

1. `address(this).balance >= sum(pendingReturns) + sum(highestBid of Live auctions)`
2. A Live auction's `highestBid` never decreases.
3. No bid is accepted at or after `endTime`.
4. A settled auction's NFT is owned by the winner; a ReserveNotMet or Cancelled
   auction's NFT is owned by the seller.
5. `extensionCount <= MAX_EXTENSIONS`.
6. The sum of seller proceeds and platform fee equals the winning bid exactly.
   Rounding dust goes to the seller.
7. Pausing MUST NOT prevent `withdraw()` or `settle()`.

## Demo companion

`DemoNFT` — a minimal ERC-721 with public `mint(address to, string memory uri)`
so the seed script and the UI can create listable items without a marketplace.

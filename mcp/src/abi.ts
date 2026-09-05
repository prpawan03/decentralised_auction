/**
 * The ABI fragments this server needs, hand-written rather than imported.
 *
 * WHY hand-written instead of importing `contracts/artifacts/**` or the
 * indexer's `abis/`:
 *
 *   1. This package is deliberately STANDALONE (see package.json). Importing a
 *      build artifact from a sibling directory would make `npm install` here
 *      depend on `hardhat compile` having been run there, and would silently
 *      break the moment someone runs `make clean`. A hand-written ABI makes the
 *      MCP server installable and type-checkable on a fresh clone.
 *   2. It is an explicit ALLOWLIST. The server can only ever encode calldata for
 *      the functions written below. `pause`, `unpause`, `setPlatformFee` and
 *      `setFeeRecipient` are owner-only and are deliberately ABSENT: even if the
 *      key were swapped for the owner's, there is no code path here that could
 *      encode a call to them. This is defence in depth behind the
 *      not-the-deployer-key rule in index.ts.
 *   3. `createAuction` is likewise absent. An agent browsing and bidding does
 *      not need to list items, and listing requires an ERC-721 approval dance
 *      that is well outside this server's remit.
 *
 * The tuple field ORDER below must match `struct Auction` in
 * contracts/src/AuctionHouse.sol exactly, because viem decodes positionally.
 * The struct is packed into five slots and the field order is load-bearing.
 */

/**
 * `enum Status` from AuctionHouse.sol, in declaration order.
 *
 * Solidity enums are ABI-encoded as uint8 ordinals, so the INDEX of each entry
 * is the wire value. Never reorder this array.
 *
 * NOTE FOR ANYONE COMPARING THIS TO THE PROJECT BRIEF: there is no `Format`
 * enum and no English/Dutch split in the deployed contract. AuctionHouse.sol is
 * a single English-auction implementation with anti-snipe extension and an
 * optional buy-now price. See the `format` note in index.ts.
 */
export const AUCTION_STATUS = [
  "Live",
  "Settled",
  "Cancelled",
  "ReserveNotMet",
  "DeliveryFailed",
] as const;

export type AuctionStatus = (typeof AUCTION_STATUS)[number];

/**
 * `enum Format`, in declaration order. Present only in the newer contract
 * layout -- see AUCTION_TUPLE_WITH_FORMAT below.
 */
export const AUCTION_FORMAT = ["English", "Dutch"] as const;

export type AuctionFormat = (typeof AUCTION_FORMAT)[number];

/**
 * The `Auction` struct components, BASE layout (13 fields).
 *
 * Matches contracts/src/AuctionHouse.sol as it stands in the source tree.
 */
export const AUCTION_TUPLE_BASE = [
  { name: "seller", type: "address" },
  { name: "reservePrice", type: "uint96" },
  { name: "highestBidder", type: "address" },
  { name: "highestBid", type: "uint96" },
  { name: "nft", type: "address" },
  { name: "buyNowPrice", type: "uint96" },
  { name: "tokenId", type: "uint256" },
  { name: "endTime", type: "uint64" },
  { name: "startTime", type: "uint64" },
  { name: "extensionCount", type: "uint32" },
  { name: "minIncrementBps", type: "uint16" },
  { name: "platformFeeBps", type: "uint16" },
  { name: "status", type: "uint8" },
] as const;

/**
 * The `Auction` struct components, EXTENDED layout (14 fields) -- the base
 * layout plus a trailing `Format format`.
 *
 * WHY BOTH LAYOUTS EXIST HERE, and why this is not over-engineering:
 *
 * The contract deployed on the local chain and the Solidity source in this
 * repository are NOT currently in step. The source (and the compiled artifact
 * under contracts/artifacts) declares 13 fields; the bytecode actually deployed
 * at the auction house address returns 14 words per auction, the extra one being
 * a `Format` enum whose observed values are 0 and 1. This was confirmed by
 * decoding all 24 live auctions and cross-checking the status ordinals against
 * `isSettleable()`: field 12 takes the values 0/1/3 and tracks Live/Settled/
 * ReserveNotMet exactly, and field 13 takes only 0/1 independently of lifecycle.
 *
 * viem decodes tuples POSITIONALLY and by fixed width, so guessing wrong is not
 * a soft failure -- it throws while decoding, and every read tool breaks. Rather
 * than hardcode whichever layout happens to be deployed today (and break the
 * moment the contracts are redeployed either way), the server DETECTS the layout
 * once at startup by counting the words `getAuction` returns. See auctions.ts.
 */
export const AUCTION_TUPLE_WITH_FORMAT = [
  ...AUCTION_TUPLE_BASE,
  { name: "format", type: "uint8" },
] as const;

/** Number of 32-byte words each layout occupies. Static tuples only, so 1:1. */
export const BASE_FIELD_COUNT = AUCTION_TUPLE_BASE.length;
export const WITH_FORMAT_FIELD_COUNT = AUCTION_TUPLE_WITH_FORMAT.length;

/** Alias kept for the ABI entries below, which only need a shape to encode. */
const AUCTION_TUPLE = AUCTION_TUPLE_BASE;

export const auctionHouseAbi = [
  // --- Reads ---------------------------------------------------------------
  {
    type: "function",
    name: "totalAuctions",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  // NOTE: the declared `outputs` of getAuction/getAuctions are the BASE layout,
  // but nothing decodes through them. auctions.ts encodes the calldata from
  // these fragments and then decodes the return data against the layout it
  // detected at startup, precisely because the deployed shape varies. Do not
  // switch these two to `readContract` -- that would decode with the base
  // layout unconditionally and throw against the extended one.
  {
    type: "function",
    name: "getAuction",
    stateMutability: "view",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [{ type: "tuple", components: AUCTION_TUPLE }],
  },
  {
    type: "function",
    name: "getAuctions",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [{ name: "page", type: "tuple[]", components: AUCTION_TUPLE }],
  },
  {
    type: "function",
    name: "minimumBid",
    stateMutability: "view",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "timeRemaining",
    stateMutability: "view",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingReturns",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "escrowOf",
    stateMutability: "view",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "isSettleable",
    stateMutability: "view",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  // `paused()` comes from OpenZeppelin's Pausable. Worth reading because a
  // paused house rejects bid/buyNow but still allows settle/withdraw, and an
  // agent that knows this can explain the failure instead of retrying forever.
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "MIN_INCREMENT",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint96" }],
  },
  /**
   * DUTCH ONLY. The current, declining ask price.
   *
   * Present only on the extended (Format-carrying) deployment. Calling it on an
   * English auction reverts with WrongFormat, and conversely `minimumBid`
   * reverts with WrongFormat on a Dutch auction -- the two formats have
   * genuinely disjoint pricing reads, which is why the tools branch on format
   * rather than calling both and hoping.
   */
  {
    type: "function",
    name: "currentPrice",
    stateMutability: "view",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },

  // --- Writes (the complete allowlist) -------------------------------------
  {
    type: "function",
    name: "bid",
    stateMutability: "payable",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "buyNow",
    stateMutability: "payable",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [],
  },
  /**
   * DUTCH ONLY. Takes the item at the current declining price.
   *
   * Unlike `buyNow` (English, which demands the EXACT price), `buy` accepts any
   * value at or above `currentPrice` -- verified empirically against the
   * deployed contract, since the source for this version is not in the tree.
   * That tolerance matters: a Dutch price falls every second, so an exact-match
   * requirement would make the call a race that nearly always loses.
   */
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelAuction",
    stateMutability: "nonpayable",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "amount", type: "uint256" }],
  },

  // --- Events (read for bid history) ---------------------------------------
  {
    type: "event",
    name: "BidPlaced",
    inputs: [
      { name: "auctionId", type: "uint256", indexed: true },
      { name: "bidder", type: "address", indexed: true },
      { name: "amount", type: "uint96", indexed: false },
      { name: "previousBidder", type: "address", indexed: false },
      { name: "previousAmount", type: "uint96", indexed: false },
      { name: "endTime", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AuctionSettled",
    inputs: [
      { name: "auctionId", type: "uint256", indexed: true },
      { name: "winner", type: "address", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "amount", type: "uint96", indexed: false },
      { name: "platformFee", type: "uint96", indexed: false },
      { name: "outcome", type: "uint8", indexed: false },
    ],
  },

  // --- Custom errors -------------------------------------------------------
  // These MUST be present in the ABI or viem cannot name a revert: without the
  // fragment the best it can say is "reverted with an unknown reason", which is
  // exactly the uninformative failure this server exists to avoid. Every error
  // declared in AuctionHouse.sol is listed, including the ones only owner-only
  // paths can raise, so an unexpected revert is still decoded rather than
  // reported as an opaque 4-byte selector.
  { type: "error", name: "AuctionNotFound", inputs: [{ name: "auctionId", type: "uint256" }] },
  {
    type: "error",
    name: "AuctionNotLive",
    inputs: [
      { name: "auctionId", type: "uint256" },
      { name: "status", type: "uint8" },
    ],
  },
  {
    type: "error",
    name: "AuctionStillRunning",
    inputs: [
      { name: "auctionId", type: "uint256" },
      { name: "endTime", type: "uint64" },
    ],
  },
  { type: "error", name: "AuctionAlreadyEnded", inputs: [{ name: "auctionId", type: "uint256" }] },
  {
    type: "error",
    name: "BidTooLow",
    inputs: [
      { name: "required", type: "uint256" },
      { name: "provided", type: "uint256" },
    ],
  },
  { type: "error", name: "SellerCannotBid", inputs: [] },
  {
    type: "error",
    name: "NotSeller",
    inputs: [
      { name: "caller", type: "address" },
      { name: "seller", type: "address" },
    ],
  },
  { type: "error", name: "AuctionHasBids", inputs: [] },
  { type: "error", name: "BuyNowDisabled", inputs: [{ name: "auctionId", type: "uint256" }] },
  {
    type: "error",
    name: "IncorrectPayment",
    inputs: [
      { name: "required", type: "uint256" },
      { name: "provided", type: "uint256" },
    ],
  },
  { type: "error", name: "NothingToWithdraw", inputs: [] },
  {
    type: "error",
    name: "DurationOutOfRange",
    inputs: [
      { name: "provided", type: "uint64" },
      { name: "min", type: "uint64" },
      { name: "max", type: "uint64" },
    ],
  },
  {
    type: "error",
    name: "InvalidBuyNowPrice",
    inputs: [
      { name: "buyNow", type: "uint96" },
      { name: "reserve", type: "uint96" },
    ],
  },
  {
    type: "error",
    name: "FeeTooHigh",
    inputs: [
      { name: "bps", type: "uint16" },
      { name: "max", type: "uint16" },
    ],
  },
  { type: "error", name: "ValueTooLarge", inputs: [{ name: "value", type: "uint256" }] },
  {
    type: "error",
    name: "TransferFailed",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
  { type: "error", name: "AlreadyHighestBidder", inputs: [] },
  /**
   * Raised when an operation is applied to the wrong auction format -- `bid` or
   * `minimumBid` on a Dutch auction, `buy` on an English one.
   *
   * The name and argument types were recovered by matching the observed 4-byte
   * selector 0xacf2cad9 against candidate signatures: keccak
   * ("WrongFormat(uint256,uint8,uint8)") matches exactly. The argument meanings
   * were then confirmed from live reverts, which carried (auctionId, 0, 1) for a
   * Dutch auction -- i.e. (id, expected, actual) with English=0 and Dutch=1.
   * This fragment exists only on the extended deployment; on the base contract
   * it is simply never raised.
   */
  {
    type: "error",
    name: "WrongFormat",
    inputs: [
      { name: "auctionId", type: "uint256" },
      { name: "expected", type: "uint8" },
      { name: "actual", type: "uint8" },
    ],
  },
  { type: "error", name: "InvalidFeeRecipient", inputs: [{ name: "recipient", type: "address" }] },
  { type: "error", name: "NoPendingNft", inputs: [{ name: "auctionId", type: "uint256" }] },
  // Raised by OpenZeppelin Pausable when the house is paused.
  { type: "error", name: "EnforcedPause", inputs: [] },
  // Raised by OpenZeppelin ReentrancyGuard.
  { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
] as const;

/**
 * The slice of ERC-721 needed to read metadata. `tokenURI` and `ownerOf` only.
 *
 * NOTE: there is deliberately no `approve`, `setApprovalForAll` or
 * `transferFrom` here. An agent with a token approval primitive could be talked
 * into handing an NFT to an arbitrary address; browsing and bidding needs none
 * of that, so the capability simply does not exist in this process.
 */
export const erc721Abi = [
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

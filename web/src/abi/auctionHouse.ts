// GENERATED — replaced by `npm run export-abi`
//
// Hand-written from docs/CONTRACT_INTERFACE.md so the web package is never
// blocked on the contracts package. When `contracts/scripts/export-abi.ts`
// runs it overwrites this file with the compiler's own output. If the two ever
// disagree, the compiler wins and CONTRACT_INTERFACE.md is the bug.
//
// `as const` is load-bearing: it is what gives viem/wagmi full type inference
// on every argument, return value, event payload and custom error.

export const auctionHouseAbi = [
  // ---- errors -----------------------------------------------------------
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

  // ---- events -----------------------------------------------------------
  {
    type: "event",
    name: "AuctionCreated",
    inputs: [
      { name: "auctionId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "nft", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "reservePrice", type: "uint96", indexed: false },
      { name: "buyNowPrice", type: "uint96", indexed: false },
      { name: "startTime", type: "uint64", indexed: false },
      { name: "endTime", type: "uint64", indexed: false },
    ],
    anonymous: false,
  },
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
    anonymous: false,
  },
  {
    type: "event",
    name: "AuctionExtended",
    inputs: [
      { name: "auctionId", type: "uint256", indexed: true },
      { name: "newEndTime", type: "uint64", indexed: false },
      { name: "extensionCount", type: "uint32", indexed: false },
    ],
    anonymous: false,
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
    anonymous: false,
  },
  {
    type: "event",
    name: "AuctionCancelled",
    inputs: [
      { name: "auctionId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RefundCredited",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "auctionId", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Withdrawal",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PlatformFeeUpdated",
    inputs: [
      { name: "oldBps", type: "uint16", indexed: false },
      { name: "newBps", type: "uint16", indexed: false },
    ],
    anonymous: false,
  },

  // ---- writes -----------------------------------------------------------
  {
    type: "function",
    name: "createAuction",
    stateMutability: "nonpayable",
    inputs: [
      { name: "nft", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "reservePrice", type: "uint96" },
      { name: "buyNowPrice", type: "uint96" },
      { name: "duration", type: "uint64" },
    ],
    outputs: [{ name: "auctionId", type: "uint256" }],
  },
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

  // ---- reads ------------------------------------------------------------
  {
    type: "function",
    name: "getAuction",
    stateMutability: "view",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
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
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getAuctions",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
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
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "totalAuctions",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "minimumBid",
    stateMutability: "view",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "timeRemaining",
    stateMutability: "view",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingReturns",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isSettleable",
    stateMutability: "view",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },

  // ---- constants --------------------------------------------------------
  { type: "function", name: "MIN_DURATION", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "MAX_DURATION", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "ANTI_SNIPE_WINDOW", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "MAX_EXTENSIONS", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint32" }] },
  { type: "function", name: "DEFAULT_INCREMENT_BPS", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint16" }] },
  { type: "function", name: "MIN_INCREMENT", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint96" }] },
  { type: "function", name: "MAX_FEE_BPS", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint16" }] },
  { type: "function", name: "MAX_PAGE_SIZE", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

export type AuctionHouseAbi = typeof auctionHouseAbi;

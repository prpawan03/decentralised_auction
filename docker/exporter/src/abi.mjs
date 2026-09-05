/**
 * The slice of the AuctionHouse ABI that this exporter actually calls.
 *
 * WHY a hand-written slice instead of importing contracts/artifacts:
 * the exporter image MUST NOT depend on the contracts workspace. If it did,
 * every Solidity edit would invalidate the exporter's Docker layer and a
 * `make up` after a contract change would rebuild the monitoring stack too.
 * Four view functions are a small, stable surface -- they are part of the
 * frontend's public read API -- so pinning them here is cheaper than the
 * coupling.
 *
 * The struct field ORDER is load-bearing: viem decodes tuples positionally.
 * It mirrors contracts/src/AuctionHouse.sol exactly, including the storage
 * packing order the contract chose (seller+reservePrice share slot 0, and so
 * on). If that struct is ever reordered, this file MUST be reordered with it
 * -- a mismatch decodes silently into garbage rather than throwing.
 */

/**
 * Solidity `enum Status` from AuctionHouse.sol, by ordinal.
 *
 * `DeliveryFailed` was appended last precisely so these ordinals never move,
 * which is what makes it safe to hard-code them in a separate service.
 */
export const STATUS = Object.freeze({
  LIVE: 0,
  SETTLED: 1,
  CANCELLED: 2,
  RESERVE_NOT_MET: 3,
  DELIVERY_FAILED: 4,
});

/**
 * `MAX_PAGE_SIZE` in the contract. Asking for more is not an error -- the
 * contract clamps -- but paging in lockstep with the clamp means the caller
 * can trust `page.length < PAGE_SIZE` as the end-of-list signal.
 */
export const MAX_PAGE_SIZE = 100;

/** The `Auction` struct, as a viem tuple component list. */
const AUCTION_TUPLE = {
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
    { name: "platformFeeBps", type: "uint16" },
    { name: "status", type: "uint8" },
  ],
};

export const AUCTION_HOUSE_ABI = [
  {
    type: "function",
    name: "totalAuctions",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getAuctions",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [{ name: "page", type: "tuple[]", components: AUCTION_TUPLE.components }],
  },
  {
    type: "function",
    name: "escrowOf",
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
];

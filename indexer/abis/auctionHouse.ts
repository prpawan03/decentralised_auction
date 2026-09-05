// ---------------------------------------------------------------------------
// AuctionHouse ABI: the events this indexer reads and the views it calls.
//
// This is a HAND-TRIMMED copy of contracts/artifacts, not the whole ABI.
// Reasons:
//
//   1. The indexer image MUST NOT depend on contracts/artifacts. Those files
//      are gitignored, they are produced by solc, and requiring them would
//      couple `docker compose build indexer` to a Solidity compile.
//   2. Ponder derives its event handler names and their argument types from
//      this array. A smaller array is a smaller surface: a stray inherited
//      event (Paused, OwnershipTransferred) would otherwise show up as a
//      registerable handler that nobody wrote, which reads as an oversight.
//
// KEEP IN SYNC. If a contract event signature changes, this file MUST change
// with it, or Ponder silently indexes nothing for that event -- the topic0
// hash simply never matches. `npm run test:contracts` does not catch that.
// Regenerate with:
//   node -e "console.log(JSON.stringify(require('./contracts/artifacts/src/AuctionHouse.sol/AuctionHouse.json').abi))"
// ---------------------------------------------------------------------------

export const auctionHouseAbi = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "auctionId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "address",
        name: "seller",
        type: "address",
      },
    ],
    name: "AuctionCancelled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "auctionId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "address",
        name: "seller",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "nft",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "tokenId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint96",
        name: "reservePrice",
        type: "uint96",
      },
      {
        indexed: false,
        internalType: "uint96",
        name: "buyNowPrice",
        type: "uint96",
      },
      {
        indexed: false,
        internalType: "uint64",
        name: "startTime",
        type: "uint64",
      },
      {
        indexed: false,
        internalType: "uint64",
        name: "endTime",
        type: "uint64",
      },
      {
        indexed: false,
        internalType: "enum AuctionCore.Format",
        name: "format",
        type: "uint8",
      },
    ],
    name: "AuctionCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "auctionId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint64",
        name: "newEndTime",
        type: "uint64",
      },
      {
        indexed: false,
        internalType: "uint32",
        name: "extensionCount",
        type: "uint32",
      },
    ],
    name: "AuctionExtended",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "auctionId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "address",
        name: "winner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "seller",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint96",
        name: "amount",
        type: "uint96",
      },
      {
        indexed: false,
        internalType: "uint96",
        name: "platformFee",
        type: "uint96",
      },
      {
        indexed: false,
        internalType: "enum AuctionCore.Status",
        name: "outcome",
        type: "uint8",
      },
    ],
    name: "AuctionSettled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "auctionId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "address",
        name: "bidder",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint96",
        name: "amount",
        type: "uint96",
      },
      {
        indexed: false,
        internalType: "address",
        name: "previousBidder",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint96",
        name: "previousAmount",
        type: "uint96",
      },
      {
        indexed: false,
        internalType: "uint64",
        name: "endTime",
        type: "uint64",
      },
      {
        indexed: false,
        internalType: "bool",
        name: "extended",
        type: "bool",
      },
    ],
    name: "BidPlaced",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "oldRecipient",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "newRecipient",
        type: "address",
      },
    ],
    name: "FeeRecipientUpdated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "auctionId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "nft",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "tokenId",
        type: "uint256",
      },
    ],
    name: "NftClaimed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "auctionId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "nft",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "tokenId",
        type: "uint256",
      },
    ],
    name: "NftReleaseFailed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint16",
        name: "oldBps",
        type: "uint16",
      },
      {
        indexed: false,
        internalType: "uint16",
        name: "newBps",
        type: "uint16",
      },
    ],
    name: "PlatformFeeUpdated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "auctionId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "RefundCredited",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "Withdrawal",
    type: "event",
  },
] as const;

// ---------------------------------------------------------------------------
// The indexed schema.
//
// TWO RULES SHAPE EVERY TABLE BELOW.
//
// 1. PONDER'S GRAPHQL HAS NO AGGREGATIONS. There is no `sum`, no `avg`, no
//    `group by`. A question like "who spent the most" or "what did we trade
//    yesterday" therefore CANNOT be answered by querying `bid`. Every such
//    number is maintained as a counter on a rollup row, incremented inside the
//    indexing function that caused it. That is why `bidder`, `seller`,
//    `dailyStat` and `account` exist at all: they are not caches of a query
//    that could be written, they are the only place those numbers live.
//
// 2. UNIQUENESS NEEDS A ROW. "How many distinct bidders bid today" cannot be
//    counted incrementally from a counter, because the handler cannot know
//    whether it has seen the address before. The `auctionBidder` and
//    `dailyBidder` tables are pure membership sets: an insert that conflicts
//    means "already counted", an insert that succeeds means "new, increment
//    the counter". They carry no data of their own and are not meant to be
//    queried directly.
//
// A note on money: every wei value is `bigint`. Never `real`. A `uint96` bid
// exceeds the exact-integer range of a float64 at ~9e15 wei, which is 0.009
// ETH -- far below a realistic bid -- so a float column would round real
// auction values.
//
// A note on time: every timestamp is the Unix SECOND from the block header,
// stored as `bigint`, never a JS Date. The chain is the clock here; the
// indexer's wall time is not part of the data.
// ---------------------------------------------------------------------------

import { index, onchainTable, primaryKey } from "ponder";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * One row per auction, carrying its whole lifecycle plus the derived signals
 * that the contract does not emit.
 *
 * This table is written by six different handlers (created, bid, extended,
 * settled, cancelled, release-failed). Each one updates only the columns it
 * owns, so the row is always readable mid-flight rather than appearing only
 * once the auction closes.
 */
export const auction = onchainTable(
  "auction",
  (t) => ({
    /** The on-chain auction id. Ids start at 0 and are dense. */
    id: t.bigint().primaryKey(),

    // --- Terms, fixed at creation -----------------------------------------
    seller: t.hex().notNull(),
    nft: t.hex().notNull(),
    tokenId: t.bigint().notNull(),
    /**
     * "English" or "Dutch".
     *
     * SHOULD NOT BE HERE VIA AN RPC CALL. `AuctionCreated` does not carry the
     * format, so the handler has to call `getAuction(id)` to learn it -- one
     * extra RPC round trip for every auction ever created, on a field that was
     * known inside the emitting transaction and costs a single byte of log
     * data. Adding `Format format` to `AuctionCreated` would delete that call.
     * Until then this column is `"Unknown"` if the read fails; see
     * src/auction.ts.
     */
    format: t.text().notNull(),
    reservePrice: t.bigint().notNull(),
    buyNowPrice: t.bigint().notNull(),
    startTime: t.bigint().notNull(),
    /** The ORIGINAL close time, before any anti-snipe extension moved it. */
    scheduledEndTime: t.bigint().notNull(),
    /** The CURRENT close time. Diverges from `scheduledEndTime` on extension. */
    endTime: t.bigint().notNull(),

    // --- Live state --------------------------------------------------------
    /** "Live" | "Settled" | "Cancelled" | "ReserveNotMet" | "DeliveryFailed". */
    status: t.text().notNull(),
    highestBidder: t.hex(),
    highestBid: t.bigint().notNull(),

    // --- Derived counters, maintained by the handlers ----------------------
    bidCount: t.integer().notNull(),
    /** Distinct bidders. Backed by the `auctionBidder` membership set. */
    uniqueBidders: t.integer().notNull(),
    /** Anti-snipe extensions applied. Mirrors the contract's own counter. */
    extensionCount: t.integer().notNull(),
    /** Total seconds the anti-snipe rule added to the original close time. */
    secondsExtended: t.bigint().notNull(),
    /**
     * The transaction that most recently extended this auction.
     *
     * This is plumbing as much as data. The contract emits `AuctionExtended`
     * BEFORE the `BidPlaced` that caused it, so by the time the bid handler
     * runs the row's `endTime` has already moved and the bid can no longer
     * tell whether it was the one that moved it. Matching this hash against
     * the bid's own transaction hash answers that exactly, including the case
     * of two bids on the same auction inside one block.
     */
    lastExtensionTxHash: t.hex(),

    // --- Outcome -----------------------------------------------------------
    winner: t.hex(),
    /** The clearing price. Null until settled, and null on a no-sale. */
    clearingPrice: t.bigint(),
    platformFee: t.bigint(),
    /** Proceeds credited to the seller: `clearingPrice - platformFee`. */
    sellerProceeds: t.bigint(),

    // --- Signals -----------------------------------------------------------
    /**
     * The leading bid at close arrived inside the anti-snipe window.
     *
     * This is the sniping signal. It is TRUE whenever the bid that ultimately
     * won landed within ANTI_SNIPE_WINDOW (300 s) of the then-current close
     * time -- whether or not the clock actually moved, because the extension
     * is capped and a late bid past the cap is the most aggressive snipe of
     * all. It tracks the LEADING bid, not any bid: an outbid late bid did not
     * snipe anything.
     */
    wasSniped: t.boolean().notNull(),
    /**
     * Seconds between the auction's close time and the settling transaction.
     *
     * This measures SETTLEMENT LATENCY, not auction duration: nothing settles
     * an auction automatically, so a large value means nobody called
     * `settle()` for a long time. Null while the auction is still open.
     */
    timeToSettleSeconds: t.bigint(),
    /** The NFT transfer reverted at settlement; the token is still in escrow. */
    deliveryFailed: t.boolean().notNull(),
    /** Set when a failed delivery was later recovered with `claimNft`. */
    nftClaimedAt: t.bigint(),

    // --- Provenance --------------------------------------------------------
    createdAt: t.bigint().notNull(),
    createdBlock: t.bigint().notNull(),
    createdTxHash: t.hex().notNull(),
    lastBidAt: t.bigint(),
    closedAt: t.bigint(),
  }),
  (table) => ({
    // "Show me the live auctions, soonest first" is the home page, so status
    // and endTime are the two hot filter/sort columns.
    statusEndTimeIdx: index().on(table.status, table.endTime),
    sellerIdx: index().on(table.seller),
    winnerIdx: index().on(table.winner),
    // The join back to `nftToken`.
    tokenIdx: index().on(table.nft, table.tokenId),
    formatIdx: index().on(table.format),
    createdAtIdx: index().on(table.createdAt),
    // Sorting a "biggest sales" list.
    clearingPriceIdx: index().on(table.clearingPrice),
  }),
);

/**
 * Every accepted bid, in full. Append-only.
 *
 * Ponder never mutates a row here, so this table is the audit trail the
 * rollups are derived from: if a counter ever looks wrong, it can be recomputed
 * from `bid` and compared.
 */
export const bid = onchainTable(
  "bid",
  (t) => ({
    /** `${transactionHash}-${logIndex}`. Unique even for two bids in one tx. */
    id: t.text().primaryKey(),
    auctionId: t.bigint().notNull(),
    bidder: t.hex().notNull(),
    amount: t.bigint().notNull(),

    /** The bid this one beat. Zero address on the opening bid. */
    previousBidder: t.hex(),
    previousAmount: t.bigint().notNull(),
    /** How much this bid raised the price. Equals `amount` on an opening bid. */
    increment: t.bigint().notNull(),

    /** The close time AFTER any extension this bid triggered. */
    endTimeAfter: t.bigint().notNull(),
    /**
     * `endTimeAfter - timestamp`: how much bidding time remained.
     *
     * Read together with `isLate`. A value of exactly 300 means this bid
     * triggered an extension, because the contract sets the new close time to
     * `now + ANTI_SNIPE_WINDOW`.
     */
    secondsBeforeEnd: t.bigint().notNull(),
    /** Landed inside the 300 s anti-snipe window. See `auction.wasSniped`. */
    isLate: t.boolean().notNull(),
    /** This bid moved the close time out. Implies `isLate`. */
    causedExtension: t.boolean().notNull(),

    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
  }),
  (table) => ({
    // The auction history endpoint reads this exact ordering.
    auctionIdx: index().on(table.auctionId, table.timestamp),
    bidderIdx: index().on(table.bidder, table.timestamp),
    timestampIdx: index().on(table.timestamp),
    lateIdx: index().on(table.isLate),
  }),
);

// ---------------------------------------------------------------------------
// Rollups
// ---------------------------------------------------------------------------

/**
 * Per-bidder totals. Rule 1 at the top of this file: GraphQL cannot compute
 * any of these, so every column is a counter the handlers maintain.
 */
export const bidder = onchainTable(
  "bidder",
  (t) => ({
    /** The bidder's address. */
    id: t.hex().primaryKey(),

    bidsPlaced: t.integer().notNull(),
    /** Distinct auctions bid on. Backed by the `auctionBidder` set. */
    auctionsEntered: t.integer().notNull(),
    auctionsWon: t.integer().notNull(),
    /**
     * Wei actually paid for won auctions.
     *
     * NOT the sum of `bid.amount`. A losing bid is refunded in full, so
     * summing bids would report money that came straight back. This is the sum
     * of clearing prices on auctions this account won.
     */
    totalSpent: t.bigint().notNull(),
    /** Sum of every bid ever placed. The "how aggressive" number. */
    totalBidVolume: t.bigint().notNull(),
    /** The largest single bid this account has placed. */
    highestBid: t.bigint().notNull(),
    /** Bids that landed inside the anti-snipe window. */
    lateBids: t.integer().notNull(),
    /**
     * `auctionsWon / auctionsEntered`, precomputed on every write.
     *
     * Stored rather than derived because sorting a leaderboard by a ratio
     * needs the ratio in an index, and Ponder's GraphQL cannot divide two
     * columns at query time. `real` is safe here: it is a ratio in [0,1], not
     * money.
     */
    winRate: t.real().notNull(),

    firstSeenAt: t.bigint().notNull(),
    lastSeenAt: t.bigint().notNull(),
  }),
  (table) => ({
    // The three leaderboard orderings.
    wonIdx: index().on(table.auctionsWon),
    spentIdx: index().on(table.totalSpent),
    winRateIdx: index().on(table.winRate),
  }),
);

/** Per-seller totals, including the two failure modes worth watching. */
export const seller = onchainTable(
  "seller",
  (t) => ({
    id: t.hex().primaryKey(),

    listed: t.integer().notNull(),
    sold: t.integer().notNull(),
    cancelled: t.integer().notNull(),
    /** Closed with bids that never cleared the reserve. A pricing failure. */
    reserveMissed: t.integer().notNull(),
    /** Settled, but the NFT could not be handed over. An escrow failure. */
    deliveryFailed: t.integer().notNull(),
    /** Auctions that closed with no bid at all. */
    noBids: t.integer().notNull(),

    /** Sum of clearing prices. What the market paid. */
    grossVolume: t.bigint().notNull(),
    /** Gross minus platform fees. What the seller was actually credited. */
    netVolume: t.bigint().notNull(),
    feesPaid: t.bigint().notNull(),
    /** `grossVolume / sold`, integer wei. Zero until the first sale. */
    avgClearingPrice: t.bigint().notNull(),
    /** `sold / listed`, precomputed for the same reason as `winRate` above. */
    sellThroughRate: t.real().notNull(),

    firstListedAt: t.bigint().notNull(),
    lastListedAt: t.bigint().notNull(),
  }),
  (table) => ({
    volumeIdx: index().on(table.grossVolume),
    soldIdx: index().on(table.sold),
    sellThroughIdx: index().on(table.sellThroughRate),
  }),
);

/**
 * One row per UTC calendar day.
 *
 * The day is derived from the BLOCK timestamp, so on a local chain whose
 * clock has been moved forward by `evm_increaseTime` the buckets follow the
 * chain, not the host. That is the correct behaviour: the rest of the data is
 * chain time too, and a mixed-clock chart is unreadable.
 */
export const dailyStat = onchainTable(
  "dailyStat",
  (t) => ({
    /** `YYYY-MM-DD`, UTC. Sorts lexicographically, which is why it is text. */
    id: t.text().primaryKey(),
    /** Midnight UTC of `id`, as a Unix second. For range queries and charts. */
    dayStart: t.bigint().notNull(),

    auctionsCreated: t.integer().notNull(),
    auctionsClosed: t.integer().notNull(),
    /** Auctions that closed WITH a sale. The denominator for the price average. */
    sales: t.integer().notNull(),
    bids: t.integer().notNull(),
    /** Distinct bidders on this day. Backed by the `dailyBidder` set. */
    uniqueBidders: t.integer().notNull(),

    /** Sum of clearing prices settled on this day. */
    volume: t.bigint().notNull(),
    fees: t.bigint().notNull(),
    /** `volume / sales`, integer wei. Zero on a day with no sale. */
    avgClearingPrice: t.bigint().notNull(),

    /** Bids that landed inside the anti-snipe window. */
    lateBids: t.integer().notNull(),
    /** Anti-snipe extensions granted on this day. */
    extensions: t.integer().notNull(),
    /** Auctions closed on this day that had at least one extension. */
    extendedAuctions: t.integer().notNull(),
    /**
     * `extendedAuctions / auctionsClosed`.
     *
     * The share of auctions that ran past their advertised close time. It is
     * the headline number for whether the anti-snipe rule is doing anything.
     */
    extensionRate: t.real().notNull(),
  }),
  (table) => ({
    dayStartIdx: index().on(table.dayStart),
    volumeIdx: index().on(table.volume),
  }),
);

/** Running credit balance per account. Money is credited, then pulled. */
export const account = onchainTable(
  "account",
  (t) => ({
    id: t.hex().primaryKey(),
    /** Everything ever credited: outbid refunds, seller proceeds, fees. */
    totalCredited: t.bigint().notNull(),
    totalWithdrawn: t.bigint().notNull(),
    /**
     * `totalCredited - totalWithdrawn`: what `withdraw()` would pay right now.
     *
     * Worth surfacing on its own because unclaimed credit is the most common
     * thing a demo user loses track of.
     */
    pending: t.bigint().notNull(),
    creditCount: t.integer().notNull(),
    withdrawalCount: t.integer().notNull(),
    lastActivityAt: t.bigint().notNull(),
  }),
  (table) => ({
    pendingIdx: index().on(table.pending),
  }),
);

// ---------------------------------------------------------------------------
// Money movement, as an append-only ledger
// ---------------------------------------------------------------------------

/** One `RefundCredited`. Part of an auction's history, so it is kept in full. */
export const credit = onchainTable(
  "credit",
  (t) => ({
    id: t.text().primaryKey(),
    account: t.hex().notNull(),
    auctionId: t.bigint().notNull(),
    amount: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    auctionIdx: index().on(table.auctionId, table.timestamp),
    accountIdx: index().on(table.account, table.timestamp),
  }),
);

/** One `Withdrawal`. */
export const withdrawal = onchainTable(
  "withdrawal",
  (t) => ({
    id: t.text().primaryKey(),
    account: t.hex().notNull(),
    amount: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    accountIdx: index().on(table.account, table.timestamp),
  }),
);

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * One row per minted token, with its metadata already resolved.
 *
 * `name`, `description` and `image` are filled in at index time by decoding
 * the token URI, so a client can render a gallery from ONE GraphQL query. The
 * alternative -- every browser fetching every token URI itself -- is what the
 * web app does today, and it is why the listing page shows placeholders while
 * a gateway is slow.
 */
export const nftToken = onchainTable(
  "nftToken",
  (t) => ({
    /** `${contract}-${tokenId}`. Composite in one key so joins stay cheap. */
    id: t.text().primaryKey(),
    contract: t.hex().notNull(),
    tokenId: t.bigint().notNull(),
    /** Current holder. Tracked through `Transfer`, including escrow moves. */
    owner: t.hex().notNull(),
    minter: t.hex().notNull(),

    /** Exactly what `tokenURI(id)` returned. Kept raw for debugging. */
    tokenURI: t.text().notNull(),
    /** Decoded from `tokenURI` when it is a `data:` URI. Null otherwise. */
    name: t.text(),
    description: t.text(),
    image: t.text(),
    /** Why the three fields above are null, when they are. */
    metadataStatus: t.text().notNull(),

    /** Times this token has been listed. Cheap provenance. */
    auctionCount: t.integer().notNull(),
    mintedAt: t.bigint().notNull(),
    mintedBlock: t.bigint().notNull(),
  }),
  (table) => ({
    ownerIdx: index().on(table.owner),
    contractTokenIdx: index().on(table.contract, table.tokenId),
    mintedAtIdx: index().on(table.mintedAt),
  }),
);

// ---------------------------------------------------------------------------
// Membership sets
//
// Rule 2 at the top of this file. These two tables exist so that a distinct
// count can be maintained incrementally. `insert(...).onConflictDoNothing()`
// returns null when the row already existed, and that null is the answer to
// "have I counted this address yet".
// ---------------------------------------------------------------------------

/** (auction, bidder) pairs. Feeds `auction.uniqueBidders`. */
export const auctionBidder = onchainTable(
  "auctionBidder",
  (t) => ({
    auctionId: t.bigint().notNull(),
    bidder: t.hex().notNull(),
    /** Kept so "when did this account first enter" needs no scan of `bid`. */
    firstBidAt: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.auctionId, table.bidder] }),
    bidderIdx: index().on(table.bidder),
  }),
);

/** (day, bidder) pairs. Feeds `dailyStat.uniqueBidders`. */
export const dailyBidder = onchainTable(
  "dailyBidder",
  (t) => ({
    day: t.text().notNull(),
    bidder: t.hex().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.day, table.bidder] }),
  }),
);

// ---------------------------------------------------------------------------
// Protocol settings
// ---------------------------------------------------------------------------

/**
 * The current platform fee and recipient. A single row with id `"platform"`.
 *
 * A one-row table looks odd next to the rest, but the fee is a real part of
 * the indexed state -- `auction.platformFee` is only explicable next to the
 * fee that was in force -- and a table is the only place Ponder can put it.
 */
export const platformSetting = onchainTable("platformSetting", (t) => ({
  id: t.text().primaryKey(),
  feeBps: t.integer().notNull(),
  feeRecipient: t.hex(),
  updatedAt: t.bigint().notNull(),
}));

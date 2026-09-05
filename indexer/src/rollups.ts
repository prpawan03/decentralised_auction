// ---------------------------------------------------------------------------
// Rollup writers.
//
// Every table in here is a COUNTER table. Ponder's GraphQL has no `sum` and no
// `avg`, so a number like "total spent" or "yesterday's volume" has to be
// incremented at the moment the event arrives -- there is no query that can
// recover it later. That makes these four functions the load-bearing part of
// the indexer, and it makes an increment that runs twice, or not at all, a
// silent data bug rather than a crash.
//
// THE UPSERT SHAPE. Each writer takes an `apply` function of one row and
// returns the row it should become. That single function is used twice: once
// against a zeroed row to produce the INSERT for the first event an account
// ever causes, and once against the stored row to produce the UPDATE for every
// event after it. Writing the arithmetic once is the point -- an insert branch
// and an update branch that drift apart is exactly how a counter starts at the
// wrong value for whoever happened to be first.
// ---------------------------------------------------------------------------

import type { Context } from "ponder:registry";
import { account, bidder, dailyStat, seller } from "ponder:schema";
import type { Address } from "viem";

import { dayIdOf, dayStartOf } from "./shared";

type BidderRow = typeof bidder.$inferSelect;
type SellerRow = typeof seller.$inferSelect;
type AccountRow = typeof account.$inferSelect;
type DailyRow = typeof dailyStat.$inferSelect;

/** Creates or updates the `bidder` rollup for `address`. */
export async function upsertBidder(
  context: Context,
  address: Address,
  timestamp: bigint,
  apply: (row: BidderRow) => BidderRow,
): Promise<void> {
  const zero: BidderRow = {
    id: address,
    bidsPlaced: 0,
    auctionsEntered: 0,
    auctionsWon: 0,
    totalSpent: 0n,
    totalBidVolume: 0n,
    highestBid: 0n,
    lateBids: 0,
    winRate: 0,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
  };

  await context.db
    .insert(bidder)
    .values(apply(zero))
    // `firstSeenAt` is deliberately absent from the update: it is the one
    // column that must survive every later event.
    .onConflictDoUpdate((row) => ({ ...apply(row), lastSeenAt: timestamp }));
}

/** Creates or updates the `seller` rollup for `address`. */
export async function upsertSeller(
  context: Context,
  address: Address,
  timestamp: bigint,
  apply: (row: SellerRow) => SellerRow,
): Promise<void> {
  const zero: SellerRow = {
    id: address,
    listed: 0,
    sold: 0,
    cancelled: 0,
    reserveMissed: 0,
    deliveryFailed: 0,
    noBids: 0,
    grossVolume: 0n,
    netVolume: 0n,
    feesPaid: 0n,
    avgClearingPrice: 0n,
    sellThroughRate: 0,
    firstListedAt: timestamp,
    lastListedAt: timestamp,
  };

  await context.db
    .insert(seller)
    .values(apply(zero))
    .onConflictDoUpdate((row) => apply(row));
}

/** Creates or updates the credit balance of `address`. */
export async function upsertAccount(
  context: Context,
  address: Address,
  timestamp: bigint,
  apply: (row: AccountRow) => AccountRow,
): Promise<void> {
  const zero: AccountRow = {
    id: address,
    totalCredited: 0n,
    totalWithdrawn: 0n,
    pending: 0n,
    creditCount: 0,
    withdrawalCount: 0,
    lastActivityAt: timestamp,
  };

  const next = (row: AccountRow): AccountRow => {
    const applied = apply(row);
    // `pending` is derived, never passed in by a caller. Deriving it in one
    // place is what keeps it equal to what `withdraw()` would actually pay.
    return {
      ...applied,
      pending: applied.totalCredited - applied.totalWithdrawn,
      lastActivityAt: timestamp,
    };
  };

  await context.db.insert(account).values(next(zero)).onConflictDoUpdate(next);
}

/**
 * Creates or updates the `dailyStat` bucket that `timestamp` falls in.
 *
 * The bucket is chosen from the BLOCK timestamp, so the series follows chain
 * time. On a local chain whose clock has been pushed forward with
 * `evm_increaseTime` that is the only reading that makes the chart agree with
 * the auctions on it.
 */
export async function upsertDaily(
  context: Context,
  timestamp: bigint,
  apply: (row: DailyRow) => DailyRow,
): Promise<void> {
  const id = dayIdOf(timestamp);

  const zero: DailyRow = {
    id,
    dayStart: dayStartOf(timestamp),
    auctionsCreated: 0,
    auctionsClosed: 0,
    sales: 0,
    bids: 0,
    uniqueBidders: 0,
    volume: 0n,
    fees: 0n,
    avgClearingPrice: 0n,
    lateBids: 0,
    extensions: 0,
    extendedAuctions: 0,
    extensionRate: 0,
  };

  await context.db.insert(dailyStat).values(apply(zero)).onConflictDoUpdate(apply);
}

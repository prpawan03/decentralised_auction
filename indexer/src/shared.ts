// ---------------------------------------------------------------------------
// Values and helpers shared by every indexing function.
//
// Nothing here touches the database. Keeping the pure parts separate is what
// makes the handlers readable: a handler should be a list of writes, not a
// list of writes with arithmetic buried between them.
// ---------------------------------------------------------------------------

import type { Address } from "viem";
import { zeroAddress } from "viem";

/**
 * The anti-snipe window, in seconds. MUST match
 * `EnglishAuction.ANTI_SNIPE_WINDOW` (5 minutes).
 *
 * Duplicating a contract constant in TypeScript is a liability, so it is worth
 * being explicit about why it is not read from the chain instead: it is
 * `constant`, not `immutable`, so there is no getter to call, and reading it
 * per event would cost an RPC round trip to learn a number that cannot change
 * without a redeployment. If the contract's window changes, change this line.
 */
export const ANTI_SNIPE_WINDOW = 300n;

/** `AuctionCore.Status`, in declaration order. The enum is encoded as uint8. */
export const STATUS = ["Live", "Settled", "Cancelled", "ReserveNotMet", "DeliveryFailed"] as const;

/** `AuctionCore.Format`, in declaration order. */
export const FORMAT = ["English", "Dutch"] as const;

/**
 * Decodes a Solidity enum ordinal.
 *
 * Returns `"Unknown"` rather than throwing on an out-of-range value. An
 * indexer that crashes on an enum it does not recognise stops indexing
 * everything, which is a far worse outcome than one unfamiliar string in one
 * column: adding a sixth `Status` to the contract should not take the
 * dashboard down until the indexer is redeployed.
 */
export function decodeEnum(names: readonly string[], ordinal: number): string {
  return names[ordinal] ?? "Unknown";
}

/** The seconds in a UTC day. */
const DAY = 86_400n;

/**
 * The `dailyStat` key for a block timestamp: `YYYY-MM-DD`, UTC.
 *
 * Text rather than a number because a lexicographic sort over `YYYY-MM-DD` is
 * also a chronological sort, so the key doubles as the ordering for the daily
 * series without a second column in the index.
 */
export function dayIdOf(timestamp: bigint): string {
  return new Date(Number(timestamp) * 1000).toISOString().slice(0, 10);
}

/** Midnight UTC of the day containing `timestamp`, as a Unix second. */
export function dayStartOf(timestamp: bigint): bigint {
  return (timestamp / DAY) * DAY;
}

/**
 * Integer division that yields 0 instead of throwing when the count is 0.
 *
 * Used for the stored averages. They are recomputed on every write rather than
 * derived at read time, because Ponder's GraphQL cannot divide two columns.
 */
export function avgOf(total: bigint, count: number): bigint {
  return count > 0 ? total / BigInt(count) : 0n;
}

/** A ratio in [0,1], safe when the denominator is 0. */
export function rateOf(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * The zero address means "nobody" in every event this indexer reads.
 *
 * `AuctionSettled.winner` is zero on a no-sale and `BidPlaced.previousBidder`
 * is zero on an opening bid. Storing the zero address in those columns would
 * make it a leaderboard entry, so they are normalised to null.
 */
export function nullIfZero(address: Address): Address | null {
  return address === zeroAddress ? null : address;
}

/** A stable id for a row that stands for exactly one log. */
export function logId(txHash: string, logIndex: number): string {
  return `${txHash}-${logIndex}`;
}

/** The `nftToken` primary key. Lower-cased so the two sides of a join match. */
export function tokenKey(contract: Address, tokenId: bigint): string {
  return `${contract.toLowerCase()}-${tokenId}`;
}

/** The larger of two bigints. `Math.max` does not accept them. */
export function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

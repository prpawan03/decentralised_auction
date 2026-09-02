import type { Address } from "viem";
import { zeroAddress } from "viem";
import { CONTRACT_LIMITS } from "@/config/contracts";

/**
 * Mirrors `enum Status { Live, Settled, Cancelled, ReserveNotMet, DeliveryFailed }`.
 *
 * `DeliveryFailed` means the NFT transfer failed at settlement, so the sale was
 * voided: the winner was credited a full refund and the seller was paid
 * nothing. The token is owed back to the seller through `claimNft()`.
 */
export const AuctionStatus = {
  Live: 0,
  Settled: 1,
  Cancelled: 2,
  ReserveNotMet: 3,
  DeliveryFailed: 4,
} as const;

export type AuctionStatusValue = (typeof AuctionStatus)[keyof typeof AuctionStatus];

/**
 * Mirrors `enum Format { English, Dutch }`.
 *
 * Which rules discover the price. It decides which entry point a listing
 * accepts — `bid`/`buyNow` for English, `buy` for Dutch — and the contract
 * rejects a call through the wrong one, so the UI must not offer it.
 *
 * The two price fields are read under different names per format: on a Dutch
 * listing `reservePrice` is the FLOOR the price decays to and `buyNowPrice` is
 * the OPENING price. Reading them as an English reserve and buy-now would
 * misdescribe the sale.
 */
export const AuctionFormat = {
  English: 0,
  Dutch: 1,
} as const;

export type AuctionFormatValue = (typeof AuctionFormat)[keyof typeof AuctionFormat];

/** The struct as viem decodes it. */
export interface RawAuction {
  seller: Address;
  reservePrice: bigint;
  highestBidder: Address;
  highestBid: bigint;
  nft: Address;
  buyNowPrice: bigint;
  tokenId: bigint;
  endTime: bigint;
  startTime: bigint;
  extensionCount: number;
  minIncrementBps: number;
  platformFeeBps: number;
  status: number;
  format: number;
}

/** The struct plus its id and everything derived from it. */
export interface Auction extends RawAuction {
  id: bigint;
}

/**
 * Phase is what the UI actually renders. It is NOT the same as `status`,
 * because a Live auction whose endTime has passed is awaiting settlement:
 * on-chain it is still `Live`, but no bid will be accepted and anyone may call
 * `settle()`. Conflating the two is what made the old app show a countdown of
 * "-00:04:11" next to an enabled Bid button.
 */
export type AuctionPhase =
  | "live"
  | "ending" // live, under 5 minutes: anti-snipe window is open
  | "final" // live, under 60 seconds
  | "awaiting-settlement" // endTime passed, status still Live
  | "settled"
  | "cancelled"
  | "reserve-not-met"
  | "delivery-failed";

export const ENDING_SOON_SECONDS = 300; // == ANTI_SNIPE_WINDOW
export const FINAL_SECONDS = 60;

export function hasBid(a: Pick<RawAuction, "highestBidder">): boolean {
  return a.highestBidder !== zeroAddress;
}

/** Seconds until endTime, floored at 0. `now` is seconds since the epoch. */
export function secondsRemaining(a: Pick<RawAuction, "endTime">, now: number): number {
  const remaining = Number(a.endTime) - now;
  return remaining > 0 ? remaining : 0;
}

export function phaseOf(a: Pick<RawAuction, "status" | "endTime">, now: number): AuctionPhase {
  switch (a.status) {
    case AuctionStatus.Settled:
      return "settled";
    case AuctionStatus.Cancelled:
      return "cancelled";
    case AuctionStatus.ReserveNotMet:
      return "reserve-not-met";
    case AuctionStatus.DeliveryFailed:
      return "delivery-failed";
    default:
      break;
  }
  const left = secondsRemaining(a, now);
  if (left <= 0) return "awaiting-settlement";
  if (left <= FINAL_SECONDS) return "final";
  if (left <= ENDING_SOON_SECONDS) return "ending";
  return "live";
}

export function isBiddable(a: Pick<RawAuction, "status" | "endTime">, now: number): boolean {
  const p = phaseOf(a, now);
  return p === "live" || p === "ending" || p === "final";
}

export function isSettleableNow(a: Pick<RawAuction, "status" | "endTime">, now: number): boolean {
  return a.status === AuctionStatus.Live && secondsRemaining(a, now) <= 0;
}

export function buyNowEnabled(a: Pick<RawAuction, "buyNowPrice">): boolean {
  /* `buyNowPrice == 0` means DISABLED, never "free". */
  return a.buyNowPrice > 0n;
}

export function reserveMet(a: Pick<RawAuction, "highestBid" | "reservePrice">): boolean {
  return a.reservePrice === 0n || a.highestBid >= a.reservePrice;
}

/**
 * The client-side mirror of `minimumBid(auctionId)`. Used to pre-fill the bid
 * field and to give instant feedback while typing. The authoritative number
 * always comes from the contract read; this is only ever a hint, and the
 * dialog simulates before it lets you sign.
 */
export function estimateMinimumBid(a: Pick<RawAuction, "highestBid" | "reservePrice" | "minIncrementBps">): bigint {
  if (a.highestBid === 0n) {
    return a.reservePrice > 0n ? a.reservePrice : CONTRACT_LIMITS.MIN_INCREMENT;
  }
  const bps = BigInt(a.minIncrementBps || Number(CONTRACT_LIMITS.DEFAULT_INCREMENT_BPS));
  const step = (a.highestBid * bps) / 10_000n;
  const floored = step > CONTRACT_LIMITS.MIN_INCREMENT ? step : CONTRACT_LIMITS.MIN_INCREMENT;
  return a.highestBid + floored;
}

/** Case-insensitive address comparison. Never compare addresses with ===. */
export function sameAddress(a: Address | undefined, b: Address | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Where the connected account stands on this auction. Purely derived — never
 * stored. `undefined` for a visitor with no wallet, which is a first-class
 * state, not an error.
 */
export type Standing =
  | "none"
  | "seller"
  | "winning"
  | "outbid"
  | "won"
  | "lost"
  | "refund-due";

export function standingOf(a: Auction, account: Address | undefined, now: number): Standing {
  if (!account) return "none";
  if (sameAddress(a.seller, account)) return "seller";

  const isHigh = sameAddress(a.highestBidder, account);
  const p = phaseOf(a, now);

  if (p === "settled") return isHigh ? "won" : "none";
  if (p === "reserve-not-met" || p === "cancelled") return isHigh ? "refund-due" : "none";
  if (isHigh) return "winning";
  return "none";
}

/**
 * `getAuctions` returns structs without ids, in offset order. Zip them back
 * together. Kept as a pure function so it is directly unit-testable.
 */
export function withIds(structs: readonly RawAuction[], offset: bigint): Auction[] {
  return structs.map((s, i) => ({ ...s, id: offset + BigInt(i) }));
}

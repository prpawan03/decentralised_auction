import { describe, expect, it } from "vitest";
import { zeroAddress } from "viem";
import {
  AuctionFormat,
  AuctionStatus,
  dutchFloorPrice,
  dutchPriceAt,
  dutchStartPrice,
  isDutch,
  buyNowEnabled,
  estimateMinimumBid,
  hasBid,
  isBiddable,
  isSettleableNow,
  phaseOf,
  reserveMet,
  sameAddress,
  secondsRemaining,
  standingOf,
  withIds,
} from "./auction";
import type { Auction } from "./auction";
import { accounts, makeAuction, NOW } from "@/test/utils";

describe("phaseOf", () => {
  it("separates a finished-but-unsettled auction from a settled one", () => {
    /* This is the distinction the old app collapsed: on-chain status is still
       Live after endTime, but no bid will be accepted. */
    const expired = makeAuction({ status: AuctionStatus.Live, endTime: BigInt(NOW - 1) });
    expect(phaseOf(expired, NOW)).toBe("awaiting-settlement");
    expect(isBiddable(expired, NOW)).toBe(false);
    expect(isSettleableNow(expired, NOW)).toBe(true);

    const settled = makeAuction({ status: AuctionStatus.Settled, endTime: BigInt(NOW - 1) });
    expect(phaseOf(settled, NOW)).toBe("settled");
    expect(isSettleableNow(settled, NOW)).toBe(false);
  });

  it("escalates through live, ending and final at the right thresholds", () => {
    expect(phaseOf(makeAuction({ endTime: BigInt(NOW + 301) }), NOW)).toBe("live");
    /* 300 s is ANTI_SNIPE_WINDOW: at exactly the boundary the window is open. */
    expect(phaseOf(makeAuction({ endTime: BigInt(NOW + 300) }), NOW)).toBe("ending");
    expect(phaseOf(makeAuction({ endTime: BigInt(NOW + 61) }), NOW)).toBe("ending");
    expect(phaseOf(makeAuction({ endTime: BigInt(NOW + 60) }), NOW)).toBe("final");
    expect(phaseOf(makeAuction({ endTime: BigInt(NOW + 1) }), NOW)).toBe("final");
  });

  it("reports terminal statuses regardless of the clock", () => {
    for (const [status, expected] of [
      [AuctionStatus.Settled, "settled"],
      [AuctionStatus.Cancelled, "cancelled"],
      [AuctionStatus.ReserveNotMet, "reserve-not-met"],
    ] as const) {
      expect(phaseOf(makeAuction({ status, endTime: BigInt(NOW + 9_999) }), NOW)).toBe(expected);
    }
  });
});

describe("secondsRemaining", () => {
  it("never goes negative", () => {
    expect(secondsRemaining(makeAuction({ endTime: BigInt(NOW - 5_000) }), NOW)).toBe(0);
    expect(secondsRemaining(makeAuction({ endTime: BigInt(NOW + 42) }), NOW)).toBe(42);
  });
});

describe("buyNowEnabled", () => {
  it("treats a zero buy-now price as DISABLED, never as free", () => {
    expect(buyNowEnabled(makeAuction({ buyNowPrice: 0n }))).toBe(false);
    expect(buyNowEnabled(makeAuction({ buyNowPrice: 1n }))).toBe(true);
  });
});

describe("hasBid / reserveMet", () => {
  it("uses the zero address as the no-bid sentinel", () => {
    expect(hasBid(makeAuction({ highestBidder: zeroAddress }))).toBe(false);
    expect(hasBid(makeAuction({ highestBidder: accounts.bob }))).toBe(true);
  });

  it("treats a zero reserve as always met", () => {
    expect(reserveMet(makeAuction({ reservePrice: 0n, highestBid: 0n }))).toBe(true);
    expect(reserveMet(makeAuction({ reservePrice: 10n, highestBid: 9n }))).toBe(false);
    expect(reserveMet(makeAuction({ reservePrice: 10n, highestBid: 10n }))).toBe(true);
  });
});

describe("estimateMinimumBid", () => {
  it("uses the reserve as the floor for the very first bid", () => {
    const a = makeAuction({ highestBid: 0n, reservePrice: 3_000_000_000_000_000_000n });
    expect(estimateMinimumBid(a)).toBe(3_000_000_000_000_000_000n);
  });

  it("falls back to MIN_INCREMENT when there is neither a bid nor a reserve", () => {
    const a = makeAuction({ highestBid: 0n, reservePrice: 0n });
    expect(estimateMinimumBid(a)).toBe(100_000_000_000_000n); // 0.0001 ETH
  });

  it("applies the basis-point increment on top of the standing bid", () => {
    /* 2.0 ETH + 5% = 2.1 ETH */
    const a = makeAuction({ highestBid: 2_000_000_000_000_000_000n, minIncrementBps: 500 });
    expect(estimateMinimumBid(a)).toBe(2_100_000_000_000_000_000n);
  });

  it("uses MIN_INCREMENT when the percentage step would be smaller", () => {
    /* 0.001 ETH + 5% = 0.00005 ETH, which is below the 0.0001 ETH floor. */
    const a = makeAuction({ highestBid: 1_000_000_000_000_000n, minIncrementBps: 500 });
    expect(estimateMinimumBid(a)).toBe(1_000_000_000_000_000n + 100_000_000_000_000n);
  });
});

describe("sameAddress", () => {
  it("compares case-insensitively, because checksums differ by source", () => {
    expect(
      sameAddress(
        "0xAbC0000000000000000000000000000000000001",
        "0xabc0000000000000000000000000000000000001",
      ),
    ).toBe(true);
  });

  it("is false when either side is missing, never throwing", () => {
    expect(sameAddress(undefined, accounts.alice)).toBe(false);
    expect(sameAddress(accounts.alice, undefined)).toBe(false);
  });
});

describe("standingOf", () => {
  it("returns 'none' for a visitor with no wallet, which is a normal state", () => {
    expect(standingOf(makeAuction(), undefined, NOW)).toBe("none");
  });

  it("identifies the seller before anything else", () => {
    expect(standingOf(makeAuction({ seller: accounts.alice }), accounts.alice, NOW)).toBe("seller");
  });

  it("marks the standing top bidder as winning while the auction runs", () => {
    expect(standingOf(makeAuction({ highestBidder: accounts.bob }), accounts.bob, NOW)).toBe(
      "winning",
    );
  });

  it("marks a refund as due when the auction closed below its reserve", () => {
    const a = makeAuction({ status: AuctionStatus.ReserveNotMet, highestBidder: accounts.bob });
    expect(standingOf(a, accounts.bob, NOW)).toBe("refund-due");
  });
});

describe("withIds", () => {
  it("restores ids from the page offset, since getAuctions omits them", () => {
    const page = [makeAuction(), makeAuction(), makeAuction()];
    const result = withIds(page, 10n);
    expect(result.map((a) => a.id)).toEqual([10n, 11n, 12n]);
  });
});

describe("Dutch format", () => {
  /* Mirrors DutchAuction._currentPrice: buyNowPrice is the OPENING price and
     reservePrice is the FLOOR. A 100-second window from 10 ETH down to 2 ETH. */
  const dutch = (over: Partial<Auction> = {}) =>
    makeAuction({
      format: AuctionFormat.Dutch,
      buyNowPrice: 10_000_000_000_000_000_000n,
      reservePrice: 2_000_000_000_000_000_000n,
      startTime: BigInt(NOW),
      endTime: BigInt(NOW + 100),
      highestBidder: accounts.zero,
      highestBid: 0n,
      ...over,
    });

  it("quotes the opening price at or before the start, and the floor at or after the end", () => {
    const a = dutch();
    expect(dutchPriceAt(a, NOW - 50)).toBe(a.buyNowPrice);
    expect(dutchPriceAt(a, NOW)).toBe(a.buyNowPrice);
    expect(dutchPriceAt(a, NOW + 100)).toBe(a.reservePrice);
    expect(dutchPriceAt(a, NOW + 5_000)).toBe(a.reservePrice);
  });

  it("decays linearly between the two", () => {
    const a = dutch();
    /* Half way through a 10 -> 2 ETH slide is 6 ETH. */
    expect(dutchPriceAt(a, NOW + 50)).toBe(6_000_000_000_000_000_000n);
    expect(dutchPriceAt(a, NOW + 25)).toBe(8_000_000_000_000_000_000n);
    expect(dutchPriceAt(a, NOW + 75)).toBe(4_000_000_000_000_000_000n);
  });

  it("never rises as time passes", () => {
    /* Monotonicity is the property a buyer relies on: waiting must never cost
       more. An off-by-one in the flooring would break it at some tick. */
    const a = dutch();
    let previous = dutchPriceAt(a, NOW);
    for (let t = 1; t <= 100; t += 1) {
      const price = dutchPriceAt(a, NOW + t);
      expect(price).toBeLessThanOrEqual(previous);
      previous = price;
    }
  });

  it("floors the division exactly as the contract does, never rounding up", () => {
    /* A span that does not divide evenly. The contract computes
       start - ((start - floor) * elapsed) / span with integer division, so the
       quote must land at or ABOVE the true real-valued price — quoting below
       it would underpay and revert. */
    const a = dutch({ buyNowPrice: 100n, reservePrice: 1n, endTime: BigInt(NOW + 7) });
    for (let t = 1; t < 7; t += 1) {
      const expected = 100n - (99n * BigInt(t)) / 7n;
      expect(dutchPriceAt(a, NOW + t)).toBe(expected);
    }
  });

  it("handles a flat listing where the opening price equals the floor", () => {
    const a = dutch({ buyNowPrice: 5n, reservePrice: 5n });
    expect(dutchPriceAt(a, NOW + 50)).toBe(5n);
  });

  it("refuses to describe a Dutch listing with English vocabulary", () => {
    /* The bug this closes: the grid read buyNowPrice as a buy-now offer and
       reservePrice as a reserve, so a Dutch lot advertised its OPENING price
       as a price you could pay right now. */
    const a = dutch();
    expect(isDutch(a)).toBe(true);
    expect(buyNowEnabled(a)).toBe(false);
    expect(reserveMet(a)).toBe(true);
    expect(dutchStartPrice(a)).toBe(a.buyNowPrice);
    expect(dutchFloorPrice(a)).toBe(a.reservePrice);
  });

  it("leaves the English readings untouched", () => {
    const english = makeAuction({ format: AuctionFormat.English, buyNowPrice: 9n });
    expect(isDutch(english)).toBe(false);
    expect(buyNowEnabled(english)).toBe(true);
  });
});

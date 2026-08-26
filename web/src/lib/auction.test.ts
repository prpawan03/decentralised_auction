import { describe, expect, it } from "vitest";
import { zeroAddress } from "viem";
import {
  AuctionStatus,
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
    expect(sameAddress("0xAbC0000000000000000000000000000000000001", "0xabc0000000000000000000000000000000000001")).toBe(true);
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
    expect(standingOf(makeAuction({ highestBidder: accounts.bob }), accounts.bob, NOW)).toBe("winning");
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

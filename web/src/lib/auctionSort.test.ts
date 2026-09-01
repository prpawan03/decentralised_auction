import { describe, expect, it } from "vitest";
import { AuctionStatus } from "./auction";
import { matchesQuery, sortAuctions } from "./auctionSort";
import { accounts, makeAuction, NOW } from "@/test/utils";

const ids = (list: ReturnType<typeof makeAuction>[]) => list.map((a) => Number(a.id));

describe("sortAuctions", () => {
  it("orders by deadline and never mutates the input", () => {
    const input = [
      makeAuction({ id: 0n, endTime: BigInt(NOW + 300) }),
      makeAuction({ id: 1n, endTime: BigInt(NOW + 60) }),
      makeAuction({ id: 2n, endTime: BigInt(NOW + 900) }),
    ];
    const before = ids(input);
    expect(ids(sortAuctions(input, "ending-soon", NOW))).toEqual([1, 0, 2]);
    expect(ids(input)).toEqual(before);
  });

  it("parks closed auctions after every open one, whatever their end time", () => {
    /* A settled auction whose endTime is long past must not win "ending
       soonest" and push the live lots off the top of the board. */
    const sorted = sortAuctions(
      [
        makeAuction({ id: 0n, status: AuctionStatus.Settled, endTime: BigInt(NOW - 9_000) }),
        makeAuction({ id: 1n, status: AuctionStatus.Live, endTime: BigInt(NOW + 500) }),
      ],
      "ending-soon",
      NOW,
    );
    expect(ids(sorted)).toEqual([1, 0]);
  });

  it("is a total order, so equal keys never swap between renders", () => {
    /* Two auctions closing in the same second must keep a fixed relative
       order. A row that jumps under the cursor is how a bid lands on the
       wrong lot. */
    const same = BigInt(NOW + 120);
    const input = [
      makeAuction({ id: 5n, endTime: same }),
      makeAuction({ id: 2n, endTime: same }),
      makeAuction({ id: 9n, endTime: same }),
    ];
    expect(ids(sortAuctions(input, "ending-soon", NOW))).toEqual([2, 5, 9]);
    expect(ids(sortAuctions([...input].reverse(), "ending-soon", NOW))).toEqual([2, 5, 9]);
  });

  it("sorts cheapest-first without letting bidless auctions claim the top", () => {
    /* "Top bid: low to high" should surface prices you could actually win,
       not a wall of empty listings all showing zero. */
    const sorted = sortAuctions(
      [
        makeAuction({ id: 0n, highestBidder: accounts.zero, highestBid: 0n }),
        makeAuction({ id: 1n, highestBidder: accounts.bob, highestBid: 5n }),
        makeAuction({ id: 2n, highestBidder: accounts.bob, highestBid: 2n }),
      ],
      "price-low",
      NOW,
    );
    expect(ids(sorted)).toEqual([2, 1, 0]);
  });

  it("sorts by price, recency and contest count", () => {
    const list = [
      makeAuction({ id: 0n, highestBid: 1n, startTime: 100n, extensionCount: 3 }),
      makeAuction({ id: 1n, highestBid: 9n, startTime: 300n, extensionCount: 0 }),
      makeAuction({ id: 2n, highestBid: 5n, startTime: 200n, extensionCount: 7 }),
    ];
    expect(ids(sortAuctions(list, "price-high", NOW))).toEqual([1, 2, 0]);
    expect(ids(sortAuctions(list, "newest", NOW))).toEqual([1, 2, 0]);
    expect(ids(sortAuctions(list, "activity", NOW))).toEqual([2, 0, 1]);
  });
});

describe("matchesQuery", () => {
  const auction = makeAuction({
    id: 12n,
    tokenId: 7n,
    seller: accounts.alice,
    highestBidder: accounts.bob,
  });

  it("matches everything when the query is blank", () => {
    expect(matchesQuery(auction, "")).toBe(true);
    expect(matchesQuery(auction, "   ")).toBe(true);
  });

  it("matches auction and token ids exactly, not as substrings", () => {
    /* Searching "1" must not return auction 12: a substring match on numbers
       makes the box useless the moment there are more than nine auctions. */
    expect(matchesQuery(auction, "12")).toBe(true);
    expect(matchesQuery(auction, "#12")).toBe(true);
    expect(matchesQuery(auction, "7")).toBe(true);
    expect(matchesQuery(auction, "1")).toBe(false);
  });

  it("matches any part of any address on the auction, from either end", () => {
    const seller = accounts.alice;
    expect(matchesQuery(auction, seller)).toBe(true);
    expect(matchesQuery(auction, seller.slice(0, 8))).toBe(true);
    /* The tail, which is what the truncated UI form shows. */
    expect(matchesQuery(auction, seller.slice(-6))).toBe(true);
    expect(matchesQuery(auction, seller.toUpperCase())).toBe(true);
    expect(matchesQuery(auction, "0xffffffffff")).toBe(false);
  });

  it("matches the off-chain metadata name when one is supplied", () => {
    /* The whole reason search takes a resolver: "Cyber" exists nowhere in
       contract storage. */
    const nameOf = () => "Cyber Rabbit #7";
    expect(matchesQuery(auction, "cyber", nameOf)).toBe(true);
    expect(matchesQuery(auction, "rabbit", nameOf)).toBe(true);
    expect(matchesQuery(auction, "cyber")).toBe(false);
  });
});

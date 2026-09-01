import { hasBid, phaseOf, type Auction } from "./auction";

/**
 * Search and sort for the auction board. Pure, so the ordering rules are
 * unit-testable without mounting a table.
 *
 * Sorting happens on the client because the whole page already lives in
 * memory: `getAuctions` returns up to `MAX_PAGE_SIZE` structs in one multicall,
 * and re-reading the chain to reorder a hundred rows would be absurd. When the
 * indexer lands this moves server-side and these functions become its contract.
 */

export type SortKey = "ending-soon" | "newest" | "price-high" | "price-low" | "activity";

export const SORTS: Array<{ id: SortKey; label: string; describe: string }> = [
  { id: "ending-soon", label: "Ending soonest", describe: "Closest deadline first" },
  { id: "newest", label: "Newest", describe: "Most recently listed first" },
  { id: "price-high", label: "Top bid: high to low", describe: "Highest current bid first" },
  { id: "price-low", label: "Top bid: low to high", describe: "Cheapest current bid first" },
  { id: "activity", label: "Most contested", describe: "Most anti-snipe extensions first" },
];

/** Compare two bigints as a sort comparator, without lossy Number conversion. */
function cmp(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Orders a list without mutating it.
 *
 * Every comparator falls back to auction id, so the order is *total*. Two
 * auctions with an identical end time must not swap places between renders —
 * a row that jumps under the cursor as the clock ticks is how you misclick a
 * bid onto the wrong item.
 */
export function sortAuctions(list: readonly Auction[], key: SortKey, now: number): Auction[] {
  const out = [...list];
  out.sort((a, b) => {
    switch (key) {
      case "newest":
        return cmp(b.startTime, a.startTime) || cmp(b.id, a.id);
      case "price-high":
        return cmp(b.highestBid, a.highestBid) || cmp(b.id, a.id);
      case "price-low":
        /* Auctions with no bid at all sort last here, not first: "cheapest"
           should surface real prices you could win, not empty listings. */
        return (
          Number(hasBid(b)) - Number(hasBid(a)) ||
          cmp(a.highestBid, b.highestBid) ||
          cmp(a.id, b.id)
        );
      case "activity":
        return b.extensionCount - a.extensionCount || cmp(b.highestBid, a.highestBid) || cmp(b.id, a.id);
      case "ending-soon":
      default: {
        /* Closed auctions have no meaningful deadline; park them after every
           live one rather than letting a long-past endTime win the sort. */
        return (
          Number(!isOpen(a, now)) - Number(!isOpen(b, now)) ||
          cmp(a.endTime, b.endTime) ||
          cmp(a.id, b.id)
        );
      }
    }
  });
  return out;
}

function isOpen(a: Auction, now: number): boolean {
  const p = phaseOf(a, now);
  return p === "live" || p === "ending" || p === "final" || p === "awaiting-settlement";
}

/**
 * Free-text match across everything a person might paste into the box: an
 * auction number, a token id, a contract address, a seller or bidder address,
 * or the token's metadata name.
 *
 * Addresses match on any substring, so the truncated form shown in the UI
 * ("0x70997…79c8") can be typed back in from either end. Numeric queries match
 * the auction id and token id exactly rather than as substrings — searching
 * "1" should not return auction 21.
 */
export function matchesQuery(
  auction: Auction,
  query: string,
  nameOf?: (a: Auction) => string | undefined,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;

  /* A leading # is how people write auction numbers; strip it before the
     numeric comparison so "#12" and "12" behave identically. */
  const numeric = q.startsWith("#") ? q.slice(1) : q;
  if (/^\d+$/.test(numeric)) {
    if (auction.id.toString() === numeric) return true;
    if (auction.tokenId.toString() === numeric) return true;
  }

  if (q.startsWith("0x") || /^[0-9a-f]{6,}$/.test(q)) {
    const needle = q.startsWith("0x") ? q.slice(2) : q;
    for (const address of [auction.nft, auction.seller, auction.highestBidder]) {
      if (address.toLowerCase().includes(needle)) return true;
    }
  }

  const name = nameOf?.(auction);
  return name !== undefined && name.toLowerCase().includes(q);
}

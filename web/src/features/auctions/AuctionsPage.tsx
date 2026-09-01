import { useDeferredValue, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { AuctionTable } from "./AuctionTable";
import { ActivityFeed } from "./ActivityFeed";
import { BidButton } from "@/features/bidding/BidDialog";
import { SettleButton } from "@/features/bidding/AuctionActions";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { ButtonLink } from "@/components/ui/Button";
import { useAuctions } from "@/hooks/useAuctions";
import { useNow } from "@/hooks/useTicker";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useNftMetadataMany, nftKey, type NftRef } from "@/hooks/useNftMetadata";
import { config } from "@/config/runtime";
import { phaseOf, type Auction, type AuctionPhase } from "@/lib/auction";
import { matchesQuery, sortAuctions, SORTS, type SortKey } from "@/lib/auctionSort";
import { cn } from "@/lib/cn";

/**
 * The auction board.
 *
 * Everything here works with NO WALLET. The account is used only to decorate
 * rows ("yours", "winning") and to decide which action buttons to offer.
 *
 * Filtering, searching and sorting all happen on the client, over the page the
 * contract already returned. `getAuctions` hands back up to MAX_PAGE_SIZE
 * structs in a single multicall, so narrowing that list is a millisecond of
 * array work — going back to the chain to reorder rows would be slower and
 * would make the controls feel laggy for no gain. When the indexer lands, this
 * is the layer that moves server-side.
 */

type Filter = "open" | "ending" | "settleable" | "watching" | "closed" | "all";

const FILTERS: Array<{ id: Filter; label: string; describe: string }> = [
  { id: "open", label: "Open", describe: "Accepting bids" },
  { id: "ending", label: "Ending soon", describe: "Under five minutes left" },
  { id: "settleable", label: "Needs settling", describe: "Time is up, anyone can close these" },
  { id: "watching", label: "Watching", describe: "Auctions you have starred in this browser" },
  { id: "closed", label: "Closed", describe: "Settled, cancelled or below reserve" },
  { id: "all", label: "All", describe: "Every auction ever created" },
];

function matches(filter: Filter, phase: AuctionPhase, watched: boolean): boolean {
  switch (filter) {
    case "open":
      return phase === "live" || phase === "ending" || phase === "final";
    case "ending":
      return phase === "ending" || phase === "final";
    case "settleable":
      return phase === "awaiting-settlement";
    case "watching":
      return watched;
    case "closed":
      return phase === "settled" || phase === "cancelled" || phase === "reserve-not-met" || phase === "delivery-failed";
    case "all":
      return true;
    default:
      return true;
  }
}

export default function AuctionsPage() {
  const now = useNow();
  const { address } = useAccount();
  const { auctions, total, isInitialLoading, isError, error, isEmpty, refetch } = useAuctions();
  const { has: watching, count: watchedCount } = useWatchlist();

  /* All three are UI state, so they live in useState. Everything derived from
     them is computed during render — nothing is mirrored. */
  const [filter, setFilter] = useState<Filter>("open");
  const [sort, setSort] = useState<SortKey>("ending-soon");
  const [query, setQuery] = useState("");

  /* The input stays responsive while the (much heavier) filtered table
     re-renders against the older query. This is what useDeferredValue is for:
     no debounce timer, no dropped keystrokes, no stale-value bug. */
  const deferredQuery = useDeferredValue(query);

  /* Names come from token metadata, so searching for "Cyber" finds the lot
     even though that string exists nowhere on chain. The same multicall backs
     the table, and react-query serves both from one cache entry. */
  const refs = useMemo<NftRef[]>(
    () => auctions.map((a) => ({ nft: a.nft, tokenId: a.tokenId })),
    [auctions],
  );
  const metadata = useNftMetadataMany(refs);
  const nameOf = useMemo(
    () => (a: Auction) => metadata.get(nftKey(a.nft, a.tokenId))?.name,
    [metadata],
  );

  const visible = useMemo(() => {
    const narrowed = auctions.filter(
      (a) =>
        matches(filter, phaseOf(a, now), watching(a.id)) && matchesQuery(a, deferredQuery, nameOf),
    );
    return sortAuctions(narrowed, sort, now);
  }, [auctions, filter, sort, deferredQuery, nameOf, now, watching]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      open: 0,
      ending: 0,
      settleable: 0,
      watching: 0,
      closed: 0,
      all: auctions.length,
    };
    for (const a of auctions) {
      const p = phaseOf(a, now);
      const w = watching(a.id);
      for (const f of ["open", "ending", "settleable", "watching", "closed"] as const) {
        if (matches(f, p, w)) c[f] += 1;
      }
    }
    return c;
  }, [auctions, now, watching]);

  const activeFilter = FILTERS.find((f) => f.id === filter);
  const searching = deferredQuery.trim() !== "";

  return (
    <main id="main" className="mx-auto w-full max-w-[90rem] px-4 py-6 lg:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-ink)]">Auction board</h1>
          <p className="mt-1 max-w-prose text-[0.8125rem] text-[var(--color-ink-3)]">
            <span className="tnum">{total}</span> auction{total === 1 ? "" : "s"} on{" "}
            {config.chainName}. Read freely; a wallet is needed only to bid, list or withdraw.
          </p>
        </div>
        <ButtonLink to="/create" variant="primary" size="sm">
          List an item
        </ButtonLink>
      </div>

      {/* Filters as a real tablist-free toggle group: buttons with
          aria-pressed, which is simpler and more robust than fake tabs. */}
      <div
        role="group"
        aria-label="Filter auctions"
        className="mt-5 flex flex-wrap gap-1 border-b border-[var(--color-line)] pb-2"
      >
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={active}
              title={f.describe}
              onClick={() => setFilter(f.id)}
              className={cn(
                "tap h-8 rounded-[3px] border px-3 text-[0.8125rem]",
                active
                  ? "border-[var(--color-action)] bg-[var(--color-action)] text-[var(--color-on-action)] font-medium"
                  : "border-[var(--color-line-strong)] text-[var(--color-ink-2)] hover:bg-[var(--color-raised)]",
              )}
            >
              {f.label}
              <span className="tnum ml-1.5 opacity-80">{counts[f.id]}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 sm:max-w-sm">
          <label
            htmlFor="auction-search"
            className="col-head mb-1 block"
          >
            Search
          </label>
          {/* type="search" so the browser offers its own clear affordance and
              announces the field as a search box. */}
          <input
            id="auction-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, #id, token id or address"
            aria-describedby="auction-search-hint"
            className="h-8 w-full rounded-[3px] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 text-[0.8125rem] text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)]"
          />
          <p id="auction-search-hint" className="sr-only">
            Matches the token name, the auction number, the token id, and any part of the
            collection, seller or bidder address.
          </p>
        </div>

        <div>
          <label htmlFor="auction-sort" className="col-head mb-1 block">
            Sort
          </label>
          <select
            id="auction-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-8 rounded-[3px] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 text-[0.8125rem] text-[var(--color-ink)]"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id} title={s.describe}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* Result count, announced politely. A search that narrows a hundred
            rows to two must say so to someone who cannot see the table shrink. */}
        <p
          role="status"
          aria-live="polite"
          className="ml-auto self-center text-[0.75rem] text-[var(--color-ink-3)]"
        >
          <span className="tnum">{visible.length}</span> shown
          {searching ? ` for “${deferredQuery.trim()}”` : ""}
        </p>
      </div>

      <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="board-heading" className="panel min-w-0">
          <h2 id="board-heading" className="sr-only">
            Auctions, {activeFilter?.label.toLowerCase()}
          </h2>

          {/* Genuinely different screens, in the order they can occur. */}
          {isInitialLoading ? (
            <TableSkeleton rows={8} />
          ) : isError ? (
            <ErrorState
              error={error}
              onRetry={refetch}
              hint={
                <>
                  The app could not read <span className="tnum">{config.auctionHouseAddress}</span> on{" "}
                  {config.chainName}. Either the node at{" "}
                  <span className="tnum">{config.rpcUrl}</span> is not running, or no AuctionHouse is
                  deployed at that address. This is not a wallet problem — reads never need one.
                </>
              }
            />
          ) : isEmpty ? (
            <EmptyState
              title="No auctions have been created yet"
              body={
                <>
                  The contract responded correctly; it simply holds nothing. This is a working,
                  empty marketplace, not a broken one. Seed the demo data or list the first item
                  yourself.
                </>
              }
              action={
                <ButtonLink to="/create" variant="primary" size="sm">
                  List the first item
                </ButtonLink>
              }
            />
          ) : visible.length === 0 ? (
            /* Three ways to end up with nothing: a search that matched
               nothing, an empty watchlist, or a filter no auction is in. They
               need different words and different escape hatches. */
            searching ? (
              <EmptyState
                title={`Nothing matches “${deferredQuery.trim()}”`}
                body="Search covers the token name, the auction number, the token id and any address on the auction."
                action={
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="tap text-[0.8125rem] text-[var(--color-action)] underline"
                  >
                    Clear the search
                  </button>
                }
              />
            ) : filter === "watching" && watchedCount === 0 ? (
              <EmptyState
                title="You are not watching anything yet"
                body="Star an auction with the ☆ button on its row to follow it. The list is kept in this browser only — it never touches the chain, so watching an item costs nothing and tells no one."
                action={
                  <button
                    type="button"
                    onClick={() => setFilter("open")}
                    className="tap text-[0.8125rem] text-[var(--color-action)] underline"
                  >
                    Browse open auctions
                  </button>
                }
              />
            ) : (
              <EmptyState
                title={`Nothing matches "${activeFilter?.label ?? ""}"`}
                body={`There are ${auctions.length} auctions in total; none are in this state right now.`}
                action={
                  <button
                    type="button"
                    onClick={() => setFilter("all")}
                    className="tap text-[0.8125rem] text-[var(--color-action)] underline"
                  >
                    Show all auctions
                  </button>
                }
              />
            )
          ) : (
            <AuctionTable
              auctions={visible}
              now={now}
              account={address}
              metadata={metadata}
              caption={`${visible.length} auctions, ${SORTS.find((s) => s.id === sort)?.label.toLowerCase() ?? ""}`}
              renderAction={(a: Auction) => (
                <div className="flex justify-end gap-1.5">
                  <SettleButton auction={a} />
                  {/* null, not a local estimate: the grid has not read
                      minimumBid(). The dialog computes its own hint and the
                      simulation is the real gate, so nothing here can present
                      a guess as the contract's answer. */}
                  <BidButton auction={a} minimumBid={null} />
                </div>
              )}
            />
          )}
        </section>

        <div className="min-w-0">
          <ActivityFeed />
        </div>
      </div>
    </main>
  );
}

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { AuctionTable } from "./AuctionTable";
import { ActivityFeed } from "./ActivityFeed";
import { BidButton } from "@/features/bidding/BidDialog";
import { SettleButton } from "@/features/bidding/AuctionActions";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { ButtonLink } from "@/components/ui/Button";
import { useAuctions } from "@/hooks/useAuctions";
import { useNow } from "@/hooks/useTicker";
import { config } from "@/config/runtime";
import { phaseOf, type Auction, type AuctionPhase } from "@/lib/auction";
import { cn } from "@/lib/cn";

/**
 * The auction board.
 *
 * Everything here works with NO WALLET. The account is used only to decorate
 * rows ("yours", "winning") and to decide which action buttons to offer.
 */

type Filter = "open" | "ending" | "settleable" | "closed" | "all";

const FILTERS: Array<{ id: Filter; label: string; describe: string }> = [
  { id: "open", label: "Open", describe: "Accepting bids" },
  { id: "ending", label: "Ending soon", describe: "Under five minutes left" },
  { id: "settleable", label: "Needs settling", describe: "Time is up, anyone can close these" },
  { id: "closed", label: "Closed", describe: "Settled, cancelled or below reserve" },
  { id: "all", label: "All", describe: "Every auction ever created" },
];

function matches(filter: Filter, phase: AuctionPhase): boolean {
  switch (filter) {
    case "open":
      return phase === "live" || phase === "ending" || phase === "final";
    case "ending":
      return phase === "ending" || phase === "final";
    case "settleable":
      return phase === "awaiting-settlement";
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

  /* Filter is UI state, so it lives in useState. Everything derived from it is
     computed during render — nothing is mirrored. */
  const [filter, setFilter] = useState<Filter>("open");

  const visible = useMemo(
    () =>
      auctions
        .filter((a) => matches(filter, phaseOf(a, now)))
        /* Soonest-ending first: the only sort a bidder wants by default. */
        .sort((a, b) => Number(a.endTime - b.endTime)),
    [auctions, filter, now],
  );

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { open: 0, ending: 0, settleable: 0, closed: 0, all: auctions.length };
    for (const a of auctions) {
      const p = phaseOf(a, now);
      for (const f of ["open", "ending", "settleable", "closed"] as const) {
        if (matches(f, p)) c[f] += 1;
      }
    }
    return c;
  }, [auctions, now]);

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

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="board-heading" className="panel min-w-0">
          <h2 id="board-heading" className="sr-only">
            Auctions, {FILTERS.find((f) => f.id === filter)?.label.toLowerCase()}
          </h2>

          {/* Three genuinely different screens. */}
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
            <EmptyState
              title={`Nothing matches "${FILTERS.find((f) => f.id === filter)?.label}"`}
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
          ) : (
            <AuctionTable
              auctions={visible}
              now={now}
              account={address}
              caption={`${visible.length} auctions, soonest ending first`}
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

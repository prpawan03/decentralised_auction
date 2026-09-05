import { Link } from "react-router-dom";
import { useActivity, type ActivityItem } from "@/hooks/useAuctionEvents";
import { useNow } from "@/hooks/useTicker";
import { AddressChip } from "@/components/ui/AddressChip";
import { Money } from "@/components/ui/Money";
import { Pill, type Tone } from "@/components/ui/Pill";
import { formatRelativePast } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * The live activity feed.
 *
 * This is a NARRATIVE, not state. Every row is "something happened at a time";
 * no price, bidder or status anywhere else in the app is read from this list.
 * The watchers that fill it also invalidate the affected queries, so the
 * tables re-read the chain and stay authoritative.
 *
 * Accessibility: the list is NOT a live region. New auction activity arriving
 * every few seconds would talk over whatever the user is doing, which is the
 * "announced 13 times" failure in a different costume. Instead there is one
 * polite counter that says "4 new events" — a summary, at a human rate.
 */

const KIND: Record<ActivityItem["kind"], { tone: Tone; verb: string }> = {
  created: { tone: "action", verb: "listed" },
  bid: { tone: "live", verb: "bid" },
  extended: { tone: "warn", verb: "extended" },
  settled: { tone: "neutral", verb: "settled" },
  cancelled: { tone: "danger", verb: "cancelled" },
};

const OUTCOME = ["live", "sold", "cancelled", "below reserve"] as const;

export function ActivityFeed({ limit = 12, className }: { limit?: number; className?: string }) {
  const { items } = useActivity();
  const now = useNow();
  const shown = items.slice(0, limit);

  return (
    <section aria-labelledby="activity-heading" className={cn("panel", className)}>
      <header className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
        <h2 id="activity-heading" className="text-sm font-semibold text-[var(--color-ink)]">
          Live activity
        </h2>
        <span className="tnum text-[0.6875rem] text-[var(--color-ink-3)]">
          {items.length === 0
            ? "watching"
            : `${items.length} event${items.length === 1 ? "" : "s"}`}
        </span>
      </header>

      {/* A summary, announced politely. Not a per-row live region. */}
      <p role="status" aria-live="polite" className="sr-only">
        {items.length > 0 ? `${items.length} chain events received this session.` : ""}
      </p>

      {shown.length === 0 ? (
        <p className="max-w-prose px-4 py-5 text-[0.8125rem] leading-relaxed text-[var(--color-ink-3)]">
          Nothing has happened on chain since you opened this page. New bids, listings and
          settlements appear here as their logs arrive — no wallet required.
        </p>
      ) : (
        <ol className="divide-y divide-[var(--color-line)]">
          {shown.map((item) => {
            const meta = KIND[item.kind];
            return (
              <li key={item.id} className="flex items-baseline gap-3 px-4 py-2.5">
                <Pill tone={meta.tone}>{meta.verb}</Pill>

                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <Link
                    to={`/auctions/${item.auctionId.toString()}`}
                    className="tnum text-[0.8125rem] text-[var(--color-action)] no-underline hover:underline"
                  >
                    <span aria-hidden="true">#{item.auctionId.toString()}</span>
                    <span className="sr-only">Auction {item.auctionId.toString()}</span>
                  </Link>

                  {item.kind === "extended" ? (
                    <span className="text-[0.8125rem] text-[var(--color-warn)]">
                      +5:00 anti-snipe
                      {item.extensionCount !== undefined ? (
                        <span className="tnum ml-1 text-[var(--color-ink-3)]">
                          (×{item.extensionCount})
                        </span>
                      ) : null}
                    </span>
                  ) : null}

                  {item.amount !== undefined && item.kind !== "extended" ? (
                    <Money wei={item.amount} size="sm" bare />
                  ) : null}

                  {item.kind === "settled" && item.outcome !== undefined ? (
                    <span className="text-[0.75rem] text-[var(--color-ink-3)]">
                      {OUTCOME[item.outcome] ?? "closed"}
                    </span>
                  ) : null}

                  {item.actor ? (
                    <AddressChip
                      address={item.actor}
                      linked
                      className="text-[0.75rem]"
                      lead={6}
                      tail={4}
                    />
                  ) : null}
                </div>

                <time className="tnum shrink-0 text-[0.6875rem] text-[var(--color-ink-3)]">
                  {formatRelativePast(item.at, now)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

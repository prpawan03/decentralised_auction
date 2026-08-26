import { Link } from "react-router-dom";
import type { Address } from "viem";
import { zeroAddress } from "viem";
import { Money } from "@/components/ui/Money";
import { Countdown } from "@/components/ui/Countdown";
import { AddressChip } from "@/components/ui/AddressChip";
import { StateStripe, type Tone } from "@/components/ui/Pill";
import { StatusPill, StandingPill } from "./StatusPill";
import { AntiSnipeBadge } from "./AntiSnipeBadge";
import {
  buyNowEnabled,
  hasBid,
  phaseOf,
  reserveMet,
  sameAddress,
  type Auction,
} from "@/lib/auction";
import { cn } from "@/lib/cn";

/**
 * The auction grid, as a real <table>.
 *
 * A table, not cards: this is columnar data with a natural sort order, and a
 * table gives a screen-reader user row/column navigation for free — which a
 * grid of <div>s does not. <caption> names it, <th scope="col"> labels every
 * column, and the id column's <th scope="row"> makes each row self-describing
 * when a cell is read out of context.
 *
 * Numeric columns are right-aligned with tabular figures so the decimal points
 * form a straight edge, which is the whole point of a trading table.
 */

const STRIPE_TONE: Record<string, Tone> = {
  live: "live",
  ending: "warn",
  final: "danger",
  "awaiting-settlement": "action",
  settled: "neutral",
  cancelled: "neutral",
  "reserve-not-met": "danger",
};

export interface AuctionTableProps {
  auctions: Auction[];
  now: number;
  account: Address | undefined;
  /** Rendered in the last column, e.g. a Bid button. */
  renderAction?: (auction: Auction) => React.ReactNode;
  caption: string;
  /** Hides the caption visually while keeping it for assistive tech. */
  captionHidden?: boolean;
}

export function AuctionTable({
  auctions,
  now,
  account,
  renderAction,
  caption,
  captionHidden = true,
}: AuctionTableProps) {
  return (
    /* The table scrolls inside its own box; the page body never scrolls
       sideways (SC 1.4.10 Reflow). */
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse text-left">
        <caption
          className={cn(
            "px-4 py-2 text-left text-[0.75rem] text-[var(--color-ink-3)]",
            captionHidden && "sr-only",
          )}
        >
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-[var(--color-line)]">
            <th scope="col" className="col-head px-4 py-2 whitespace-nowrap">
              #
            </th>
            <th scope="col" className="col-head px-4 py-2">
              Item
            </th>
            <th scope="col" className="col-head px-4 py-2">
              State
            </th>
            <th scope="col" className="col-head px-4 py-2 text-right whitespace-nowrap">
              Top bid
            </th>
            <th scope="col" className="col-head px-4 py-2 text-right whitespace-nowrap">
              Reserve
            </th>
            <th scope="col" className="col-head px-4 py-2 text-right whitespace-nowrap">
              Buy now
            </th>
            <th scope="col" className="col-head px-4 py-2 whitespace-nowrap">
              Leader
            </th>
            <th scope="col" className="col-head px-4 py-2 text-right whitespace-nowrap">
              Ends in
            </th>
            {renderAction ? (
              <th scope="col" className="col-head px-4 py-2 text-right">
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {auctions.map((a) => {
            const phase = phaseOf(a, now);
            const bid = hasBid(a);
            const met = reserveMet(a);
            return (
              <tr
                key={a.id.toString()}
                className={cn(
                  "relative border-b border-[var(--color-line)]",
                  "hover:bg-[var(--color-raised)] focus-within:bg-[var(--color-raised)]",
                )}
              >
                {/* Row-state stripe: form, not just colour. */}
                <th scope="row" className="relative px-4 py-3 align-middle">
                  <StateStripe tone={STRIPE_TONE[phase] ?? "neutral"} />
                  <Link
                    to={`/auctions/${a.id.toString()}`}
                    className="tnum text-[0.8125rem] font-semibold text-[var(--color-action)] no-underline hover:underline"
                  >
                    <span aria-hidden="true">#{a.id.toString()}</span>
                    <span className="sr-only">Auction number {a.id.toString()}, open details</span>
                  </Link>
                </th>

                <td className="px-4 py-3 align-middle">
                  <div className="flex min-w-0 flex-col">
                    <Link
                      to={`/auctions/${a.id.toString()}`}
                      className="truncate text-[0.8125rem] text-[var(--color-ink)] no-underline hover:underline"
                    >
                      Token #{a.tokenId.toString()}
                    </Link>
                    <span className="tnum truncate text-[0.6875rem] text-[var(--color-ink-3)]">
                      {a.nft}
                    </span>
                  </div>
                </td>

                <td className="px-4 py-3 align-middle">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusPill auction={a} now={now} />
                    <StandingPill auction={a} account={account} now={now} />
                    <AntiSnipeBadge auction={a} compact />
                  </div>
                </td>

                <td className="px-4 py-3 text-right align-middle">
                  {bid ? (
                    <Money wei={a.highestBid} bare tone={met ? "default" : "muted"} size="sm" />
                  ) : (
                    <span className="text-[0.8125rem] text-[var(--color-ink-3)]">no bids</span>
                  )}
                </td>

                <td className="px-4 py-3 text-right align-middle">
                  {a.reservePrice > 0n ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Money wei={a.reservePrice} bare tone="muted" size="sm" />
                      {bid && !met ? (
                        <span
                          title="The top bid is below the reserve"
                          className="text-[0.625rem] font-semibold tracking-wide text-[var(--color-warn)] uppercase"
                        >
                          unmet
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-[0.8125rem] text-[var(--color-ink-3)]">none</span>
                  )}
                </td>

                <td className="px-4 py-3 text-right align-middle">
                  {buyNowEnabled(a) ? (
                    <Money wei={a.buyNowPrice} bare tone="muted" size="sm" />
                  ) : (
                    /* buyNowPrice == 0 means DISABLED, never "free". */
                    <span className="text-[0.8125rem] text-[var(--color-ink-3)]">off</span>
                  )}
                </td>

                <td className="px-4 py-3 align-middle">
                  {a.highestBidder === zeroAddress ? (
                    <span className="text-[0.8125rem] text-[var(--color-ink-3)]">—</span>
                  ) : (
                    <AddressChip
                      address={a.highestBidder}
                      you={sameAddress(a.highestBidder, account)}
                      label="highest bidder"
                      className="text-[0.8125rem]"
                    />
                  )}
                </td>

                <td className="px-4 py-3 text-right align-middle whitespace-nowrap">
                  {phase === "settled" || phase === "cancelled" || phase === "reserve-not-met" ? (
                    <span className="text-[0.8125rem] text-[var(--color-ink-3)]">closed</span>
                  ) : (
                    <Countdown endTime={a.endTime} size="sm" label={`Auction ${a.id.toString()}`} />
                  )}
                </td>

                {renderAction ? (
                  <td className="px-4 py-3 text-right align-middle">{renderAction(a)}</td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

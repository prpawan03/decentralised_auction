import { Money } from "@/components/ui/Money";
import { Pill } from "@/components/ui/Pill";
import { useNow } from "@/hooks/useTicker";
import {
  dutchFloorPrice,
  dutchPriceAt,
  dutchStartPrice,
  isDutch,
  secondsRemaining,
  type Auction,
} from "@/lib/auction";
import { formatEth } from "@/lib/format";

/**
 * The falling price of a Dutch listing.
 *
 * A descending auction has no bids and no leader — the first buyer to accept
 * the current price takes it. So there is exactly one number that matters, and
 * it changes every second. It is recomputed from the shared 1 Hz ticker rather
 * than polled from the chain: `currentPrice()` is a pure function of the two
 * prices, the two timestamps and the clock, all of which the client already
 * holds. Polling it would be a network round trip per second per row.
 *
 * The quote is a HINT, and the buy path is built to make that safe. The client
 * reads the browser clock while the contract reads the block timestamp, so the
 * two can disagree by a few seconds; the buy sends slightly more than the quote
 * and the contract refunds the excess. See {@link BuyDutchButton}.
 */

/** The format badge. Shown wherever English and Dutch listings sit together. */
export function FormatPill({ auction }: { auction: Pick<Auction, "format"> }) {
  return isDutch(auction) ? (
    <Pill tone="action" title="Descending price. The first buyer at the current price wins.">
      Dutch
    </Pill>
  ) : null;
}

export interface DutchPriceProps {
  auction: Auction;
  size?: "sm" | "md" | "lg";
  /** Adds the opening price and floor as context. The detail page wants these. */
  withRange?: boolean;
}

export function DutchPrice({ auction, size = "sm", withRange = false }: DutchPriceProps) {
  const now = useNow();
  const price = dutchPriceAt(auction, now);
  const floor = dutchFloorPrice(auction);
  const start = dutchStartPrice(auction);
  const atFloor = price <= floor;
  const over = secondsRemaining(auction, now) <= 0;

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      {/*
        aria-live is deliberately absent. This number changes every second, and
        announcing it would make the page unusable with a screen reader (SC
        2.2.2). The value is in the DOM and readable on demand; the Buy dialog
        states the price once, at the moment it matters.
      */}
      <Money wei={price} bare size={size} tone={atFloor ? "muted" : "default"} />
      {withRange ? (
        <span className="text-[0.6875rem] text-[var(--color-ink-3)]">
          {atFloor || over ? (
            <>at the floor</>
          ) : (
            <>
              from <span className="tnum">{formatEth(start)}</span> down to{" "}
              <span className="tnum">{formatEth(floor)}</span>
            </>
          )}
        </span>
      ) : null}
    </span>
  );
}

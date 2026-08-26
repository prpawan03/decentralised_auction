import { useAuctionActivity } from "@/hooks/useAuctionEvents";
import { useNow } from "@/hooks/useTicker";
import { Pill } from "@/components/ui/Pill";
import { formatCountdown } from "@/lib/format";
import { ENDING_SOON_SECONDS, phaseOf, type Auction } from "@/lib/auction";

/**
 * The anti-snipe indicator.
 *
 * Two distinct things get shown here, and conflating them would be a lie:
 *
 *  ARMED  — the auction is inside the anti-snipe window right now, so a bid
 *           WILL extend it. Derived from the clock, not from an event.
 *  FIRED  — an AuctionExtended log has just arrived. Shows the extension that
 *           happened and the running count, straight from the struct's
 *           `extensionCount` (the authoritative number) with the event only
 *           supplying the "just now" timing.
 *
 * The +5:00 figure is ANTI_SNIPE_WINDOW rendered as a duration rather than a
 * hard-coded string, so a contract deployed with a different window still
 * reports itself honestly.
 */

/** How long a FIRED badge stays up after the event lands. */
const FLASH_SECONDS = 45;

export function AntiSnipeBadge({ auction, compact = false }: { auction: Auction; compact?: boolean }) {
  const now = useNow();
  const events = useAuctionActivity(auction.id);
  const phase = phaseOf(auction, now);

  const lastExtension = events.find((e) => e.kind === "extended");
  const justFired = lastExtension !== undefined && now - lastExtension.at <= FLASH_SECONDS;

  /* extensionCount from the struct is the truth; the event is only a prompt. */
  const count = auction.extensionCount;

  if (justFired) {
    return (
      <Pill
        tone="warn"
        solid
        title={`A bid inside the final ${formatCountdown(ENDING_SOON_SECONDS)} pushed the end time back.`}
      >
        <span aria-hidden="true">
          Extended +{formatCountdown(ENDING_SOON_SECONDS)} — anti-snipe
          {count > 0 ? ` (×${count})` : ""}
        </span>
        <span className="sr-only">
          Anti-snipe extension fired. The auction was extended by{" "}
          {ENDING_SOON_SECONDS / 60} minutes. This is extension number {count}.
        </span>
      </Pill>
    );
  }

  /* No live flash, but the auction has been extended before: keep the count
     visible, because it changes how a bidder should think about the clock. */
  if (count > 0) {
    return (
      <Pill
        tone="neutral"
        title={`This auction has been extended ${count} time${count === 1 ? "" : "s"} by the anti-snipe rule.`}
      >
        <span aria-hidden="true">ext ×{count}</span>
        <span className="sr-only">
          Extended {count} time{count === 1 ? "" : "s"} by anti-snipe
        </span>
      </Pill>
    );
  }

  /* Armed: inside the window, so any bid extends. Worth saying out loud. */
  if (!compact && (phase === "ending" || phase === "final")) {
    return (
      <Pill tone="warn" title="A bid placed now will push the end time back.">
        anti-snipe armed
      </Pill>
    );
  }

  return null;
}

/**
 * The long-form explanation for the detail page. Plain prose, because this is
 * the rule that most surprises a first-time bidder.
 */
export function AntiSnipeExplainer({ auction }: { auction: Auction }) {
  const now = useNow();
  const phase = phaseOf(auction, now);
  const armed = phase === "ending" || phase === "final";

  return (
    <div className="border-l-2 border-[var(--color-line-strong)] px-4 py-3">
      <h3 className="text-[0.75rem] font-semibold tracking-[0.06em] text-[var(--color-ink-2)] uppercase">
        Anti-snipe
      </h3>
      <p className="mt-1.5 max-w-prose text-[0.8125rem] leading-relaxed text-[var(--color-ink-3)]">
        A bid landing in the last {ENDING_SOON_SECONDS / 60} minutes pushes the end time back by{" "}
        {ENDING_SOON_SECONDS / 60} minutes, up to 20 times. You cannot win by bidding one second
        before the close.{" "}
        {armed ? (
          <strong className="text-[var(--color-warn)]">
            The window is open now: any bid you place will extend this auction.
          </strong>
        ) : null}
      </p>
      {auction.extensionCount > 0 ? (
        <p className="tnum mt-2 text-[0.75rem] text-[var(--color-ink-2)]">
          Extended {auction.extensionCount} time{auction.extensionCount === 1 ? "" : "s"} so far.
        </p>
      ) : null}
    </div>
  );
}

import { useWatchlist } from "@/hooks/useWatchlist";
import { cn } from "@/lib/cn";

/**
 * The follow star.
 *
 * `aria-pressed` rather than a checkbox: this is a two-state control that acts
 * immediately, not a form field that gets submitted. The accessible name says
 * which auction it applies to, because in a table of a hundred rows "Watch" on
 * its own is useless to anyone navigating by control.
 *
 * The star is drawn filled or hollow, so watched state is legible without
 * colour, and the button never moves or resizes between states — a control
 * that reflows on click is a control you double-fire by accident.
 */
export function WatchButton({ auctionId, className }: { auctionId: bigint; className?: string }) {
  const { has, toggle } = useWatchlist();
  const watched = has(auctionId);
  const id = auctionId.toString();

  return (
    <button
      type="button"
      aria-pressed={watched}
      aria-label={watched ? `Stop watching auction ${id}` : `Watch auction ${id}`}
      title={watched ? "Watching. Click to stop." : "Watch this auction"}
      onClick={() => {
        toggle(auctionId);
      }}
      className={cn(
        "tap inline-flex h-6 w-6 items-center justify-center rounded-[3px] leading-none",
        watched
          ? "text-[var(--color-warn)]"
          : "text-[var(--color-ink-3)] hover:bg-[var(--color-raised)] hover:text-[var(--color-ink-2)]",
        className,
      )}
    >
      <span aria-hidden="true" className="text-[0.875rem]">
        {watched ? "★" : "☆"}
      </span>
    </button>
  );
}

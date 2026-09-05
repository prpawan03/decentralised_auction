import { useAlerts } from "@/hooks/useAuctionAlerts";
import { cn } from "@/lib/cn";

/**
 * The alerts switch, in the header.
 *
 * A real toggle (`aria-pressed`), not a link to a settings page, because it has
 * exactly two states and the user wants to flip it in the middle of a bidding
 * war. The label states what turning it on WILL DO, and the permission story is
 * told in the tooltip rather than in a modal.
 *
 * When the browser has already denied notifications the control does not
 * pretend otherwise: it disables itself and explains that the block lives in
 * browser settings, which is the only place it can be undone. Silently
 * offering a switch that cannot work is the worse failure.
 */
export function AlertsToggle() {
  const { enabled, supported, permission, toggle } = useAlerts();

  if (!supported) return null;

  const denied = permission === "denied";
  const label = denied ? "Alerts blocked" : enabled ? "Alerts on" : "Alerts off";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={denied}
      aria-pressed={enabled}
      title={
        denied
          ? "This browser has blocked notifications for this site. Re-allow them in browser settings to turn alerts on."
          : "Notifies you when you are outbid, when a watched auction is about to close, and when one of yours settles."
      }
      className={cn(
        "tap hidden h-8 items-center gap-1.5 rounded-[3px] border px-3 text-[0.75rem] sm:inline-flex",
        denied
          ? "cursor-not-allowed border-[var(--color-line)] text-[var(--color-ink-3)]"
          : enabled
            ? "border-[var(--color-live)] text-[var(--color-live)]"
            : "border-[var(--color-line-strong)] text-[var(--color-ink-2)] hover:bg-[var(--color-raised)]",
      )}
    >
      {/* State is carried by the text, not by the dot. The dot is decoration
          for sighted scanning only (SC 1.4.1 Use of Color). */}
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          enabled ? "bg-[var(--color-live)]" : "bg-[var(--color-line-strong)]",
        )}
      />
      {label}
    </button>
  );
}

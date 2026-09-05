import { useEffect, useRef, useState } from "react";
import { useNow } from "@/hooks/useTicker";
import { formatCountdown, speakDuration, toIso } from "@/lib/format";
import { ENDING_SOON_SECONDS, FINAL_SECONDS } from "@/lib/auction";
import { cn } from "@/lib/cn";

/**
 * A live countdown.
 *
 * TWO things make this accessible, and the second one is the hard part:
 *
 * 1. The visible digits are `aria-hidden`, because "04:11:07" read aloud is
 *    "four eleven oh seven". A separate, visually hidden live region carries
 *    words: "3 minutes remaining".
 *
 * 2. THE LIVE REGION DOES NOT UPDATE EVERY SECOND. A polite region that
 *    changes at 1 Hz makes a screen reader talk continuously and the page
 *    unusable — it also violates SC 2.2.2 in spirit. It announces only when
 *    the countdown crosses a threshold a bidder would act on:
 *
 *      1 hour, 30 min, 10 min, 5 min (anti-snipe window opens), 1 min,
 *      30 s, 10 s, and 0.
 *
 *    Between thresholds the region's text does not change, so nothing is
 *    announced at all.
 *
 * The colour and the WORD both shift under 5 minutes and under 60 seconds, so
 * urgency survives greyscale (SC 1.4.1).
 */

const THRESHOLDS = [3600, 1800, 600, 300, 60, 30, 10, 0] as const;

/** The highest threshold the countdown has dropped at or below. */
function crossedThreshold(seconds: number): number {
  let crossed = Number.POSITIVE_INFINITY;
  for (const t of THRESHOLDS) {
    if (seconds <= t && t < crossed) crossed = t;
  }
  return Number.isFinite(crossed) ? crossed : -1;
}

export interface CountdownProps {
  /** Unix seconds. */
  endTime: bigint;
  /** Renders a compact variant for a dense table row. */
  size?: "sm" | "md" | "lg";
  /** Prefix for the spoken announcement, e.g. "Auction 4". */
  label?: string;
  className?: string;
}

export function Countdown({ endTime, size = "md", label, className }: CountdownProps) {
  const now = useNow();
  /* Derived during render. Never mirrored into state. */
  const remaining = Math.max(0, Number(endTime) - now);

  const urgency = remaining <= 0 ? "over" : remaining <= FINAL_SECONDS ? "final" : remaining <= ENDING_SOON_SECONDS ? "soon" : "normal";

  const tone =
    urgency === "over"
      ? "text-[var(--color-ink-3)]"
      : urgency === "final"
        ? "text-[var(--color-danger)]"
        : urgency === "soon"
          ? "text-[var(--color-warn)]"
          : "text-[var(--color-ink)]";

  const sizeClass = {
    sm: "text-[0.8125rem]",
    md: "text-sm",
    lg: "text-2xl",
  }[size];

  /* The announcement text only changes at a threshold, so the live region is
     silent in between. */
  const [announcement, setAnnouncement] = useState("");
  const lastThreshold = useRef<number | null>(null);

  /* An anti-snipe extension moves endTime. Forget the last threshold so the
     next tick announces the new remaining time instead of leaving the region
     showing a value that is now several minutes stale. */
  useEffect(() => {
    lastThreshold.current = null;
  }, [endTime]);

  useEffect(() => {
    const t = crossedThreshold(remaining);
    if (t === lastThreshold.current) return;
    lastThreshold.current = t;
    if (t < 0) return; // still above every threshold: say nothing
    const prefix = label ? `${label}: ` : "";
    setAnnouncement(remaining <= 0 ? `${prefix}auction ended` : `${prefix}${speakDuration(remaining)}`);
  }, [remaining, label]);

  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <time
        dateTime={toIso(endTime)}
        aria-hidden="true"
        className={cn("tnum font-medium", sizeClass, tone)}
      >
        {remaining <= 0 ? "ENDED" : formatCountdown(remaining)}
      </time>

      {/* The word channel: urgency without relying on the colour. */}
      {urgency === "soon" || urgency === "final" ? (
        <span
          aria-hidden="true"
          className={cn(
            "text-[0.625rem] font-semibold tracking-[0.08em] uppercase",
            urgency === "final" ? "text-[var(--color-danger)]" : "text-[var(--color-warn)]",
          )}
        >
          {urgency === "final" ? "final" : "ending"}
        </span>
      ) : null}

      {/* Polite, threshold-gated. This is the only thing a screen reader hears. */}
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>
    </span>
  );
}

/** A static, non-announcing countdown for a list of many rows. */
export function StaticRemaining({ endTime }: { endTime: bigint }) {
  const now = useNow();
  const remaining = Math.max(0, Number(endTime) - now);
  return (
    <time dateTime={toIso(endTime)} className="tnum text-[0.8125rem] text-[var(--color-ink-2)]">
      <span aria-hidden="true">{remaining <= 0 ? "ENDED" : formatCountdown(remaining)}</span>
      <span className="sr-only">{remaining <= 0 ? "ended" : speakDuration(remaining)}</span>
    </time>
  );
}

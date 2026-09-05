import { formatEth, formatEthExact } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * An ETH amount in a column of ETH amounts.
 *
 * `tnum` gives tabular figures, so decimal points stack vertically down a
 * table. The visible string is rounded to 4 dp; the exact wei value is in the
 * title and in the screen-reader text, because "2.5200 ETH" and
 * "2.52004999 ETH" are different bids and a bidder is entitled to the truth.
 */

export interface MoneyProps {
  wei: bigint;
  decimals?: number;
  /** Suppresses the "ETH" suffix when the column header already says it. */
  bare?: boolean;
  size?: "sm" | "md" | "lg";
  tone?: "default" | "muted" | "live" | "danger";
  className?: string;
}

export function Money({
  wei,
  decimals = 4,
  bare = false,
  size = "md",
  tone = "default",
  className,
}: MoneyProps) {
  const shown = formatEth(wei, decimals);
  const exact = formatEthExact(wei);
  const rounded = shown !== exact;

  const sizes = { sm: "text-[0.8125rem]", md: "text-sm", lg: "text-xl" }[size];
  const tones = {
    default: "text-[var(--color-ink)]",
    muted: "text-[var(--color-ink-3)]",
    live: "text-[var(--color-live)]",
    danger: "text-[var(--color-danger)]",
  }[tone];

  return (
    <span
      className={cn("tnum font-medium", sizes, tones, className)}
      title={rounded ? `${exact} ETH` : undefined}
    >
      <span aria-hidden="true">
        {shown}
        {bare ? null : <span className="ml-1 text-[0.75em] text-[var(--color-ink-3)]">ETH</span>}
      </span>
      <span className="sr-only">{exact} ETH</span>
    </span>
  );
}

/** A label/value pair for the dense stat strips. */
export function Stat({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string | undefined;
}) {
  return (
    <div className="min-w-0">
      <dt className="col-head">{label}</dt>
      <dd className="mt-1 text-[var(--color-ink)]">{children}</dd>
      {hint ? <p className="mt-0.5 text-[0.6875rem] text-[var(--color-ink-3)]">{hint}</p> : null}
    </div>
  );
}

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A state pill.
 *
 * SC 1.4.1 Use of Color: colour is never the only channel. Each tone also
 * carries a distinct GLYPH (a filled square, a hollow square, a bar, a cross)
 * and, always, a word. Read in greyscale the four tones remain distinguishable
 * by their marker alone.
 */

export type Tone = "live" | "warn" | "danger" | "neutral" | "action";

const tones: Record<Tone, { className: string; marker: string }> = {
  live: {
    className: "text-[var(--color-live)] border-[var(--color-live)]",
    marker: "●", // filled circle
  },
  warn: {
    className: "text-[var(--color-warn)] border-[var(--color-warn)]",
    marker: "▲", // filled triangle
  },
  danger: {
    className: "text-[var(--color-danger)] border-[var(--color-danger)]",
    marker: "■", // filled square
  },
  action: {
    className: "text-[var(--color-action)] border-[var(--color-action)]",
    marker: "◆", // filled diamond
  },
  neutral: {
    className: "text-[var(--color-ink-3)] border-[var(--color-line-strong)]",
    marker: "○", // hollow circle
  },
};

export interface PillProps {
  tone?: Tone;
  children: ReactNode;
  /** Solid fill, for the one pill that must dominate a row. */
  solid?: boolean;
  className?: string;
  title?: string;
}

const solidTones: Record<Tone, string> = {
  live: "bg-[var(--color-live)] text-[var(--color-on-live)] border-[var(--color-live)]",
  warn: "bg-[var(--color-warn)] text-[var(--color-on-warn)] border-[var(--color-warn)]",
  danger: "bg-[var(--color-danger)] text-[var(--color-on-danger)] border-[var(--color-danger)]",
  action: "bg-[var(--color-action)] text-[var(--color-on-action)] border-[var(--color-action)]",
  neutral: "bg-[var(--color-raised)] text-[var(--color-ink-2)] border-[var(--color-line-strong)]",
};

export function Pill({ tone = "neutral", solid = false, children, className, title }: PillProps) {
  const t = tones[tone];
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[2px] border px-1.5 py-0.5",
        "text-[0.6875rem] font-semibold tracking-[0.06em] uppercase whitespace-nowrap",
        solid ? solidTones[tone] : t.className,
        className,
      )}
    >
      {/* The glyph is decorative: the word next to it carries the meaning. */}
      <span aria-hidden="true" className="text-[0.625rem] leading-none">
        {t.marker}
      </span>
      {children}
    </span>
  );
}

/**
 * A 2px stripe down the left edge of a row. The SECOND non-colour channel for
 * row state: present/absent and position, independent of hue.
 */
export function StateStripe({ tone }: { tone: Tone }) {
  const colour: Record<Tone, string> = {
    live: "bg-[var(--color-live)]",
    warn: "bg-[var(--color-warn)]",
    danger: "bg-[var(--color-danger)]",
    action: "bg-[var(--color-action)]",
    neutral: "bg-[var(--color-line-strong)]",
  };
  return <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-[2px]", colour[tone])} />;
}

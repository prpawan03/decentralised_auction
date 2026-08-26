import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { cn } from "@/lib/cn";

/**
 * The one button.
 *
 * - Sharp corners (3px), 1px hairline border, flat fill. No shadow, no
 *   gradient, no scale-on-press.
 * - Every variant clears 24x24 CSS px (SC 2.5.8 Target Size (Minimum)); the
 *   default size clears 44px, which is the AAA figure, because this is a
 *   money app.
 * - `disabled` is a real `disabled` attribute AND `aria-disabled`, so it is
 *   both unclickable and announced. A "loading" button keeps its accessible
 *   name and adds a status suffix rather than swapping the label for a
 *   spinner, so a screen reader is not left with an unnamed control.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-[3px] border font-medium " +
  "transition-[background-color,border-color,color] duration-150 select-none " +
  "disabled:cursor-not-allowed disabled:opacity-55";

const variants: Record<Variant, string> = {
  primary:
    "bg-[var(--color-action)] text-[var(--color-on-action)] border-[var(--color-action)] " +
    "hover:bg-[var(--color-action-hover)] hover:border-[var(--color-action-hover)]",
  secondary:
    "bg-[var(--color-raised)] text-[var(--color-ink)] border-[var(--color-line-strong)] " +
    "hover:bg-[var(--color-surface)] hover:border-[var(--color-action)]",
  ghost:
    "bg-transparent text-[var(--color-action)] border-transparent " +
    "hover:bg-[var(--color-raised)] hover:border-[var(--color-line-strong)]",
  danger:
    "bg-transparent text-[var(--color-danger)] border-[var(--color-danger)] " +
    "hover:bg-[var(--color-danger)] hover:text-[var(--color-on-danger)]",
};

const sizes: Record<Size, string> = {
  /* 32px tall: above the 24px floor, dense enough for a table row. */
  sm: "h-8 px-3 text-[0.8125rem] min-w-8",
  /* 44px tall: the comfortable target for a primary action. */
  md: "h-11 px-4 text-sm min-w-11",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a status suffix; keeps the label so the accessible name is stable. */
  loading?: boolean;
  loadingLabel?: string;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, loadingLabel = "Working", className, children, disabled, ...rest },
  ref,
) {
  const isDisabled = disabled === true || loading;
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], sizes[size], className)}
    >
      {children}
      {loading ? (
        <span className="tnum text-[0.75rem] opacity-80">
          <span aria-hidden="true">…</span>
          <span className="sr-only">{loadingLabel}</span>
        </span>
      ) : null}
    </button>
  );
});

export interface ButtonLinkProps extends LinkProps {
  variant?: Variant;
  size?: Size;
}

/** Same look, but a real anchor, so it is keyboard- and right-click-correct. */
export function ButtonLink({ variant = "secondary", size = "md", className, ...rest }: ButtonLinkProps) {
  return <Link {...rest} className={cn(base, variants[variant], sizes[size], "no-underline", className)} />;
}

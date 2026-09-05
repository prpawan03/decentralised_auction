import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

/**
 * Loading, empty and error are THREE DIFFERENT SCREENS.
 *
 * The old app rendered the same "No auctions yet" for all three, so a
 * disconnected node and a genuinely empty marketplace were indistinguishable
 * and nobody could tell whether the demo was broken.
 */

/** Skeleton rows. `aria-busy` + a polite status, so the wait is announced once. */
export function TableSkeleton({
  rows = 6,
  label = "Loading auctions",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        {label}
      </p>
      <ul className="divide-y divide-[var(--color-line)]">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-center gap-4 px-4 py-3.5" aria-hidden="true">
            <span className="h-3 w-10 rounded-[2px] bg-[var(--color-raised)]" />
            <span className="h-3 flex-1 rounded-[2px] bg-[var(--color-raised)]" />
            <span className="h-3 w-20 rounded-[2px] bg-[var(--color-raised)]" />
            <span className="h-3 w-24 rounded-[2px] bg-[var(--color-raised)]" />
            <span className="h-3 w-16 rounded-[2px] bg-[var(--color-raised)]" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    /* Left-aligned. Not everything is centred. */
    <div className={cn("px-5 py-10", className)}>
      <h3 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h3>
      <div className="mt-1.5 max-w-prose text-[0.8125rem] leading-relaxed text-[var(--color-ink-3)]">
        {body}
      </div>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Could not read the chain",
  error,
  onRetry,
  hint,
}: {
  title?: string;
  error?: Error | string | null;
  onRetry?: () => void;
  hint?: ReactNode;
}) {
  const message = typeof error === "string" ? error : (error?.message ?? "No further detail.");
  return (
    /* role="alert": an error that replaces the content must be announced. */
    <div role="alert" className="border-l-2 border-[var(--color-danger)] px-5 py-6">
      <h3 className="text-sm font-semibold text-[var(--color-danger)]">{title}</h3>
      {hint ? (
        <p className="mt-1.5 max-w-prose text-[0.8125rem] leading-relaxed text-[var(--color-ink-2)]">
          {hint}
        </p>
      ) : null}
      <details className="mt-3">
        <summary className="tap cursor-pointer text-[0.75rem] text-[var(--color-ink-3)]">
          Technical detail
        </summary>
        <pre className="mt-2 max-w-full overflow-x-auto rounded-[2px] border border-[var(--color-line)] bg-[var(--color-ground)] p-3 text-[0.6875rem] leading-relaxed whitespace-pre-wrap text-[var(--color-ink-3)]">
          {message}
        </pre>
      </details>
      {onRetry ? (
        <div className="mt-4">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

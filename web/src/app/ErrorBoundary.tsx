import { Component, type ErrorInfo, type ReactNode } from "react";
import { useRouteError, isRouteErrorResponse, Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";

/**
 * Two boundaries, because they catch different things.
 *
 *   AppErrorBoundary   — a render crash anywhere in the tree. Class component,
 *                        because that is still the only way to catch one.
 *   RouteErrorBoundary — a router-level error (a bad param, a lazy chunk that
 *                        failed to load, a 404).
 *
 * Both render a focusable <h1> inside <main>, so a keyboard user who hits an
 * error is not left with focus on a page that no longer exists.
 */

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[AuctionHouse] render crash", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <Fallback
        title="The interface crashed"
        detail={this.state.error.message}
        onReset={() => this.setState({ error: null })}
      />
    );
  }
}

export function RouteErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <Fallback
        title={error.status === 404 ? "No such page" : `Error ${error.status}`}
        detail={error.statusText || "That URL does not match any route in this app."}
      />
    );
  }

  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  return <Fallback title="This page failed to load" detail={message} />;
}

function Fallback({
  title,
  detail,
  onReset,
}: {
  title: string;
  detail: string;
  onReset?: () => void;
}) {
  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-5 py-16">
      {/* tabIndex -1 so the router / reset can move focus here. */}
      <h1 tabIndex={-1} className="text-xl font-semibold text-[var(--color-ink)]">
        {title}
      </h1>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-[var(--color-ink-2)]">
        The auction data itself is on-chain and unaffected. Reloading is safe: nothing in this app
        holds state that a refresh would lose.
      </p>

      <details className="mt-5">
        <summary className="tap cursor-pointer text-[0.8125rem] text-[var(--color-ink-3)]">
          Technical detail
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-[2px] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-[0.6875rem] leading-relaxed whitespace-pre-wrap text-[var(--color-ink-3)]">
          {detail}
        </pre>
      </details>

      <div className="mt-6 flex flex-wrap gap-2">
        {onReset ? (
          <Button variant="primary" onClick={onReset}>
            Try rendering again
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
        <Link
          to="/"
          className="inline-flex h-11 items-center rounded-[3px] border border-[var(--color-line-strong)] px-4 text-sm text-[var(--color-action)] no-underline hover:bg-[var(--color-raised)]"
        >
          Back to auctions
        </Link>
      </div>
    </main>
  );
}

/** The `*` route. A wrong URL is not an error in the app, so it must not be labelled as one. */
export function NotFoundPage() {
  return <Fallback title="No such page" detail="That URL does not match any route in this app." />;
}

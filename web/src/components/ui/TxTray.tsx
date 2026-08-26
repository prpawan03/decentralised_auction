import { useTxTracker, type TrackedTx } from "@/hooks/useTxTracker";
import { Pill, type Tone } from "@/components/ui/Pill";
import { Button } from "@/components/ui/Button";
import { truncateAddress } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * The transaction tray.
 *
 * Persistent, bottom-right, and it survives navigation because the tracker
 * lives above the router. It exists so a pending transaction is never
 * invisible: the old app showed a toast, the toast expired, and the user was
 * left with no way to tell whether their bid had landed.
 *
 * NOTE THE VOCABULARY. "Submitted" is not "confirmed". A row only reads
 * "confirmed" after `useWaitForTransactionReceipt` returns a receipt whose
 * status is "success". A receipt with status "reverted" reads "reverted", in
 * red, with a word — never a green tick.
 */

const STATUS: Record<TrackedTx["status"], { tone: Tone; label: string; detail: string }> = {
  signing: { tone: "neutral", label: "signing", detail: "Waiting for you to confirm in your wallet" },
  pending: { tone: "action", label: "submitted", detail: "In the mempool, waiting for a block" },
  success: { tone: "live", label: "confirmed", detail: "Included in a block and succeeded" },
  reverted: { tone: "danger", label: "reverted", detail: "Included in a block, but the contract rejected it" },
  error: { tone: "danger", label: "failed", detail: "Never reached the chain" },
};

export function TxTray() {
  const { transactions, dismiss, clearFinished, pendingCount } = useTxTracker();

  if (transactions.length === 0) return null;

  return (
    <aside
      aria-labelledby="tx-tray-heading"
      className={cn(
        "fixed right-4 bottom-4 z-40 w-[min(24rem,calc(100vw-2rem))]",
        "rounded-[4px] border border-[var(--color-line-strong)] bg-[var(--color-surface)]",
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-3 py-2">
        <h2 id="tx-tray-heading" className="text-[0.75rem] font-semibold tracking-[0.06em] text-[var(--color-ink-2)] uppercase">
          Transactions
          {pendingCount > 0 ? (
            <span className="tnum ml-2 font-normal text-[var(--color-ink-3)]">
              {pendingCount} pending
            </span>
          ) : null}
        </h2>
        <Button variant="ghost" size="sm" onClick={clearFinished} className="h-6 px-2 text-[0.6875rem]">
          Clear finished
        </Button>
      </header>

      {/* Polite: a confirmation is worth hearing, but it must not interrupt. */}
      <ul className="max-h-64 divide-y divide-[var(--color-line)] overflow-y-auto" aria-live="polite">
        {transactions.map((tx) => {
          const meta = STATUS[tx.status];
          return (
            <li key={tx.id} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={meta.tone}>{meta.label}</Pill>
                  <span className="truncate text-[0.8125rem] text-[var(--color-ink)]">{tx.label}</span>
                </div>
                <p className="mt-1 text-[0.6875rem] leading-relaxed text-[var(--color-ink-3)]">
                  {tx.message ?? meta.detail}
                </p>
                {tx.hash ? (
                  <p className="tnum mt-0.5 text-[0.6875rem] text-[var(--color-ink-3)]">
                    <span aria-hidden="true">{truncateAddress(tx.hash, 10, 8)}</span>
                    <span className="sr-only">Transaction hash {tx.hash.split("").join(" ")}</span>
                  </p>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => dismiss(tx.id)}
                className="tap flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] border border-transparent text-[var(--color-ink-3)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]"
              >
                <span aria-hidden="true">×</span>
                <span className="sr-only">Dismiss {tx.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

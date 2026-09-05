import { useAccount, useSimulateContract, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Money } from "@/components/ui/Money";
import { Pill } from "@/components/ui/Pill";
import { auctionHouse } from "@/config/contracts";
import { usePendingReturns } from "@/hooks/useAuctions";
import { useTxTracker } from "@/hooks/useTxTracker";
import { decodeContractError } from "@/lib/errors";
import { formatEth } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * The withdrawable balance.
 *
 * This is the pull-payment vault, and it is the single most important number
 * in the app for a user who has been outbid. In the OLD contract a refund was
 * PUSHED with a raw `.send()`; if the recipient was a contract, or the gas
 * stipend was short, the send failed silently and the money was simply gone.
 *
 * Here every refund is credited and waits until you pull it. That is safe, but
 * it is only safe if people know the money is there — so this panel is loud
 * when there is a balance, present-but-quiet when there is not, and never
 * hidden behind a menu.
 *
 * `variant="banner"` is the site-wide version pinned under the header.
 */
export function WithdrawPanel({ variant = "panel" }: { variant?: "panel" | "banner" }) {
  const { address, isConnected } = useAccount();
  const tracker = useTxTracker();
  const { amount, hasBalance, isLoading } = usePendingReturns(address);

  const simulation = useSimulateContract({
    ...auctionHouse,
    functionName: "withdraw",
    ...(address ? { account: address } : {}),
    query: { enabled: isConnected && hasBalance, retry: false },
  });

  const { writeContractAsync, isPending } = useWriteContract();
  const error = simulation.error ? decodeContractError(simulation.error) : null;

  const run = async () => {
    if (!simulation.data) return;
    const id = tracker.begin({
      kind: "withdraw",
      label: `Withdraw ${formatEth(amount)} ETH`,
      invalidate: [["readContract"], ["readContracts"]],
    });
    try {
      const hash = await writeContractAsync(simulation.data.request);
      tracker.submitted(id, hash);
    } catch (e: unknown) {
      tracker.failed(id, e);
    }
  };

  /* Read-only visitor: explain the mechanism rather than showing an empty box. */
  if (!isConnected) {
    if (variant === "banner") return null;
    return (
      <section aria-labelledby="withdraw-heading" className="panel">
        <header className="border-b border-[var(--color-line)] px-4 py-3">
          <h2 id="withdraw-heading" className="text-sm font-semibold text-[var(--color-ink)]">
            Withdrawable balance
          </h2>
        </header>
        <p className="max-w-prose px-4 py-4 text-[0.8125rem] leading-relaxed text-[var(--color-ink-3)]">
          When you are outbid, your ETH is credited to a balance here rather than sent back to you
          automatically. Nothing can fail on the way, and nothing is lost. Connect a wallet to see
          yours.
        </p>
      </section>
    );
  }

  /* The banner only appears when there is money to collect. */
  if (variant === "banner") {
    if (!hasBalance) return null;
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-2 border-b-2 border-[var(--color-live)]",
          "bg-[var(--color-surface)] px-4 py-2.5",
        )}
      >
        <Pill tone="live" solid>
          to collect
        </Pill>
        <p className="min-w-0 flex-1 text-[0.8125rem] text-[var(--color-ink-2)]">
          You have <Money wei={amount} size="sm" tone="live" className="align-baseline" /> waiting
          in the withdrawal vault. It stays there safely until you pull it.
        </p>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void run()}
          disabled={!simulation.isSuccess}
          loading={isPending}
          loadingLabel="Waiting for your wallet"
        >
          Withdraw
        </Button>
      </div>
    );
  }

  return (
    <section aria-labelledby="withdraw-heading" className="panel">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
        <h2 id="withdraw-heading" className="text-sm font-semibold text-[var(--color-ink)]">
          Withdrawable balance
        </h2>
        {hasBalance ? <Pill tone="live">funds waiting</Pill> : <Pill tone="neutral">empty</Pill>}
      </header>

      <div className="flex flex-wrap items-end justify-between gap-4 px-4 py-5">
        <div>
          <p className="col-head">Credited to you</p>
          <p className="mt-1.5">
            {isLoading ? (
              <span className="tnum text-2xl text-[var(--color-ink-3)]">…</span>
            ) : (
              <Money wei={amount} size="lg" tone={hasBalance ? "live" : "muted"} decimals={6} />
            )}
          </p>
        </div>

        <Button
          variant="primary"
          onClick={() => void run()}
          disabled={!hasBalance || !simulation.isSuccess}
          loading={isPending}
          loadingLabel="Waiting for your wallet"
        >
          Withdraw everything
        </Button>
      </div>

      <p className="max-w-prose border-t border-[var(--color-line)] px-4 py-3 text-[0.75rem] leading-relaxed text-[var(--color-ink-3)]">
        Refunds from being outbid, proceeds from a sale, and returns from an auction that closed
        below its reserve all accumulate here. <code>withdraw()</code> is the only way ETH leaves
        this contract, and it keeps working even while the contract is paused.
      </p>

      {error && !error.rejected && hasBalance ? (
        <p
          role="alert"
          className="border-t border-[var(--color-line)] px-4 py-3 text-[0.8125rem] text-[var(--color-danger)]"
        >
          {error.message}
        </p>
      ) : null}
    </section>
  );
}

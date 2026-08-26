import { useAccount, useBlockNumber } from "wagmi";
import { config } from "@/config/runtime";
import { localChain } from "@/config/chain";
import { Pill } from "@/components/ui/Pill";
import { cn } from "@/lib/cn";

/**
 * The node/wallet status strip.
 *
 * This exists to make READ-ONLY MODE legible rather than mysterious. With no
 * wallet installed the app is fully browsable, and this strip says so in
 * words: "Read-only — browsing without a wallet." It is a statement of fact,
 * not a nag, and it never blocks anything.
 *
 * It also reports node health from `useBlockNumber`, which is the fastest way
 * to distinguish "no auctions yet" from "the node is not running" — the
 * ambiguity that made the old demo impossible to debug on stage.
 */
export function ConnectionStrip({ className }: { className?: string }) {
  const { isConnected, chainId } = useAccount();
  const block = useBlockNumber({
    chainId: localChain.id,
    watch: { enabled: true, poll: true, pollingInterval: 6_000 },
    query: { retry: 1 },
  });

  const nodeReachable = block.isSuccess;
  const nodeDown = block.isError;
  const wrongChain = isConnected && chainId !== undefined && chainId !== localChain.id;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-[var(--color-line)]",
        "bg-[var(--color-surface)] px-4 py-1.5 text-[0.6875rem] text-[var(--color-ink-3)]",
        className,
      )}
    >
      {/* Node */}
      <span className="inline-flex items-center gap-1.5">
        {nodeDown ? (
          <Pill tone="danger">node unreachable</Pill>
        ) : nodeReachable ? (
          <Pill tone="live">node up</Pill>
        ) : (
          <Pill tone="neutral">connecting</Pill>
        )}
        <span className="tnum">{config.rpcUrl}</span>
      </span>

      {/* Head */}
      {nodeReachable && block.data !== undefined ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="col-head">block</span>
          <span className="tnum text-[var(--color-ink-2)]">#{block.data.toString()}</span>
        </span>
      ) : null}

      {/* Chain */}
      <span className="inline-flex items-center gap-1.5">
        <span className="col-head">chain</span>
        <span className="tnum text-[var(--color-ink-2)]">
          {localChain.name} · {localChain.id}
        </span>
      </span>

      {/* Contract */}
      <span className="inline-flex items-center gap-1.5">
        <span className="col-head">contract</span>
        <span className="tnum text-[var(--color-ink-2)]">{config.auctionHouseAddress}</span>
      </span>

      {/* Mode. THE line that tells a visitor with no wallet that this is fine. */}
      <span className="ml-auto inline-flex items-center gap-1.5">
        {wrongChain ? (
          <Pill tone="warn">wrong chain in wallet</Pill>
        ) : isConnected ? (
          <Pill tone="action">wallet connected</Pill>
        ) : (
          <Pill tone="neutral">read-only</Pill>
        )}
        <span>
          {wrongChain
            ? "Reads still work; switch chains to transact."
            : isConnected
              ? "You can bid, list and withdraw."
              : "Browsing without a wallet. Everything here is readable."}
        </span>
      </span>

      {/* Where the config came from, for anyone debugging a demo. */}
      <span className="sr-only">Configuration source: {config.source}.</span>
    </div>
  );
}

/**
 * The blocking banner, shown only when the node itself is unreachable. This is
 * the one condition under which the app genuinely cannot show anything, and it
 * must not be confused with "no wallet".
 */
export function NodeDownBanner() {
  const block = useBlockNumber({ chainId: localChain.id, query: { retry: 1 } });
  if (!block.isError) return null;

  return (
    <div
      role="alert"
      className="border-b border-[var(--color-danger)] bg-[var(--color-surface)] px-4 py-3"
    >
      <p className="text-sm font-semibold text-[var(--color-danger)]">
        Cannot reach the chain node at {config.rpcUrl}
      </p>
      <p className="mt-1 max-w-prose text-[0.8125rem] leading-relaxed text-[var(--color-ink-2)]">
        This is a node problem, not a wallet problem. Start the local chain, then reload. Nothing on
        this page is stale data — there is simply nothing to read yet.
      </p>
    </div>
  );
}

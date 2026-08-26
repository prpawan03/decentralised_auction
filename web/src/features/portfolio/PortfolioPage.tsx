import { useMemo } from "react";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import { useParams } from "react-router-dom";
import { AuctionTable } from "@/features/auctions/AuctionTable";
import { SettleButton, CancelButton } from "@/features/bidding/AuctionActions";
import { WithdrawPanel } from "./WithdrawPanel";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { AddressChip } from "@/components/ui/AddressChip";
import { ButtonLink } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { useAuctions } from "@/hooks/useAuctions";
import { useNow } from "@/hooks/useTicker";
import { phaseOf, sameAddress, type Auction } from "@/lib/auction";
import { isAddressLike } from "@/lib/format";

/**
 * Portfolio.
 *
 * Both `/portfolio` (the connected account) and `/u/:address` (anyone's, with
 * no wallet at all) render through this component. That symmetry is the point:
 * a public address's activity is public data, and the app can show it over
 * plain HTTP with nothing installed.
 *
 * Everything below is DERIVED from the one multicall the board already made.
 * There is no second fetch, no local copy of the list, and no useState holding
 * a filtered array that can drift out of date.
 */

interface Buckets {
  listings: Auction[];
  winning: Auction[];
  lost: Auction[];
  won: Auction[];
}

function bucket(auctions: Auction[], subject: Address | undefined, now: number): Buckets {
  const out: Buckets = { listings: [], winning: [], lost: [], won: [] };
  if (!subject) return out;

  for (const a of auctions) {
    if (sameAddress(a.seller, subject)) {
      out.listings.push(a);
      continue;
    }
    const isHigh = sameAddress(a.highestBidder, subject);
    const phase = phaseOf(a, now);
    const closed = phase === "settled" || phase === "cancelled" || phase === "reserve-not-met";

    if (isHigh && !closed) out.winning.push(a);
    else if (isHigh && phase === "settled") out.won.push(a);
    /* "Lost" is only knowable for auctions where this account was once the top
       bidder and is not any more. The struct keeps only the CURRENT highest
       bidder, so a losing bid is not recoverable from storage alone — it lives
       in the BidPlaced logs and in pendingReturns. The withdrawable balance
       below is the honest, complete answer, so this section says so rather
       than showing a list that would silently be incomplete. */
  }
  return out;
}

export default function PortfolioPage() {
  const now = useNow();
  const { address: connected } = useAccount();
  const params = useParams<{ address?: string }>();

  /* `/u/:address` names its subject; `/portfolio` uses the connected account.
     One source of truth either way — derived, never copied into state. */
  const routeAddress = params.address && isAddressLike(params.address) ? params.address : undefined;
  const subject = routeAddress ?? connected;
  const isSelf = routeAddress === undefined || sameAddress(routeAddress, connected);

  const { auctions, isInitialLoading, isError, error, refetch } = useAuctions();
  const buckets = useMemo(() => bucket(auctions, subject, now), [auctions, subject, now]);

  if (params.address && !routeAddress) {
    return (
      <main id="main" className="mx-auto w-full max-w-3xl px-4 py-12">
        <h1 className="text-lg font-semibold text-[var(--color-ink)]">Not a valid address</h1>
        <p className="mt-2 max-w-prose text-sm text-[var(--color-ink-2)]">
          <span className="tnum">{params.address}</span> is not an Ethereum address. It should be 0x
          followed by 40 hexadecimal characters.
        </p>
        <div className="mt-5">
          <ButtonLink to="/" variant="secondary">
            Back to the board
          </ButtonLink>
        </div>
      </main>
    );
  }

  if (!subject) {
    return (
      <main id="main" className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-lg font-semibold text-[var(--color-ink)]">Portfolio</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-[var(--color-ink-2)]">
          Connect a wallet to see your own listings, bids and withdrawable balance. You do not need
          one to browse: any address's activity is public, and{" "}
          <span className="tnum">/u/0x…</span> shows it without a wallet.
        </p>
        <div className="mt-6">
          <WithdrawPanel />
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="mx-auto w-full max-w-[90rem] px-4 py-6 lg:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-ink)]">
            {isSelf ? "Your portfolio" : "Portfolio"}
          </h1>
          <div className="mt-1.5 flex items-center gap-2">
            <AddressChip address={subject} you={isSelf} linked={false} />
            {!isSelf ? <Pill tone="neutral">read-only view</Pill> : null}
          </div>
        </div>
        <ButtonLink to="/create" variant="primary" size="sm">
          List an item
        </ButtonLink>
      </header>

      {/* The vault, first and unmissable. */}
      {isSelf ? (
        <div className="mt-5">
          <WithdrawPanel />
        </div>
      ) : null}

      {isInitialLoading ? (
        <div className="panel mt-5">
          <TableSkeleton rows={5} label="Loading portfolio" />
        </div>
      ) : isError ? (
        <div className="panel mt-5">
          <ErrorState error={error} onRetry={refetch} />
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-5">
          <Section
            id="winning"
            title={isSelf ? "Bids you are winning" : "Bids leading"}
            count={buckets.winning.length}
            empty={
              isSelf
                ? "You are not the top bidder on any live auction right now."
                : "This account is not leading any live auction."
            }
          >
            <AuctionTable
              auctions={buckets.winning}
              now={now}
              account={connected}
              caption="Auctions where this account holds the highest bid"
              renderAction={(a) => <SettleButton auction={a} />}
            />
          </Section>

          <Section
            id="won"
            title="Won"
            count={buckets.won.length}
            empty="No settled auctions won yet."
          >
            <AuctionTable
              auctions={buckets.won}
              now={now}
              account={connected}
              caption="Settled auctions this account won"
            />
          </Section>

          <Section
            id="listings"
            title={isSelf ? "Your listings" : "Listings"}
            count={buckets.listings.length}
            empty={
              isSelf ? (
                <>
                  You have not listed anything.{" "}
                  <ButtonLink to="/create" variant="ghost" size="sm">
                    List an item
                  </ButtonLink>
                </>
              ) : (
                "This account has not listed anything."
              )
            }
          >
            <AuctionTable
              auctions={buckets.listings}
              now={now}
              account={connected}
              caption="Auctions listed by this account"
              renderAction={(a) => (
                <div className="flex justify-end gap-1.5">
                  <SettleButton auction={a} />
                  <CancelButton auction={a} />
                </div>
              )}
            />
          </Section>

          {/* Honest about what contract storage cannot answer. */}
          <section aria-labelledby="lost-heading" className="panel">
            <header className="border-b border-[var(--color-line)] px-4 py-3">
              <h2 id="lost-heading" className="text-sm font-semibold text-[var(--color-ink)]">
                Bids you have lost
              </h2>
            </header>
            <p className="max-w-prose px-4 py-4 text-[0.8125rem] leading-relaxed text-[var(--color-ink-3)]">
              The contract stores only the <em>current</em> highest bidder per auction, so a
              superseded bid leaves no trace in storage. What it does leave is money: every outbid
              amount is credited to your withdrawable balance above, in full. That balance is the
              complete and authoritative record of what you are owed — this app will not invent a
              list from partial logs and let you mistake it for the whole picture.
            </p>
          </section>

          {buckets.winning.length + buckets.listings.length + buckets.won.length === 0 ? (
            <div className="panel">
              <EmptyState
                title="Nothing to show for this account yet"
                body={
                  <>
                    The chain read succeeded; this address simply has no listings or leading bids
                    among the {auctions.length} auctions on the board.
                  </>
                }
                action={
                  <ButtonLink to="/" variant="secondary" size="sm">
                    Browse the auction board
                  </ButtonLink>
                }
              />
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
}

function Section({
  id,
  title,
  count,
  empty,
  children,
}: {
  id: string;
  title: string;
  count: number;
  empty: React.ReactNode;
  children: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="panel" id={id}>
      <header className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
        <h2 id={headingId} className="text-sm font-semibold text-[var(--color-ink)]">
          {title}
        </h2>
        <span className="tnum text-[0.75rem] text-[var(--color-ink-3)]">{count}</span>
      </header>
      {count === 0 ? (
        <p className="max-w-prose px-4 py-4 text-[0.8125rem] leading-relaxed text-[var(--color-ink-3)]">
          {empty}
        </p>
      ) : (
        children
      )}
    </section>
  );
}

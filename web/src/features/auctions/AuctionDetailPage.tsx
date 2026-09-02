import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { zeroAddress } from "viem";
import { useAuctionDetail } from "@/hooks/useAuctions";
import { useNow } from "@/hooks/useTicker";
import { useAuctionActivity } from "@/hooks/useAuctionEvents";
import { Countdown } from "@/components/ui/Countdown";
import { Money, Stat } from "@/components/ui/Money";
import { AddressChip } from "@/components/ui/AddressChip";
import { Pill } from "@/components/ui/Pill";
import { ErrorState, TableSkeleton } from "@/components/ui/States";
import { ButtonLink } from "@/components/ui/Button";
import { StatusPill, StandingPill } from "./StatusPill";
import { AntiSnipeExplainer, AntiSnipeBadge } from "./AntiSnipeBadge";
import { WatchButton } from "./WatchButton";
import { DutchPrice, FormatPill } from "./DutchPrice";
import { TokenPanel } from "./TokenPanel";
import { useNftMetadata } from "@/hooks/useNftMetadata";
import { fallbackName } from "@/lib/nftMetadata";
import { BidButton } from "@/features/bidding/BidDialog";
import { BuyNowButton, SettleButton, CancelButton } from "@/features/bidding/AuctionActions";
import { BuyDutchButton } from "@/features/bidding/BuyDutchButton";
import { ConnectPrompt } from "@/features/wallet/WalletButton";
import { formatAbsolute, formatRelativePast, toIso } from "@/lib/format";
import {
  buyNowEnabled,
  dutchFloorPrice,
  dutchStartPrice,
  hasBid,
  isDutch,
  phaseOf,
  reserveMet,
  sameAddress,
} from "@/lib/auction";

/**
 * One auction, in full.
 *
 * The id comes from the URL (`/auctions/:id`), so this page is linkable,
 * bookmarkable and refresh-safe — none of which was true of the old app, where
 * every auction lived inside a modal with no address of its own.
 */
export default function AuctionDetailPage() {
  const params = useParams<{ id: string }>();
  const now = useNow();
  const { address } = useAccount();

  /* Parse the URL param defensively: /auctions/banana must 404, not crash. */
  const auctionId = useMemo<bigint | undefined>(() => {
    const raw = params.id;
    if (!raw || !/^\d+$/.test(raw)) return undefined;
    try {
      return BigInt(raw);
    } catch {
      return undefined;
    }
  }, [params.id]);

  const { auction, minimumBid, isLoading, isError, error, notFound, refetch } =
    useAuctionDetail(auctionId);

  const events = useAuctionActivity(auctionId);

  /* Called before the early returns so the hook order is identical on every
     render, including the not-found and error paths. */
  const art = useNftMetadata(auction?.nft, auction?.tokenId);

  if (auctionId === undefined) {
    return (
      <main id="main" className="mx-auto w-full max-w-3xl px-4 py-12">
        <h1 className="text-lg font-semibold text-[var(--color-ink)]">Not a valid auction id</h1>
        <p className="mt-2 max-w-prose text-sm text-[var(--color-ink-2)]">
          Auction ids are whole numbers, like <span className="tnum">/auctions/3</span>. The URL you
          followed has <span className="tnum">{params.id}</span> instead.
        </p>
        <div className="mt-5">
          <ButtonLink to="/" variant="secondary">
            Back to the board
          </ButtonLink>
        </div>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main id="main" className="mx-auto w-full max-w-[80rem] px-4 py-6">
        <div className="panel">
          <TableSkeleton rows={5} label={`Loading auction ${auctionId.toString()}`} />
        </div>
      </main>
    );
  }

  if (notFound || (!auction && !isError)) {
    return (
      <main id="main" className="mx-auto w-full max-w-3xl px-4 py-12">
        <h1 className="text-lg font-semibold text-[var(--color-ink)]">
          Auction #{auctionId.toString()} does not exist
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-[var(--color-ink-2)]">
          The contract has no auction with that id on this chain. If you are following a link from
          another deployment, the ids will not line up.
        </p>
        <div className="mt-5">
          <ButtonLink to="/" variant="secondary">
            Back to the board
          </ButtonLink>
        </div>
      </main>
    );
  }

  if (isError || !auction) {
    return (
      <main id="main" className="mx-auto w-full max-w-3xl px-4 py-8">
        <ErrorState error={error} onRetry={refetch} />
      </main>
    );
  }

  const phase = phaseOf(auction, now);
  const closed = phase === "settled" || phase === "cancelled" || phase === "reserve-not-met" || phase === "delivery-failed";
  const met = reserveMet(auction);
  const isSeller = sameAddress(auction.seller, address);
  const dutch = isDutch(auction);

  return (
    <main id="main" className="mx-auto w-full max-w-[80rem] px-4 py-6 lg:px-6">
      <nav aria-label="Breadcrumb" className="text-[0.75rem]">
        <ol className="flex items-center gap-2 text-[var(--color-ink-3)]">
          <li>
            <Link to="/" className="text-[var(--color-action)] no-underline hover:underline">
              Auction board
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="tnum">
            #{auction.id.toString()}
          </li>
        </ol>
      </nav>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">
            <span className="tnum">#{auction.id.toString()}</span>
            <span className="mx-2 text-[var(--color-ink-3)]">·</span>
            {/* The metadata name when the token has one. It is off-chain and
                seller-controlled, so the auction number stays in front of it:
                the id is what identifies the sale. */}
            {art.name ?? fallbackName(auction.tokenId)}
          </h1>
          <p className="mt-1 truncate text-[0.75rem] text-[var(--color-ink-3)]">
            {art.collection !== undefined ? `${art.collection} · ` : "Collection "}
            <span className="tnum">{auction.nft}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WatchButton auctionId={auction.id} />
          <StatusPill auction={auction} now={now} />
          <FormatPill auction={auction} />
          <StandingPill auction={auction} account={address} now={now} />
          <AntiSnipeBadge auction={auction} />
        </div>
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {/* The headline numbers. */}
          <section aria-labelledby="price-heading" className="panel">
            <h2 id="price-heading" className="sr-only">
              Price and time
            </h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 py-5 sm:grid-cols-4">
              {dutch ? (
                <>
                  <Stat
                    label={closed ? "Sold at" : "Price now"}
                    hint={closed ? undefined : "falls every second"}
                  >
                    {closed ? (
                      hasBid(auction) ? (
                        <Money wei={auction.highestBid} size="lg" tone="live" />
                      ) : (
                        <span className="text-2xl text-[var(--color-ink-3)]">unsold</span>
                      )
                    ) : (
                      <DutchPrice auction={auction} size="lg" />
                    )}
                  </Stat>

                  <Stat label="Opening price" hint="where the decay started">
                    <Money wei={dutchStartPrice(auction)} size="lg" tone="muted" />
                  </Stat>

                  <Stat label="Floor" hint="the lowest it will reach">
                    <Money wei={dutchFloorPrice(auction)} size="lg" tone="muted" />
                  </Stat>
                </>
              ) : (
                <>
                  <Stat
                    label="Top bid"
                    hint={hasBid(auction) ? (met ? "meets the reserve" : "below the reserve") : "no bids yet"}
                  >
                    {hasBid(auction) ? (
                      <Money wei={auction.highestBid} size="lg" tone={met ? "live" : "default"} />
                    ) : (
                      <span className="text-2xl text-[var(--color-ink-3)]">—</span>
                    )}
                  </Stat>

                  {/* Not shown for Dutch: `minimumBid()` carries no format
                      guard, so it happily returns the English increment
                      formula applied to a Dutch sale price. The number is
                      meaningless there, and showing it would invite someone
                      to act on it. */}
                  <Stat label="Minimum next bid" hint="from the contract">
                    <Money wei={minimumBid ?? 0n} size="lg" />
                  </Stat>

                  <Stat
                    label="Reserve"
                    hint={auction.reservePrice === 0n ? "no reserve set" : met ? "met" : "not met"}
                  >
                    {auction.reservePrice > 0n ? (
                      <Money wei={auction.reservePrice} size="lg" tone="muted" />
                    ) : (
                      <span className="text-2xl text-[var(--color-ink-3)]">none</span>
                    )}
                  </Stat>
                </>
              )}

              <Stat
                label={closed ? "Closed" : "Ends in"}
                hint={closed ? undefined : formatAbsolute(auction.endTime)}
              >
                {closed ? (
                  <time dateTime={toIso(auction.endTime)} className="tnum text-sm text-[var(--color-ink-2)]">
                    {formatAbsolute(auction.endTime)}
                  </time>
                ) : (
                  <Countdown
                    endTime={auction.endTime}
                    size="lg"
                    label={`Auction ${auction.id.toString()}`}
                  />
                )}
              </Stat>
            </dl>

            {/* Actions. Absent when they cannot apply; never present-and-broken. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] bg-[var(--color-raised)] px-5 py-3">
              <BidButton auction={auction} minimumBid={minimumBid} size="md" />
              <BuyDutchButton auction={auction} />
              <BuyNowButton auction={auction} />
              <SettleButton auction={auction} />
              <CancelButton auction={auction} />
              {closed ? (
                <p className="text-[0.8125rem] text-[var(--color-ink-3)]">
                  This auction is closed. Any ETH owed to you is in your withdrawable balance.
                </p>
              ) : null}
              {dutch ? (
                <p className="ml-auto text-[0.75rem] text-[var(--color-ink-3)]">
                  Descending price · no bidding
                </p>
              ) : buyNowEnabled(auction) ? (
                <p className="ml-auto text-[0.75rem] text-[var(--color-ink-3)]">
                  Buy-now price{" "}
                  <Money wei={auction.buyNowPrice} size="sm" className="align-baseline" />
                </p>
              ) : (
                <p className="ml-auto text-[0.75rem] text-[var(--color-ink-3)]">Buy-now disabled</p>
              )}
            </div>

            {!isSeller ? <ConnectPrompt action="Bidding" /> : null}
          </section>

          {/* Parties. */}
          <section aria-labelledby="parties-heading" className="panel">
            <header className="border-b border-[var(--color-line)] px-5 py-3">
              <h2 id="parties-heading" className="text-sm font-semibold text-[var(--color-ink)]">
                Parties
              </h2>
            </header>
            <dl className="grid gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2">
              <div>
                <dt className="col-head">Seller</dt>
                <dd className="mt-1.5">
                  <AddressChip
                    address={auction.seller}
                    you={sameAddress(auction.seller, address)}
                    label="seller"
                  />
                </dd>
              </div>
              <div>
                <dt className="col-head">Highest bidder</dt>
                <dd className="mt-1.5">
                  {auction.highestBidder === zeroAddress ? (
                    <span className="text-[0.8125rem] text-[var(--color-ink-3)]">
                      Nobody has bid yet
                    </span>
                  ) : (
                    <AddressChip
                      address={auction.highestBidder}
                      you={sameAddress(auction.highestBidder, address)}
                      label="highest bidder"
                    />
                  )}
                </dd>
              </div>
              <div>
                <dt className="col-head">Started</dt>
                <dd className="tnum mt-1.5 text-[0.8125rem] text-[var(--color-ink-2)]">
                  <time dateTime={toIso(auction.startTime)}>{formatAbsolute(auction.startTime)}</time>
                </dd>
              </div>
              <div>
                <dt className="col-head">Minimum increment</dt>
                <dd className="tnum mt-1.5 text-[0.8125rem] text-[var(--color-ink-2)]">
                  {(auction.minIncrementBps / 100).toFixed(2)}%
                </dd>
              </div>
            </dl>
          </section>

          {dutch ? null : (
            <div className="panel">
              <AntiSnipeExplainer auction={auction} />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5 self-start">
        <TokenPanel nft={auction.nft} tokenId={auction.tokenId} />

        {/* This auction's own event stream. */}
        <aside aria-labelledby="auction-activity-heading" className="panel min-w-0">
          <header className="border-b border-[var(--color-line)] px-4 py-3">
            <h2 id="auction-activity-heading" className="text-sm font-semibold text-[var(--color-ink)]">
              This auction
            </h2>
          </header>
          {events.length === 0 ? (
            <p className="max-w-prose px-4 py-4 text-[0.8125rem] leading-relaxed text-[var(--color-ink-3)]">
              No events for this auction since you opened the page. Historic logs are not backfilled;
              the numbers above are read straight from contract storage and are always current.
            </p>
          ) : (
            <ol className="divide-y divide-[var(--color-line)]">
              {events.map((e) => (
                <li key={e.id} className="flex items-baseline gap-2 px-4 py-2.5">
                  <Pill
                    tone={
                      e.kind === "bid"
                        ? "live"
                        : e.kind === "extended"
                          ? "warn"
                          : e.kind === "cancelled"
                            ? "danger"
                            : "neutral"
                    }
                  >
                    {e.kind}
                  </Pill>
                  {e.amount !== undefined && e.kind !== "extended" ? (
                    <Money wei={e.amount} size="sm" bare />
                  ) : null}
                  {e.kind === "extended" ? (
                    <span className="text-[0.8125rem] text-[var(--color-warn)]">
                      +5:00 · ×{e.extensionCount ?? auction.extensionCount}
                    </span>
                  ) : null}
                  {e.actor ? <AddressChip address={e.actor} className="text-[0.75rem]" /> : null}
                  <time className="tnum ml-auto text-[0.6875rem] text-[var(--color-ink-3)]">
                    {formatRelativePast(e.at, now)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </aside>
        </div>
      </div>
    </main>
  );
}

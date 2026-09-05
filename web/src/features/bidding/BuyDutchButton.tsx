import { useState } from "react";
import { useAccount, useSimulateContract, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Money } from "@/components/ui/Money";
import { auctionHouse } from "@/config/contracts";
import { decodeContractError } from "@/lib/errors";
import { formatEth } from "@/lib/format";
import { dutchPriceAt, isDutch, phaseOf, sameAddress, type Auction } from "@/lib/auction";
import { useNow } from "@/hooks/useTicker";
import { useTxTracker } from "@/hooks/useTxTracker";

const INVALIDATE = [["readContracts"], ["readContract"]] as const;

/**
 * Buying a Dutch listing at the current asking price.
 *
 * THE CLOCK PROBLEM, AND WHY THE VALUE SENT IS NOT THE QUOTE.
 *
 * The price the browser shows is computed from `Date.now()`. The price the
 * contract charges is computed from the timestamp of the block that mines the
 * transaction. Those two clocks are not the same clock.
 *
 * If the chain's clock is AHEAD of the browser's, the contract's price is lower
 * than the quote and the purchase succeeds with change. If the chain's clock is
 * BEHIND — which is routine on a local node that has been time-warped, as this
 * project's own seed script does — the contract's price is HIGHER than the
 * quote, and sending exactly the quote reverts with `BidTooLow`.
 *
 * So the value sent is the price as it stood {@link SKEW_ALLOWANCE} seconds
 * ago, which is strictly the larger number. Overpaying is safe; underpaying is
 * a failed transaction and a wasted fee.
 *
 * WHY THE ALLOWANCE IS SMALL. `DutchAuction.buy` does NOT hand the excess back
 * in the transaction — it credits it to `pendingReturns`, so recovering an
 * overpayment costs the buyer a second transaction. A generous buffer would
 * therefore leave dust behind on every purchase. Fifteen seconds is about one
 * block of tolerance, and the simulation below is the real gate: if the chain
 * disagrees by more than the allowance, the simulation fails and the button
 * stays disabled with the contract's own reason, rather than sending a
 * transaction that reverts.
 */

/** How far the chain's clock is assumed to possibly lag the browser's. */
const SKEW_ALLOWANCE = 15;

export function BuyDutchButton({ auction }: { auction: Auction }) {
  const now = useNow();
  const { address, isConnected } = useAccount();
  const tracker = useTxTracker();
  const [open, setOpen] = useState(false);

  const phase = phaseOf(auction, now);
  const live = phase === "live" || phase === "ending" || phase === "final";
  const isSeller = sameAddress(auction.seller, address);

  /* What the page is showing, and what we will actually send. */
  const quote = dutchPriceAt(auction, now);
  const sending = dutchPriceAt(auction, now - SKEW_ALLOWANCE);
  const buffer = sending - quote;

  const simulation = useSimulateContract({
    ...auctionHouse,
    functionName: "buy",
    args: [auction.id],
    value: sending,
    ...(address ? { account: address } : {}),
    query: { enabled: open && isConnected && isDutch(auction) && live, retry: false },
  });

  const { writeContractAsync, isPending } = useWriteContract();
  const error = simulation.error ? decodeContractError(simulation.error) : null;

  /* Same rule as every other action: absent when it cannot apply, never
     present-and-broken. The seller is excluded because the contract rejects
     a self-purchase with SellerCannotBid. */
  if (!isDutch(auction) || !live || isSeller) return null;

  const buy = async () => {
    if (!simulation.data) return;
    const id = tracker.begin({
      kind: "buy-now",
      label: `Buy #${auction.id.toString()} at ${formatEth(quote)} ETH`,
      invalidate: INVALIDATE,
    });
    try {
      const hash = await writeContractAsync(simulation.data.request);
      tracker.submitted(id, hash);
      setOpen(false);
    } catch (e: unknown) {
      tracker.failed(id, e);
    }
  };

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <span aria-hidden="true">Buy</span>
        <span className="sr-only">
          Buy auction {auction.id.toString()} at the current price of {formatEth(quote)} ETH
        </span>
      </Button>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        dismissable={!isPending}
        title={`Buy auction #${auction.id.toString()}`}
        description="A Dutch listing sells to the first buyer who accepts the falling price. This settles in the same transaction: the NFT transfers to you and the seller is paid immediately."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void buy()}
              disabled={isPending || !simulation.isSuccess}
              loading={isPending}
            >
              Buy at {formatEth(quote)} ETH
            </Button>
          </>
        }
      >
        <dl className="grid gap-3 text-[0.8125rem]">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[var(--color-ink-2)]">Price right now</dt>
            <dd>
              <Money wei={quote} size="sm" />
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[var(--color-ink-2)]">Your wallet will send</dt>
            <dd>
              <Money wei={sending} size="sm" />
            </dd>
          </div>
        </dl>

        {buffer > 0n ? (
          <p className="mt-3 max-w-prose text-[0.75rem] leading-relaxed text-[var(--color-ink-3)]">
            The extra <span className="tnum">{formatEth(buffer)}</span> ETH covers the price moving
            between now and the block that mines this. The contract charges only the price at that
            block. Anything above it is credited to your withdrawable balance — it is not lost, but
            claiming it takes a second transaction, which is why the margin is kept small.
          </p>
        ) : null}

        {error ? (
          /* The simulation is the gate. A chain clock further behind than the
             allowance shows up here as BidTooLow, before anything is signed. */
          <p role="alert" className="mt-3 text-[0.8125rem] text-[var(--color-danger)]">
            {decodeContractError(error).message}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}

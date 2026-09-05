import { useState } from "react";
import { useAccount, useSimulateContract, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Money } from "@/components/ui/Money";
import { auctionHouse } from "@/config/contracts";
import { decodeContractError } from "@/lib/errors";
import { formatEth } from "@/lib/format";
import {
  buyNowEnabled,
  hasBid,
  isSettleableNow,
  phaseOf,
  reserveMet,
  sameAddress,
  type Auction,
} from "@/lib/auction";
import { useNow } from "@/hooks/useTicker";
import { useTxTracker } from "@/hooks/useTxTracker";

const INVALIDATE = [["readContracts"], ["readContract"]] as const;

/**
 * Buy-now.
 *
 * `buyNowPrice == 0` means DISABLED. The button simply does not exist in that
 * case — it is never rendered as "Buy for 0 ETH", which is the bug that let
 * the old contract's items be taken for free.
 *
 * The value sent is the struct's exact `buyNowPrice`, because the contract
 * reverts with `IncorrectPayment` on anything else, including an overpayment.
 */
export function BuyNowButton({ auction }: { auction: Auction }) {
  const now = useNow();
  const { address, isConnected } = useAccount();
  const tracker = useTxTracker();
  const [open, setOpen] = useState(false);

  const phase = phaseOf(auction, now);
  const live = phase === "live" || phase === "ending" || phase === "final";
  const isSeller = sameAddress(auction.seller, address);

  const simulation = useSimulateContract({
    ...auctionHouse,
    functionName: "buyNow",
    args: [auction.id],
    value: auction.buyNowPrice,
    ...(address ? { account: address } : {}),
    query: { enabled: open && isConnected && buyNowEnabled(auction) && live, retry: false },
  });

  const { writeContractAsync, isPending } = useWriteContract();
  const error = simulation.error ? decodeContractError(simulation.error) : null;

  if (!buyNowEnabled(auction) || !live || isSeller) return null;

  const buy = async () => {
    if (!simulation.data) return;
    const id = tracker.begin({
      kind: "buy-now",
      label: `Buy #${auction.id.toString()} for ${formatEth(auction.buyNowPrice)} ETH`,
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
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <span aria-hidden="true">Buy now</span>
        <span className="sr-only">
          Buy auction {auction.id.toString()} immediately for {formatEth(auction.buyNowPrice)} ETH
        </span>
      </Button>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        dismissable={!isPending}
        title={`Buy auction #${auction.id.toString()} outright`}
        description="Buy-now settles in the same transaction: the NFT transfers to you and the seller is paid immediately."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void buy()}
              disabled={!simulation.isSuccess}
              loading={isPending || simulation.isLoading}
              loadingLabel={isPending ? "Waiting for your wallet" : "Checking against the contract"}
            >
              Pay {formatEth(auction.buyNowPrice)} ETH
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-[var(--color-ink-2)]">
          You will send exactly{" "}
          <Money wei={auction.buyNowPrice} size="sm" className="align-baseline" />, the price the
          seller set. The contract rejects any other amount, so there is nothing to get wrong.
        </p>
        {hasBid(auction) ? (
          <p className="mt-3 text-[0.8125rem] leading-relaxed text-[var(--color-ink-3)]">
            The current top bid of {formatEth(auction.highestBid)} ETH is credited back to that
            bidder's withdrawable balance.
          </p>
        ) : null}
        {error && !error.rejected ? (
          <p role="alert" className="mt-3 border-l-2 border-[var(--color-danger)] py-1 pl-3 text-[0.8125rem] text-[var(--color-danger)]">
            {decodeContractError(error).message}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}

/**
 * Settle.
 *
 * Deliberately available to EVERYONE, not just the seller, and labelled as
 * such — that permissionlessness is the design rule that stops a seller from
 * freezing a bidder's ETH by refusing to close a finished auction.
 */
export function SettleButton({ auction }: { auction: Auction }) {
  const now = useNow();
  const { address, isConnected } = useAccount();
  const tracker = useTxTracker();

  const settleable = isSettleableNow(auction, now);

  const simulation = useSimulateContract({
    ...auctionHouse,
    functionName: "settle",
    args: [auction.id],
    ...(address ? { account: address } : {}),
    query: { enabled: settleable && isConnected, retry: false },
  });

  const { writeContractAsync, isPending } = useWriteContract();

  if (!settleable) return null;

  const willMeetReserve = reserveMet(auction) && hasBid(auction);

  const run = async () => {
    if (!simulation.data) return;
    const id = tracker.begin({
      kind: "settle",
      label: `Settle #${auction.id.toString()}`,
      invalidate: INVALIDATE,
    });
    try {
      const hash = await writeContractAsync(simulation.data.request);
      tracker.submitted(id, hash);
    } catch (e: unknown) {
      tracker.failed(id, e);
    }
  };

  return (
    <Button
      variant="primary"
      size="sm"
      onClick={() => void run()}
      disabled={!isConnected || !simulation.isSuccess}
      loading={isPending}
      loadingLabel="Waiting for your wallet"
      title={
        isConnected
          ? willMeetReserve
            ? "Transfers the NFT to the winner and credits the seller"
            : "Closes below reserve: the bidder is credited in full and the NFT returns to the seller"
          : "Anyone can settle a finished auction. Connect a wallet to do it."
      }
    >
      Settle
    </Button>
  );
}

/**
 * Cancel. Seller-only, and only while there are no bids — exactly what the
 * contract enforces, mirrored here so the button is absent rather than
 * present-and-reverting.
 */
export function CancelButton({ auction }: { auction: Auction }) {
  const now = useNow();
  const { address, isConnected } = useAccount();
  const tracker = useTxTracker();
  const [open, setOpen] = useState(false);

  const phase = phaseOf(auction, now);
  const live = phase === "live" || phase === "ending" || phase === "final";
  const isSeller = sameAddress(auction.seller, address);
  const eligible = isSeller && live && !hasBid(auction);

  const simulation = useSimulateContract({
    ...auctionHouse,
    functionName: "cancelAuction",
    args: [auction.id],
    ...(address ? { account: address } : {}),
    query: { enabled: open && eligible && isConnected, retry: false },
  });

  const { writeContractAsync, isPending } = useWriteContract();

  if (!eligible) return null;

  const run = async () => {
    if (!simulation.data) return;
    const id = tracker.begin({
      kind: "cancel",
      label: `Cancel #${auction.id.toString()}`,
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
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        Cancel listing
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        dismissable={!isPending}
        title={`Cancel auction #${auction.id.toString()}`}
        description="Cancelling returns the escrowed NFT to you and closes the auction."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Keep it listed
            </Button>
            <Button
              variant="danger"
              onClick={() => void run()}
              disabled={!simulation.isSuccess}
              loading={isPending}
              loadingLabel="Waiting for your wallet"
            >
              Cancel the auction
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-[var(--color-ink-2)]">
          This is only possible because nobody has bid yet. As soon as the first bid arrives the
          contract refuses to cancel, so a seller cannot pull a listing out from under a bidder.
        </p>
      </Dialog>
    </>
  );
}

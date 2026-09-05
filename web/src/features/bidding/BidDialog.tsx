import { useState } from "react";
import { parseEther, formatEther, type Address } from "viem";
import {
  useAccount,
  useBalance,
  useEstimateFeesPerGas,
  useGasPrice,
  useSimulateContract,
  useWriteContract,
} from "wagmi";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Money } from "@/components/ui/Money";
import { Pill } from "@/components/ui/Pill";
import { Countdown } from "@/components/ui/Countdown";
import { auctionHouse } from "@/config/contracts";
import { decodeContractError } from "@/lib/errors";
import { formatEth, formatFee } from "@/lib/format";
import { estimateMinimumBid, isDutch, phaseOf, sameAddress, type Auction } from "@/lib/auction";
import { useNow } from "@/hooks/useTicker";
import { useTxTracker } from "@/hooks/useTxTracker";

/**
 * The bid dialog.
 *
 * THE ORDER MATTERS AND IT IS THE POINT:
 *
 *   1. The user types an amount.
 *   2. `useSimulateContract` runs `eth_call` against the real contract with
 *      that exact value. A bid that would revert reverts HERE, for free, and
 *      the custom error comes back decoded with its arguments.
 *   3. Only if the simulation succeeds is the submit button enabled, and it
 *      writes `simulation.data.request` — the exact, pre-validated request.
 *
 * So `BidTooLow(2520000000000000000, 2000000000000000000)` becomes
 * "Your bid must be at least 2.5200 ETH", inline, next to the field, with the
 * button disabled — before the wallet ever opens.
 *
 * The gas estimate comes from the same simulation plus current fee data, and
 * is shown BEFORE signing, so the cost is never a surprise.
 */

export interface BidDialogProps {
  auction: Auction;
  /** Authoritative minimumBid() from the contract, when it has loaded. */
  minimumBid: bigint | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BidDialog({ auction, minimumBid, open, onOpenChange }: BidDialogProps) {
  const now = useNow();
  const { address, isConnected } = useAccount();
  const tracker = useTxTracker();

  /* The floor, preferring the contract's own answer over the local estimate. */
  const floor = minimumBid ?? estimateMinimumBid(auction);

  /* The single piece of genuine local state in this dialog: what the user has
     typed. It is NOT seeded from a prop via useState-of-prop; it starts empty
     and `displayValue` derives the effective amount during render. */
  const [typed, setTyped] = useState("");

  const trimmed = typed.trim();
  const usingDefault = trimmed === "";
  const effectiveText = usingDefault ? formatEther(floor) : trimmed;

  /* Parse without throwing. An unparseable string is a validation error, not
     a crash. */
  let parsed: bigint | null = null;
  let parseError: string | undefined;
  try {
    if (effectiveText === "" || Number.isNaN(Number(effectiveText))) {
      parseError = "Enter an amount in ETH, for example 2.5";
    } else if (Number(effectiveText) < 0) {
      parseError = "A bid cannot be negative.";
    } else {
      parsed = parseEther(effectiveText as `${number}`);
    }
  } catch {
    parseError = "That is not a valid ETH amount. Use a decimal number like 2.5";
  }

  const belowFloor = parsed !== null && parsed < floor;

  const { data: balance } = useBalance({
    address,
    query: { enabled: Boolean(address) && open },
  });

  /* -- 1. SIMULATE ------------------------------------------------------- */
  const simulation = useSimulateContract({
    ...auctionHouse,
    functionName: "bid",
    args: [auction.id],
    ...(parsed !== null ? { value: parsed } : {}),
    ...(address ? { account: address } : {}),
    query: {
      /* Only simulate a well-formed, plausibly-fundable amount from a
         connected account, and only while the dialog is open. */
      enabled: open && isConnected && parsed !== null && parsed > 0n && !parseError,
      retry: false,
      /* A revert is a stable answer, not a transient failure. Cache it. */
      staleTime: 4_000,
    },
  });

  const simError = simulation.error ? decodeContractError(simulation.error) : null;

  /* -- 2. GAS ------------------------------------------------------------ */
  const fees = useEstimateFeesPerGas({ query: { enabled: open && isConnected } });
  /* EIP-1559 estimation needs a recent fee history; a quiet local node can
     answer eth_gasPrice when that is unavailable. Either figure is better than
     asking someone to approve a spend with no cost shown. */
  const legacyGasPrice = useGasPrice({ query: { enabled: open && isConnected && !fees.data } });
  const gasLimit = simulation.data?.request.gas;
  const gasPrice = fees.data?.maxFeePerGas ?? fees.data?.gasPrice ?? legacyGasPrice.data;
  const feeEstimate = gasLimit !== undefined && gasPrice !== undefined ? gasLimit * gasPrice : null;

  const totalCost = parsed !== null && feeEstimate !== null ? parsed + feeEstimate : null;
  const insufficient =
    balance !== undefined && totalCost !== null ? balance.value < totalCost : false;

  /* -- 3. WRITE ---------------------------------------------------------- */
  const { writeContractAsync, isPending: isSigning } = useWriteContract();

  const phase = phaseOf(auction, now);
  const isSeller = sameAddress(auction.seller, address);
  const alreadyLeading = sameAddress(auction.highestBidder, address);
  const closed = phase === "settled" || phase === "cancelled" || phase === "reserve-not-met" || phase === "delivery-failed" || phase === "awaiting-settlement";

  /* The submit button is enabled ONLY on a green simulation. */
  const canSubmit =
    isConnected &&
    !closed &&
    !isSeller &&
    !alreadyLeading &&
    parsed !== null &&
    !parseError &&
    !belowFloor &&
    !insufficient &&
    simulation.isSuccess &&
    simulation.data !== undefined;

  const inlineError =
    parseError ??
    (belowFloor ? `Your bid must be at least ${formatEth(floor)} ETH.` : undefined) ??
    (insufficient
      ? `That account holds ${formatEth(balance?.value ?? 0n)} ETH, which does not cover the bid plus the gas fee.`
      : undefined) ??
    (simError && !simError.rejected ? simError.message : undefined);

  const submit = async () => {
    if (!simulation.data) return;
    const label = `Bid ${formatEth(parsed ?? 0n)} ETH on #${auction.id.toString()}`;
    const id = tracker.begin({
      kind: "bid",
      label,
      invalidate: [["readContracts"], ["readContract"]],
    });
    try {
      const hash = await writeContractAsync(simulation.data.request);
      /* PENDING, not success. Only the receipt watcher may say "confirmed". */
      tracker.submitted(id, hash);
      onOpenChange(false);
      setTyped("");
    } catch (e: unknown) {
      tracker.failed(id, e);
    }
  };

  const blockedReason = closed
    ? "This auction is no longer accepting bids."
    : isSeller
      ? "You listed this auction. A seller cannot bid on their own item."
      : alreadyLeading
        ? "You are already the highest bidder. Bidding again would only raise your own price."
        : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setTyped("");
      }}
      dismissable={!isSigning}
      title={`Bid on auction #${auction.id.toString()}`}
      description={`Token #${auction.tokenId.toString()}. Your bid is simulated against the contract before you are asked to sign.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSigning}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!canSubmit}
            loading={isSigning || simulation.isLoading}
            loadingLabel={isSigning ? "Waiting for your wallet" : "Checking the bid against the contract"}
          >
            {isSigning ? "Confirm in your wallet" : `Bid ${formatEth(parsed ?? floor)} ETH`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Current state, so the number in the field has context. */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-[var(--color-line)] pb-4 sm:grid-cols-3">
          <div>
            <dt className="col-head">Top bid</dt>
            <dd className="mt-1">
              {auction.highestBid > 0n ? (
                <Money wei={auction.highestBid} size="sm" />
              ) : (
                <span className="text-[0.8125rem] text-[var(--color-ink-3)]">no bids yet</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="col-head">Minimum</dt>
            <dd className="mt-1">
              <Money wei={floor} size="sm" tone="live" />
            </dd>
          </div>
          <div>
            <dt className="col-head">Ends in</dt>
            <dd className="mt-1">
              <Countdown endTime={auction.endTime} size="sm" />
            </dd>
          </div>
        </dl>

        {blockedReason ? (
          <p role="alert" className="border-l-2 border-[var(--color-danger)] py-1 pl-3 text-[0.8125rem] text-[var(--color-danger)]">
            {blockedReason}
          </p>
        ) : null}

        <Field
          label="Your bid"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          suffix="ETH"
          value={typed}
          placeholder={formatEther(floor)}
          onChange={(e) => setTyped(e.target.value)}
          disabled={Boolean(blockedReason)}
          {...(inlineError ? { error: inlineError } : {})}
          hint={
            <>
              At least <strong className="tnum text-[var(--color-ink-2)]">{formatEth(floor)} ETH</strong>
              . Leave this empty to bid exactly the minimum. If you are outbid, your ETH is credited
              to your withdrawable balance — it is never lost.
            </>
          }
        />

        {/* Offer the exact number rather than making the user do arithmetic. */}
        {belowFloor || simError?.requiredWei ? (
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setTyped(formatEther(simError?.requiredWei ?? floor))}
            >
              Use the minimum, {formatEth(simError?.requiredWei ?? floor)} ETH
            </Button>
          </div>
        ) : null}

        {/* Simulation verdict + gas, BEFORE signing. */}
        <div className="border-t border-[var(--color-line)] pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="col-head">Pre-flight</span>
            {!isConnected ? (
              <Pill tone="neutral">wallet needed</Pill>
            ) : simulation.isLoading ? (
              <Pill tone="neutral">checking…</Pill>
            ) : simulation.isSuccess ? (
              <Pill tone="live">would succeed</Pill>
            ) : simError ? (
              <Pill tone="danger">would revert</Pill>
            ) : (
              <Pill tone="neutral">enter an amount</Pill>
            )}
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[0.8125rem]">
            <dt className="text-[var(--color-ink-3)]">Bid amount</dt>
            <dd className="tnum text-right text-[var(--color-ink)]">
              {parsed !== null ? `${formatEth(parsed)} ETH` : "—"}
            </dd>

            <dt className="text-[var(--color-ink-3)]">Estimated gas fee</dt>
            <dd className="tnum text-right text-[var(--color-ink)]">
              {feeEstimate !== null ? formatFee(feeEstimate) : "—"}
            </dd>

            <dt className="font-medium text-[var(--color-ink-2)]">Total to leave your wallet</dt>
            <dd className="tnum text-right font-medium text-[var(--color-ink)]">
              {totalCost !== null ? `${formatEth(totalCost, 6)} ETH` : "—"}
            </dd>

            {balance ? (
              <>
                <dt className="text-[var(--color-ink-3)]">Your balance</dt>
                <dd className="tnum text-right text-[var(--color-ink-3)]">
                  {formatEth(balance.value)} ETH
                </dd>
              </>
            ) : null}
          </dl>

          {feeEstimate === null && simulation.isSuccess ? (
            <p className="mt-2 text-[0.6875rem] text-[var(--color-ink-3)]">
              The node did not return fee data, so the gas figure is unavailable. Your wallet will
              show the final cost before you sign.
            </p>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

/** The trigger button, with the read-only path handled honestly. */
export function BidButton({
  auction,
  minimumBid,
  size = "sm",
}: {
  auction: Auction;
  minimumBid: bigint | null;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const now = useNow();
  const { address, isConnected } = useAccount();
  const phase = phaseOf(auction, now);
  const biddable = phase === "live" || phase === "ending" || phase === "final";
  const isSeller = sameAddress(auction.seller, address as Address | undefined);

  /* A Dutch listing takes `buy`, not `bid`; the contract rejects the wrong
     entry point, so offering this button would guarantee a failed
     transaction. BuyDutchButton is what renders in its place. */
  if (!biddable || isDutch(auction)) return null;

  return (
    <>
      <Button
        variant="primary"
        size={size}
        onClick={() => setOpen(true)}
        disabled={isSeller}
        title={
          isSeller
            ? "A seller cannot bid on their own auction"
            : isConnected
              ? undefined
              : "You will be asked to connect a wallet"
        }
      >
        <span aria-hidden="true">Bid</span>
        <span className="sr-only">Bid on auction {auction.id.toString()}</span>
      </Button>
      {open ? (
        <BidDialog auction={auction} minimumBid={minimumBid} open={open} onOpenChange={setOpen} />
      ) : null}
    </>
  );
}

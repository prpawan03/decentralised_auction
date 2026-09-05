import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { useAccount, useReadContract, useSimulateContract, useWriteContract } from "wagmi";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { ConnectPrompt } from "@/features/wallet/WalletButton";
import { auctionHouse, demoNft } from "@/config/contracts";
import { config } from "@/config/runtime";
import { useProtocolConstants } from "@/hooks/useAuctions";
import { useTxTracker } from "@/hooks/useTxTracker";
import { decodeContractError } from "@/lib/errors";
import { formatDuration } from "@/lib/format";
import { sameAddress } from "@/lib/auction";
import {
  DURATION_PRESETS,
  LISTING_FORMATS,
  listingSchema,
  toCreateCall,
  type ListingInput,
} from "./listingSchema";
import { cn } from "@/lib/cn";

/**
 * Create a listing.
 *
 * Two things make this different from the old "Add Item" form:
 *
 *  1. Validation is derived from the CONTRACT's constraints (see
 *     listingSchema.ts), so the form refuses what the chain would refuse, with
 *     the same reasoning, before any gas is spent.
 *
 *  2. It handles the ESCROW APPROVAL, which the old app ignored entirely.
 *     `createAuction` transfers the NFT into the contract, so the seller must
 *     approve first. Without that step the transaction reverts, and "approve
 *     then list" is a two-transaction flow the UI has to make legible rather
 *     than hide.
 */
export default function CreateListingPage() {
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const tracker = useTxTracker();
  const limits = useProtocolConstants();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<ListingInput>({
    resolver: zodResolver(listingSchema),
    mode: "onBlur",
    defaultValues: {
      format: "english",
      nft: config.demoNftAddress,
      tokenId: "",
      reservePrice: "0",
      buyNowPrice: "0",
      startPrice: "1",
      floorPrice: "0",
      minIncrementPercent: "5",
      durationSeconds: 600,
    },
  });

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isValid, isSubmitting },
  } = form;

  /* Derived during render from the form's own values — never mirrored. */
  const values = watch();
  /* Drives which price vocabulary the form shows. Watched rather than stored,
     so it can never disagree with what will actually be submitted. */
  const dutch = values.format === "dutch";
  const tokenIdValid = /^\d+$/.test(String(values.tokenId ?? "").trim());
  const nftAddress = /^0x[0-9a-fA-F]{40}$/.test(String(values.nft ?? "").trim())
    ? (values.nft as `0x${string}`)
    : undefined;

  /* -- escrow approval --------------------------------------------------- */

  const owner = useReadContract({
    address: nftAddress,
    abi: demoNft.abi,
    functionName: "ownerOf",
    args: tokenIdValid ? [BigInt(String(values.tokenId))] : undefined,
    query: { enabled: Boolean(nftAddress) && tokenIdValid, retry: false },
  });

  const approvedFor = useReadContract({
    address: nftAddress,
    abi: demoNft.abi,
    functionName: "getApproved",
    args: tokenIdValid ? [BigInt(String(values.tokenId))] : undefined,
    query: { enabled: Boolean(nftAddress) && tokenIdValid, retry: false },
  });

  const approvedAll = useReadContract({
    address: nftAddress,
    abi: demoNft.abi,
    functionName: "isApprovedForAll",
    args: address ? [address, auctionHouse.address] : undefined,
    query: { enabled: Boolean(nftAddress) && Boolean(address), retry: false },
  });

  const ownsToken = sameAddress(owner.data as `0x${string}` | undefined, address);
  const isApproved =
    sameAddress(approvedFor.data as `0x${string}` | undefined, auctionHouse.address) ||
    approvedAll.data === true;

  const approveSim = useSimulateContract({
    address: nftAddress,
    abi: demoNft.abi,
    functionName: "setApprovalForAll",
    args: [auctionHouse.address, true],
    ...(address ? { account: address } : {}),
    query: { enabled: Boolean(nftAddress) && isConnected && !isApproved, retry: false },
  });

  const { writeContractAsync: writeApprove, isPending: approving } = useWriteContract();

  const runApprove = async () => {
    if (!approveSim.data) return;
    const id = tracker.begin({
      kind: "approve",
      label: "Approve the auction house to escrow your NFTs",
      invalidate: [["readContract"]],
    });
    try {
      const hash = await writeApprove(approveSim.data.request);
      tracker.submitted(id, hash);
    } catch (e: unknown) {
      tracker.failed(id, e);
    }
  };

  /* -- create ------------------------------------------------------------ */

  const parsed = listingSchema.safeParse(values);
  /* The two formats are different functions with differently-ordered
     arguments, so the call is resolved next to the schema that validated it
     rather than assembled here. */
  const createCall = parsed.success ? toCreateCall(parsed.data) : null;

  const createSim = useSimulateContract({
    ...auctionHouse,
    ...(createCall
      ? { functionName: createCall.functionName, args: createCall.args }
      : { functionName: "createAuction" as const }),
    ...(address ? { account: address } : {}),
    query: { enabled: isConnected && createCall !== null && isApproved && ownsToken, retry: false },
  });

  const { writeContractAsync: writeCreate, isPending: creating } = useWriteContract();
  const createError = createSim.error ? decodeContractError(createSim.error) : null;

  const onSubmit = handleSubmit(async () => {
    setSubmitError(null);
    if (!createSim.data) {
      setSubmitError(
        createError?.message ??
          "The contract has not confirmed this listing would succeed yet. Wait a moment and try again.",
      );
      return;
    }
    const id = tracker.begin({
      kind: "create",
      label: `List token #${String(values.tokenId)}`,
      invalidate: [["readContracts"], ["readContract"]],
    });
    try {
      const hash = await writeCreate(createSim.data.request);
      tracker.submitted(id, hash);
      void navigate("/portfolio");
    } catch (e: unknown) {
      tracker.failed(id, e);
    }
  });

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-lg font-semibold text-[var(--color-ink)]">List an item</h1>
      <p className="mt-1 max-w-prose text-[0.8125rem] leading-relaxed text-[var(--color-ink-3)]">
        Listing escrows your NFT in the auction house and opens a live auction. The token is
        released atomically with payment when the auction settles, so a winner can never pay and
        receive nothing.
      </p>

      {!isConnected ? <ConnectPrompt action="Listing an item" /> : null}

      <form onSubmit={(e) => void onSubmit(e)} noValidate className="mt-6 flex flex-col gap-6">
        <fieldset className="panel border-0 p-0">
          <legend className="col-head px-4 pt-4">The item</legend>
          <div className="grid gap-4 px-4 pt-3 pb-4 sm:grid-cols-2">
            <Field
              label="NFT contract"
              {...register("nft")}
              {...(errors.nft?.message ? { error: errors.nft.message } : {})}
              hint="The demo collection is pre-filled. Any ERC-721 you own works."
              autoComplete="off"
              spellCheck={false}
            />
            <Field
              label="Token id"
              {...register("tokenId")}
              {...(errors.tokenId?.message ? { error: errors.tokenId.message } : {})}
              hint="The specific token you are selling."
              inputMode="numeric"
              autoComplete="off"
            />
          </div>

          {/* Ownership, read from the chain rather than assumed. */}
          {nftAddress && tokenIdValid ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] px-4 py-2.5 text-[0.75rem]">
              {owner.isLoading ? (
                <Pill tone="neutral">checking ownership</Pill>
              ) : owner.isError ? (
                <>
                  <Pill tone="danger">no such token</Pill>
                  <span className="text-[var(--color-ink-3)]">
                    That contract has no token with this id.
                  </span>
                </>
              ) : ownsToken ? (
                <Pill tone="live">you own this token</Pill>
              ) : (
                <>
                  <Pill tone="danger">not yours</Pill>
                  <span className="text-[var(--color-ink-3)]">
                    Only the owner can list a token for auction.
                  </span>
                </>
              )}
            </div>
          ) : null}
        </fieldset>

        <fieldset className="panel border-0 p-0">
          <legend className="col-head px-4 pt-4">Format</legend>
          <div className="flex flex-col gap-2 px-4 pt-3 pb-4">
            {/* Radios, not a select: two mutually exclusive options that change
                the rest of the form, and a radio group announces that change
                far better than a collapsed listbox. */}
            {LISTING_FORMATS.map((f) => (
              <label key={f.id} className="flex items-start gap-2.5 text-[0.8125rem]">
                <input
                  type="radio"
                  value={f.id}
                  {...register("format")}
                  className="mt-0.5 accent-[var(--color-action)]"
                />
                <span>
                  <span className="font-medium text-[var(--color-ink)]">{f.label}</span>
                  <span className="block text-[0.75rem] text-[var(--color-ink-3)]">{f.describe}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="panel border-0 p-0">
          <legend className="col-head px-4 pt-4">Price</legend>
          {dutch ? (
            <div className="grid gap-4 px-4 pt-3 pb-4 sm:grid-cols-2">
              <Field
                label="Opening price"
                suffix="ETH"
                inputMode="decimal"
                {...register("startPrice")}
                {...(errors.startPrice?.message ? { error: errors.startPrice.message } : {})}
                hint="Where the price starts. It falls from here in a straight line over the duration. Must be above zero."
                autoComplete="off"
              />
              <Field
                label="Floor price"
                suffix="ETH"
                inputMode="decimal"
                {...register("floorPrice")}
                {...(errors.floorPrice?.message ? { error: errors.floorPrice.message } : {})}
                hint="The lowest the price will reach, held until the deadline. If nobody buys by then the item is unsold and returns to you. Set it equal to the opening price for a flat price."
                autoComplete="off"
              />
            </div>
          ) : (
          <div className="grid gap-4 px-4 pt-3 pb-4 sm:grid-cols-2">
            <Field
              label="Reserve price"
              suffix="ETH"
              inputMode="decimal"
              {...register("reservePrice")}
              {...(errors.reservePrice?.message ? { error: errors.reservePrice.message } : {})}
              hint="The least you will accept. Below it, the auction closes as ReserveNotMet and the bidder is refunded in full. Use 0 for no reserve."
              autoComplete="off"
            />
            <Field
              label="Buy-now price"
              suffix="ETH"
              inputMode="decimal"
              {...register("buyNowPrice")}
              {...(errors.buyNowPrice?.message ? { error: errors.buyNowPrice.message } : {})}
              hint="Ends the auction immediately at this price. Must be above the reserve. 0 switches buy-now off — it never means free."
              autoComplete="off"
            />
            <Field
              label="Minimum bid step"
              suffix="%"
              inputMode="decimal"
              {...register("minIncrementPercent")}
              {...(errors.minIncrementPercent?.message
                ? { error: errors.minIncrementPercent.message }
                : {})}
              hint="How much each bid must beat the last one by. 5% is the default. There is also a flat floor, so a tiny percentage of a tiny bid still has to move the price."
              autoComplete="off"
            />
          </div>
          )}
        </fieldset>

        <fieldset className="panel border-0 p-0">
          <legend className="col-head px-4 pt-4">Duration</legend>
          <div className="px-4 pt-3 pb-4">
            <Controller
              control={control}
              name="durationSeconds"
              render={({ field, fieldState }) => (
                <div>
                  <div role="group" aria-label="Auction duration" className="flex flex-wrap gap-1.5">
                    {DURATION_PRESETS.map((preset) => {
                      const active = field.value === preset.seconds;
                      return (
                        <button
                          key={preset.seconds}
                          type="button"
                          aria-pressed={active}
                          onClick={() => field.onChange(preset.seconds)}
                          className={cn(
                            "tap h-9 rounded-[3px] border px-3 text-[0.8125rem]",
                            active
                              ? "border-[var(--color-action)] bg-[var(--color-action)] font-medium text-[var(--color-on-action)]"
                              : "border-[var(--color-line-strong)] text-[var(--color-ink-2)] hover:bg-[var(--color-raised)]",
                          )}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>

                  <p className="mt-2.5 text-[0.75rem] text-[var(--color-ink-3)]">
                    Selected: <span className="tnum">{formatDuration(field.value ?? 0)}</span>. The
                    contract allows {formatDuration(Number(limits.minDuration))} to{" "}
                    {formatDuration(Number(limits.maxDuration))}
                    {limits.fromChain ? " (read from the contract)." : " (contract defaults)."}
                  </p>

                  {fieldState.error?.message ? (
                    <p role="alert" className="mt-1.5 text-[0.75rem] text-[var(--color-danger)]">
                      <span className="font-semibold">Error: </span>
                      {fieldState.error.message}
                    </p>
                  ) : null}
                </div>
              )}
            />
          </div>
        </fieldset>

        {/* Escrow approval: a real, separate transaction, shown as one. */}
        {isConnected && nftAddress ? (
          <section
            aria-labelledby="approval-heading"
            className="border-l-2 border-[var(--color-line-strong)] px-4 py-3"
          >
            <h2 id="approval-heading" className="text-[0.75rem] font-semibold tracking-[0.06em] text-[var(--color-ink-2)] uppercase">
              Step 1 · Escrow approval
            </h2>
            {isApproved ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.8125rem] text-[var(--color-ink-3)]">
                <Pill tone="live">approved</Pill>
                The auction house may escrow your tokens from this collection.
              </p>
            ) : (
              <>
                <p className="mt-1.5 max-w-prose text-[0.8125rem] leading-relaxed text-[var(--color-ink-3)]">
                  Before it can escrow the NFT, the auction house needs your approval on this
                  collection. This is a separate transaction, and you only do it once per
                  collection.
                </p>
                <div className="mt-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void runApprove()}
                    disabled={!approveSim.isSuccess}
                    loading={approving}
                    loadingLabel="Waiting for your wallet"
                  >
                    Approve this collection
                  </Button>
                </div>
              </>
            )}
          </section>
        ) : null}

        {/* Pre-flight verdict on the listing itself. */}
        <section aria-labelledby="preflight-heading" className="border-t border-[var(--color-line)] pt-4">
          <h2 id="preflight-heading" className="col-head">
            Step 2 · Pre-flight
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!isConnected ? (
              <Pill tone="neutral">wallet needed</Pill>
            ) : !isApproved ? (
              <Pill tone="warn">approve first</Pill>
            ) : createSim.isLoading ? (
              <Pill tone="neutral">checking…</Pill>
            ) : createSim.isSuccess ? (
              <Pill tone="live">would succeed</Pill>
            ) : createError ? (
              <Pill tone="danger">would revert</Pill>
            ) : (
              <Pill tone="neutral">complete the form</Pill>
            )}
          </div>

          {createError && !createError.rejected ? (
            <p role="alert" className="mt-2 max-w-prose text-[0.8125rem] leading-relaxed text-[var(--color-danger)]">
              {createError.message}
            </p>
          ) : null}
          {submitError ? (
            <p role="alert" className="mt-2 max-w-prose text-[0.8125rem] text-[var(--color-danger)]">
              {submitError}
            </p>
          ) : null}
        </section>

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={!isConnected || !isValid || !isApproved || !createSim.isSuccess}
            loading={creating || isSubmitting}
            loadingLabel="Waiting for your wallet"
          >
            Create the auction
          </Button>
          <Button variant="ghost" onClick={() => void navigate("/")}>
            Cancel
          </Button>
        </div>
      </form>
    </main>
  );
}

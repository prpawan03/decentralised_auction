import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  formatEther,
} from "viem";
import { formatEth } from "./format";
import { truncateAddress } from "./format";

/**
 * Turn a revert into a sentence a person can act on.
 *
 * The contract uses custom errors, not revert strings, specifically so the
 * frontend can do this. `BidTooLow(required, provided)` carries the exact
 * number you need, so the UI should say "at least 2.5200 ETH" rather than
 * "transaction failed".
 */

export interface DecodedError {
  /** One sentence, imperative where the user can fix it. */
  message: string;
  /** The contract's own error name, for the details disclosure. */
  name?: string;
  /** True when the user dismissed their wallet. Not a failure worth shouting about. */
  rejected: boolean;
  /** The minimum acceptable value, when the error carries one. */
  requiredWei?: bigint;
}

const STATUS_LABEL = ["live", "already settled", "cancelled", "closed below reserve"] as const;

function statusLabel(raw: unknown): string {
  const n = Number(raw);
  return STATUS_LABEL[n] ?? `status ${String(raw)}`;
}

function fromCustomError(name: string, args: readonly unknown[]): DecodedError {
  const base = { name, rejected: false };

  switch (name) {
    case "BidTooLow": {
      const required = args[0] as bigint;
      const provided = args[1] as bigint;
      return {
        ...base,
        requiredWei: required,
        message: `Your bid must be at least ${formatEth(required)} ETH. You entered ${formatEth(
          provided,
        )} ETH.`,
      };
    }
    case "IncorrectPayment": {
      const required = args[0] as bigint;
      return {
        ...base,
        requiredWei: required,
        message: `Buy-now costs exactly ${formatEth(required)} ETH. Send that amount, not more or less.`,
      };
    }
    case "SellerCannotBid":
      return {
        ...base,
        message: "You listed this auction. A seller cannot bid on their own item.",
      };
    case "AlreadyHighestBidder":
      return {
        ...base,
        message:
          "You are already the highest bidder. Bidding again would only raise your own price.",
      };
    case "AuctionNotLive":
      return {
        ...base,
        message: `This auction is ${statusLabel(args[1])}, so it can no longer take bids.`,
      };
    case "AuctionAlreadyEnded":
      return { ...base, message: "This auction has ended. It can be settled, but not bid on." };
    case "AuctionStillRunning": {
      const endTime = args[1] as bigint;
      return {
        ...base,
        message: `This auction cannot be settled until it ends at ${new Date(
          Number(endTime) * 1000,
        ).toLocaleString("en-GB")}.`,
      };
    }
    case "AuctionNotFound":
      return { ...base, message: `Auction #${String(args[0])} does not exist on this chain.` };
    case "NotSeller": {
      const seller = args[1] as string;
      return { ...base, message: `Only the seller (${truncateAddress(seller)}) can do that.` };
    }
    case "AuctionHasBids":
      return {
        ...base,
        message:
          "This auction already has a bid, so it can no longer be cancelled. It will settle when it ends.",
      };
    case "BuyNowDisabled":
      return { ...base, message: "This auction has no buy-now price. Place a bid instead." };
    case "NothingToWithdraw":
      return {
        ...base,
        message: "You have no balance to withdraw. Refunds appear here after you are outbid.",
      };
    case "DurationOutOfRange": {
      const min = Number(args[1] as bigint);
      const max = Number(args[2] as bigint);
      return {
        ...base,
        message: `Duration must be between ${min / 60} minutes and ${Math.round(max / 86_400)} days.`,
      };
    }
    case "InvalidBuyNowPrice": {
      const reserve = args[1] as bigint;
      return {
        ...base,
        message: `Buy-now must be above the reserve of ${formatEth(reserve)} ETH, or 0 to disable it.`,
      };
    }
    case "FeeTooHigh":
      return { ...base, message: `The platform fee is capped at ${Number(args[1]) / 100}%.` };
    case "ValueTooLarge":
      return { ...base, message: "That amount is too large for this contract to store." };
    case "TransferFailed": {
      const to = args[0] as string;
      return {
        ...base,
        message: `Transferring ${formatEther(args[1] as bigint)} ETH to ${truncateAddress(to)} failed.`,
      };
    }
    case "EnforcedPause":
      return {
        ...base,
        message: "The auction house is paused. Withdrawals and settlement still work.",
      };
    case "OwnableUnauthorizedAccount":
      return { ...base, message: "That action is restricted to the contract owner." };
    default:
      return { ...base, message: `The contract rejected this with ${name}.` };
  }
}

/**
 * Walks a viem/wagmi error chain and produces something worth showing.
 * Handles: user rejection, custom errors, revert strings, out-of-funds,
 * and a dead RPC.
 */
export function decodeContractError(error: unknown): DecodedError {
  if (!error) return { message: "Something went wrong.", rejected: false };

  if (error instanceof BaseError) {
    /* 1. The user closed their wallet. Silent path — not an error state. */
    const rejection = error.walk((e) => e instanceof UserRejectedRequestError);
    if (rejection) {
      return {
        message: "You cancelled the request in your wallet.",
        rejected: true,
        name: "UserRejected",
      };
    }

    /* 2. A decoded custom error, which is where the useful numbers live. */
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name) return fromCustomError(name, (reverted.data?.args ?? []) as readonly unknown[]);
      if (reverted.reason) return { message: reverted.reason, rejected: false, name: "Revert" };
    }

    /* 3. Common wallet/node conditions that are not contract errors at all. */
    const text = `${error.shortMessage ?? ""} ${error.details ?? ""}`.toLowerCase();
    if (text.includes("insufficient funds")) {
      return {
        message: "That account does not have enough ETH to cover the bid plus gas.",
        rejected: false,
        name: "InsufficientFunds",
      };
    }
    if (text.includes("nonce")) {
      return {
        message:
          "Your wallet's transaction count is out of step with the node. Reset the account in your wallet's advanced settings.",
        rejected: false,
        name: "NonceMismatch",
      };
    }
    if (
      text.includes("failed to fetch") ||
      text.includes("http request failed") ||
      text.includes("connection refused")
    ) {
      return {
        message:
          "Cannot reach the chain node. Check that it is running and reachable at the configured RPC URL.",
        rejected: false,
        name: "NetworkError",
      };
    }

    return { message: error.shortMessage || error.message, rejected: false, name: error.name };
  }

  if (error instanceof Error) return { message: error.message, rejected: false, name: error.name };
  return { message: String(error), rejected: false };
}

/**
 * Extract the minimum acceptable bid from a failed simulation, so the dialog
 * can offer "use the minimum" instead of making the user do arithmetic.
 */
export function requiredAmountFrom(error: unknown): bigint | undefined {
  return decodeContractError(error).requiredWei;
}

/**
 * Turning contract reverts into sentences an agent can act on.
 *
 * WHY this file is worth its length: an agent that receives "execution
 * reverted" has learned nothing and its only strategy is to retry the identical
 * call. An agent that receives "bid too low: the minimum is 1.05 ETH, you
 * offered 1.0 ETH" can compute the correct retry on its first attempt. Custom
 * Solidity errors already carry the numbers needed to say that -- they arrive as
 * a 4-byte selector plus ABI-encoded arguments -- so all that is missing is the
 * translation layer. That is what this is.
 *
 * Every message follows the same shape: what went wrong, the numbers involved,
 * and what to do about it. The last part matters most: `AlreadyHighestBidder`
 * without "you are already winning; wait for it to close" reads like a failure
 * when it is actually good news.
 */

import { BaseError, ContractFunctionRevertedError, formatEther } from "viem";
import { AUCTION_STATUS, AUCTION_FORMAT } from "./abi.js";

/** Renders wei as a compact ETH string. `formatEther` already trims zeros. */
export function eth(wei: bigint): string {
  return `${formatEther(wei)} ETH`;
}

/** Maps a `Status` ordinal to its name, tolerating an unknown future value. */
function statusName(ordinal: unknown): string {
  const index = Number(ordinal);
  return AUCTION_STATUS[index] ?? `unknown status ${String(ordinal)}`;
}

/** Formats a Unix second as an ISO timestamp, for human-readable deadlines. */
function isoTime(unixSeconds: unknown): string {
  const seconds = Number(unixSeconds);
  if (!Number.isFinite(seconds)) return String(unixSeconds);
  return new Date(seconds * 1000).toISOString();
}

/**
 * Builds the human sentence for one decoded custom error.
 *
 * `args` is positional and matches the error's ABI declaration order, so each
 * case below must stay in step with contracts/src/AuctionHouse.sol.
 */
function describe(name: string, args: readonly unknown[]): string {
  switch (name) {
    // --- Bidding ----------------------------------------------------------
    case "BidTooLow": {
      const [required, provided] = args as [bigint, bigint];
      const shortfall = required - provided;
      return (
        `Bid too low: this auction needs at least ${eth(required)}, but you offered ` +
        `${eth(provided)} (${eth(shortfall)} short). Call simulate_bid or get_auction to ` +
        `read the current minimum before retrying -- it rises with every accepted bid.`
      );
    }
    case "AlreadyHighestBidder":
      return (
        "You already hold the leading bid on this auction. The contract rejects bidding " +
        "against yourself so you cannot lock up extra ETH for no gain. Do nothing and " +
        "wait for the auction to close, then call settle_auction once it is settleable."
      );
    case "WrongFormat": {
      const [auctionId, expected, actual] = args as [bigint, number, number];
      const actualName = AUCTION_FORMAT[Number(actual)] ?? `format ${actual}`;
      const expectedName = AUCTION_FORMAT[Number(expected)] ?? `format ${expected}`;
      return (
        `Wrong operation for the auction format: auction ${auctionId} is a ${actualName} ` +
        `auction, but that call is only valid on a ${expectedName} auction.\n\n` +
        (actualName === "Dutch"
          ? `Dutch auctions do not take bids -- the price starts high and falls over time, and ` +
            `the first buyer to accept it wins. Use buy_now on this auction, which pays the ` +
            `current declining price. Read that price with get_auction.`
          : `English auctions ascend via competing bids. Use simulate_bid and then place_bid ` +
            `on this auction rather than an instant-purchase call.`)
      );
    }
    case "SellerCannotBid":
      return (
        "The connected account is the SELLER of this auction, and a seller may not bid on " +
        "or buy their own listing (this blocks wash trading and self-cancellation). " +
        "There is no retry that succeeds -- pick a different auction."
      );
    case "ValueTooLarge": {
      const [value] = args as [bigint];
      return (
        `Bid of ${eth(value)} is too large: the contract stores bids in a uint96, which ` +
        `caps a single bid at about 79.2 billion ETH. Bid a smaller amount.`
      );
    }

    // --- Lifecycle --------------------------------------------------------
    case "AuctionNotFound": {
      const [auctionId] = args as [bigint];
      return (
        `Auction ${auctionId} does not exist. Valid ids run from 0 to totalAuctions()-1; ` +
        `call list_auctions to see what is actually listed.`
      );
    }
    case "AuctionNotLive": {
      const [auctionId, status] = args as [bigint, number];
      return (
        `Auction ${auctionId} is not live -- its status is "${statusName(status)}". ` +
        `Only a Live auction accepts bids, buy-now, settlement or cancellation. ` +
        `If money is owed to you from it, call withdraw instead.`
      );
    }
    case "AuctionAlreadyEnded": {
      const [auctionId] = args as [bigint];
      return (
        `Auction ${auctionId} has passed its end time and no longer accepts bids, even ` +
        `though it has not been settled yet. Call settle_auction to close it out -- ` +
        `anyone may settle, not just the seller or the winner.`
      );
    }
    case "AuctionStillRunning": {
      const [auctionId, endTime] = args as [bigint, bigint];
      return (
        `Auction ${auctionId} is still running: bidding closes at ${isoTime(endTime)} ` +
        `(unix ${endTime}). It cannot be settled until then. Note that a late bid can ` +
        `push this deadline out via the 5-minute anti-snipe extension.`
      );
    }
    case "AuctionHasBids":
      return (
        "This auction cannot be cancelled: it carries a standing bid at or above the " +
        "reserve price, which is a real sale in waiting. Only a listing with no bids, or " +
        "one whose best bid is below reserve, may be withdrawn by its seller."
      );
    case "NotSeller": {
      const [caller, seller] = args as [string, string];
      return (
        `Only the seller may cancel this auction. The listing belongs to ${seller}, but ` +
        `the connected account is ${caller}.`
      );
    }

    // --- Buy now ----------------------------------------------------------
    case "BuyNowDisabled": {
      const [auctionId] = args as [bigint];
      return (
        `Buy-now is not available on auction ${auctionId}. Either the seller never set a ` +
        `buy-now price, or bidding has already reached it -- once the leading bid meets ` +
        `the buy-now price the instant-purchase route closes, so nobody can buy the item ` +
        `for less than the standing bid. Place a normal bid instead.`
      );
    }
    case "IncorrectPayment": {
      const [required, provided] = args as [bigint, bigint];
      return (
        `Buy-now requires EXACTLY ${eth(required)}, but ${eth(provided)} was sent. ` +
        `Unlike a bid, buy-now does not accept an overpayment -- send the exact price.`
      );
    }

    // --- Withdrawals ------------------------------------------------------
    case "NothingToWithdraw":
      return (
        "There is nothing to withdraw: this account has no pending balance in the auction " +
        "house. Credits appear here when you are outbid, when an auction you bid on ends " +
        "below its reserve, or when an item you sold settles. Call get_wallet_status to " +
        "check the pending balance before withdrawing."
      );
    case "TransferFailed": {
      const [to, amount] = args as [string, bigint];
      return (
        `The transfer of ${eth(amount)} to ${to} failed -- the receiving account rejected ` +
        `the ETH. Nothing was lost: the credit remains claimable.`
      );
    }

    // --- Delivery ---------------------------------------------------------
    case "NoPendingNft": {
      const [auctionId] = args as [bigint];
      return `Auction ${auctionId} has no undelivered NFT waiting to be claimed.`;
    }

    // --- House state ------------------------------------------------------
    case "EnforcedPause":
      return (
        "The auction house is PAUSED by its owner. New bids and buy-now purchases are " +
        "rejected while paused. Settlement and withdrawal deliberately still work, so no " +
        "money can be trapped by a pause -- you can still call settle_auction and withdraw."
      );
    case "ReentrancyGuardReentrantCall":
      return "The contract's reentrancy guard rejected this call. This should not happen from a normal client.";

    // --- Owner-only (unreachable from this server; decoded for clarity) ----
    case "OwnableUnauthorizedAccount": {
      const [account] = args as [string];
      return (
        `${account} is not the owner of the auction house. This server intentionally runs ` +
        `as a non-owner account and exposes no owner-only operations.`
      );
    }
    case "FeeTooHigh":
    case "InvalidFeeRecipient":
    case "DurationOutOfRange":
    case "InvalidBuyNowPrice":
      return `${name}(${args.map(String).join(", ")}) -- this is an owner or listing operation that this server does not expose.`;

    default:
      // An error the contract declares but this file has no prose for. Still far
      // better than "execution reverted": the agent gets the name and numbers.
      return args.length > 0
        ? `Contract reverted with ${name}(${args.map(String).join(", ")}).`
        : `Contract reverted with ${name}().`;
  }
}

/**
 * Converts any thrown value from a viem contract call into readable text.
 *
 * The interesting path is `BaseError.walk`: viem wraps the raw RPC failure in
 * layers (call error -> execution error -> revert), and only the innermost
 * `ContractFunctionRevertedError` carries the decoded custom error. Walking to
 * it is the difference between a decoded name and a hex selector.
 */
export function explainError(error: unknown): string {
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);

    if (revert instanceof ContractFunctionRevertedError) {
      const decoded = revert.data;
      if (decoded?.errorName) {
        return describe(decoded.errorName, decoded.args ?? []);
      }
      // A plain `require("...")` string rather than a custom error.
      if (revert.reason) {
        return `Contract reverted: ${revert.reason}`;
      }
      // A selector the ABI does not cover. Surface the raw signature so it can
      // at least be looked up, instead of swallowing it.
      const raw = revert.signature ?? revert.shortMessage;
      return `Contract reverted with an unrecognised error (${raw}).`;
    }

    // Not a revert: out of gas, nonce clash, node unreachable, insufficient
    // funds. `shortMessage` is viem's one-line summary and is already decent.
    // The metaMessages carry the useful detail (e.g. the balance shortfall).
    const detail = error.metaMessages?.length ? `\n${error.metaMessages.join("\n")}` : "";
    return `${error.shortMessage}${detail}`;
  }

  if (error instanceof Error) return error.message;
  return String(error);
}

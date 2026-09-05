import { describe, expect, it } from "vitest";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { decodeContractError, requiredAmountFrom } from "./errors";

/**
 * The decoder walks a viem error chain. Building a genuine
 * ContractFunctionRevertedError needs a full simulation against a node, so
 * these tests construct the minimum shape viem's `walk` traverses and assert
 * on the OUTPUT SENTENCE — the part a user actually reads.
 */

/** A BaseError whose `walk` yields a decoded custom error, as viem's does. */
function revertWith(errorName: string, args: readonly unknown[]): BaseError {
  const reverted = Object.create(
    ContractFunctionRevertedError.prototype,
  ) as ContractFunctionRevertedError;
  Object.assign(reverted, { data: { errorName, args }, name: "ContractFunctionRevertedError" });

  const outer = new BaseError("simulation failed");
  outer.walk = ((fn?: (e: unknown) => boolean) =>
    fn && fn(reverted) ? reverted : null) as BaseError["walk"];
  return outer;
}

describe("decodeContractError", () => {
  it("always returns a sentence, for any input at all", () => {
    expect(decodeContractError(null).message).toBeTruthy();
    expect(decodeContractError(new Error("boom")).message).toBe("boom");
    expect(decodeContractError("plain string").message).toBe("plain string");
    expect(decodeContractError(undefined).message).toBeTruthy();
  });

  it("marks a plain Error as not-rejected, so it is surfaced rather than swallowed", () => {
    expect(decodeContractError(new Error("boom")).rejected).toBe(false);
  });
});

describe("custom errors become actionable sentences", () => {
  it("turns BidTooLow into the exact minimum, in ETH", () => {
    const decoded = decodeContractError(
      revertWith("BidTooLow", [2_520_000_000_000_000_000n, 2_000_000_000_000_000_000n]),
    );
    expect(decoded.name).toBe("BidTooLow");
    expect(decoded.message).toContain("2.5200 ETH");
    expect(decoded.message).toContain("2.0000 ETH");
    expect(decoded.requiredWei).toBe(2_520_000_000_000_000_000n);
    expect(decoded.rejected).toBe(false);
  });

  it("exposes the required amount so the dialog can offer it as a one-click fix", () => {
    expect(requiredAmountFrom(revertWith("BidTooLow", [42n, 1n]))).toBe(42n);
    expect(requiredAmountFrom(new Error("boom"))).toBeUndefined();
  });

  it("explains SellerCannotBid in the seller's own terms", () => {
    expect(decodeContractError(revertWith("SellerCannotBid", [])).message).toMatch(
      /cannot bid on their own item/i,
    );
  });

  it("explains AlreadyHighestBidder as self-harm rather than a failure", () => {
    expect(decodeContractError(revertWith("AlreadyHighestBidder", [])).message).toMatch(
      /already the highest bidder/i,
    );
  });

  it("says buy-now costs EXACTLY the price, since over- and under-payment both revert", () => {
    const decoded = decodeContractError(
      revertWith("IncorrectPayment", [5_000_000_000_000_000_000n, 6_000_000_000_000_000_000n]),
    );
    expect(decoded.message).toMatch(/exactly 5\.0000 ETH/i);
    expect(decoded.message).toMatch(/not more or less/i);
  });

  it("tells a bidder with no balance where refunds come from", () => {
    expect(decodeContractError(revertWith("NothingToWithdraw", [])).message).toMatch(
      /after you are outbid/i,
    );
  });

  it("turns DurationOutOfRange into human units, not seconds", () => {
    const decoded = decodeContractError(revertWith("DurationOutOfRange", [30n, 60n, 2_592_000n]));
    expect(decoded.message).toContain("1 minutes");
    expect(decoded.message).toContain("30 days");
  });

  it("explains InvalidBuyNowPrice against the actual reserve", () => {
    const decoded = decodeContractError(
      revertWith("InvalidBuyNowPrice", [1_000_000_000_000_000_000n, 2_000_000_000_000_000_000n]),
    );
    expect(decoded.message).toContain("2.0000 ETH");
    expect(decoded.message).toMatch(/or 0 to disable/i);
  });

  it("explains that a cancel is refused once a bid exists", () => {
    expect(decodeContractError(revertWith("AuctionHasBids", [])).message).toMatch(
      /no longer be cancelled/i,
    );
  });

  it("says buy-now is off rather than free when it is disabled", () => {
    expect(decodeContractError(revertWith("BuyNowDisabled", [1n])).message).toMatch(
      /no buy-now price/i,
    );
  });

  it("notes that a pause still allows withdrawal and settlement", () => {
    expect(decodeContractError(revertWith("EnforcedPause", [])).message).toMatch(
      /Withdrawals and settlement still work/i,
    );
  });

  it("never reports a contract revert as a user rejection", () => {
    // `rejected` gates whether the UI stays silent. A revert must never be
    // silent, or a failed bid vanishes with no explanation at all.
    for (const name of ["BidTooLow", "SellerCannotBid", "NothingToWithdraw", "AuctionHasBids"]) {
      expect(decodeContractError(revertWith(name, [1n, 1n])).rejected).toBe(false);
    }
  });

  it("degrades gracefully on an error name it has never seen", () => {
    const decoded = decodeContractError(revertWith("SomeFutureError", []));
    expect(decoded.message).toContain("SomeFutureError");
    expect(decoded.rejected).toBe(false);
  });
});

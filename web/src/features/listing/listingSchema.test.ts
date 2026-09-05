import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import { listingSchema, toCreateArgs, toCreateCall, toIncrementBps } from "./listingSchema";

const valid = {
  nft: "0x1234567890abcdef1234567890abcdef12345678",
  tokenId: "7",
  reservePrice: "1.5",
  buyNowPrice: "0",
  durationSeconds: 600,
};

function errorFor(input: Record<string, unknown>, path: string): string | undefined {
  const result = listingSchema.safeParse(input);
  if (result.success) return undefined;
  return result.error.issues.find((i) => i.path.join(".") === path)?.message;
}

describe("listingSchema", () => {
  it("accepts a well-formed listing", () => {
    expect(listingSchema.safeParse(valid).success).toBe(true);
  });

  describe("duration", () => {
    it("rejects anything under MIN_DURATION (1 minute)", () => {
      expect(errorFor({ ...valid, durationSeconds: 59 }, "durationSeconds")).toMatch(/shortest/i);
    });

    it("accepts exactly MIN_DURATION", () => {
      expect(listingSchema.safeParse({ ...valid, durationSeconds: 60 }).success).toBe(true);
    });

    it("accepts exactly MAX_DURATION (30 days)", () => {
      expect(listingSchema.safeParse({ ...valid, durationSeconds: 2_592_000 }).success).toBe(true);
    });

    it("rejects anything over MAX_DURATION", () => {
      expect(errorFor({ ...valid, durationSeconds: 2_592_001 }, "durationSeconds")).toMatch(
        /longest/i,
      );
    });
  });

  describe("buy-now vs reserve", () => {
    it("accepts 0, which DISABLES buy-now", () => {
      expect(
        listingSchema.safeParse({ ...valid, reservePrice: "5", buyNowPrice: "0" }).success,
      ).toBe(true);
    });

    it("accepts a buy-now strictly above the reserve", () => {
      expect(
        listingSchema.safeParse({ ...valid, reservePrice: "1.5", buyNowPrice: "1.6" }).success,
      ).toBe(true);
    });

    it("rejects a buy-now equal to the reserve", () => {
      expect(errorFor({ ...valid, reservePrice: "2", buyNowPrice: "2" }, "buyNowPrice")).toMatch(
        /higher than the reserve/i,
      );
    });

    it("rejects a buy-now below the reserve", () => {
      expect(errorFor({ ...valid, reservePrice: "2", buyNowPrice: "1" }, "buyNowPrice")).toMatch(
        /higher than the reserve/i,
      );
    });
  });

  describe("amounts", () => {
    it("rejects a non-numeric amount", () => {
      expect(errorFor({ ...valid, reservePrice: "abc" }, "reservePrice")).toMatch(
        /decimal number/i,
      );
    });

    it("rejects a negative amount", () => {
      expect(errorFor({ ...valid, reservePrice: "-1" }, "reservePrice")).toBeTruthy();
    });

    it("rejects a value that overflows uint96", () => {
      /* uint96 max is ~7.9e28 wei, i.e. ~79 billion ETH. */
      expect(errorFor({ ...valid, reservePrice: "100000000000" }, "reservePrice")).toMatch(
        /larger than this contract can store/i,
      );
    });

    it("tells the user 0 is how you disable a field, not to leave it blank", () => {
      expect(errorFor({ ...valid, buyNowPrice: "" }, "buyNowPrice")).toMatch(/Enter 0 to disable/i);
    });
  });

  describe("addresses and ids", () => {
    it("rejects a malformed contract address", () => {
      expect(errorFor({ ...valid, nft: "0x123" }, "nft")).toMatch(/40 hex characters/i);
    });

    it("rejects a non-integer token id", () => {
      expect(errorFor({ ...valid, tokenId: "1.5" }, "tokenId")).toMatch(/whole number/i);
    });
  });
});

describe("toCreateArgs", () => {
  it("produces the exact tuple createAuction expects, in wei", () => {
    const parsed = listingSchema.parse({ ...valid, reservePrice: "1.5", buyNowPrice: "2" });
    const args = toCreateArgs(parsed);
    expect(args).toEqual([
      "0x1234567890abcdef1234567890abcdef12345678",
      7n,
      1_500_000_000_000_000_000n,
      2_000_000_000_000_000_000n,
      600n,
    ]);
  });
});

describe("Dutch listings", () => {
  const dutchValid = { ...valid, format: "dutch" as const, startPrice: "10", floorPrice: "2" };

  it("accepts a falling price", () => {
    expect(listingSchema.safeParse(dutchValid).success).toBe(true);
  });

  it("accepts a flat listing where the floor equals the opening price", () => {
    /* The contract allows startPrice == floorPrice, so the form must not be
       stricter than the chain. */
    expect(
      listingSchema.safeParse({ ...dutchValid, startPrice: "3", floorPrice: "3" }).success,
    ).toBe(true);
  });

  it("rejects an opening price of zero", () => {
    /* Mirrors InvalidDutchPrices: it would be on sale for nothing immediately. */
    expect(listingSchema.safeParse({ ...dutchValid, startPrice: "0" }).success).toBe(false);
  });

  it("rejects a floor above the opening price, which would make the price rise", () => {
    expect(
      listingSchema.safeParse({ ...dutchValid, startPrice: "1", floorPrice: "5" }).success,
    ).toBe(false);
  });

  it("does not apply the English buy-now rule to a Dutch listing", () => {
    /* buyNowPrice is unused for Dutch; leaving it at its default must not
       trip the ascending-format cross-field check. */
    const parsed = listingSchema.safeParse({ ...dutchValid, reservePrice: "9", buyNowPrice: "0" });
    expect(parsed.success).toBe(true);
  });

  it("maps to createDutchAuction with start BEFORE floor", () => {
    /* The two entry points take their prices in opposite orders. Getting this
       backwards would list every item with an inverted price curve. */
    const call = toCreateCall(listingSchema.parse(dutchValid));
    expect(call.functionName).toBe("createDutchAuction");
    expect(call.args[2]).toBe(parseEther("10")); // start
    expect(call.args[3]).toBe(parseEther("2")); // floor
  });

  it("still routes an English listing to createAuction", () => {
    const call = toCreateCall(listingSchema.parse(valid));
    expect(call.functionName).toBe("createAuction");
  });
});

describe("minimum bid step", () => {
  it("defaults to the contract's own 5% and keeps the original entry point", () => {
    /* An untouched form must produce exactly the transaction this form always
       produced, against the signature the seed script and the deployed ABI
       already use. */
    const parsed = listingSchema.parse(valid);
    expect(parsed.minIncrementPercent).toBe("5");
    expect(toIncrementBps(parsed)).toBe(500);
    expect(toCreateCall(parsed).functionName).toBe("createAuction");
  });

  it("routes to createAuctionWithIncrement once the step differs", () => {
    const parsed = listingSchema.parse({ ...valid, minIncrementPercent: "20" });
    const call = toCreateCall(parsed);
    expect(call.functionName).toBe("createAuctionWithIncrement");
    expect(call.args[5]).toBe(2000);
  });

  it("converts fractional percentages to whole basis points", () => {
    expect(toIncrementBps(listingSchema.parse({ ...valid, minIncrementPercent: "2.5" }))).toBe(250);
    expect(toIncrementBps(listingSchema.parse({ ...valid, minIncrementPercent: "0.01" }))).toBe(1);
    expect(toIncrementBps(listingSchema.parse({ ...valid, minIncrementPercent: "0" }))).toBe(0);
  });

  it("accepts a zero step, which the contract floors at MIN_INCREMENT", () => {
    expect(listingSchema.safeParse({ ...valid, minIncrementPercent: "0" }).success).toBe(true);
  });

  it("rejects a step above the contract's cap", () => {
    /* Mirrors IncrementOutOfRange. 50% is the boundary and is legal. */
    expect(listingSchema.safeParse({ ...valid, minIncrementPercent: "50" }).success).toBe(true);
    expect(listingSchema.safeParse({ ...valid, minIncrementPercent: "51" }).success).toBe(false);
  });

  it("rejects values the contract could not store as whole basis points", () => {
    /* More than two decimals would round, and a seller who typed 2.555 would
       get a listing that does not match what they asked for. */
    expect(listingSchema.safeParse({ ...valid, minIncrementPercent: "2.555" }).success).toBe(false);
    expect(listingSchema.safeParse({ ...valid, minIncrementPercent: "abc" }).success).toBe(false);
    expect(listingSchema.safeParse({ ...valid, minIncrementPercent: "-5" }).success).toBe(false);
  });
});

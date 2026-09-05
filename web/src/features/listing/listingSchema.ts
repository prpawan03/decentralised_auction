import { z } from "zod";
import { parseEther, isAddress } from "viem";
import { CONTRACT_LIMITS } from "@/config/contracts";

/**
 * Client-side validation that mirrors the CONTRACT's rules, not a designer's
 * guesses. Every rule below maps to a specific custom error:
 *
 *   duration outside MIN..MAX  -> DurationOutOfRange(provided, min, max)
 *   buyNow != 0 && <= reserve  -> InvalidBuyNowPrice(buyNow, reserve)
 *   any value > uint96 max     -> ValueTooLarge(value)
 *
 * Getting this wrong in either direction is a real cost: too strict and the
 * form blocks a legal listing; too loose and the user pays gas to be told no.
 * The transaction is still simulated before signing, so this is the fast
 * feedback layer, never the only check.
 */

/** Accepts "", "0", "1.5"; rejects "1.2.3", "abc", "-1", and > uint96. */
const ethAmount = (fieldLabel: string) =>
  z
    .string()
    .trim()
    .refine((v) => v !== "", { message: `${fieldLabel} is required. Enter 0 to disable it.` })
    .refine((v) => /^\d*\.?\d*$/.test(v) && v !== ".", {
      message: `${fieldLabel} must be a decimal number of ETH, like 2.5`,
    })
    .refine(
      (v) => {
        try {
          return parseEther(v as `${number}`) <= CONTRACT_LIMITS.MAX_UINT96;
        } catch {
          return false;
        }
      },
      { message: `${fieldLabel} is larger than this contract can store.` },
    );

export const DURATION_PRESETS = [
  { label: "2 minutes", seconds: 120, note: "for a live demo" },
  { label: "10 minutes", seconds: 600 },
  { label: "1 hour", seconds: 3_600 },
  { label: "24 hours", seconds: 86_400 },
  { label: "7 days", seconds: 604_800 },
] as const;

/**
 * Which format the seller is creating.
 *
 * The two share a shape but not a vocabulary. English asks for a reserve and
 * an optional buy-now; Dutch asks for an opening price and a floor it decays
 * to. They are separate fields rather than one pair read two ways, because a
 * form that silently changes what a number means is how a seller lists an item
 * at the wrong price.
 */
export const LISTING_FORMATS = [
  {
    id: "english" as const,
    label: "English (ascending)",
    describe: "Bidders compete upward against a deadline. Anti-snipe extends the close.",
  },
  {
    id: "dutch" as const,
    label: "Dutch (descending)",
    describe: "The price starts high and falls. The first buyer to accept it wins.",
  },
];

export const listingSchema = z
  .object({
    format: z.enum(["english", "dutch"]).default("english"),
    nft: z
      .string()
      .trim()
      .refine((v) => isAddress(v), {
        message: "That is not a valid contract address. It should be 0x followed by 40 hex characters.",
      }),
    tokenId: z
      .string()
      .trim()
      .refine((v) => /^\d+$/.test(v), { message: "Token id must be a whole number." }),
    reservePrice: ethAmount("Reserve price"),
    buyNowPrice: ethAmount("Buy-now price"),
    /* Dutch only. Defaulted so an English submission never has to carry them
       and the existing English rules stay exactly as they were. */
    startPrice: ethAmount("Opening price").default("0"),
    floorPrice: ethAmount("Floor price").default("0"),
    /* English only, as a PERCENTAGE. Sellers think in percent, the contract
       stores basis points, and the conversion belongs here rather than in a
       form handler. Defaulted to the contract's own default so an untouched
       form produces exactly the listing it always did. */
    minIncrementPercent: z
      .string()
      .trim()
      .refine((v) => /^\d{1,2}(\.\d{1,2})?$/.test(v), {
        message: "Enter the bid step as a percentage, like 5 or 2.5",
      })
      .refine((v) => Number(v) * 100 <= Number(CONTRACT_LIMITS.MAX_INCREMENT_BPS), {
        message: `The largest bid step this contract accepts is ${Number(CONTRACT_LIMITS.MAX_INCREMENT_BPS) / 100}%.`,
      })
      .default(String(Number(CONTRACT_LIMITS.DEFAULT_INCREMENT_BPS) / 100)),
    durationSeconds: z
      .number({ message: "Choose how long the auction runs." })
      .int("Duration must be a whole number of seconds.")
      .min(
        Number(CONTRACT_LIMITS.MIN_DURATION),
        `The contract's shortest allowed auction is ${Number(CONTRACT_LIMITS.MIN_DURATION) / 60} minute(s).`,
      )
      .max(
        Number(CONTRACT_LIMITS.MAX_DURATION),
        `The contract's longest allowed auction is ${Number(CONTRACT_LIMITS.MAX_DURATION) / 86_400} days.`,
      ),
  })
  /* Cross-field: buy-now must exceed the reserve, or be exactly 0 to disable.
     `0` means DISABLED, never "free" — the contract is explicit about this and
     so is the message. */
  .refine(
    (data) => {
      if (data.format !== "english") return true;
      try {
        const buyNow = parseEther(data.buyNowPrice as `${number}`);
        const reserve = parseEther(data.reservePrice as `${number}`);
        return buyNow === 0n || buyNow > reserve;
      } catch {
        return false;
      }
    },
    {
      message:
        "Buy-now must be higher than the reserve, or exactly 0 to switch buy-now off. A buy-now at or below the reserve would let someone skip the auction for less than you said you would accept.",
      path: ["buyNowPrice"],
    },
  )
  /* Mirrors DutchAuction.createDutchAuction:
       startPrice == 0 || startPrice < floorPrice -> InvalidDutchPrices
     Equal prices are LEGAL — that is a flat listing at a fixed price, and the
     contract allows it, so the form must not be stricter than the chain. */
  .refine(
    (data) => {
      if (data.format !== "dutch") return true;
      try {
        return parseEther(data.startPrice as `${number}`) > 0n;
      } catch {
        return false;
      }
    },
    {
      message:
        "The opening price must be above zero. A Dutch listing that opens at 0 is on sale for nothing from its first second.",
      path: ["startPrice"],
    },
  )
  .refine(
    (data) => {
      if (data.format !== "dutch") return true;
      try {
        const start = parseEther(data.startPrice as `${number}`);
        const floor = parseEther(data.floorPrice as `${number}`);
        return start >= floor;
      } catch {
        return false;
      }
    },
    {
      message:
        "The floor cannot be above the opening price — that would make the price rise instead of fall. Set them equal for a flat price.",
      path: ["floorPrice"],
    },
  );

export type ListingInput = z.input<typeof listingSchema>;
export type ListingValues = z.output<typeof listingSchema>;

/** Turn validated strings into the exact argument tuple `createAuction` takes. */
export function toCreateArgs(values: ListingValues) {
  return [
    values.nft as `0x${string}`,
    BigInt(values.tokenId),
    parseEther(values.reservePrice as `${number}`),
    parseEther(values.buyNowPrice as `${number}`),
    BigInt(values.durationSeconds),
  ] as const;
}

/** The argument tuple `createDutchAuction` takes: start THEN floor. */
export function toDutchCreateArgs(values: ListingValues) {
  return [
    values.nft as `0x${string}`,
    BigInt(values.tokenId),
    parseEther(values.startPrice as `${number}`),
    parseEther(values.floorPrice as `${number}`),
    BigInt(values.durationSeconds),
  ] as const;
}

/**
 * The contract call for whichever format was chosen.
 *
 * The two entry points take their prices in OPPOSITE orders — `createAuction`
 * is (reserve, buyNow) ascending, `createDutchAuction` is (start, floor)
 * descending — so the mapping lives here, once, next to the schema that
 * validated them, rather than being reassembled at the call site.
 */
export function toCreateCall(values: ListingValues) {
  if (values.format === "dutch") {
    return { functionName: "createDutchAuction", args: toDutchCreateArgs(values) } as const;
  }
  /* The default step keeps the original entry point. It is the signature the
     seed script, the deployed ABI and the whole test suite already use, so a
     seller who does not touch the field produces exactly the transaction this
     form has always produced. */
  if (toIncrementBps(values) === Number(CONTRACT_LIMITS.DEFAULT_INCREMENT_BPS)) {
    return { functionName: "createAuction", args: toCreateArgs(values) } as const;
  }
  return {
    functionName: "createAuctionWithIncrement",
    args: toCreateWithIncrementArgs(values),
  } as const;
}

/** The seller's percentage as the basis points the contract stores. */
export function toIncrementBps(values: ListingValues): number {
  /* At most two decimals and at most 50, both enforced by the schema, so this
     multiplication is exact in a double and the rounding is belt-and-braces. */
  return Math.round(Number(values.minIncrementPercent) * 100);
}

/** The argument tuple `createAuctionWithIncrement` takes. */
export function toCreateWithIncrementArgs(values: ListingValues) {
  return [
    values.nft as `0x${string}`,
    BigInt(values.tokenId),
    parseEther(values.reservePrice as `${number}`),
    parseEther(values.buyNowPrice as `${number}`),
    BigInt(values.durationSeconds),
    toIncrementBps(values),
  ] as const;
}

/**
 * Reading auctions, tolerant of the two struct layouts in circulation.
 *
 * See the long note on AUCTION_TUPLE_WITH_FORMAT in abi.ts for the background:
 * the deployed bytecode and the Solidity source in this repository disagree on
 * whether `Auction` carries a trailing `Format` field, and viem's positional
 * decoder throws outright when the assumed shape is wrong. Every auction read in
 * the server goes through this module so the layout question is answered in
 * exactly one place.
 *
 * The approach is: probe once at startup, then decode manually against the
 * detected component list. `readContract` is deliberately not used for these two
 * functions because it would bind the decode to the ABI's declared outputs.
 */

import {
  decodeAbiParameters,
  encodeFunctionData,
  type Address,
  type PublicClient,
} from "viem";
import {
  auctionHouseAbi,
  AUCTION_TUPLE_BASE,
  AUCTION_TUPLE_WITH_FORMAT,
  BASE_FIELD_COUNT,
  WITH_FORMAT_FIELD_COUNT,
} from "./abi.js";

/** The normalised auction record the rest of the server works with. */
export interface AuctionRecord {
  seller: Address;
  reservePrice: bigint;
  highestBidder: Address;
  highestBid: bigint;
  nft: Address;
  buyNowPrice: bigint;
  tokenId: bigint;
  endTime: bigint;
  startTime: bigint;
  extensionCount: number;
  minIncrementBps: number;
  platformFeeBps: number;
  status: number;
  /** Only present when the deployed contract carries a Format field. */
  format?: number;
}

/** Which struct layout the deployed contract uses. */
export interface AuctionLayout {
  hasFormat: boolean;
  fieldCount: number;
}

/** The tuple component list for a detected layout. */
function componentsFor(layout: AuctionLayout) {
  return layout.hasFormat ? AUCTION_TUPLE_WITH_FORMAT : AUCTION_TUPLE_BASE;
}

/**
 * Detects the layout by counting the 32-byte words `getAuction(0)` returns.
 *
 * Every field of `Auction` is a static type, so the encoding is exactly one word
 * per field with no offsets or padding to reason about -- the word count IS the
 * field count. That makes this probe unambiguous rather than a heuristic.
 *
 * When the house holds no auctions there is nothing to probe (the call reverts
 * with AuctionNotFound), so the base layout is assumed. That is the safe
 * default: it matches the checked-in source, and the first real read after an
 * auction exists would surface any mismatch immediately rather than silently
 * returning wrong numbers.
 */
export async function detectAuctionLayout(
  client: PublicClient,
  house: Address,
): Promise<AuctionLayout> {
  let total: bigint;
  try {
    total = (await client.readContract({
      address: house,
      abi: auctionHouseAbi,
      functionName: "totalAuctions",
    })) as bigint;
  } catch {
    return { hasFormat: false, fieldCount: BASE_FIELD_COUNT };
  }

  if (total === 0n) {
    return { hasFormat: false, fieldCount: BASE_FIELD_COUNT };
  }

  const result = await client.call({
    to: house,
    data: encodeFunctionData({
      abi: auctionHouseAbi,
      functionName: "getAuction",
      args: [0n],
    }),
  });

  const hex = result.data ?? "0x";
  const words = (hex.length - 2) / 64;

  if (words === WITH_FORMAT_FIELD_COUNT) {
    return { hasFormat: true, fieldCount: WITH_FORMAT_FIELD_COUNT };
  }
  if (words === BASE_FIELD_COUNT) {
    return { hasFormat: false, fieldCount: BASE_FIELD_COUNT };
  }

  // Neither known shape. Fail loudly rather than decode garbage: a wrong guess
  // here would put a wei value into a bps field and produce plausible-looking
  // nonsense, which is worse than an error.
  throw new Error(
    `Unrecognised Auction struct layout: getAuction returned ${words} words, but this ` +
      `server understands ${BASE_FIELD_COUNT} (base) or ${WITH_FORMAT_FIELD_COUNT} ` +
      `(with Format). The deployed AuctionHouse is a version this MCP server has not been ` +
      `updated for -- update AUCTION_TUPLE_* in src/abi.ts to match.`,
  );
}

/** Normalises a decoded tuple into an AuctionRecord. */
function normalise(decoded: Record<string, unknown>, hasFormat: boolean): AuctionRecord {
  const record: AuctionRecord = {
    seller: decoded.seller as Address,
    reservePrice: decoded.reservePrice as bigint,
    highestBidder: decoded.highestBidder as Address,
    highestBid: decoded.highestBid as bigint,
    nft: decoded.nft as Address,
    buyNowPrice: decoded.buyNowPrice as bigint,
    tokenId: decoded.tokenId as bigint,
    endTime: BigInt(decoded.endTime as string | number | bigint),
    startTime: BigInt(decoded.startTime as string | number | bigint),
    extensionCount: Number(decoded.extensionCount),
    minIncrementBps: Number(decoded.minIncrementBps),
    platformFeeBps: Number(decoded.platformFeeBps),
    status: Number(decoded.status),
  };
  if (hasFormat) record.format = Number(decoded.format);
  return record;
}

/**
 * Reads one auction. Returns null when the id does not exist.
 *
 * The contract reverts `AuctionNotFound` for an out-of-range id, and every
 * caller wants that as "no such auction" rather than as an exception.
 */
export async function readAuction(
  client: PublicClient,
  house: Address,
  layout: AuctionLayout,
  id: bigint,
): Promise<AuctionRecord | null> {
  let data: `0x${string}` | undefined;
  try {
    const result = await client.call({
      to: house,
      data: encodeFunctionData({
        abi: auctionHouseAbi,
        functionName: "getAuction",
        args: [id],
      }),
    });
    data = result.data;
  } catch {
    return null;
  }

  if (data === undefined || data === "0x") return null;

  const [tuple] = decodeAbiParameters(
    [{ type: "tuple", components: componentsFor(layout) }] as const,
    data,
  );

  return normalise(tuple as unknown as Record<string, unknown>, layout.hasFormat);
}

/**
 * Reads a page of auctions starting at `offset`.
 *
 * `limit` is clamped by the contract to its MAX_PAGE_SIZE (100), so asking for
 * more is safe and simply returns fewer.
 */
export async function readAuctionPage(
  client: PublicClient,
  house: Address,
  layout: AuctionLayout,
  offset: bigint,
  limit: bigint,
): Promise<AuctionRecord[]> {
  const result = await client.call({
    to: house,
    data: encodeFunctionData({
      abi: auctionHouseAbi,
      functionName: "getAuctions",
      args: [offset, limit],
    }),
  });

  const data = result.data;
  if (data === undefined || data === "0x") return [];

  const [page] = decodeAbiParameters(
    [{ type: "tuple[]", components: componentsFor(layout) }] as const,
    data,
  );

  return (page as unknown as Record<string, unknown>[]).map((entry) =>
    normalise(entry, layout.hasFormat),
  );
}

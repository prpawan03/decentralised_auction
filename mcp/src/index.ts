#!/usr/bin/env node
/**
 * An MCP server that lets an AI agent browse and bid on the local NFT auction
 * house.
 *
 * ---------------------------------------------------------------------------
 * TRANSPORT: STDIO, not HTTP.
 * ---------------------------------------------------------------------------
 * The server speaks JSON-RPC over stdin/stdout and the client owns its
 * lifecycle. That choice removes an entire category of work and risk:
 *
 *   - No listening port, so nothing to firewall and nothing for another process
 *     on the box to connect to. The trust boundary is the process boundary.
 *   - No CORS policy, no Origin validation, no DNS-rebinding defence -- all of
 *     which a local HTTP MCP server genuinely needs and frequently gets wrong.
 *   - No nginx buffering/timeout tuning for a long-lived SSE stream, which this
 *     project's reverse proxy would otherwise need.
 *   - It is what Claude Desktop and Claude Code launch natively: a command and
 *     an argv, with no separate service to start first.
 *
 * The old HTTP+SSE transport is deprecated in the current spec, so building on
 * it would mean starting on a migration path. Streamable HTTP is the right
 * answer for a REMOTE, multi-tenant server; this one is single-user and local,
 * and stdio is strictly simpler for that shape.
 *
 * Because stdout IS the protocol channel, nothing may ever be printed to it.
 * Every diagnostic in this file goes to stderr. A stray `console.log` would
 * inject a non-JSON-RPC line into the stream and desynchronise the client.
 *
 * ---------------------------------------------------------------------------
 * SAFETY MODEL
 * ---------------------------------------------------------------------------
 * The MCP specification states that tool annotations (`readOnlyHint`,
 * `destructiveHint`, ...) are UNTRUSTED HINTS: a client may display them and
 * use them to decide when to ask a human, but they carry no authority and a
 * server can declare anything it likes. They are therefore documentation here,
 * not enforcement. The actual boundaries are:
 *
 *   1. CHAIN ID GATE (config.ts). The process refuses to finish starting unless
 *      the connected node reports chain 31337. Not configurable.
 *   2. SPEND CAP (this file, `assertWithinCap`). A hard server-side wei ceiling
 *      on every value-bearing call, checked in the handler before signing.
 *   3. NO GENERIC EXECUTION. There is no tool that takes calldata, an arbitrary
 *      address, a raw transaction, or a message to sign. `eth_sendTransaction`,
 *      `eth_sign` and `personal_sign` are not reachable through any tool. The
 *      only functions this process can encode are the ones in abi.ts.
 *   4. NON-OWNER KEY (config.ts). The signer defaults to Hardhat account #1,
 *      never the deployer/owner #0, and setting it to #0 is rejected outright.
 *
 * Each of those holds no matter what text reaches the model.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { formatEther, parseAbiItem, parseEther, type Address } from "viem";

import {
  auctionHouseAbi,
  erc721Abi,
  AUCTION_STATUS,
  AUCTION_FORMAT,
  type AuctionStatus,
} from "./abi.js";
import { readAuction, readAuctionPage, type AuctionRecord } from "./auctions.js";
import {
  loadConfig,
  assertLocalChain,
  StartupError,
  localChain,
  type ServerConfig,
} from "./config.js";
import { explainError, eth } from "./errors.js";
import { decodeTokenUri } from "./metadata.js";
import * as indexer from "./indexer.js";

const SERVER_NAME = "auction-house";
const SERVER_VERSION = "1.0.0";

/** The `BidPlaced` event, for the RPC log-scan fallback in get_bid_history. */
const bidPlacedEvent = parseAbiItem(
  "event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint96 amount, address previousBidder, uint96 previousAmount, uint64 endTime)",
);

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

/** A successful tool result carrying pretty-printed JSON. */
function ok(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, bigintReplacer, 2) }],
  };
}

/**
 * A failed tool result.
 *
 * `isError: true` rather than a thrown exception: a protocol-level error tells
 * the client the CALL failed, whereas an error result tells the MODEL the
 * operation failed and hands it text to reason about. For "your bid was too
 * low", the model is the one that needs to know.
 */
function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/**
 * `JSON.stringify` throws on bigint, and nearly every value here is one. Wei
 * amounts are serialised as decimal STRINGS rather than numbers because a
 * uint96 exceeds the exact-integer range of a float64 at ~9e15 wei (0.009 ETH),
 * so a JSON number would silently round real bid values.
 */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/** Renders a wei amount in both forms, so the model never has to convert. */
function money(wei: bigint) {
  return { wei: wei.toString(), eth: formatEther(wei) };
}

/** Formats a Unix second as ISO-8601. */
function iso(unixSeconds: bigint): string {
  return new Date(Number(unixSeconds) * 1000).toISOString();
}

/** Renders a duration in seconds as a compact human string. */
function humanDuration(seconds: bigint): string {
  if (seconds <= 0n) return "ended";
  const s = Number(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!d && !h) parts.push(`${s % 60}s`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

/**
 * The normalised auction record. Decoding lives in auctions.ts because the
 * deployed struct layout varies -- see the note there.
 */
type AuctionTuple = AuctionRecord;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Turns a raw auction tuple into the view an agent should reason about.
 *
 * The derived fields matter more than the raw ones. `youAreTheSeller` and
 * `youAreTheHighestBidder` are the two facts that determine whether a bid can
 * possibly succeed, and computing them here means every tool that returns an
 * auction carries them -- the model does not have to remember its own address
 * and compare strings, which is exactly the kind of step it skips.
 */
function viewAuction(auction: AuctionTuple, id: bigint, self: Address, now: bigint) {
  const status = AUCTION_STATUS[auction.status] ?? `unknown(${auction.status})`;
  const isLive = status === "Live" && now < auction.endTime;
  const hasBids = auction.highestBidder !== ZERO_ADDRESS;
  const secondsLeft = isLive ? auction.endTime - now : 0n;

  // Mirrors `_minimumBid` in AuctionHouse.sol. Recomputed locally rather than
  // called per-auction so a 100-item listing costs one multicall, not 100 RPCs.
  // Any single-auction tool reads the on-chain `minimumBid` instead.
  const MIN_INCREMENT = parseEther("0.0001");
  let minimumBid: bigint;
  if (auction.highestBid === 0n) {
    minimumBid = MIN_INCREMENT;
  } else {
    let step = (auction.highestBid * BigInt(auction.minIncrementBps)) / 10_000n;
    if (step < MIN_INCREMENT) step = MIN_INCREMENT;
    minimumBid = auction.highestBid + step;
  }

  const isSeller = auction.seller.toLowerCase() === self.toLowerCase();
  const isLeader = hasBids && auction.highestBidder.toLowerCase() === self.toLowerCase();

  // Format drives which operations are even legal. On the extended contract a
  // Dutch auction rejects `bid` and `minimumBid` outright with WrongFormat, so
  // the minimum-bid figure computed above is meaningless there and is reported
  // as null rather than as a number the agent might act on.
  const isDutch = auction.format !== undefined && AUCTION_FORMAT[auction.format] === "Dutch";

  return {
    auctionId: id.toString(),
    status,
    isLive,
    // Only present on contracts that carry a Format field. Reported as null
    // rather than defaulted to "English", so the model can tell "this house has
    // one format" apart from "this auction happens to be English".
    format:
      auction.format === undefined
        ? null
        : (AUCTION_FORMAT[auction.format] ?? `unknown(${auction.format})`),
    seller: auction.seller,
    nft: auction.nft,
    tokenId: auction.tokenId.toString(),

    isDutch,
    // For a Dutch auction the price DESCENDS from a start price toward the
    // reserve and the first taker wins; there is no bidding and no increment.
    howToBuy: isDutch
      ? "Dutch auction: the price falls over time and the first buyer takes it. Use buy_now (bidding is rejected with WrongFormat). The price to pay is `currentPrice`."
      : "English auction: use simulate_bid then place_bid. buy_now works only if a buy-now price is set and bidding has not reached it.",

    highestBidder: hasBids ? auction.highestBidder : null,
    highestBid: money(auction.highestBid),
    minimumBid: isDutch ? null : money(minimumBid),
    reservePrice: money(auction.reservePrice),
    // The reserve is NOT a bid floor: below-reserve bids are accepted and
    // refunded in full at settlement. Stating it inline stops an agent from
    // treating the reserve as the minimum and overbidding to clear it.
    reserveMet: hasBids && auction.highestBid >= auction.reservePrice,
    buyNowPrice: auction.buyNowPrice === 0n ? null : money(auction.buyNowPrice),
    // Liveness is part of availability: a settled auction still carries its
    // buy-now price in storage, and reporting that as "available" would send
    // the agent into an AuctionNotLive revert. For Dutch, the price to pay is
    // `currentPrice`, not this field -- `buyNowPrice` there is the START price.
    buyNowAvailable:
      isLive &&
      (isDutch || (auction.buyNowPrice !== 0n && auction.highestBid < auction.buyNowPrice)),

    startTime: iso(auction.startTime),
    endTime: iso(auction.endTime),
    secondsRemaining: secondsLeft.toString(),
    timeRemaining: humanDuration(secondsLeft),
    // A bid inside the last 5 minutes pushes endTime out, up to 20 times. An
    // agent planning a last-second snipe needs to know it will not work.
    antiSnipeExtensionsUsed: auction.extensionCount,

    minIncrementBps: auction.minIncrementBps,
    platformFeeBps: auction.platformFeeBps,

    // --- Facts about the CONNECTED account -------------------------------
    youAreTheSeller: isSeller,
    youAreTheHighestBidder: isLeader,
    canYouBid: isLive && !isSeller && !isLeader && !isDutch,
    whyYouCannotBid: !isLive
      ? `The auction is not live (status: ${status}).`
      : isDutch
        ? "This is a Dutch auction; it takes no bids. Use buy_now to take it at the current price."
        : isSeller
          ? "You are the seller; a seller may not bid on their own listing."
          : isLeader
            ? "You already hold the leading bid; bidding against yourself is rejected."
            : null,
    canYouBuyNow:
      isLive &&
      !isSeller &&
      (isDutch || (auction.buyNowPrice !== 0n && auction.highestBid < auction.buyNowPrice)),

    settleable: status === "Live" && now >= auction.endTime,
  };
}

/** Reads one auction, or returns null when the id does not exist. */
async function fetchAuction(config: ServerConfig, id: bigint): Promise<AuctionTuple | null> {
  return readAuction(config.publicClient, config.deployment.auctionHouse, config.layout, id);
}

/**
 * The price to pay right now for a Dutch auction, or null if unavailable.
 *
 * Returns null rather than throwing, because a contract without the Format
 * extension has no `currentPrice` at all and every caller treats "no Dutch
 * price" as a normal state rather than an error.
 */
async function fetchCurrentPrice(config: ServerConfig, id: bigint): Promise<bigint | null> {
  try {
    return (await config.publicClient.readContract({
      address: config.deployment.auctionHouse,
      abi: auctionHouseAbi,
      functionName: "currentPrice",
      args: [id],
    })) as bigint;
  } catch {
    return null;
  }
}

/** The current chain time. Auctions are timed by block timestamp, not wall clock. */
async function chainNow(config: ServerConfig): Promise<bigint> {
  const block = await config.publicClient.getBlock();
  return block.timestamp;
}

// ---------------------------------------------------------------------------
// SAFETY: the spend cap
// ---------------------------------------------------------------------------

/**
 * Enforces MAX_BID_WEI. Returns an error message, or null when the value is
 * acceptable.
 *
 * Called in EVERY handler that attaches value to a transaction, before any
 * simulation or signing. It is a plain function rather than middleware so the
 * check is visible at each call site -- a cap that lives in a wrapper is a cap
 * someone eventually forgets to wrap with.
 */
function assertWithinCap(config: ServerConfig, valueWei: bigint): string | null {
  if (valueWei > config.maxBidWei) {
    return (
      `REFUSED by the spend cap: ${eth(valueWei)} exceeds this server's per-transaction ` +
      `limit of ${eth(config.maxBidWei)}.\n\n` +
      `This cap is enforced server-side and cannot be raised by any tool call. It exists ` +
      `to bound the cost of a mistake or an injected instruction. If a human genuinely ` +
      `wants a larger bid, they must restart the server with a higher ` +
      `AUCTION_MCP_MAX_BID_WEI.`
    );
  }
  if (valueWei <= 0n) {
    return "The amount must be greater than zero.";
  }
  return null;
}

/**
 * Parses an amount given either as ETH ("1.5") or as raw wei.
 *
 * Both are accepted because models produce both, and guessing between them from
 * magnitude alone would be a great way to send 10^18 times too much. The unit is
 * an explicit field with no default beyond "eth", and the resolved value is
 * echoed in every response so a unit mistake is visible immediately.
 */
function toWei(amount: string, unit: "eth" | "wei"): bigint {
  if (unit === "wei") {
    const parsed = BigInt(amount);
    return parsed;
  }
  return parseEther(amount as `${number}`);
}

// ---------------------------------------------------------------------------
// Server construction
// ---------------------------------------------------------------------------

/**
 * Registers every tool onto a fresh `McpServer`.
 *
 * Built as a factory because `serveStdio` takes one: it constructs an instance
 * per connection and pins it for that connection's lifetime, which is how the
 * SDK serves the current and the 2025-era protocol revisions from the same
 * registration code.
 */
function buildServer(config: ServerConfig): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  const house = config.deployment.auctionHouse;
  const self = config.account.address;

  // =========================================================================
  // READ TOOLS
  // =========================================================================

  server.registerTool(
    "list_auctions",
    {
      title: "List auctions",
      description:
        "Browse the auction house. Returns a page of auctions with prices, deadlines, and " +
        "whether the connected account is able to bid on each one. Filter by status to find " +
        "what is worth acting on: 'Live' for things you can bid on now, 'settleable' for " +
        "auctions whose time has expired but which nobody has closed yet (anyone may settle " +
        "one, and doing so releases the NFT and the money).",
      inputSchema: z.object({
        status: z
          .enum([
            "Live",
            "Settled",
            "Cancelled",
            "ReserveNotMet",
            "DeliveryFailed",
            "settleable",
            "any",
          ])
          .default("Live")
          .describe(
            "Lifecycle filter. 'settleable' is a derived filter: Live auctions past their end time.",
          ),
        format: z
          .enum(["English", "Dutch", "any"])
          .default("any")
          .describe(
            "Auction format. Only meaningful when the deployed contract exposes a Format field; " +
              "when it does not, any value other than 'any' returns nothing and the response says so.",
          ),
        cursor: z
          .string()
          .optional()
          .describe("Auction id to resume from, taken from a previous call's nextCursor."),
        limit: z.number().int().min(1).max(100).default(25).describe("Maximum auctions to return."),
      }),
      annotations: {
        // HINTS ONLY. See the safety note at the top of this file: the client
        // may use these to decide whether to prompt a human, but they are not a
        // security boundary and this server does not rely on them.
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ status, format, cursor, limit }) => {
      try {
        const total = (await config.publicClient.readContract({
          address: house,
          abi: auctionHouseAbi,
          functionName: "totalAuctions",
        })) as bigint;

        if (total === 0n) {
          return ok({ total: 0, auctions: [], note: "No auctions have been created yet." });
        }

        const now = await chainNow(config);
        const start = cursor !== undefined ? BigInt(cursor) : 0n;

        // Scan forward in contract-sized pages, filtering as we go. The filter
        // is applied client-side because the contract has no filtered read; the
        // cursor is an AUCTION ID rather than an index into the filtered set, so
        // paging stays correct even as auctions change status between calls.
        const PAGE = 100n;
        const results: ReturnType<typeof viewAuction>[] = [];
        let offset = start;
        let nextCursor: string | null = null;

        while (offset < total && results.length < limit) {
          const page = await readAuctionPage(
            config.publicClient,
            house,
            config.layout,
            offset,
            PAGE,
          );

          if (page.length === 0) break;

          for (let i = 0; i < page.length; i++) {
            const id = offset + BigInt(i);
            const view = viewAuction(page[i]!, id, self, now);

            const matches =
              status === "any"
                ? true
                : status === "settleable"
                  ? view.settleable
                  : status === "Live"
                    ? // "Live" means actually biddable. An auction whose clock has
                      // run out still carries status Live on chain until someone
                      // settles it, and offering it as biddable would send the
                      // agent straight into an AuctionAlreadyEnded revert.
                      view.isLive
                    : view.status === (status as AuctionStatus);

            if (!matches) continue;

            // The format filter is applied on top of the status filter. When the
            // deployed contract has no Format field every auction reports null,
            // so an explicit format request correctly matches nothing.
            if (format !== "any" && view.format !== format) continue;

            if (results.length === limit) {
              nextCursor = id.toString();
              break;
            }
            results.push(view);
          }

          if (nextCursor !== null) break;
          offset += BigInt(page.length);
        }

        // Dutch entries carry no meaningful minimum bid, so without the live
        // ask they would list with no price at all. Fetched only for the Dutch
        // rows actually being returned (at most `limit`), in parallel, so a
        // page of English auctions costs no extra round trips.
        const dutchRows = results.filter((row) => row.isDutch);
        if (dutchRows.length > 0) {
          const prices = await Promise.all(
            dutchRows.map((row) => fetchCurrentPrice(config, BigInt(row.auctionId))),
          );
          dutchRows.forEach((row, index) => {
            // `prices[index]` is `bigint | null | undefined` under
            // noUncheckedIndexedAccess; the arrays are the same length by
            // construction, so undefined is unreachable, but it is narrowed
            // rather than asserted away.
            const price = prices[index];
            (row as Record<string, unknown>).currentPrice =
              price === null || price === undefined ? null : money(price);
          });
        }

        return ok({
          total: total.toString(),
          filter: { status, format },
          returned: results.length,
          nextCursor,
          connectedAccount: self,
          auctions: results,
          // Said out loud because the two formats need DIFFERENT tools, and an
          // agent that assumes everything is biddable will burn calls on
          // WrongFormat reverts. Each entry also carries `howToBuy`.
          note: config.layout.hasFormat
            ? "This AuctionHouse exposes a Format field (English or Dutch). English auctions ascend with an optional buy-now price and a 5-minute anti-snipe extension."
            : "The deployed AuctionHouse has no Format field: every auction is English (ascending) with an optional buy-now price. Filtering by format will match nothing.",
        });
      } catch (error) {
        return fail(explainError(error));
      }
    },
  );

  server.registerTool(
    "get_auction",
    {
      title: "Get auction detail",
      description:
        "Full detail for one auction, including the exact minimum next bid read from the " +
        "contract, the escrowed amount, and whether the connected account is allowed to bid. " +
        "Read this before bidding: the minimum rises with every accepted bid.",
      inputSchema: z.object({
        auctionId: z.string().describe("The auction id, as a decimal string."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ auctionId }) => {
      try {
        const id = BigInt(auctionId);
        const auction = await fetchAuction(config, id);
        if (auction === null) {
          return fail(`Auction ${id} does not exist. Call list_auctions to see the valid ids.`);
        }

        const now = await chainNow(config);
        const preview = viewAuction(auction, id, self, now);

        // The authoritative minimum and escrow come from the contract here,
        // rather than the local recomputation used for list pages.
        //
        // `minimumBid` is skipped entirely for a Dutch auction: it reverts with
        // WrongFormat there, and a rejected promise inside this Promise.all
        // would fail the whole tool call for an auction that is otherwise
        // perfectly readable.
        const [minimum, escrow, remaining, paused, dutchPrice] = await Promise.all([
          preview.isDutch
            ? Promise.resolve(null)
            : (config.publicClient.readContract({
                address: house,
                abi: auctionHouseAbi,
                functionName: "minimumBid",
                args: [id],
              }) as Promise<bigint>),
          config.publicClient.readContract({
            address: house,
            abi: auctionHouseAbi,
            functionName: "escrowOf",
            args: [id],
          }) as Promise<bigint>,
          config.publicClient.readContract({
            address: house,
            abi: auctionHouseAbi,
            functionName: "timeRemaining",
            args: [id],
          }) as Promise<bigint>,
          config.publicClient.readContract({
            address: house,
            abi: auctionHouseAbi,
            functionName: "paused",
          }) as Promise<boolean>,
          preview.isDutch ? fetchCurrentPrice(config, id) : Promise.resolve(null),
        ]);

        return ok({
          ...preview,
          minimumBid: minimum === null ? null : money(minimum),
          // The live Dutch ask. It falls every second, so it is a quote, not a
          // fixed price -- buy_now re-reads it immediately before sending.
          currentPrice: dutchPrice === null ? null : money(dutchPrice),
          currentPriceNote: preview.isDutch
            ? "This price DECLINES every second toward the reserve. buy_now pays at least this much and accepts an overpayment, so a slightly stale quote still succeeds."
            : null,
          secondsRemaining: remaining.toString(),
          timeRemaining: humanDuration(remaining),
          escrowHeld: money(escrow),
          houseIsPaused: paused,
          spendCap: money(config.maxBidWei),
          connectedAccount: self,
        });
      } catch (error) {
        return fail(explainError(error));
      }
    },
  );

  server.registerTool(
    "get_bid_history",
    {
      title: "Get bid history",
      description:
        "The bid history for one auction, newest first. Uses the Ponder indexer when it is " +
        "running (which supplies block timestamps directly) and falls back to scanning chain " +
        "logs when it is not. The response states which source was used.",
      inputSchema: z.object({
        auctionId: z.string().describe("The auction id, as a decimal string."),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ auctionId, limit }) => {
      try {
        const id = BigInt(auctionId);

        const indexed = await indexer.bidHistory(config.indexerUrl, id, limit);
        if (indexed.ok && indexed.data) {
          return ok({
            auctionId: auctionId,
            source: "indexer",
            count: indexed.data.length,
            bids: indexed.data.map((bid) => ({
              bidder: bid.bidder,
              amount: money(BigInt(bid.amount)),
              timestamp: iso(BigInt(bid.timestamp)),
              blockNumber: bid.blockNumber,
              transactionHash: bid.transactionHash,
              isYou: bid.bidder.toLowerCase() === self.toLowerCase(),
            })),
          });
        }

        // Fallback: scan BidPlaced logs. Bounded below by the deployment block
        // so this never walks the chain from genesis.
        const logs = await config.publicClient.getLogs({
          address: house,
          event: bidPlacedEvent,
          args: { auctionId: id },
          fromBlock: config.deployment.blockNumber,
          toBlock: "latest",
        });

        // Timestamps are not in a log, so they cost one block read each. De-dupe
        // by block number: a busy auction has many bids across few blocks.
        const blockNumbers = [...new Set(logs.map((log) => log.blockNumber))];
        const blocks = await Promise.all(
          blockNumbers.map((blockNumber) => config.publicClient.getBlock({ blockNumber })),
        );
        const timestampOf = new Map(blocks.map((b) => [b.number, b.timestamp]));

        const bids = logs
          .slice()
          .reverse()
          .slice(0, limit)
          .map((log) => {
            const timestamp = timestampOf.get(log.blockNumber);
            return {
              bidder: log.args.bidder,
              amount: money(log.args.amount ?? 0n),
              previousBidder:
                log.args.previousBidder === ZERO_ADDRESS ? null : log.args.previousBidder,
              timestamp: timestamp !== undefined ? iso(timestamp) : null,
              blockNumber: log.blockNumber.toString(),
              transactionHash: log.transactionHash,
              isYou: (log.args.bidder ?? "").toLowerCase() === self.toLowerCase(),
            };
          });

        return ok({
          auctionId,
          source: "rpc-logs",
          sourceNote: indexed.reason,
          count: bids.length,
          bids,
        });
      } catch (error) {
        return fail(explainError(error));
      }
    },
  );

  server.registerTool(
    "get_nft_metadata",
    {
      title: "Get NFT metadata",
      description:
        "Reads an ERC-721 token's metadata: collection name and symbol, current owner, and the " +
        "decoded tokenURI. Inline data: URIs (both base64 and utf8 forms) are decoded and " +
        "returned as JSON. ipfs: and http: URIs are resolved to a URL but NOT fetched -- this " +
        "server makes no outbound requests for seller-supplied URIs.",
      inputSchema: z.object({
        tokenId: z.string().describe("The token id, as a decimal string."),
        contract: z
          .string()
          .optional()
          .describe(
            "ERC-721 contract address. Defaults to the demo NFT collection from the deployment record.",
          ),
        auctionId: z
          .string()
          .optional()
          .describe(
            "Alternative to tokenId/contract: read the NFT escrowed by this auction instead.",
          ),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ tokenId, contract, auctionId }) => {
      try {
        let nftAddress: Address | undefined;
        let id: bigint;

        if (auctionId !== undefined) {
          const auction = await fetchAuction(config, BigInt(auctionId));
          if (auction === null) return fail(`Auction ${auctionId} does not exist.`);
          nftAddress = auction.nft;
          id = auction.tokenId;
        } else {
          nftAddress = (contract as Address | undefined) ?? config.deployment.demoNft;
          id = BigInt(tokenId);
        }

        if (nftAddress === undefined) {
          return fail(
            "No NFT contract to read. Pass `contract`, pass `auctionId`, or set DEMO_NFT_ADDRESS " +
              "so the demo collection can be resolved.",
          );
        }

        // `allowFailure` keeps a collection that omits an optional ERC-721
        // Metadata method (name/symbol are optional) from failing the whole read.
        const [name, symbol, owner, uri] = await Promise.all([
          config.publicClient
            .readContract({ address: nftAddress, abi: erc721Abi, functionName: "name" })
            .catch(() => null),
          config.publicClient
            .readContract({ address: nftAddress, abi: erc721Abi, functionName: "symbol" })
            .catch(() => null),
          config.publicClient
            .readContract({
              address: nftAddress,
              abi: erc721Abi,
              functionName: "ownerOf",
              args: [id],
            })
            .catch(() => null),
          config.publicClient
            .readContract({
              address: nftAddress,
              abi: erc721Abi,
              functionName: "tokenURI",
              args: [id],
            })
            .catch(() => null),
        ]);

        if (uri === null && owner === null) {
          return fail(
            `Token ${id} does not exist on ${nftAddress}, or that address is not an ERC-721 contract.`,
          );
        }

        return ok({
          contract: nftAddress,
          tokenId: id.toString(),
          collectionName: name,
          collectionSymbol: symbol,
          owner,
          // While an auction is live the auction house holds the token in
          // escrow, so `owner` being the house is expected, not a red flag.
          ownerIsAuctionHouse:
            typeof owner === "string" && owner.toLowerCase() === house.toLowerCase(),
          ...(uri === null
            ? { note: "The contract did not return a tokenURI." }
            : decodeTokenUri(uri as string)),
        });
      } catch (error) {
        return fail(explainError(error));
      }
    },
  );

  server.registerTool(
    "get_wallet_status",
    {
      title: "Get wallet status",
      description:
        "The connected account's on-chain ETH balance, its pending (withdrawable) balance held " +
        "by the auction house, and the server's spend cap. Pending balance accumulates when you " +
        "are outbid or when an auction ends below its reserve -- the house never pushes ETH, so " +
        "it sits there until withdraw is called.",
      inputSchema: z.object({
        address: z
          .string()
          .optional()
          .describe("Address to inspect. Defaults to the connected account."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ address }) => {
      try {
        const target = ((address as Address | undefined) ?? self) as Address;

        const [balance, pending, paused] = await Promise.all([
          config.publicClient.getBalance({ address: target }),
          config.publicClient.readContract({
            address: house,
            abi: auctionHouseAbi,
            functionName: "pendingReturns",
            args: [target],
          }) as Promise<bigint>,
          config.publicClient.readContract({
            address: house,
            abi: auctionHouseAbi,
            functionName: "paused",
          }) as Promise<boolean>,
        ]);

        return ok({
          address: target,
          isConnectedAccount: target.toLowerCase() === self.toLowerCase(),
          walletBalance: money(balance),
          pendingReturns: money(pending),
          canWithdraw: pending > 0n,
          totalControlled: money(balance + pending),
          spendCapPerTransaction: money(config.maxBidWei),
          chainId: localChain.id,
          auctionHouse: house,
          houseIsPaused: paused,
        });
      } catch (error) {
        return fail(explainError(error));
      }
    },
  );

  server.registerTool(
    "get_leaderboard",
    {
      title: "Get leaderboard",
      description:
        "Top bidders or sellers by volume. This requires the Ponder indexer, which maintains " +
        "running totals that the contract does not store and that cannot be derived from a " +
        "single chain read. When the indexer is not running this returns a clear explanation " +
        "rather than a fabricated ranking.",
      inputSchema: z.object({
        board: z.enum(["bidders", "sellers"]).default("bidders"),
        limit: z.number().int().min(1).max(50).default(10),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ board, limit }) => {
      try {
        if (board === "bidders") {
          const result = await indexer.topBidders(config.indexerUrl, limit);
          if (!result.ok) {
            // Deliberately an error result, not an empty list. An empty
            // leaderboard is indistinguishable from "nobody has bid", and a
            // model shown that will confidently report there are no bidders.
            return fail(
              `Leaderboard unavailable. ${result.reason}\n\n` +
                `Lifetime totals (total spent, auctions won, bids placed) are maintained by the ` +
                `indexer and are not stored on chain, so there is no RPC fallback for this ranking. ` +
                `Start it with \`make indexer\` from the repo root, or use get_bid_history for ` +
                `per-auction activity, which does work over RPC.`,
            );
          }
          return ok({
            board: "bidders",
            source: "indexer",
            entries: result.data!.map((row, index) => ({
              rank: index + 1,
              address: row.id,
              isYou: row.id.toLowerCase() === self.toLowerCase(),
              totalSpent: money(BigInt(row.totalSpent)),
              totalBidVolume: money(BigInt(row.totalBidVolume)),
              highestBid: money(BigInt(row.highestBid)),
              bidsPlaced: row.bidsPlaced,
              auctionsEntered: row.auctionsEntered,
              auctionsWon: row.auctionsWon,
              lateBids: row.lateBids,
            })),
          });
        }

        const result = await indexer.topSellers(config.indexerUrl, limit);
        if (!result.ok) {
          return fail(
            `Leaderboard unavailable. ${result.reason}\n\n` +
              `Start the indexer with \`make indexer\` from the repo root.`,
          );
        }
        return ok({
          board: "sellers",
          source: "indexer",
          entries: result.data!.map((row, index) => ({
            rank: index + 1,
            address: row.id,
            isYou: row.id.toLowerCase() === self.toLowerCase(),
            grossVolume: money(BigInt(row.grossVolume)),
            netVolume: money(BigInt(row.netVolume)),
            feesPaid: money(BigInt(row.feesPaid)),
            listed: row.listed,
            sold: row.sold,
            sellThroughRate: row.sellThroughRate,
          })),
        });
      } catch (error) {
        return fail(explainError(error));
      }
    },
  );

  // =========================================================================
  // WRITE TOOLS
  // =========================================================================

  server.registerTool(
    "simulate_bid",
    {
      title: "Simulate a bid (dry run)",
      description:
        "DRY RUN a bid without spending anything. Call this BEFORE place_bid, always. It runs " +
        "the bid against the current chain state via eth_call: nothing is signed, no gas is " +
        "burned, and no state changes. If the bid would fail you get the exact reason with the " +
        "numbers filled in (for example the precise minimum you need to beat), so the next " +
        "attempt can be correct instead of a guess.",
      inputSchema: z.object({
        auctionId: z.string().describe("The auction id, as a decimal string."),
        amount: z.string().describe("Amount to bid, e.g. '1.5'."),
        unit: z.enum(["eth", "wei"]).default("eth").describe("Unit for `amount`."),
      }),
      annotations: {
        // A simulation changes nothing, so it is genuinely read-only. Again: a
        // hint. The reason this call is safe is that it goes to eth_call and no
        // signing key is used, not that this flag says so.
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ auctionId, amount, unit }) => {
      try {
        const id = BigInt(auctionId);
        const value = toWei(amount, unit);

        // The cap is checked even for a simulation. A simulation that succeeds
        // for an amount the server would then refuse to send is a trap: the
        // model would report a plan it cannot execute.
        const capError = assertWithinCap(config, value);
        if (capError !== null) return fail(capError);

        const auction = await fetchAuction(config, id);
        if (auction === null) {
          return fail(`Auction ${id} does not exist. Call list_auctions to see the valid ids.`);
        }

        const now = await chainNow(config);
        const view = viewAuction(auction, id, self, now);

        // A Dutch auction rejects `bid` outright. Caught before the simulation
        // so the agent is redirected to the operation that CAN work, rather
        // than being told only that its call was invalid.
        if (view.isDutch) {
          const price = await fetchCurrentPrice(config, id);
          return fail(
            `Auction ${id} is a DUTCH auction and does not accept bids -- calling bid() reverts ` +
              `with WrongFormat.\n\n` +
              `In a Dutch auction the price starts high and falls over time, and the first buyer ` +
              `to accept it wins.` +
              (price === null
                ? ""
                : ` The current price is ${eth(price)}, and it keeps falling toward the reserve of ` +
                  `${eth(auction.reservePrice)}.`) +
              `\n\nUse buy_now on this auction to take it at the current price.`,
          );
        }

        // Pre-flight the two conditions that are cheap to check and confusing
        // when they surface as a revert. AlreadyHighestBidder in particular
        // reads like a failure when it actually means "you are winning".
        if (view.youAreTheHighestBidder) {
          return fail(
            `You already hold the leading bid on auction ${id} at ${view.highestBid.eth} ETH. ` +
              `The contract rejects a bid from the current leader (AlreadyHighestBidder), so ` +
              `this bid would revert.\n\n` +
              `Nothing needs doing: you are winning. The auction closes at ${view.endTime} ` +
              `(${view.timeRemaining} remaining). Once it ends, call settle_auction to close it out.`,
          );
        }
        if (view.youAreTheSeller) {
          return fail(
            `You are the seller of auction ${id}. A seller may not bid on their own listing ` +
              `(SellerCannotBid). This will never succeed -- choose a different auction.`,
          );
        }

        const balance = await config.publicClient.getBalance({ address: self });

        try {
          await config.publicClient.simulateContract({
            address: house,
            abi: auctionHouseAbi,
            functionName: "bid",
            args: [id],
            value,
            account: config.account,
          });
        } catch (error) {
          return ok({
            wouldSucceed: false,
            auctionId,
            bidAmount: money(value),
            reason: explainError(error),
            currentMinimumBid: view.minimumBid,
            currentHighestBid: view.highestBid,
            note: "Nothing was sent and nothing was spent. Adjust the amount and simulate again.",
          });
        }

        return ok({
          wouldSucceed: true,
          auctionId,
          bidAmount: money(value),
          currentHighestBid: view.highestBid,
          currentMinimumBid: view.minimumBid,
          reserveMet: value >= auction.reservePrice,
          reserveNote:
            value < auction.reservePrice
              ? `This bid is below the reserve of ${formatEther(auction.reservePrice)} ETH. It ` +
                `will be ACCEPTED and will make you the leader, but if no bid reaches the ` +
                `reserve the auction ends as ReserveNotMet and you are refunded in full.`
              : null,
          walletBalance: money(balance),
          balanceAfter: money(balance > value ? balance - value : 0n),
          timeRemaining: view.timeRemaining,
          antiSnipeNote:
            auction.endTime - now <= 300n
              ? "This bid falls inside the 5-minute anti-snipe window, so it will push the end time out by 5 minutes (up to 20 times per auction)."
              : null,
          nextStep: `The bid is valid. Call place_bid with the same auctionId and amount to sign and send it.`,
        });
      } catch (error) {
        return fail(explainError(error));
      }
    },
  );

  server.registerTool(
    "place_bid",
    {
      title: "Place a bid",
      description:
        "Sign and send a real bid, spending real ETH from the connected account on the local " +
        "chain. Run simulate_bid first. If you are outbid later the contract credits your ETH " +
        "back to your pending balance -- it is not pushed to you, so you must call withdraw to " +
        "actually receive it.",
      inputSchema: z.object({
        auctionId: z.string().describe("The auction id, as a decimal string."),
        amount: z.string().describe("Amount to bid, e.g. '1.5'."),
        unit: z.enum(["eth", "wei"]).default("eth").describe("Unit for `amount`."),
      }),
      annotations: {
        readOnlyHint: false,
        // Not "destructive" in the delete-your-data sense, but it moves money
        // and cannot be undone by a subsequent call, which is what the flag is
        // for from a client's confirm-with-a-human standpoint.
        destructiveHint: true,
        // Emphatically NOT idempotent: calling twice places two bids, and the
        // second reverts with AlreadyHighestBidder. A client must not retry
        // this on a timeout without re-reading state first.
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ auctionId, amount, unit }) => {
      try {
        const id = BigInt(auctionId);
        const value = toWei(amount, unit);

        // GATE 1: the spend cap, before anything is read or signed.
        const capError = assertWithinCap(config, value);
        if (capError !== null) return fail(capError);

        const auction = await fetchAuction(config, id);
        if (auction === null) {
          return fail(`Auction ${id} does not exist. Call list_auctions to see the valid ids.`);
        }

        const now = await chainNow(config);
        const view = viewAuction(auction, id, self, now);

        // GATE 2a: wrong format. Bidding on a Dutch auction always reverts.
        if (view.isDutch) {
          const price = await fetchCurrentPrice(config, id);
          return fail(
            `Refusing to bid: auction ${id} is a DUTCH auction, which takes no bids (bid() ` +
              `reverts with WrongFormat).` +
              (price === null ? "" : ` Its current price is ${eth(price)} and falling.`) +
              ` Use buy_now to take it at the current price.`,
          );
        }

        // GATE 2b: refuse to bid against ourselves. The contract enforces this
        // too, but surfacing it here costs no gas and turns a confusing revert
        // into an explanation.
        if (view.youAreTheHighestBidder) {
          return fail(
            `Refusing to bid: you ALREADY hold the leading bid on auction ${id} at ` +
              `${view.highestBid.eth} ETH. Bidding again would revert with AlreadyHighestBidder ` +
              `and would only lock up more of your ETH for no benefit.\n\n` +
              `You are winning. Wait for the auction to close at ${view.endTime}, then call ` +
              `settle_auction.`,
          );
        }
        if (view.youAreTheSeller) {
          return fail(
            `Refusing to bid: you are the seller of auction ${id}. SellerCannotBid would revert this.`,
          );
        }

        // GATE 3: simulate, then send. simulateContract runs the call against
        // current state and reverts here, off-chain, if it would revert
        // on-chain -- so a bad bid costs nothing rather than a failed tx's gas.
        // It also returns the prepared request, which is what gets signed, so
        // there is no gap between what was checked and what is sent.
        const { request } = await config.publicClient.simulateContract({
          address: house,
          abi: auctionHouseAbi,
          functionName: "bid",
          args: [id],
          value,
          account: config.account,
        });

        const hash = await config.walletClient.writeContract(request);
        const receipt = await config.publicClient.waitForTransactionReceipt({ hash });

        // Re-read so the response reflects reality (an anti-snipe extension may
        // have moved the deadline) rather than what we predicted.
        const after = await fetchAuction(config, id);
        const afterNow = await chainNow(config);
        const afterView = after ? viewAuction(after, id, self, afterNow) : null;

        return ok({
          success: receipt.status === "success",
          transactionHash: hash,
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
          auctionId,
          bidPlaced: money(value),
          youAreNowTheHighestBidder: afterView?.youAreTheHighestBidder ?? null,
          newMinimumBidForOthers: afterView?.minimumBid ?? null,
          auctionEndsAt: afterView?.endTime ?? null,
          timeRemaining: afterView?.timeRemaining ?? null,
          extensionApplied:
            afterView && after && after.endTime > auction.endTime
              ? `Anti-snipe: the end time moved from ${iso(auction.endTime)} to ${iso(after.endTime)}.`
              : null,
          reminder:
            "If someone outbids you, your ETH is credited to your pending balance, not sent back " +
            "automatically. Call withdraw to collect it.",
        });
      } catch (error) {
        return fail(explainError(error));
      }
    },
  );

  server.registerTool(
    "buy_now",
    {
      title: "Buy now",
      description:
        "Buy an NFT immediately, settling the auction at once. Handles both formats: an " +
        "ENGLISH auction is bought at its fixed buy-now price (exact payment, and only while " +
        "bidding has not reached that price), a DUTCH auction at its current descending price. " +
        "The price is always read from the contract, so no amount is passed in; the spend cap " +
        "still applies. Use maxPrice to commit to a budget before the price is known.",
      inputSchema: z.object({
        auctionId: z.string().describe("The auction id, as a decimal string."),
        maxPrice: z
          .string()
          .optional()
          .describe(
            "Optional safety limit in ETH. If the on-chain buy-now price exceeds this, the purchase is refused.",
          ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ auctionId, maxPrice }) => {
      try {
        const id = BigInt(auctionId);
        const auction = await fetchAuction(config, id);
        if (auction === null) return fail(`Auction ${id} does not exist.`);

        const now = await chainNow(config);
        const view = viewAuction(auction, id, self, now);

        // ---------------------------------------------------------------
        // DUTCH: a different function, a different price, different rules.
        //
        // `buy(id)` rather than `buyNow(id)`, priced at the live descending
        // `currentPrice` rather than the fixed `buyNowPrice`, and it accepts an
        // overpayment where English buy-now demands the exact amount. Sending
        // buyNow here (or the buyNowPrice figure, which is the Dutch START
        // price) reverts -- so the branch is not cosmetic.
        // ---------------------------------------------------------------
        if (view.isDutch) {
          const price = await fetchCurrentPrice(config, id);
          if (price === null) {
            return fail(
              `Auction ${id} is Dutch, but its current price could not be read. It may no ` +
                `longer be live -- call get_auction to check.`,
            );
          }

          const capError = assertWithinCap(config, price);
          if (capError !== null) return fail(capError);

          if (maxPrice !== undefined) {
            const limit = parseEther(maxPrice as `${number}`);
            if (price > limit) {
              return fail(
                `Refused: the current Dutch price is ${formatEther(price)} ETH, above your ` +
                  `stated maxPrice of ${formatEther(limit)} ETH. The price falls over time, so ` +
                  `waiting and retrying may bring it within your limit.`,
              );
            }
          }

          // The price ticks down between the read and the send. Overpayment is
          // accepted and the contract keeps only what it needs, so quoting the
          // just-read price is safe; it can only ever be slightly high.
          const { request } = await config.publicClient.simulateContract({
            address: house,
            abi: auctionHouseAbi,
            functionName: "buy",
            args: [id],
            value: price,
            account: config.account,
          });

          const hash = await config.walletClient.writeContract(request);
          const receipt = await config.publicClient.waitForTransactionReceipt({ hash });

          return ok({
            success: receipt.status === "success",
            transactionHash: hash,
            blockNumber: receipt.blockNumber.toString(),
            gasUsed: receipt.gasUsed.toString(),
            auctionId,
            format: "Dutch",
            pricePaid: money(price),
            nft: auction.nft,
            tokenId: auction.tokenId.toString(),
            note:
              "Dutch purchase via buy(): the descending price was accepted and the auction " +
              "settled immediately, transferring the NFT in the same transaction.",
          });
        }

        // ---------------------------------------------------------------
        // ENGLISH: fixed buy-now price, exact payment required.
        // ---------------------------------------------------------------
        const price = auction.buyNowPrice;
        if (price === 0n) {
          return fail(
            `Auction ${id} has no buy-now price -- the seller did not enable instant purchase. ` +
              `Use place_bid instead.`,
          );
        }
        if (auction.highestBid >= price) {
          return fail(
            `Buy-now is closed on auction ${id}: bidding has already reached ` +
              `${formatEther(auction.highestBid)} ETH, at or above the buy-now price of ` +
              `${formatEther(price)} ETH. Nobody may take the item for less than the standing ` +
              `bid. Use place_bid instead.`,
          );
        }

        // The price comes from the chain, so the cap is the only thing standing
        // between an agent and an arbitrarily expensive purchase it never named
        // a number for. Check it against the REAL price, not a requested one.
        const capError = assertWithinCap(config, price);
        if (capError !== null) return fail(capError);

        // An optional caller-supplied ceiling on top of the server cap: it lets
        // a model commit to a budget before reading the price, so it cannot be
        // walked up to an expensive purchase by a listing it did not inspect.
        if (maxPrice !== undefined) {
          const limit = parseEther(maxPrice as `${number}`);
          if (price > limit) {
            return fail(
              `Refused: the buy-now price is ${formatEther(price)} ETH, above your stated ` +
                `maxPrice of ${formatEther(limit)} ETH.`,
            );
          }
        }

        const { request } = await config.publicClient.simulateContract({
          address: house,
          abi: auctionHouseAbi,
          functionName: "buyNow",
          args: [id],
          value: price,
          account: config.account,
        });

        const hash = await config.walletClient.writeContract(request);
        const receipt = await config.publicClient.waitForTransactionReceipt({ hash });

        return ok({
          success: receipt.status === "success",
          transactionHash: hash,
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
          auctionId,
          format: "English",
          pricePaid: money(price),
          nft: auction.nft,
          tokenId: auction.tokenId.toString(),
          note:
            "Buy-now settles the auction immediately: the NFT is transferred to you in the same " +
            "transaction, and any outbid bidder is credited their refund.",
        });
      } catch (error) {
        return fail(explainError(error));
      }
    },
  );

  server.registerTool(
    "settle_auction",
    {
      title: "Settle an auction",
      description:
        "Close an auction whose end time has passed. ANYONE may settle -- you do not have to be " +
        "the seller or the winner -- which is what stops a seller from freezing a bidder's money " +
        "by never settling. Settling transfers the NFT to the winner and credits the proceeds. " +
        "Sends no ETH of your own beyond gas.",
      inputSchema: z.object({
        auctionId: z.string().describe("The auction id, as a decimal string."),
      }),
      annotations: {
        readOnlyHint: false,
        // Settlement is the auction's intended terminal step and destroys
        // nothing, so it is not flagged destructive. It IS effectively
        // idempotent from the caller's point of view: a second call reverts
        // with AuctionNotLive and changes nothing, so a retry is safe.
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ auctionId }) => {
      try {
        const id = BigInt(auctionId);

        const settleable = (await config.publicClient.readContract({
          address: house,
          abi: auctionHouseAbi,
          functionName: "isSettleable",
          args: [id],
        })) as boolean;

        if (!settleable) {
          const auction = await fetchAuction(config, id);
          if (auction === null) return fail(`Auction ${id} does not exist.`);
          const now = await chainNow(config);
          const view = viewAuction(auction, id, self, now);
          return fail(
            view.status !== "Live"
              ? `Auction ${id} has already reached a terminal state (${view.status}) and cannot ` +
                  `be settled again. If it credited you anything, call withdraw to collect it.`
              : `Auction ${id} is still running: it closes at ${view.endTime} ` +
                  `(${view.timeRemaining} remaining). It cannot be settled until then, and a late ` +
                  `bid can push that deadline out via anti-snipe.`,
          );
        }

        const { request } = await config.publicClient.simulateContract({
          address: house,
          abi: auctionHouseAbi,
          functionName: "settle",
          args: [id],
          account: config.account,
        });

        const hash = await config.walletClient.writeContract(request);
        const receipt = await config.publicClient.waitForTransactionReceipt({ hash });

        const after = await fetchAuction(config, id);
        const outcome = after ? (AUCTION_STATUS[after.status] ?? "unknown") : "unknown";
        const pending = (await config.publicClient.readContract({
          address: house,
          abi: auctionHouseAbi,
          functionName: "pendingReturns",
          args: [self],
        })) as bigint;

        return ok({
          success: receipt.status === "success",
          transactionHash: hash,
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
          auctionId,
          outcome,
          outcomeMeaning:
            outcome === "Settled"
              ? "The reserve was met. The NFT went to the winner and the seller was credited the proceeds less the platform fee."
              : outcome === "ReserveNotMet"
                ? "No bid reached the reserve (or there were no bids). The NFT returned to the seller and any bidder was credited a full refund."
                : outcome === "DeliveryFailed"
                  ? "The NFT could not be delivered to the winner, so the sale was voided: the winner was refunded in full and the seller was credited nothing. The token is owed back to the seller."
                  : `Terminal state: ${outcome}.`,
          winner: after?.highestBidder === ZERO_ADDRESS ? null : after?.highestBidder,
          winningBid: after ? money(after.highestBid) : null,
          yourPendingBalance: money(pending),
          nextStep:
            pending > 0n
              ? `You have ${formatEther(pending)} ETH waiting. Call withdraw to collect it.`
              : "Nothing is currently owed to you.",
        });
      } catch (error) {
        return fail(explainError(error));
      }
    },
  );

  server.registerTool(
    "withdraw",
    {
      title: "Withdraw pending balance",
      description:
        "Collect everything the auction house owes the connected account: refunds from being " +
        "outbid, refunds from auctions that ended below reserve, and proceeds from items sold. " +
        "The house never pushes ETH -- this pull is the only way funds leave it -- so this must " +
        "be called explicitly. Takes no arguments and can only ever pay the connected account.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        // Safe to retry: the second call reverts with NothingToWithdraw because
        // the credit is zeroed before the transfer.
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const pending = (await config.publicClient.readContract({
          address: house,
          abi: auctionHouseAbi,
          functionName: "pendingReturns",
          args: [self],
        })) as bigint;

        if (pending === 0n) {
          return fail(
            "Nothing to withdraw: the auction house holds no pending balance for this account. " +
              "Credits appear when you are outbid, when an auction you bid on ends below its " +
              "reserve, or when an item you sold settles.",
          );
        }

        const balanceBefore = await config.publicClient.getBalance({ address: self });

        const { request } = await config.publicClient.simulateContract({
          address: house,
          abi: auctionHouseAbi,
          functionName: "withdraw",
          account: config.account,
        });

        const hash = await config.walletClient.writeContract(request);
        const receipt = await config.publicClient.waitForTransactionReceipt({ hash });
        const balanceAfter = await config.publicClient.getBalance({ address: self });

        return ok({
          success: receipt.status === "success",
          transactionHash: hash,
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
          withdrawn: money(pending),
          walletBalanceBefore: money(balanceBefore),
          walletBalanceAfter: money(balanceAfter),
          // Net rather than gross, because gas came out of the same balance and
          // a model comparing before/after would otherwise report a discrepancy.
          netChange: money(balanceAfter - balanceBefore),
          note: "The difference between the amount withdrawn and the net balance change is the gas paid.",
        });
      } catch (error) {
        return fail(explainError(error));
      }
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Order matters and is the whole safety story: build config, VERIFY THE CHAIN,
  // and only then expose tools. An exception anywhere above `serveStdio` means
  // the process dies without ever having registered a way to spend anything.
  const config = loadConfig();
  await assertLocalChain(config);

  // stderr, never stdout: stdout carries the JSON-RPC framing.
  console.error(
    [
      `${SERVER_NAME} v${SERVER_VERSION} ready`,
      `  chain:      ${localChain.id} (verified) via ${config.rpcUrl}`,
      `  layout:     Auction struct has ${config.layout.fieldCount} fields${config.layout.hasFormat ? " (includes Format)" : " (no Format field)"}`,
      `  house:      ${config.deployment.auctionHouse}`,
      `  account:    ${config.account.address}`,
      `  spend cap:  ${formatEther(config.maxBidWei)} ETH per transaction`,
      `  indexer:    ${config.indexerUrl} (optional)`,
    ].join("\n"),
  );

  serveStdio(() => buildServer(config), {
    onerror: (error) => {
      console.error(`[${SERVER_NAME}] transport error:`, error.message);
    },
  });
}

main().catch((error: unknown) => {
  if (error instanceof StartupError) {
    // A configuration or safety refusal: print the message on its own, with no
    // stack trace, because the message is the entire actionable content.
    console.error(`\n${error.message}\n`);
  } else {
    console.error(`\n${SERVER_NAME} failed to start:\n`, error);
  }

  // Set the code and let the event loop drain, rather than calling
  // process.exit() outright.
  //
  // WHY: a refusal that happens AFTER an RPC round trip (the no-contract-code
  // check, for instance) leaves the HTTP transport's keep-alive socket mid-close.
  // Calling process.exit() at that moment trips a libuv assertion on Windows
  // ("!(handle->flags & UV_HANDLE_CLOSING)") which kills the process with code
  // 127 instead of 1 -- so a caller checking the exit status sees "command not
  // found" rather than "the server refused to start". Setting `exitCode` lets
  // the socket finish closing and the process exit cleanly with the right code.
  process.exitCode = 1;

  // Backstop, in case a lingering keep-alive socket keeps the loop alive. It is
  // unref'd so it never itself delays a clean exit.
  const backstop = setTimeout(() => process.exit(1), 500);
  backstop.unref();
});

// ---------------------------------------------------------------------------
// The HTTP surface.
//
// Ponder serves /health, /ready, /status and /metrics itself. This file adds
// the two things it does not: the GraphQL endpoint, which must be mounted
// explicitly once an api directory exists, and a small REST layer for the
// questions GraphQL CANNOT answer.
//
// WHY REST AT ALL, NEXT TO GRAPHQL. Ponder's GraphQL is a typed view of the
// tables: filter, sort, paginate. It has no aggregation and no computed
// ordering. Every endpoint below either reads a rollup with an ordering that
// only makes sense as a leaderboard, or stitches several tables into one
// chronological answer. A client could do the stitching itself with four
// round trips; that is the cost this file removes.
//
// EVERY ROUTE IS READ ONLY. `db` from "ponder:api" is typed `ReadonlyDrizzle`,
// so `insert`, `update` and `delete` are not merely discouraged here, they do
// not exist.
// ---------------------------------------------------------------------------

import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { and, asc, desc, eq, graphql, gte, lte } from "ponder";

const app = new Hono();

// CORS, stated explicitly.
//
// Ponder 0.17 already wraps this app in `cors({ origin: "*" })` of its own, so
// in practice the preflight is answered upstream and this middleware only
// decorates the actual request. It is declared here anyway, because the policy
// for these routes belongs in the file that owns them: a framework default is
// not a policy, and it can be tightened in a minor release without anything
// here failing loudly.
//
// Why permissive at all. The browser reaches this service through the nginx
// proxy on the same origin, so the deployed path needs nothing. The two paths
// people actually develop against do: the Vite dev server on :5173 calling
// :42069 directly, and a GraphQL client or curl from anywhere else on the
// host. Every route is read-only public data from a local demo chain, and
// `credentials` is deliberately left off, so a browser will never attach a
// cookie to a cross-origin call here.
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86_400,
  }),
);

// Mounting GraphQL is the caller's job once `src/api/` exists. Both paths are
// served because "/" is what GraphiQL links to and "/graphql" is what every
// client is configured with.
app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

// ---------------------------------------------------------------------------
// Shared request handling
// ---------------------------------------------------------------------------

/** Clamps `?limit=` into a range. An unbounded limit is a denial of service. */
function limitOf(raw: string | undefined, fallback = 25, max = 200): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

/**
 * JSON.stringify cannot serialise a bigint -- it throws a TypeError.
 *
 * Every wei value and every timestamp in this schema is a bigint, so the
 * choice is between losing precision by converting to a number and losing
 * ergonomics by converting to a string. This converts to a STRING: a `uint96`
 * of wei exceeds float64's exact-integer range, and a leaderboard that rounds
 * the amounts it is ranking is worse than one whose client calls BigInt().
 */
function jsonSafe<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v)),
  );
}

// ---------------------------------------------------------------------------
// Leaderboards
//
// These read a rollup table directly. The ordering column is indexed in
// ponder.schema.ts, so each of these is one index scan, not a sort of the
// whole table.
// ---------------------------------------------------------------------------

/**
 * GET /api/leaderboard/bidders?limit=&sort=
 *
 * sort: "spent" (default) | "wins" | "winRate" | "volume"
 *
 * `winRate` additionally requires three completed auctions. Without that floor
 * the top of the board is permanently occupied by accounts that entered one
 * auction and won it, which is a 100% win rate and no information at all.
 */
app.get("/api/leaderboard/bidders", async (c) => {
  const limit = limitOf(c.req.query("limit"));
  const sort = c.req.query("sort") ?? "spent";

  const orderBy = {
    spent: desc(schema.bidder.totalSpent),
    wins: desc(schema.bidder.auctionsWon),
    winRate: desc(schema.bidder.winRate),
    volume: desc(schema.bidder.totalBidVolume),
  }[sort];

  if (!orderBy) {
    return c.json({ error: "sort must be one of: spent, wins, winRate, volume" }, 400);
  }

  const rows = await db
    .select()
    .from(schema.bidder)
    .where(sort === "winRate" ? gte(schema.bidder.auctionsEntered, 3) : undefined)
    .orderBy(orderBy)
    .limit(limit);

  return c.json(jsonSafe({ sort, limit, count: rows.length, bidders: rows }));
});

/**
 * GET /api/leaderboard/sellers?limit=&sort=
 *
 * sort: "volume" (default) | "sold" | "sellThrough"
 *
 * `sellThrough` applies the same floor as `winRate` above, for the same reason.
 */
app.get("/api/leaderboard/sellers", async (c) => {
  const limit = limitOf(c.req.query("limit"));
  const sort = c.req.query("sort") ?? "volume";

  const orderBy = {
    volume: desc(schema.seller.grossVolume),
    sold: desc(schema.seller.sold),
    sellThrough: desc(schema.seller.sellThroughRate),
  }[sort];

  if (!orderBy) {
    return c.json({ error: "sort must be one of: volume, sold, sellThrough" }, 400);
  }

  const rows = await db
    .select()
    .from(schema.seller)
    .where(sort === "sellThrough" ? gte(schema.seller.listed, 3) : undefined)
    .orderBy(orderBy)
    .limit(limit);

  return c.json(jsonSafe({ sort, limit, count: rows.length, sellers: rows }));
});

// ---------------------------------------------------------------------------
// Time series
// ---------------------------------------------------------------------------

/**
 * GET /api/stats/daily?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=
 *
 * Returns the daily buckets oldest-first, which is the order a chart wants,
 * plus a `totals` block summing the range.
 *
 * The totals are computed HERE, in TypeScript, rather than with a SQL
 * aggregate. The range is bounded to at most `limit` rows -- a year of a demo
 * chain -- so the sum is over a few hundred small rows, and doing it in
 * TypeScript keeps `volume` a bigint end to end. `SUM()` over a Postgres
 * `numeric` would come back as a string that then has to be re-parsed anyway.
 */
app.get("/api/stats/daily", async (c) => {
  const limit = limitOf(c.req.query("limit"), 90, 365);
  const from = c.req.query("from");
  const to = c.req.query("to");

  const bounds = [
    from ? gte(schema.dailyStat.id, from) : undefined,
    to ? lte(schema.dailyStat.id, to) : undefined,
  ].filter((clause) => clause !== undefined);

  // Newest-first for the LIMIT, so an unbounded request returns the most
  // recent window rather than the oldest one, then reversed for the client.
  const rows = await db
    .select()
    .from(schema.dailyStat)
    .where(bounds.length > 0 ? and(...bounds) : undefined)
    .orderBy(desc(schema.dailyStat.id))
    .limit(limit);

  const days = rows.reverse();

  const totals = days.reduce(
    (sum, day) => ({
      auctionsCreated: sum.auctionsCreated + day.auctionsCreated,
      auctionsClosed: sum.auctionsClosed + day.auctionsClosed,
      sales: sum.sales + day.sales,
      bids: sum.bids + day.bids,
      lateBids: sum.lateBids + day.lateBids,
      extensions: sum.extensions + day.extensions,
      volume: sum.volume + day.volume,
      fees: sum.fees + day.fees,
    }),
    {
      auctionsCreated: 0,
      auctionsClosed: 0,
      sales: 0,
      bids: 0,
      lateBids: 0,
      extensions: 0,
      volume: 0n,
      fees: 0n,
    },
  );

  return c.json(
    jsonSafe({
      from: days.at(0)?.id ?? null,
      to: days.at(-1)?.id ?? null,
      count: days.length,
      // `uniqueBidders` is NOT summed. Distinct counts do not add up across
      // days -- the same account bidding on Monday and Tuesday is one bidder,
      // not two -- and answering that correctly needs a scan of `dailyBidder`,
      // which is not what this endpoint is for.
      totals: {
        ...totals,
        avgClearingPrice: totals.sales > 0 ? totals.volume / BigInt(totals.sales) : 0n,
      },
      days,
    }),
  );
});

// ---------------------------------------------------------------------------
// Auction history
// ---------------------------------------------------------------------------

/**
 * GET /api/auctions/:id/history
 *
 * The full story of one auction on one response: the lifecycle row, every bid
 * oldest-first, every refund it produced, and the distinct participants.
 *
 * This is the endpoint GraphQL comes closest to serving and still cannot: the
 * three lists live in three tables with no foreign key between them, so a
 * GraphQL client needs three round trips and then has to interleave the
 * results itself to get a timeline.
 */
app.get("/api/auctions/:id/history", async (c) => {
  const raw = c.req.param("id");

  // The id is a uint256, so it is parsed as a bigint. `Number` would silently
  // round anything past 2^53 and then match the wrong row.
  let auctionId: bigint;
  try {
    auctionId = BigInt(raw);
    if (auctionId < 0n) throw new Error("negative");
  } catch {
    return c.json({ error: `auction id must be a non-negative integer, got: ${raw}` }, 400);
  }

  const [record] = await db
    .select()
    .from(schema.auction)
    .where(eq(schema.auction.id, auctionId))
    .limit(1);

  if (!record) {
    return c.json({ error: `no auction with id ${auctionId}` }, 404);
  }

  const [bids, refunds, participants] = await Promise.all([
    db
      .select()
      .from(schema.bid)
      .where(eq(schema.bid.auctionId, auctionId))
      .orderBy(asc(schema.bid.timestamp), asc(schema.bid.logIndex)),
    db
      .select()
      .from(schema.credit)
      .where(eq(schema.credit.auctionId, auctionId))
      .orderBy(asc(schema.credit.timestamp)),
    db
      .select()
      .from(schema.auctionBidder)
      .where(eq(schema.auctionBidder.auctionId, auctionId))
      .orderBy(asc(schema.auctionBidder.firstBidAt)),
  ]);

  const token = await db
    .select()
    .from(schema.nftToken)
    .where(
      and(eq(schema.nftToken.contract, record.nft), eq(schema.nftToken.tokenId, record.tokenId)),
    )
    .limit(1);

  return c.json(
    jsonSafe({
      auction: record,
      token: token.at(0) ?? null,
      bids,
      refunds,
      participants,
      // The two derived numbers a timeline is usually drawn against, so the
      // client does not have to recompute them from `bids`.
      summary: {
        bidCount: bids.length,
        lateBidCount: bids.filter((b) => b.isLate).length,
        uniqueBidders: participants.length,
        firstBidAt: bids.at(0)?.timestamp ?? null,
        lastBidAt: bids.at(-1)?.timestamp ?? null,
      },
    }),
  );
});

export default app;

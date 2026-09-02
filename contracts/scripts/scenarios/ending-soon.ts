import { formatEther, parseEther } from "viem";

import {
  Status,
  bidAt,
  chainNow,
  clockDrift,
  connect,
  fastForwardTo,
  heading,
  listEnglish,
  log,
  report,
  require_,
} from "./_shared.js";

/**
 * SCENARIO: an auction about to close, with a real contest behind it.
 *
 * Produces one Live English auction that is {@link LEAD} seconds from its
 * close, carrying two competing bids from two different accounts. It is the
 * scenario for showing the countdown turn red, the "ending soon" treatment
 * fire, and the settle button light up on its own.
 *
 *   npx hardhat run scripts/scenarios/ending-soon.ts --network localhost
 *
 * WHY THE BIDS GO IN FIRST AND THE CLOCK MOVES AFTERWARDS: a bid inside
 * {ANTI_SNIPE_WINDOW} - five minutes - pushes `endTime` out to five minutes
 * past the bid. So an auction that has just been bid on is NEVER less than five
 * minutes from closing; that is the whole point of the feature. The only
 * arrangement that is simultaneously "has bids" and "closes in thirty seconds"
 * is one where the bids landed while the auction was still comfortably long,
 * and the clock has since run down. So the auction opens ten minutes wide, both
 * bids land in the first few seconds - outside the window, provably, see the
 * assertion below - and only then is the clock advanced to the last thirty
 * seconds.
 */

/** Seconds left on the chain clock when the scenario finishes. */
const LEAD = Number(process.env.SCENARIO_LEAD_SECONDS ?? 30);

/**
 * Ten minutes. Comfortably more than twice {ANTI_SNIPE_WINDOW}, so an opening
 * bid cannot possibly extend the auction and shift the close time this script
 * is aiming at.
 */
const DURATION = 600n;

const ctx = await connect("ending-soon");
const { cast } = ctx;

require_(
  LEAD > 0 && LEAD < Number(DURATION) - 300,
  `SCENARIO_LEAD_SECONDS must be between 1 and ${Number(DURATION) - 301}, got ${LEAD}.`,
);

// ---------------------------------------------------------------------------
// Open the auction
// ---------------------------------------------------------------------------

heading("Listing");

const { auctionId, tokenId } = await listEnglish(ctx, cast.ann, {
  reserve: parseEther("1"),
  duration: DURATION,
});

const opened = await ctx.house.read.getAuction([auctionId]);
const closesAt = Number(opened.endTime);
log(`  Auction #${auctionId} on token #${tokenId}, listed by ${ctx.nameOf(opened.seller)}.`);
log(`  Reserve ${formatEther(opened.reservePrice)} ETH, closes at ${closesAt}.`);

// ---------------------------------------------------------------------------
// The contest
// ---------------------------------------------------------------------------

heading("Bidding");

// Both bids are pinned to an exact second rather than left to whenever the node
// mines. Two runs then produce byte-identical bid timestamps, so anything
// reading the event log downstream - the indexer's analytics, a screenshot, a
// regression fixture - is comparable run to run.
const windowOpensAt = closesAt - Number(await ctx.house.read.ANTI_SNIPE_WINDOW());

const first = await bidAt(ctx, cast.cara, auctionId, {
  at: (await chainNow(ctx)) + 1,
  amount: parseEther("1.5"),
});
log(`  ${ctx.nameOf(cast.cara.account.address)} bid ${formatEther(first.amount)} ETH at ${first.at}.`);

const second = await bidAt(ctx, cast.dev, auctionId, {
  at: first.at + 2,
  amount: parseEther("2.25"),
});
log(`  ${ctx.nameOf(cast.dev.account.address)} bid ${formatEther(second.amount)} ETH at ${second.at}.`);

require_(
  second.at < windowOpensAt,
  `the bids landed at ${second.at}, inside the anti-snipe window that opens at` +
    ` ${windowOpensAt}. They would have extended the auction and the close time` +
    ` this scenario aims at would be wrong.`,
);

// The close time must be untouched, or the fast-forward below lands in the
// wrong place and the whole scenario is a lie.
const contested = await ctx.house.read.getAuction([auctionId]);
require_(
  contested.extensionCount === 0,
  `expected no anti-snipe extensions, found ${contested.extensionCount}.`,
);
require_(
  Number(contested.endTime) === closesAt,
  `the close time moved from ${closesAt} to ${contested.endTime}.`,
);

// ---------------------------------------------------------------------------
// Run the clock down
// ---------------------------------------------------------------------------

heading("Clock");

await fastForwardTo(ctx, closesAt - LEAD);
log(`  Chain clock moved to ${await chainNow(ctx)}, ${LEAD}s before the close.`);

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

const final = await ctx.house.read.getAuction([auctionId]);
const remaining = await ctx.house.read.timeRemaining([auctionId]);

require_(final.status === Status.Live, `expected a Live auction, found ${final.status}.`);
require_(Number(remaining) === LEAD, `expected ${LEAD}s remaining, the contract says ${remaining}.`);
require_(
  (await ctx.house.read.isSettleable([auctionId])) === false,
  "the auction is already settleable, so there is no countdown left to watch.",
);
require_(
  final.highestBidder.toLowerCase() === cast.dev.account.address.toLowerCase(),
  `expected ${ctx.nameOf(cast.dev.account.address)} to lead, found ${ctx.nameOf(final.highestBidder)}.`,
);
require_(
  final.highestBid === second.amount,
  `expected a leading bid of ${formatEther(second.amount)} ETH, found ${formatEther(final.highestBid)}.`,
);

// The outbid leader is credited, never paid. That credit is the other half of
// what this screen shows, so it is checked rather than assumed.
const outbidCredit = await ctx.house.read.pendingReturns([cast.cara.account.address]);
require_(
  outbidCredit >= first.amount,
  `${ctx.nameOf(cast.cara.account.address)} was outbid but is credited only ${formatEther(outbidCredit)} ETH.`,
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

// The UI's countdown ticks on `Date.now()` (see `web/src/hooks/useTicker.tsx`),
// so it measures `endTime` against the WALL clock while the contract measures
// it against the block timestamp. Advancing the chain does not bring `endTime`
// any closer in real time, so the browser's timer reads `drift` seconds longer
// than the contract's. `endTime` is a plain Unix second either way, so the
// honest thing to hand the presenter is the actual clock time it lands on.
const drift = await clockDrift(ctx);
const closesAtLocal = new Date(closesAt * 1000).toLocaleTimeString();

await report(
  ctx,
  [{ auctionId, note: `English, ${LEAD}s from close, two bidders in` }],
  [
    `The countdown, which crosses the 60s and 30s thresholds and turns urgent.`,
    `The settle button, which enables the moment the countdown reaches zero` +
      ` - anyone may press it, not just the seller or the winner.`,
    `${ctx.nameOf(cast.dev.account.address)} leads at ${formatEther(final.highestBid)} ETH;` +
      ` ${ctx.nameOf(cast.cara.account.address)} holds a ${formatEther(outbidCredit)} ETH credit to claim.`,
    `The auction closes at ${closesAtLocal} local time. On the chain's own clock` +
      ` that is ${LEAD}s away; in the browser it is ${LEAD + drift}s away, because` +
      ` the countdown ticks on Date.now() and this script moved the chain ahead.`,
  ],
);

await ctx.connection.close();

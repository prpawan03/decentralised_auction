import { formatEther, parseEther } from "viem";

import {
  Status,
  bidAt,
  chainNow,
  connect,
  fastForwardTo,
  heading,
  listEnglish,
  log,
  report,
  require_,
} from "./_shared.js";

/**
 * SCENARIO: a snipe attempt, defeated live.
 *
 * Opens an auction, lets an honest bidder take the lead well before the end,
 * runs the clock into the last two minutes, and then has a second account bid
 * with {@link SNIPE_AT} seconds showing. That bid lands inside
 * {ANTI_SNIPE_WINDOW}, so the contract pushes the close time out by a full
 * window and the sniper wins nothing but a chance for everyone else to
 * respond.
 *
 *   npx hardhat run scripts/scenarios/snipe-in-progress.ts --network localhost
 *
 * The scenario finishes with the auction STILL LIVE and roughly five minutes
 * back on the clock, which is the observable half of the behaviour: the number
 * a viewer was watching count down towards zero jumps back up.
 *
 * The extension is not taken on trust. The auction is read before and after,
 * and the script fails unless `endTime` moved by exactly the amount the
 * contract's rule predicts and `extensionCount` went up by exactly one.
 */

/** Seconds left when the late bid lands. Well inside the five-minute window. */
const SNIPE_AT = Number(process.env.SCENARIO_SNIPE_AT ?? 45);

/** Seconds left when the clock stops before the snipe, so the window is open. */
const WATCH_FROM = 120;

/** Ten minutes: long enough that the opening bid cannot extend anything. */
const DURATION = 600n;

const ctx = await connect("snipe-in-progress");
const { cast, house } = ctx;

const window_ = Number(await house.read.ANTI_SNIPE_WINDOW());
const cap = await house.read.MAX_EXTENSIONS();

require_(
  SNIPE_AT > 0 && SNIPE_AT < WATCH_FROM,
  `SCENARIO_SNIPE_AT must be between 1 and ${WATCH_FROM - 1}, got ${SNIPE_AT}.`,
);
require_(
  WATCH_FROM < window_,
  `the watch point (${WATCH_FROM}s) must sit inside the ${window_}s anti-snipe window.`,
);

// ---------------------------------------------------------------------------
// Open the auction and take an honest lead
// ---------------------------------------------------------------------------

heading("Listing");

const { auctionId, tokenId } = await listEnglish(ctx, cast.ann, {
  reserve: parseEther("1"),
  duration: DURATION,
});

const opened = await house.read.getAuction([auctionId]);
const originalClose = Number(opened.endTime);
log(`  Auction #${auctionId} on token #${tokenId}, listed by ${ctx.nameOf(opened.seller)}.`);
log(`  Opens ${DURATION}s wide; the anti-snipe window opens at ${originalClose - window_}.`);

heading("The honest bid");

// Pinned to an exact second so the whole run is reproducible: the extension
// arithmetic asserted below is only meaningful if the bid timestamps are.
const honest = await bidAt(ctx, cast.ben, auctionId, {
  at: (await chainNow(ctx)) + 1,
  amount: parseEther("2"),
});
log(`  ${ctx.nameOf(cast.ben.account.address)} bid ${formatEther(honest.amount)} ETH at ${honest.at}.`);
log(`  That is ${originalClose - honest.at}s before the close, outside the window.`);

const afterHonest = await house.read.getAuction([auctionId]);
require_(
  afterHonest.extensionCount === 0 && Number(afterHonest.endTime) === originalClose,
  "the opening bid extended the auction; it was supposed to land outside the window.",
);

// ---------------------------------------------------------------------------
// Into the window
// ---------------------------------------------------------------------------

heading("Into the anti-snipe window");

await fastForwardTo(ctx, originalClose - WATCH_FROM);

const before = await house.read.getAuction([auctionId]);
const beforeRemaining = Number(await house.read.timeRemaining([auctionId]));
log(`  ${beforeRemaining}s left. The window is open, so any bid from here extends the auction.`);

require_(
  beforeRemaining <= window_,
  `expected to be inside the ${window_}s window, but ${beforeRemaining}s remain.`,
);
require_(
  before.extensionCount < cap,
  `this auction has already used all ${cap} extensions, so no further bid can extend it.`,
);

// ---------------------------------------------------------------------------
// The snipe
// ---------------------------------------------------------------------------

heading("The snipe");

const snipe = await bidAt(ctx, cast.cara, auctionId, {
  at: originalClose - SNIPE_AT,
  amount: parseEther("2.4"),
});
log(
  `  ${ctx.nameOf(cast.cara.account.address)} bid ${formatEther(snipe.amount)} ETH with` +
    ` ${SNIPE_AT}s showing, at ${snipe.at}.`,
);

// ---------------------------------------------------------------------------
// Verify the extension actually happened
// ---------------------------------------------------------------------------

const after = await house.read.getAuction([auctionId]);

require_(
  after.extensionCount === before.extensionCount + 1,
  `expected the extension count to go from ${before.extensionCount} to` +
    ` ${before.extensionCount + 1}, found ${after.extensionCount}. The anti-snipe` +
    ` rule did not fire, so this scenario demonstrates nothing.`,
);
require_(
  after.endTime > before.endTime,
  `the close time did not move: still ${after.endTime}.`,
);
// The rule is exact, not approximate: a bid inside the window sets the close to
// one full window from the BID, never a relative nudge. Asserting the precise
// value is what would catch the rule being weakened to something softer.
require_(
  Number(after.endTime) === snipe.at + window_,
  `expected the new close time to be ${snipe.at + window_} (bid + one full window),` +
    ` found ${after.endTime}.`,
);
require_(
  after.status === Status.Live,
  `the auction is ${after.status} rather than Live; an extension must leave it open.`,
);

heading("Before and after");

const rows: readonly (readonly [string, string, string])[] = [
  ["", "before the snipe", "after the snipe"],
  ["endTime", String(before.endTime), String(after.endTime)],
  ["seconds left", `${beforeRemaining}`, `${Number(after.endTime) - (await chainNow(ctx))}`],
  ["extensions", `${before.extensionCount}`, `${after.extensionCount} of ${cap}`],
  [
    "leader",
    `${ctx.nameOf(before.highestBidder)} at ${formatEther(before.highestBid)} ETH`,
    `${ctx.nameOf(after.highestBidder)} at ${formatEther(after.highestBid)} ETH`,
  ],
];

const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
for (const row of rows) {
  log(`  ${row.map((cell, column) => cell.padEnd(widths[column])).join("  |  ")}`);
}

log(
  `\n  The close moved out by ${Number(after.endTime) - Number(before.endTime)}s.` +
    ` A bid with ${SNIPE_AT}s showing bought the sniper nothing, and gave` +
    ` ${ctx.nameOf(before.highestBidder)} a full ${window_}s to answer it.`,
);

// The outbid leader keeps a claim on every wei, immediately.
const credit = await house.read.pendingReturns([cast.ben.account.address]);
require_(
  credit >= honest.amount,
  `${ctx.nameOf(cast.ben.account.address)} was outbid but holds only ${formatEther(credit)} ETH in credit.`,
);

await report(
  ctx,
  [{ auctionId, note: "English, just extended by an anti-snipe bid" }],
  [
    `The countdown JUMPED BACK UP from ${SNIPE_AT}s to ${window_}s the moment the late bid landed.`,
    `The extension counter now reads ${after.extensionCount} of ${cap}. The cap is what` +
      ` guarantees the auction still terminates - it cannot be extended forever.`,
    `${ctx.nameOf(cast.ben.account.address)} can answer the snipe, or claim the` +
      ` ${formatEther(credit)} ETH credit they already hold.`,
  ],
);

await ctx.connection.close();

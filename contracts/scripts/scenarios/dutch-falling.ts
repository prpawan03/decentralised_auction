import { formatEther, parseEther } from "viem";

import {
  Status,
  connect,
  heading,
  listDutch,
  log,
  report,
  require_,
} from "./_shared.js";

/**
 * SCENARIO: a descending-price sale, caught mid-decay.
 *
 * Runs a Dutch clock down from {@link START_PRICE} towards {@link FLOOR_PRICE}
 * and stops it partway, so the UI shows a price that has visibly fallen and has
 * further to fall.
 *
 *   npx hardhat run scripts/scenarios/dutch-falling.ts --network localhost
 *
 * HOW THE FALL IS PRODUCED, AND WHY IT LOOKS LIKE THIS.
 * `contracts/src/AuctionHouse.sol` is an ascending-price contract. There is no
 * `Format` enum, no `DutchAuction.sol` and no `currentPrice()` view, and
 * `buyNowPrice` is fixed for the life of a listing - so no single auction in
 * this deployment can show a number that goes down. {listDutch} therefore walks
 * a LADDER: each rung is a real auction on the same escrowed token at a lower
 * price, and the seller cancels a rung to open the next one down. It probes for
 * a native Dutch format first and refuses to run the emulation if one appears,
 * so this script starts telling the truth the day that contract lands.
 *
 * The emulation is faithful rather than convenient. A Dutch clock is a sequence
 * of take-it-or-leave-it prices, and setting each rung's `reservePrice` equal to
 * its `buyNowPrice` reproduces exactly that: a bid below the clock price can
 * never win, and the seller can still step the clock past it. Every walked rung
 * stays in the book as `Cancelled`, so the decay is visible history instead of a
 * number that changed with no trace.
 */

/** The opening clock price. */
const START_PRICE = parseEther(process.env.SCENARIO_DUTCH_START ?? "8");

/** Where the clock stops falling. A Dutch sale has a floor, not a free fall. */
const FLOOR_PRICE = parseEther(process.env.SCENARIO_DUTCH_FLOOR ?? "2");

/** Rungs in the full ladder, start and floor included. Seven gives 1 ETH steps. */
const STEPS = 7;

/** Seconds the clock rests on each rung. */
const STEP_SECONDS = 45;

/**
 * How many rungs to walk before stopping.
 *
 * Deliberately short of {@link STEPS}: the point of the scenario is a price
 * caught in motion, so the clock has to have somewhere left to go.
 */
const WALK = 4;

/** Half an hour on the live rung, so the demo is not racing a countdown. */
const DURATION = 1800n;

const ctx = await connect("dutch-falling");
const { cast, house, nft } = ctx;

require_(WALK < STEPS, `WALK (${WALK}) must be below STEPS (${STEPS}) to stop mid-decay.`);

// ---------------------------------------------------------------------------
// Run the clock down
// ---------------------------------------------------------------------------

heading("Running the clock down");

const ladder = await listDutch(ctx, cast.cara, {
  startPrice: START_PRICE,
  floorPrice: FLOOR_PRICE,
  steps: STEPS,
  stepSeconds: STEP_SECONDS,
  walk: WALK,
  duration: DURATION,
});

log(`  Mode: ${ladder.mode} (see listDutch in _shared.ts for why).`);
log(`  Token #${ladder.tokenId}, carried down every rung by ${ctx.nameOf(cast.cara.account.address)}.`);

for (const rung of ladder.rungs) {
  const live = rung.auctionId === ladder.live.auctionId;
  log(
    `    +${String(rung.openedAfter).padStart(3)}s  ${formatEther(rung.price).padStart(6)} ETH` +
      `  auction #${rung.auctionId}${live ? "   <- the clock is here" : ""}`,
  );
}
for (const [index, price] of ladder.remaining.entries()) {
  const at = ladder.live.openedAfter + (index + 1) * STEP_SECONDS;
  log(`    +${String(at).padStart(3)}s  ${formatEther(price).padStart(6)} ETH  (not reached yet)`);
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

const live = await house.read.getAuction([ladder.live.auctionId]);

require_(live.status === Status.Live, `the current rung is ${live.status}, not Live.`);
require_(
  live.buyNowPrice === ladder.live.price,
  `the live rung should be priced at ${formatEther(ladder.live.price)} ETH,` +
    ` the chain says ${formatEther(live.buyNowPrice)}.`,
);
// Reserve equal to price is what makes it a Dutch sale rather than an English
// one with a buy-now attached: there is no winning bid below the clock.
require_(
  live.reservePrice === live.buyNowPrice,
  `the live rung's reserve (${formatEther(live.reservePrice)} ETH) must equal its price` +
    ` (${formatEther(live.buyNowPrice)} ETH), or a bid under the clock could win.`,
);
require_(
  live.buyNowPrice < START_PRICE && live.buyNowPrice > FLOOR_PRICE,
  `the clock is at ${formatEther(live.buyNowPrice)} ETH, which is not between the` +
    ` ${formatEther(START_PRICE)} ETH start and the ${formatEther(FLOOR_PRICE)} ETH floor.` +
    ` The scenario is meant to stop mid-decay.`,
);
require_(
  live.highestBidder === "0x0000000000000000000000000000000000000000",
  `the live rung already carries a bid from ${ctx.nameOf(live.highestBidder)}; the` +
    ` clock cannot be stepped down past a bid that meets its price.`,
);

// Every earlier rung must be closed, or the book shows the same token for sale
// at several prices at once.
for (const rung of ladder.rungs.slice(0, -1)) {
  const walked = await house.read.getAuction([rung.auctionId]);
  require_(
    walked.status === Status.Cancelled,
    `rung #${rung.auctionId} at ${formatEther(rung.price)} ETH is ${walked.status},` +
      ` not Cancelled. Two rungs are live at once.`,
  );
}

// The token has to be escrowed against the CURRENT rung, not stranded with the
// seller after a cancel that never re-listed.
const tokenOwner = await nft.read.ownerOf([ladder.tokenId]);
require_(
  tokenOwner.toLowerCase() === house.address.toLowerCase(),
  `token #${ladder.tokenId} is held by ${ctx.nameOf(tokenOwner)} rather than escrowed by the house.`,
);

const fallen = START_PRICE - live.buyNowPrice;
log(
  `\n  The clock has fallen ${formatEther(fallen)} ETH from ${formatEther(START_PRICE)}` +
    ` to ${formatEther(live.buyNowPrice)}, with ${ladder.remaining.length} rung(s) left` +
    ` before the ${formatEther(FLOOR_PRICE)} ETH floor.`,
);

await report(
  ctx,
  [
    { auctionId: ladder.live.auctionId, note: `Dutch clock, live at ${formatEther(live.buyNowPrice)} ETH` },
    { auctionId: ladder.rungs[0].auctionId, note: `the opening rung at ${formatEther(START_PRICE)} ETH, now cancelled` },
  ],
  [
    `The buy-now price on the live rung: ${formatEther(live.buyNowPrice)} ETH, down from` +
      ` ${formatEther(START_PRICE)} ETH.`,
    `The cancelled rungs above it in the book are the decay path, one auction per price.`,
    `Reserve equals price, so there is no bid that wins below the clock -` +
      ` a buyer either takes it at ${formatEther(live.buyNowPrice)} ETH or waits for the next rung.`,
    `Re-run this script to walk the clock further down on a fresh token.`,
  ],
);

await ctx.connection.close();

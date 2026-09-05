import { formatEther, parseEther } from "viem";

import { Status, connect, heading, listDutch, log, report, require_ } from "./_shared.js";

/**
 * SCENARIO: a descending-price sale, caught mid-decay.
 *
 * Opens a Dutch auction at {@link START_PRICE}, runs its clock partway down
 * towards {@link FLOOR_PRICE}, and stops. The UI then shows a price that has
 * visibly fallen and still has somewhere to go.
 *
 *   npx hardhat run scripts/scenarios/dutch-falling.ts --network localhost
 *
 * HOW THE FALL IS PRODUCED
 * It is not produced at all -- it is read. `DutchAuction.currentPrice` is a
 * pure function of `block.timestamp`, so moving the chain's clock IS moving the
 * price. This script does nothing but list, fast-forward, and check.
 *
 * That is worth stating because an earlier version of this scenario could not
 * do it. Before the format split there was only an ascending contract, so the
 * decay had to be faked with a ladder of cancelled auctions at descending
 * prices. The two look similar in a screenshot and are not the same thing: a
 * ladder is N auction ids and N-1 cancellations in the book, while the real
 * format is ONE listing whose price is a function of time. Everything
 * downstream -- the UI, the indexer, any leaderboard -- sees the difference.
 *
 * HOW A DUTCH SALE IS BOUGHT
 * With `buy(auctionId)` at `currentPrice(auctionId)`. NOT with `bid()`, which
 * reverts with `WrongFormat`, and NOT at `buyNowPrice`, which on a Dutch record
 * holds the START price rather than the price a buyer pays now. Overpayment is
 * accepted and credited back, so a buyer racing the clock down cannot lose the
 * difference.
 */

/** The opening clock price. */
const START_PRICE = parseEther(process.env.SCENARIO_DUTCH_START ?? "8");

/** Where the clock stops falling. A Dutch sale has a floor, not a free fall. */
const FLOOR_PRICE = parseEther(process.env.SCENARIO_DUTCH_FLOOR ?? "2");

/** How long the clock takes to walk the whole way down. */
const DURATION = 1800n;

/**
 * Seconds of decay to run off before handing over.
 *
 * Deliberately well inside {@link DURATION}: the point of the scenario is a
 * price caught in motion. At 0 it is just an expensive listing; at DURATION it
 * is sitting on its floor. A third of the way down reads as obviously falling
 * while leaving plenty of room to watch it keep going.
 */
const ELAPSED = Number(process.env.SCENARIO_DUTCH_ELAPSED ?? 600);

const ctx = await connect("dutch-falling");
const { cast, house, nft } = ctx;

// ---------------------------------------------------------------------------
// List and run the clock down
// ---------------------------------------------------------------------------

heading("Running the clock down");

const sale = await listDutch(ctx, cast.cara, {
  startPrice: START_PRICE,
  floorPrice: FLOOR_PRICE,
  duration: DURATION,
  elapsed: ELAPSED,
});

log(
  `  Auction #${sale.auctionId}, token #${sale.tokenId}, listed by ${ctx.nameOf(cast.cara.account.address)}.`,
);
log(`    opened at   ${formatEther(sale.startPrice).padStart(6)} ETH`);
log(
  `    now reads   ${formatEther(sale.currentPrice).padStart(6)} ETH  (after ${sale.elapsed}s of decay)`,
);
log(`    floor at    ${formatEther(sale.floorPrice).padStart(6)} ETH`);

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

const record = await house.read.getAuction([sale.auctionId]);

require_(record.status === Status.Live, `the auction is ${record.status}, not Live.`);

// On a Dutch record the stored prices are the ENDS of the ramp, not the current
// price. Asserting that keeps the scenario honest about which number is which:
// a reader who takes buyNowPrice for the clock price would be 6 ETH wrong here.
require_(
  record.buyNowPrice === START_PRICE,
  `buyNowPrice should hold the START price (${formatEther(START_PRICE)} ETH), the chain` +
    ` says ${formatEther(record.buyNowPrice)} ETH.`,
);
require_(
  record.reservePrice === FLOOR_PRICE,
  `reservePrice should hold the FLOOR (${formatEther(FLOOR_PRICE)} ETH), the chain says` +
    ` ${formatEther(record.reservePrice)} ETH.`,
);

// The clock has to have actually moved. A decay window misconfigured so that
// no time passes would otherwise produce a scenario that runs green and shows
// a static number -- the exact failure this script exists to prevent.
require_(
  sale.currentPrice < START_PRICE,
  `the clock still reads its opening price, so nothing has decayed.`,
);
require_(
  sale.currentPrice > FLOOR_PRICE,
  `the clock has already reached its floor, so there is nothing left to watch.`,
);

// A Dutch listing takes no bids, so nothing should be standing against it.
require_(
  record.highestBidder === "0x0000000000000000000000000000000000000000",
  `the auction already carries a bid from ${ctx.nameOf(record.highestBidder)}, which a` +
    ` descending sale should never have before it is bought.`,
);

// The token must be escrowed, or the listing is an id with nothing behind it.
const tokenOwner = await nft.read.ownerOf([sale.tokenId]);
require_(
  tokenOwner.toLowerCase() === house.address.toLowerCase(),
  `token #${sale.tokenId} is held by ${ctx.nameOf(tokenOwner)} rather than escrowed by the house.`,
);

const fallen = START_PRICE - sale.currentPrice;
const remaining = sale.currentPrice - FLOOR_PRICE;
log(
  `\n  Fallen ${formatEther(fallen)} ETH so far, with ${formatEther(remaining)} ETH left` +
    ` before the ${formatEther(FLOOR_PRICE)} ETH floor.`,
);

await report(
  ctx,
  [
    {
      auctionId: sale.auctionId,
      note: `Dutch clock, currently ${formatEther(sale.currentPrice)} ETH`,
    },
  ],
  [
    `The price on auction #${sale.auctionId} falls on its own as blocks are mined -` +
      ` reload and it will read lower.`,
    `buyNowPrice on this record is ${formatEther(START_PRICE)} ETH, the price it OPENED at.` +
      ` The live number comes from currentPrice(), not from the struct.`,
    `Buying is buy(${sale.auctionId}) at the clock price, not bid() - bid() reverts with` +
      ` WrongFormat on a descending sale.`,
    `Overpaying is safe: the excess is credited back rather than kept.`,
  ],
);

await ctx.connection.close();

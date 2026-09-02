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
 * SCENARIO: the reserve was never met, and everybody gets their money back.
 *
 * Lists an item behind a reserve nobody in this scenario is willing to pay,
 * takes two real bids under it, runs the clock past the close and settles. The
 * outcome is `ReserveNotMet`: the seller is credited nothing, the NFT goes home,
 * and BOTH bidders hold a credit they can pull with {withdraw}.
 *
 *   npx hardhat run scripts/scenarios/reserve-not-met.ts --network localhost
 *
 * It is the scenario for the pull-payment design. Nothing is pushed at
 * settlement: a failing bidder cannot block the close, and no refund can be
 * lost to a contract that reverts on receive. The money sits in
 * `pendingReturns` until its owner comes for it, which is why the script leaves
 * both credits UNCLAIMED - the claim is the thing worth demonstrating in the
 * UI. It proves the claim would succeed by simulating it rather than by
 * spending it.
 *
 * Note the two-sided refund. The outbid bidder was credited the instant they
 * were outbid, mid-auction; the standing leader is credited at settlement.
 * Those are different code paths and the scenario exercises both.
 */

/** A reserve far above anything the scenario bids. */
const RESERVE = parseEther(process.env.SCENARIO_RESERVE ?? "50");

/** Ten minutes, so both bids land outside the anti-snipe window. */
const DURATION = 600n;

const ctx = await connect("reserve-not-met");
const { cast, house, nft } = ctx;

// ---------------------------------------------------------------------------
// List behind a reserve nobody will meet
// ---------------------------------------------------------------------------

heading("Listing");

const { auctionId, tokenId } = await listEnglish(ctx, cast.ben, {
  reserve: RESERVE,
  duration: DURATION,
});

const opened = await house.read.getAuction([auctionId]);
const closesAt = Number(opened.endTime);
log(`  Auction #${auctionId} on token #${tokenId}, listed by ${ctx.nameOf(opened.seller)}.`);
log(`  Reserve ${formatEther(RESERVE)} ETH. Closes at ${closesAt}.`);

// ---------------------------------------------------------------------------
// Two bids, both short of the reserve
// ---------------------------------------------------------------------------

heading("Bidding");

// Pinned timestamps, so the two credits below are produced by the same block
// times on every run and the event log is comparable between runs.
const outbid = await bidAt(ctx, cast.cara, auctionId, {
  at: (await chainNow(ctx)) + 1,
  amount: parseEther("1.2"),
});
log(`  ${ctx.nameOf(cast.cara.account.address)} bid ${formatEther(outbid.amount)} ETH.`);

const leading = await bidAt(ctx, cast.dev, auctionId, {
  at: outbid.at + 2,
  amount: parseEther("3.4"),
});
log(
  `  ${ctx.nameOf(cast.dev.account.address)} bid ${formatEther(leading.amount)} ETH and took the lead.`,
);
log(`  Both are below the ${formatEther(RESERVE)} ETH reserve, so neither can win.`);

require_(
  leading.amount < RESERVE,
  `the leading bid of ${formatEther(leading.amount)} ETH met the reserve; raise SCENARIO_RESERVE.`,
);

// The reserve is NOT a bid floor: under-reserve bids are accepted and refunded.
// If that ever changed, the bids above would revert rather than reach here, so
// the check is on the recorded state instead.
const bidding = await house.read.getAuction([auctionId]);
require_(
  bidding.highestBid === leading.amount,
  `expected a leading bid of ${formatEther(leading.amount)} ETH, found ${formatEther(bidding.highestBid)}.`,
);

// Snapshotted before settlement so the assertions below measure this scenario's
// effect, not a balance some earlier script left behind.
const creditBefore = {
  seller: await house.read.pendingReturns([cast.ben.account.address]),
  outbid: await house.read.pendingReturns([cast.cara.account.address]),
  leader: await house.read.pendingReturns([cast.dev.account.address]),
};

// ---------------------------------------------------------------------------
// Close it
// ---------------------------------------------------------------------------

heading("Settlement");

await fastForwardTo(ctx, closesAt + 1);
require_(
  await house.read.isSettleable([auctionId]),
  `the auction is not settleable at ${await chainNow(ctx)} with a close time of ${closesAt}.`,
);

// Settling is permissionless on purpose - that is what stops a seller freezing
// a bidder's money by refusing to close. The house owner does it here only
// because it is convenient, and using an account with no stake in the auction
// makes the point better than the seller or the leader would.
await house.write.settle([auctionId], { account: cast.owner.account });

// ---------------------------------------------------------------------------
// Verify the outcome
// ---------------------------------------------------------------------------

const settled = await house.read.getAuction([auctionId]);
require_(
  settled.status === Status.ReserveNotMet,
  `expected ReserveNotMet (${Status.ReserveNotMet}), found status ${settled.status}.`,
);

// The token goes back to the seller, and the escrow is emptied into credits.
const tokenOwner = await nft.read.ownerOf([tokenId]);
require_(
  tokenOwner.toLowerCase() === cast.ben.account.address.toLowerCase(),
  `token #${tokenId} should have gone back to the seller, but it is held by ${ctx.nameOf(tokenOwner)}.`,
);
require_(
  (await house.read.escrowOf([auctionId])) === 0n,
  `auction #${auctionId} still holds escrow after settlement.`,
);

const creditAfter = {
  seller: await house.read.pendingReturns([cast.ben.account.address]),
  outbid: await house.read.pendingReturns([cast.cara.account.address]),
  leader: await house.read.pendingReturns([cast.dev.account.address]),
};

require_(
  creditAfter.outbid - creditBefore.outbid === outbid.amount,
  `the outbid bidder should hold ${formatEther(outbid.amount)} ETH from this auction,` +
    ` found ${formatEther(creditAfter.outbid - creditBefore.outbid)}.`,
);
require_(
  creditAfter.leader - creditBefore.leader === leading.amount,
  `the leader should have been refunded ${formatEther(leading.amount)} ETH in full,` +
    ` found ${formatEther(creditAfter.leader - creditBefore.leader)}.`,
);
require_(
  creditAfter.seller === creditBefore.seller,
  `the seller was credited ${formatEther(creditAfter.seller - creditBefore.seller)} ETH` +
    ` on an auction that never sold.`,
);

// The credit is worthless if it cannot actually be pulled. Simulated rather
// than sent, so the "claim" button is still there to press in the UI.
//
// The caller is given as a bare address rather than the wallet's `Account`
// object: `simulate` needs no signer, and the address form sidesteps the two
// structurally distinct copies of viem's `Account` that the workspace resolves.
await house.simulate.withdraw({ account: cast.dev.account.address });
await house.simulate.withdraw({ account: cast.cara.account.address });

heading("Pending balances");
log(
  `  ${ctx.nameOf(cast.dev.account.address)}   ${formatEther(creditAfter.leader)} ETH  (refunded in full at settlement)`,
);
log(
  `  ${ctx.nameOf(cast.cara.account.address)}  ${formatEther(creditAfter.outbid)} ETH  (credited the moment they were outbid)`,
);
log(
  `  ${ctx.nameOf(cast.ben.account.address)}   ${formatEther(creditAfter.seller)} ETH  (the seller earned nothing, and got the token back)`,
);
log("  Both withdrawals simulate cleanly and are left unclaimed, so the claim can be shown live.");

await report(
  ctx,
  [{ auctionId, note: `closed below a ${formatEther(RESERVE)} ETH reserve` }],
  [
    `The auction reads ReserveNotMet, not Settled: bids arrived, none of them won.`,
    `Token #${tokenId} is back with ${ctx.nameOf(cast.ben.account.address)}, who was credited nothing.`,
    `${ctx.nameOf(cast.dev.account.address)} holds ${formatEther(creditAfter.leader)} ETH and` +
      ` ${ctx.nameOf(cast.cara.account.address)} holds ${formatEther(creditAfter.outbid)} ETH,` +
      ` both claimable with withdraw(). Connect either account and press claim.`,
    `Nothing was pushed at settlement. That is what makes a bidder who reverts on` +
      ` receive unable to block the close.`,
  ],
);

await ctx.connection.close();

// ---------------------------------------------------------------------------
// AuctionHouse indexing functions.
//
// One handler per event. Each handler does three kinds of work, always in this
// order, so that a reader can skim it:
//
//   1. derive     -- pure arithmetic on the event
//   2. record     -- write the lifecycle row or the ledger row
//   3. roll up    -- increment the counters that GraphQL cannot compute
//
// EVENT ORDER MATTERS. Ponder delivers logs in block order, then log order
// within a block, and the contract emits `AuctionExtended` BEFORE the
// `BidPlaced` that triggered it. Anything in here that depends on that order
// says so at the point where it does.
// ---------------------------------------------------------------------------

import { ponder } from "ponder:registry";
import {
  auction,
  auctionBidder,
  bid,
  credit,
  dailyBidder,
  nftToken,
  platformSetting,
  withdrawal,
} from "ponder:schema";
import { zeroAddress } from "viem";

import { upsertAccount, upsertBidder, upsertDaily, upsertSeller } from "./rollups";
import {
  ANTI_SNIPE_WINDOW,
  FORMAT,
  STATUS,
  avgOf,
  dayIdOf,
  decodeEnum,
  logId,
  maxBigInt,
  nullIfZero,
  rateOf,
  tokenKey,
} from "./shared";

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

ponder.on("AuctionHouse:AuctionCreated", async ({ event, context }) => {
  const { auctionId, seller: sellerAddress, nft, tokenId } = event.args;
  const timestamp = event.block.timestamp;

  // --- Derive -------------------------------------------------------------
  //
  // The format comes straight off the event. It used to be read back with
  // `getAuction`, which cost one `eth_call` PER AUCTION -- a blocking round
  // trip in the middle of the backfill loop, to learn a value the emitting
  // transaction already had in a stack slot. `AuctionCreated` now carries
  // `Format` as a uint8 in its non-indexed data, so the call is gone.
  //
  // This is also what makes `BidPlaced` legible. One event carries both an
  // English bid and a Dutch purchase, and the format is the only thing in the
  // log stream that says which of the two a reader is holding.
  const format = decodeEnum(FORMAT, event.args.format);

  // --- Record -------------------------------------------------------------
  await context.db.insert(auction).values({
    id: auctionId,
    seller: sellerAddress,
    nft,
    tokenId,
    format,
    reservePrice: event.args.reservePrice,
    buyNowPrice: event.args.buyNowPrice,
    startTime: event.args.startTime,
    scheduledEndTime: event.args.endTime,
    endTime: event.args.endTime,
    status: "Live",
    highestBidder: null,
    highestBid: 0n,
    bidCount: 0,
    uniqueBidders: 0,
    extensionCount: 0,
    secondsExtended: 0n,
    lastExtensionTxHash: null,
    winner: null,
    clearingPrice: null,
    platformFee: null,
    sellerProceeds: null,
    wasSniped: false,
    timeToSettleSeconds: null,
    deliveryFailed: false,
    nftClaimedAt: null,
    createdAt: timestamp,
    createdBlock: event.block.number,
    createdTxHash: event.transaction.hash,
    lastBidAt: null,
    closedAt: null,
  });

  // --- Roll up ------------------------------------------------------------
  await upsertSeller(context, sellerAddress, timestamp, (row) => {
    const listed = row.listed + 1;
    return {
      ...row,
      listed,
      sellThroughRate: rateOf(row.sold, listed),
      lastListedAt: timestamp,
    };
  });

  await upsertDaily(context, timestamp, (row) => ({
    ...row,
    auctionsCreated: row.auctionsCreated + 1,
  }));

  // The token may belong to a contract this indexer does not follow, so the
  // row is updated only when it exists. `update` on a missing row throws.
  const key = tokenKey(nft, tokenId);
  if (await context.db.find(nftToken, { id: key })) {
    await context.db.update(nftToken, { id: key }).set((row) => ({
      auctionCount: row.auctionCount + 1,
    }));
  }
});

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

ponder.on("AuctionHouse:BidPlaced", async ({ event, context }) => {
  const { auctionId, bidder: bidderAddress, amount, previousAmount } = event.args;
  const timestamp = event.block.timestamp;

  // --- Derive: the sniping signal -----------------------------------------
  //
  // `event.args.endTime` is the close time AFTER any extension this bid just
  // triggered, which is what makes this one comparison sufficient for all
  // three cases:
  //
  //   * an early bid            -- endTime is untouched and far away  -> false
  //   * a late bid that extends -- the contract set endTime to now + 300, so
  //                                the difference is EXACTLY 300      -> true
  //   * a late bid past the
  //     extension cap           -- endTime is untouched and near      -> true
  //
  // The third case is the one that matters most and the one a naive "did the
  // clock move" test misses: once MAX_EXTENSIONS is spent the anti-snipe rule
  // is switched off, and a bid in the last seconds is a textbook snipe. The
  // comparison is `<=`, not `<`, so the exactly-300 case counts.
  const secondsBeforeEnd = event.args.endTime - timestamp;
  const isLate = secondsBeforeEnd <= ANTI_SNIPE_WINDOW;

  // Whether THIS bid moved the clock, straight from the event.
  //
  // This was previously inferred by comparing the transaction hash the
  // `AuctionExtended` handler stamped on the row, which made a per-bid fact
  // depend on two handlers firing in the right order. `BidPlaced.extended`
  // states it directly, so the ordering no longer matters.
  //
  // Note this is NOT the same question as `isLate` above, and both are kept.
  // `extended` is "did the clock move"; `isLate` is "was this a snipe". They
  // diverge in exactly the case that matters most: once MAX_EXTENSIONS is
  // spent, a bid in the final seconds is a textbook snipe that by definition
  // cannot move the clock.
  const causedExtension = event.args.extended;
  const current = await context.db.find(auction, { id: auctionId });

  // --- Record -------------------------------------------------------------
  await context.db.insert(bid).values({
    id: logId(event.transaction.hash, event.log.logIndex),
    auctionId,
    bidder: bidderAddress,
    amount,
    previousBidder: nullIfZero(event.args.previousBidder),
    previousAmount,
    increment: amount - previousAmount,
    endTimeAfter: event.args.endTime,
    secondsBeforeEnd,
    isLate,
    causedExtension,
    timestamp,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
  });

  // `wasSniped` follows the LEADING bid, and this bid is now the leader, so it
  // is assigned rather than OR-ed. An early bid that overtakes a late one un-
  // snipes the auction, which is the honest reading: nothing was sniped if the
  // late bidder did not win.
  await context.db.update(auction, { id: auctionId }).set((row) => ({
    highestBidder: bidderAddress,
    highestBid: amount,
    endTime: event.args.endTime,
    bidCount: row.bidCount + 1,
    lastBidAt: timestamp,
    wasSniped: isLate,
  }));

  // --- Roll up ------------------------------------------------------------
  //
  // `onConflictDoNothing` returns null when the row was already there, and
  // that null is the whole distinct-count mechanism: a non-null result means
  // this address had never bid on this auction, so both counters move.
  const firstTimeOnAuction = await context.db
    .insert(auctionBidder)
    .values({ auctionId, bidder: bidderAddress, firstBidAt: timestamp })
    .onConflictDoNothing();

  if (firstTimeOnAuction !== null) {
    await context.db.update(auction, { id: auctionId }).set((row) => ({
      uniqueBidders: row.uniqueBidders + 1,
    }));
  }

  await upsertBidder(context, bidderAddress, timestamp, (row) => {
    const auctionsEntered = row.auctionsEntered + (firstTimeOnAuction !== null ? 1 : 0);
    return {
      ...row,
      bidsPlaced: row.bidsPlaced + 1,
      auctionsEntered,
      totalBidVolume: row.totalBidVolume + amount,
      highestBid: maxBigInt(row.highestBid, amount),
      lateBids: row.lateBids + (isLate ? 1 : 0),
      winRate: rateOf(row.auctionsWon, auctionsEntered),
    };
  });

  const firstTimeToday = await context.db
    .insert(dailyBidder)
    .values({ day: dayIdOf(timestamp), bidder: bidderAddress })
    .onConflictDoNothing();

  await upsertDaily(context, timestamp, (row) => ({
    ...row,
    bids: row.bids + 1,
    lateBids: row.lateBids + (isLate ? 1 : 0),
    uniqueBidders: row.uniqueBidders + (firstTimeToday !== null ? 1 : 0),
  }));
});

// ---------------------------------------------------------------------------
// Anti-snipe
// ---------------------------------------------------------------------------

ponder.on("AuctionHouse:AuctionExtended", async ({ event, context }) => {
  const { auctionId, newEndTime, extensionCount } = event.args;

  // This handler runs BEFORE the `BidPlaced` of the same transaction. The
  // transaction hash written here is read back there to decide
  // `bid.causedExtension`.
  await context.db.update(auction, { id: auctionId }).set((row) => ({
    endTime: newEndTime,
    extensionCount,
    secondsExtended: newEndTime - row.scheduledEndTime,
    lastExtensionTxHash: event.transaction.hash,
  }));

  await upsertDaily(context, event.block.timestamp, (row) => ({
    ...row,
    extensions: row.extensions + 1,
  }));
});

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

ponder.on("AuctionHouse:AuctionSettled", async ({ event, context }) => {
  const { auctionId, winner, seller: sellerAddress, amount, platformFee, outcome } = event.args;
  const timestamp = event.block.timestamp;

  const status = decodeEnum(STATUS, outcome);
  const isSale = status === "Settled";

  const row = await context.db.find(auction, { id: auctionId });

  // --- Derive -------------------------------------------------------------
  //
  // A sale is the ONLY outcome that moves money to the seller. On
  // `ReserveNotMet` the highest bid is refunded, and on `DeliveryFailed` the
  // winner is refunded in full because the token never moved -- the contract
  // is explicit that a seller is not paid for an NFT that was not delivered.
  // Counting either as volume would inflate every revenue number downstream,
  // so `amount` is folded into the rollups only when `isSale`.
  const clearingPrice = isSale ? amount : null;
  const fee = isSale ? platformFee : null;
  const proceeds = isSale ? amount - platformFee : null;

  // Settlement LATENCY, not duration: nothing settles an auction on its own,
  // so this is how long the auction sat closed before somebody called
  // `settle()`. Clamped at zero because a buy-now settles before `endTime`.
  const scheduledEnd = row?.endTime ?? timestamp;
  const timeToSettleSeconds = timestamp > scheduledEnd ? timestamp - scheduledEnd : 0n;

  const hadBids = (row?.bidCount ?? 0) > 0;
  const wasExtended = (row?.extensionCount ?? 0) > 0;

  // --- Record -------------------------------------------------------------
  await context.db.update(auction, { id: auctionId }).set({
    status,
    winner: nullIfZero(winner),
    clearingPrice,
    platformFee: fee,
    sellerProceeds: proceeds,
    timeToSettleSeconds,
    closedAt: timestamp,
    // A snipe needs a winner. Without one there was nothing to snipe.
    wasSniped: (row?.wasSniped ?? false) && winner !== zeroAddress,
  });

  // --- Roll up ------------------------------------------------------------
  await upsertSeller(context, sellerAddress, timestamp, (current) => {
    const sold = current.sold + (isSale ? 1 : 0);
    const grossVolume = current.grossVolume + (clearingPrice ?? 0n);
    return {
      ...current,
      sold,
      reserveMissed: current.reserveMissed + (status === "ReserveNotMet" ? 1 : 0),
      deliveryFailed: current.deliveryFailed + (status === "DeliveryFailed" ? 1 : 0),
      noBids: current.noBids + (!isSale && !hadBids ? 1 : 0),
      grossVolume,
      netVolume: current.netVolume + (proceeds ?? 0n),
      feesPaid: current.feesPaid + (fee ?? 0n),
      avgClearingPrice: avgOf(grossVolume, sold),
      sellThroughRate: rateOf(sold, current.listed),
    };
  });

  if (isSale && winner !== zeroAddress) {
    await upsertBidder(context, winner, timestamp, (current) => {
      const auctionsWon = current.auctionsWon + 1;
      return {
        ...current,
        auctionsWon,
        // The clearing price, not the sum of this account's bids: every losing
        // bid was refunded in full, so bids are not spending.
        totalSpent: current.totalSpent + amount,
        winRate: rateOf(auctionsWon, current.auctionsEntered),
      };
    });
  }

  await upsertDaily(context, timestamp, (current) => {
    const auctionsClosed = current.auctionsClosed + 1;
    const sales = current.sales + (isSale ? 1 : 0);
    const volume = current.volume + (clearingPrice ?? 0n);
    const extendedAuctions = current.extendedAuctions + (wasExtended ? 1 : 0);
    return {
      ...current,
      auctionsClosed,
      sales,
      volume,
      fees: current.fees + (fee ?? 0n),
      avgClearingPrice: avgOf(volume, sales),
      extendedAuctions,
      extensionRate: rateOf(extendedAuctions, auctionsClosed),
    };
  });
});

ponder.on("AuctionHouse:AuctionCancelled", async ({ event, context }) => {
  const { auctionId, seller: sellerAddress } = event.args;
  const timestamp = event.block.timestamp;

  await context.db.update(auction, { id: auctionId }).set({
    status: "Cancelled",
    closedAt: timestamp,
  });

  await upsertSeller(context, sellerAddress, timestamp, (row) => ({
    ...row,
    cancelled: row.cancelled + 1,
    // The denominator does not change, so the rate has to be recomputed here
    // too: a cancellation makes a seller's sell-through worse, and leaving the
    // stale value would quietly reward cancelling.
    sellThroughRate: rateOf(row.sold, row.listed),
  }));

  // A cancelled auction is a closed auction for the daily series. It is NOT a
  // sale, so it moves `auctionsClosed` and the extension rate's denominator
  // only.
  await upsertDaily(context, timestamp, (row) => {
    const auctionsClosed = row.auctionsClosed + 1;
    return {
      ...row,
      auctionsClosed,
      extensionRate: rateOf(row.extendedAuctions, auctionsClosed),
    };
  });
});

// ---------------------------------------------------------------------------
// Escrow failures
// ---------------------------------------------------------------------------

ponder.on("AuctionHouse:NftReleaseFailed", async ({ event, context }) => {
  // The token is stuck in escrow and recoverable with `claimNft`. This flag is
  // what a client needs to show the "claim your NFT" affordance, and it is set
  // separately from `status` because a release can fail on a cancellation too.
  await context.db.update(auction, { id: event.args.auctionId }).set({ deliveryFailed: true });
});

ponder.on("AuctionHouse:NftClaimed", async ({ event, context }) => {
  await context.db
    .update(auction, { id: event.args.auctionId })
    .set({ nftClaimedAt: event.block.timestamp });
  // The token's `owner` is not written here. `claimNft` performs a real ERC-721
  // transfer, so the `DemoNFT:Transfer` handler records the move -- and it
  // records it for tokens from any followed collection, not just this path.
});

// ---------------------------------------------------------------------------
// Money movement
// ---------------------------------------------------------------------------

ponder.on("AuctionHouse:RefundCredited", async ({ event, context }) => {
  const { account: address, auctionId, amount } = event.args;
  const timestamp = event.block.timestamp;

  await context.db.insert(credit).values({
    id: logId(event.transaction.hash, event.log.logIndex),
    account: address,
    auctionId,
    amount,
    timestamp,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
  });

  await upsertAccount(context, address, timestamp, (row) => ({
    ...row,
    totalCredited: row.totalCredited + amount,
    creditCount: row.creditCount + 1,
  }));
});

ponder.on("AuctionHouse:Withdrawal", async ({ event, context }) => {
  const { account: address, amount } = event.args;
  const timestamp = event.block.timestamp;

  await context.db.insert(withdrawal).values({
    id: logId(event.transaction.hash, event.log.logIndex),
    account: address,
    amount,
    timestamp,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
  });

  await upsertAccount(context, address, timestamp, (row) => ({
    ...row,
    totalWithdrawn: row.totalWithdrawn + amount,
    withdrawalCount: row.withdrawalCount + 1,
  }));
});

// ---------------------------------------------------------------------------
// Protocol settings
//
// One row, id "platform". Both handlers upsert because either event can be the
// first one seen: the fee and the recipient are set independently.
// ---------------------------------------------------------------------------

ponder.on("AuctionHouse:PlatformFeeUpdated", async ({ event, context }) => {
  const timestamp = event.block.timestamp;
  await context.db
    .insert(platformSetting)
    .values({
      id: "platform",
      feeBps: event.args.newBps,
      feeRecipient: null,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({ feeBps: event.args.newBps, updatedAt: timestamp });
});

ponder.on("AuctionHouse:FeeRecipientUpdated", async ({ event, context }) => {
  const timestamp = event.block.timestamp;
  const recipient = nullIfZero(event.args.newRecipient);
  await context.db
    .insert(platformSetting)
    .values({ id: "platform", feeBps: 0, feeRecipient: recipient, updatedAt: timestamp })
    .onConflictDoUpdate({ feeRecipient: recipient, updatedAt: timestamp });
});

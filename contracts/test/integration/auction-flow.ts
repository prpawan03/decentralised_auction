import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, parseEther } from "viem";

import {
  FEE_BPS,
  Status,
  deployAuctionHouse,
  listAuction,
  withdrawAndMeasure,
} from "../helpers/auction-fixture.js";

/**
 * The headline multi-step flow: one seller lists, three bidders outbid each
 * other, a stranger settles, and every loser pulls their money back.
 *
 * These are integration tests. Single-function edge cases and fuzzing live in
 * the Solidity suite, which is the only runner that can drive a fuzzer.
 */
const { viem, networkHelpers } = await network.create();

describe("AuctionHouse — list, outbid, settle, withdraw", () => {
  it("runs a three-bidder auction end to end and pays everyone correctly", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, nft, deployer, feeSink, seller, alice, bob, carol } = fixture;
    const { auctionId, tokenId } = await listAuction(fixture, seller, {
      reserve: parseEther("1"),
    });

    // The NFT is escrowed the moment the auction opens, not at settlement.
    assert.equal(await nft.read.ownerOf([tokenId]), getAddress(house.address));

    // --- Three bidders climb over each other -----------------------------
    await house.write.bid([auctionId], { account: alice.account, value: parseEther("1") });

    await viem.assertions.emitWithArgs(
      house.write.bid([auctionId], { account: bob.account, value: parseEther("1.5") }),
      house,
      "BidPlaced",
      [
        auctionId,
        getAddress(bob.account.address),
        parseEther("1.5"),
        getAddress(alice.account.address),
        parseEther("1"),
        (endTime: bigint) => endTime > 0n,
        // This bid lands far from the close, so it must NOT have moved the
        // clock. Asserting false here is what makes the true case in
        // anti-snipe.ts meaningful: without it, a flag stuck on one value
        // would pass both suites.
        false,
      ],
    );

    await house.write.bid([auctionId], { account: carol.account, value: parseEther("2") });

    // Nothing was pushed: both losers hold a credit, not a transfer.
    assert.equal(await house.read.pendingReturns([alice.account.address]), parseEther("1"));
    assert.equal(await house.read.pendingReturns([bob.account.address]), parseEther("1.5"));
    assert.equal(await house.read.escrowOf([auctionId]), parseEther("2"));

    const auction = await house.read.getAuction([auctionId]);
    assert.equal(auction.highestBidder, getAddress(carol.account.address));
    assert.equal(auction.highestBid, parseEther("2"));
    assert.equal(auction.status, Status.Live);

    // --- A stranger settles it -------------------------------------------
    await networkHelpers.time.increaseTo(Number(auction.endTime));
    assert.equal(await house.read.isSettleable([auctionId]), true);

    const fee = (parseEther("2") * FEE_BPS) / 10_000n;
    await viem.assertions.emitWithArgs(
      // `deployer` is neither the seller nor a bidder. Anyone may settle.
      house.write.settle([auctionId], { account: deployer.account }),
      house,
      "AuctionSettled",
      [
        auctionId,
        getAddress(carol.account.address),
        getAddress(seller.account.address),
        parseEther("2"),
        fee,
        Status.Settled,
      ],
    );

    // The winner holds the token, and the split is exact.
    assert.equal(await nft.read.ownerOf([tokenId]), getAddress(carol.account.address));
    assert.equal(await house.read.pendingReturns([seller.account.address]), parseEther("2") - fee);
    assert.equal(await house.read.pendingReturns([feeSink.account.address]), fee);
    assert.equal(await house.read.escrowOf([auctionId]), 0n);

    // --- The losers pull their money back ---------------------------------
    assert.equal(await withdrawAndMeasure(viem, house, alice), parseEther("1"));
    assert.equal(await withdrawAndMeasure(viem, house, bob), parseEther("1.5"));
    assert.equal(await house.read.pendingReturns([alice.account.address]), 0n);
    assert.equal(await house.read.pendingReturns([bob.account.address]), 0n);

    // --- And the house empties out to the wei ----------------------------
    assert.equal(await withdrawAndMeasure(viem, house, seller), parseEther("2") - fee);
    assert.equal(await withdrawAndMeasure(viem, house, feeSink), fee);

    const publicClient = await viem.getPublicClient();
    assert.equal(await publicClient.getBalance({ address: house.address }), 0n);
  });

  it("rejects a second withdrawal once the credit is spent", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, seller, alice, bob } = fixture;
    const { auctionId } = await listAuction(fixture, seller);

    await house.write.bid([auctionId], { account: alice.account, value: parseEther("1") });
    await house.write.bid([auctionId], { account: bob.account, value: parseEther("2") });

    await house.write.withdraw({ account: alice.account });
    await viem.assertions.revertWithCustomError(
      house.write.withdraw({ account: alice.account }),
      house,
      "NothingToWithdraw",
    );
  });

  it("keeps a bid below the increment out of the book", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, seller, alice, bob } = fixture;
    const { auctionId } = await listAuction(fixture, seller);

    await house.write.bid([auctionId], { account: alice.account, value: parseEther("1") });

    // The step is 5% of the leading bid, so 1.04 must be refused.
    assert.equal(await house.read.minimumBid([auctionId]), parseEther("1.05"));
    await viem.assertions.revertWithCustomErrorWithArgs(
      house.write.bid([auctionId], { account: bob.account, value: parseEther("1.04") }),
      house,
      "BidTooLow",
      [parseEther("1.05"), parseEther("1.04")],
    );
  });

  it("stops the seller bidding on their own item", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, seller } = fixture;
    const { auctionId } = await listAuction(fixture, seller);

    await viem.assertions.revertWithCustomError(
      house.write.bid([auctionId], { account: seller.account, value: parseEther("1") }),
      house,
      "SellerCannotBid",
    );
  });

  it("pages the auction list and clamps an oversized limit", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, seller } = fixture;
    for (let i = 0; i < 4; i++) {
      await listAuction(fixture, seller);
    }

    assert.equal((await house.read.getAuctions([0n, 10_000n])).length, 4);
    assert.equal((await house.read.getAuctions([2n, 2n])).length, 2);
    assert.equal((await house.read.getAuctions([99n, 10n])).length, 0);
  });
});

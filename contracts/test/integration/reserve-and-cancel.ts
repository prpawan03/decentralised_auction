import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, parseEther } from "viem";

import {
  Status,
  deployAuctionHouse,
  listAuction,
  withdrawAndMeasure,
} from "../helpers/auction-fixture.js";

/**
 * The two ways an auction ends without a sale:
 *
 * - It closes below the reserve. The bidder is refunded in full and the NFT
 *   goes back to the seller.
 * - The seller cancels before any bid arrives.
 *
 * Both paths must leave the house exactly as solvent as it was.
 */
const { viem, networkHelpers } = await network.create();

describe("AuctionHouse — reserve not met", () => {
  it("refunds the bidder in full and returns the NFT to the seller", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, nft, feeSink, seller, alice, deployer } = fixture;
    const { auctionId, tokenId } = await listAuction(fixture, seller, {
      reserve: parseEther("10"),
    });

    // A bid below the reserve is still a legal bid. The reserve is not a floor.
    await house.write.bid([auctionId], { account: alice.account, value: parseEther("1") });
    assert.equal(await house.read.minimumBid([auctionId]), parseEther("1.05"));

    const auction = await house.read.getAuction([auctionId]);
    await networkHelpers.time.increaseTo(Number(auction.endTime));

    await viem.assertions.emitWithArgs(
      house.write.settle([auctionId], { account: deployer.account }),
      house,
      "AuctionSettled",
      [
        auctionId,
        // No winner: the reserve was not met.
        "0x0000000000000000000000000000000000000000",
        getAddress(seller.account.address),
        parseEther("1"),
        0n,
        Status.ReserveNotMet,
      ],
    );

    const settled = await house.read.getAuction([auctionId]);
    assert.equal(settled.status, Status.ReserveNotMet);

    // Every wei goes back to the bidder. The seller and the fee sink get nothing.
    assert.equal(await house.read.pendingReturns([alice.account.address]), parseEther("1"));
    assert.equal(await house.read.pendingReturns([seller.account.address]), 0n);
    assert.equal(await house.read.pendingReturns([feeSink.account.address]), 0n);
    assert.equal(await nft.read.ownerOf([tokenId]), getAddress(seller.account.address));

    assert.equal(await withdrawAndMeasure(viem, house, alice), parseEther("1"));

    const publicClient = await viem.getPublicClient();
    assert.equal(await publicClient.getBalance({ address: house.address }), 0n);
  });

  it("treats an auction that got no bids at all the same way", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, nft, seller, deployer } = fixture;
    const { auctionId, tokenId } = await listAuction(fixture, seller);

    const auction = await house.read.getAuction([auctionId]);
    await networkHelpers.time.increaseTo(Number(auction.endTime));
    await house.write.settle([auctionId], { account: deployer.account });

    assert.equal(
      await house.read.getAuction([auctionId]).then((a) => a.status),
      Status.ReserveNotMet,
    );
    assert.equal(await nft.read.ownerOf([tokenId]), getAddress(seller.account.address));
  });

  it("settles at the reserve exactly, not one wei above it", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, seller, alice, deployer } = fixture;
    const { auctionId } = await listAuction(fixture, seller, { reserve: parseEther("1") });

    await house.write.bid([auctionId], { account: alice.account, value: parseEther("1") });

    const auction = await house.read.getAuction([auctionId]);
    await networkHelpers.time.increaseTo(Number(auction.endTime));
    await house.write.settle([auctionId], { account: deployer.account });

    assert.equal(await house.read.getAuction([auctionId]).then((a) => a.status), Status.Settled);
  });
});

describe("AuctionHouse — cancelling", () => {
  it("returns the NFT when the seller cancels before any bid", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, nft, seller } = fixture;
    const { auctionId, tokenId } = await listAuction(fixture, seller);

    await viem.assertions.emitWithArgs(
      house.write.cancelAuction([auctionId], { account: seller.account }),
      house,
      "AuctionCancelled",
      [auctionId, getAddress(seller.account.address)],
    );

    assert.equal(await house.read.getAuction([auctionId]).then((a) => a.status), Status.Cancelled);
    assert.equal(await nft.read.ownerOf([tokenId]), getAddress(seller.account.address));
    assert.equal(await house.read.timeRemaining([auctionId]), 0n);
  });

  it("refuses to cancel once a bid is standing", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, seller, alice } = fixture;
    const { auctionId } = await listAuction(fixture, seller);

    await house.write.bid([auctionId], { account: alice.account, value: parseEther("1") });

    await viem.assertions.revertWithCustomError(
      house.write.cancelAuction([auctionId], { account: seller.account }),
      house,
      "AuctionHasBids",
    );
  });

  it("refuses to let anyone but the seller cancel", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, seller, alice } = fixture;
    const { auctionId } = await listAuction(fixture, seller);

    await viem.assertions.revertWithCustomErrorWithArgs(
      house.write.cancelAuction([auctionId], { account: alice.account }),
      house,
      "NotSeller",
      [getAddress(alice.account.address), getAddress(seller.account.address)],
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { parseEther } from "viem";

import { deployAuctionHouse, listAuction } from "../helpers/auction-fixture.js";

/**
 * Anti-snipe: a bid that lands inside the last five minutes pushes the close
 * time out, so nobody can win by bidding one second before the end.
 *
 * The extension is capped, so an auction always terminates. That cap is the
 * other half of the property, and it is proved here and in the Solidity suite.
 */
const { viem, networkHelpers } = await network.create();

const TEN_MINUTES = 600n;

describe("AuctionHouse — anti-snipe extension", () => {
  it("pushes the close time out when a bid lands inside the window", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, seller, alice } = fixture;
    const { auctionId } = await listAuction(fixture, seller, { duration: TEN_MINUTES });

    const before = await house.read.getAuction([auctionId]);
    const window = await house.read.ANTI_SNIPE_WINDOW();

    // Move to 30 seconds before the close: well inside the window.
    await networkHelpers.time.increaseTo(Number(before.endTime) - 30);

    await viem.assertions.emit(
      house.write.bid([auctionId], { account: alice.account, value: parseEther("1") }),
      house,
      "AuctionExtended",
    );

    const after = await house.read.getAuction([auctionId]);
    assert.equal(after.extensionCount, 1);
    assert.ok(after.endTime > before.endTime, "the close time did not move");
    // The new close time is exactly one full window from the bid.
    assert.equal(after.endTime - BigInt(await networkHelpers.time.latest()), window);
  });

  it("leaves an early bid alone", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, seller, alice } = fixture;
    const { auctionId } = await listAuction(fixture, seller, { duration: 3600n });

    const before = await house.read.getAuction([auctionId]);
    await house.write.bid([auctionId], { account: alice.account, value: parseEther("1") });

    const after = await house.read.getAuction([auctionId]);
    assert.equal(after.endTime, before.endTime, "an early bid must not extend the auction");
    assert.equal(after.extensionCount, 0);
  });

  it("stops extending at the cap, so the auction always ends", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, seller, alice, bob, carol } = fixture;
    // A one minute auction sits entirely inside the window, so every bid extends.
    const { auctionId } = await listAuction(fixture, seller, { duration: 60n });

    const cap = await house.read.MAX_EXTENSIONS();

    for (let i = 0; i < cap; i++) {
      const auction = await house.read.getAuction([auctionId]);
      const amount = await house.read.minimumBid([auctionId]);
      // setNextBlockTimestamp, not increaseTo: `increaseTo` mines a block of its
      // own, so the bid would land a second later and miss the window.
      await networkHelpers.time.setNextBlockTimestamp(Number(auction.endTime) - 1);

      const bidder = i % 2 === 0 ? alice : bob;
      await house.write.bid([auctionId], { account: bidder.account, value: amount });

      const updated = await house.read.getAuction([auctionId]);
      assert.ok(updated.extensionCount <= cap, "invariant 5: the extension cap was breached");
    }

    const capped = await house.read.getAuction([auctionId]);
    assert.equal(capped.extensionCount, cap);

    // One more bid, still comfortably inside the window. The clock MUST NOT move.
    const amount = await house.read.minimumBid([auctionId]);
    await networkHelpers.time.setNextBlockTimestamp(Number(capped.endTime) - 60);
    await house.write.bid([auctionId], { account: carol.account, value: amount });

    const after = await house.read.getAuction([auctionId]);
    assert.equal(after.endTime, capped.endTime, "a capped auction was extended again");
    assert.equal(after.extensionCount, cap);

    // And so the auction actually reaches its end.
    await networkHelpers.time.increaseTo(Number(after.endTime));
    assert.equal(await house.read.isSettleable([auctionId]), true);
  });

  it("refuses a bid that lands at the close time", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, seller, alice } = fixture;
    const { auctionId } = await listAuction(fixture, seller, { duration: TEN_MINUTES });

    const auction = await house.read.getAuction([auctionId]);
    await networkHelpers.time.increaseTo(Number(auction.endTime));

    // Invariant 3: no bid is accepted at or after endTime.
    await viem.assertions.revertWithCustomErrorWithArgs(
      house.write.bid([auctionId], { account: alice.account, value: parseEther("1") }),
      house,
      "AuctionAlreadyEnded",
      [auctionId],
    );
  });
});

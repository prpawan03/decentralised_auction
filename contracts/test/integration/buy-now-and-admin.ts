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
 * Buy-now and the admin surface.
 *
 * `buyNowPrice == 0` means disabled, never free, and pausing must never stop
 * anyone getting their money out.
 */
const { viem, networkHelpers } = await network.create();

describe("AuctionHouse — buy now", () => {
  it("settles in the same transaction and refunds the standing bidder", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, nft, feeSink, seller, alice, bob } = fixture;
    const { auctionId, tokenId } = await listAuction(fixture, seller, {
      reserve: parseEther("1"),
      buyNow: parseEther("5"),
    });

    await house.write.bid([auctionId], { account: alice.account, value: parseEther("1") });

    await viem.assertions.emit(
      house.write.buyNow([auctionId], { account: bob.account, value: parseEther("5") }),
      house,
      "AuctionSettled",
    );

    const auction = await house.read.getAuction([auctionId]);
    assert.equal(auction.status, Status.Settled);
    assert.equal(auction.highestBidder, getAddress(bob.account.address));
    assert.equal(await nft.read.ownerOf([tokenId]), getAddress(bob.account.address));

    // The outbid account is made whole, and the split is exact.
    const fee = (parseEther("5") * FEE_BPS) / 10_000n;
    assert.equal(await house.read.pendingReturns([alice.account.address]), parseEther("1"));
    assert.equal(await house.read.pendingReturns([seller.account.address]), parseEther("5") - fee);
    assert.equal(await house.read.pendingReturns([feeSink.account.address]), fee);
    assert.equal(await house.read.escrowOf([auctionId]), 0n);

    assert.equal(await withdrawAndMeasure(viem, house, alice), parseEther("1"));
  });

  it("treats a zero buy-now price as disabled, never as free", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, nft, seller, alice } = fixture;
    // No buy-now price was set on this listing.
    const { auctionId, tokenId } = await listAuction(fixture, seller);

    await viem.assertions.revertWithCustomErrorWithArgs(
      house.write.buyNow([auctionId], { account: alice.account, value: 0n }),
      house,
      "BuyNowDisabled",
      [auctionId],
    );

    assert.equal(await nft.read.ownerOf([tokenId]), getAddress(house.address));
    assert.equal(await house.read.getAuction([auctionId]).then((a) => a.status), Status.Live);
  });

  it("requires the exact price", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, seller, alice } = fixture;
    const { auctionId } = await listAuction(fixture, seller, { buyNow: parseEther("5") });

    await viem.assertions.revertWithCustomErrorWithArgs(
      house.write.buyNow([auctionId], { account: alice.account, value: parseEther("4") }),
      house,
      "IncorrectPayment",
      [parseEther("5"), parseEther("4")],
    );
  });

  it("closes buy-now once bidding passes it", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, seller, alice, bob } = fixture;
    const { auctionId } = await listAuction(fixture, seller, { buyNow: parseEther("5") });

    await house.write.bid([auctionId], { account: alice.account, value: parseEther("6") });

    await viem.assertions.revertWithCustomErrorWithArgs(
      house.write.buyNow([auctionId], { account: bob.account, value: parseEther("5") }),
      house,
      "BuyNowDisabled",
      [auctionId],
    );
  });

  it("refuses a listing whose buy-now price is below the reserve", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, nft, seller } = fixture;

    const tokenId = await nft.read.totalMinted();
    await nft.write.mint([seller.account.address, "ipfs://demo/item.json"], {
      account: seller.account,
    });
    await nft.write.approve([house.address, tokenId], { account: seller.account });

    await viem.assertions.revertWithCustomErrorWithArgs(
      house.write.createAuction(
        [nft.address, tokenId, parseEther("2"), parseEther("1"), 3600n],
        { account: seller.account },
      ),
      house,
      "InvalidBuyNowPrice",
      [parseEther("1"), parseEther("2")],
    );
  });
});

describe("AuctionHouse — admin", () => {
  it("blocks bidding while paused but never blocks settle or withdraw", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, deployer, seller, alice, bob } = fixture;
    const { auctionId } = await listAuction(fixture, seller);

    await house.write.bid([auctionId], { account: alice.account, value: parseEther("1") });
    await house.write.bid([auctionId], { account: bob.account, value: parseEther("2") });

    await house.write.pause({ account: deployer.account });

    await viem.assertions.revertWithCustomError(
      house.write.bid([auctionId], { account: alice.account, value: parseEther("3") }),
      house,
      "EnforcedPause",
    );

    // Invariant 7: both of these MUST still work while the house is paused.
    const auction = await house.read.getAuction([auctionId]);
    await networkHelpers.time.increaseTo(Number(auction.endTime));
    await house.write.settle([auctionId], { account: deployer.account });

    assert.equal(await house.read.getAuction([auctionId]).then((a) => a.status), Status.Settled);
    assert.equal(await withdrawAndMeasure(viem, house, alice), parseEther("1"));
    assert.ok((await withdrawAndMeasure(viem, house, seller)) > 0n);

    await house.write.unpause({ account: deployer.account });
  });

  it("caps the platform fee in code", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, deployer } = fixture;
    const cap = await house.read.MAX_FEE_BPS();

    await house.write.setPlatformFee([cap], { account: deployer.account });
    assert.equal(await house.read.platformFeeBps(), cap);

    await viem.assertions.revertWithCustomErrorWithArgs(
      house.write.setPlatformFee([cap + 1], { account: deployer.account }),
      house,
      "FeeTooHigh",
      [cap + 1, cap],
    );
  });

  it("transfers ownership in two steps", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, deployer, alice } = fixture;

    await house.write.transferOwnership([alice.account.address], { account: deployer.account });
    assert.equal(await house.read.owner(), getAddress(deployer.account.address));
    assert.equal(await house.read.pendingOwner(), getAddress(alice.account.address));

    await house.write.acceptOwnership({ account: alice.account });
    assert.equal(await house.read.owner(), getAddress(alice.account.address));
  });

  it("refuses admin calls from anyone else", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, alice } = fixture;

    await viem.assertions.revertWithCustomErrorWithArgs(
      house.write.pause({ account: alice.account }),
      house,
      "OwnableUnauthorizedAccount",
      [getAddress(alice.account.address)],
    );
    await viem.assertions.revertWithCustomError(
      house.write.setPlatformFee([100], { account: alice.account }),
      house,
      "OwnableUnauthorizedAccount",
    );
  });
});

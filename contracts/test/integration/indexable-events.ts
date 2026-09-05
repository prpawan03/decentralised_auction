import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, parseEther, zeroAddress } from "viem";

import { ONE_HOUR, deployAuctionHouse, listAuction } from "../helpers/auction-fixture.js";

/**
 * The two event fields that exist for READERS rather than for the contract.
 *
 * Neither `format` on {AuctionCreated} nor `extended` on {BidPlaced} changes
 * what the contract does. Both exist so that the log stream is self-sufficient:
 * an indexer that sees only events, and never makes a contract call, can still
 * answer "which format is this" and "was this bid a snipe".
 *
 * That is exactly what makes them easy to break silently — nothing reverts if
 * they are wrong. Hence this suite, and hence the negative cases: a flag
 * asserted only in its true case would still pass if it were wired to a
 * constant.
 */
const { viem, networkHelpers } = await network.create();

/** `Format` in declaration order. Members are append-only, so the numbering is load bearing. */
const Format = { English: 0, Dutch: 1 } as const;

describe("Indexable events — AuctionCreated.format", () => {
  it("reports English for an ascending listing", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, nft, seller } = fixture;

    const tokenId = await nft.read.totalMinted();
    await nft.write.mint([seller.account.address, "ipfs://demo/item.json"], {
      account: seller.account,
    });
    await nft.write.approve([house.address, tokenId], { account: seller.account });

    await viem.assertions.emitWithArgs(
      house.write.createAuction([nft.address, tokenId, 0n, 0n, ONE_HOUR], {
        account: seller.account,
      }),
      house,
      "AuctionCreated",
      [
        (id: bigint) => id >= 0n,
        getAddress(seller.account.address),
        getAddress(nft.address),
        tokenId,
        0n,
        0n,
        (startTime: bigint) => startTime > 0n,
        (endTime: bigint) => endTime > 0n,
        Format.English,
      ],
    );
  });

  it("reports Dutch for a descending listing", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, nft, seller } = fixture;

    const tokenId = await nft.read.totalMinted();
    await nft.write.mint([seller.account.address, "ipfs://demo/item.json"], {
      account: seller.account,
    });
    await nft.write.approve([house.address, tokenId], { account: seller.account });

    await viem.assertions.emitWithArgs(
      house.write.createDutchAuction(
        [nft.address, tokenId, parseEther("8"), parseEther("2"), ONE_HOUR],
        { account: seller.account },
      ),
      house,
      "AuctionCreated",
      [
        (id: bigint) => id >= 0n,
        getAddress(seller.account.address),
        getAddress(nft.address),
        tokenId,
        // The floor goes in reservePrice and the start in buyNowPrice.
        parseEther("2"),
        parseEther("8"),
        (startTime: bigint) => startTime > 0n,
        (endTime: bigint) => endTime > 0n,
        Format.Dutch,
      ],
    );
  });

  it("separates the two formats inside one shared auction id space", async () => {
    // This is why the field has to be on the event at all. Both formats share
    // one id space, one escrow pool and one BidPlaced event, so `format` is the
    // only thing in the log stream that says which rules produced a sale.
    const fixture = await deployAuctionHouse(viem);
    const { house, nft, seller } = fixture;

    const englishToken = await nft.read.totalMinted();
    await nft.write.mint([seller.account.address, "ipfs://demo/item.json"], {
      account: seller.account,
    });
    await nft.write.approve([house.address, englishToken], { account: seller.account });
    await house.write.createAuction([nft.address, englishToken, 0n, 0n, ONE_HOUR], {
      account: seller.account,
    });

    const dutchToken = await nft.read.totalMinted();
    await nft.write.mint([seller.account.address, "ipfs://demo/item.json"], {
      account: seller.account,
    });
    await nft.write.approve([house.address, dutchToken], { account: seller.account });
    await house.write.createDutchAuction(
      [nft.address, dutchToken, parseEther("8"), parseEther("2"), ONE_HOUR],
      { account: seller.account },
    );

    const events = await house.getEvents.AuctionCreated(undefined, { fromBlock: 0n });
    assert.deepEqual(
      events.map((event) => Number(event.args.format)),
      [Format.English, Format.Dutch],
    );
  });
});

describe("Indexable events — BidPlaced.extended", () => {
  it("is false for a bid placed far from the close", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, alice } = fixture;
    const { auctionId } = await listAuction(fixture, fixture.seller, { duration: ONE_HOUR });

    await viem.assertions.emitWithArgs(
      house.write.bid([auctionId], { account: alice.account, value: parseEther("1") }),
      house,
      "BidPlaced",
      [
        auctionId,
        getAddress(alice.account.address),
        parseEther("1"),
        zeroAddress,
        0n,
        (endTime: bigint) => endTime > 0n,
        false,
      ],
    );
  });

  it("is true for a bid inside the anti-snipe window, and the clock really moved", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, alice, bob } = fixture;
    const { auctionId } = await listAuction(fixture, fixture.seller, { duration: ONE_HOUR });

    await house.write.bid([auctionId], { account: alice.account, value: parseEther("1") });
    const before = await house.read.getAuction([auctionId]);

    // Land the next bid one minute from the close, well inside ANTI_SNIPE_WINDOW.
    await networkHelpers.time.setNextBlockTimestamp(Number(before.endTime) - 60);
    await viem.assertions.emitWithArgs(
      house.write.bid([auctionId], { account: bob.account, value: parseEther("2") }),
      house,
      "BidPlaced",
      [
        auctionId,
        getAddress(bob.account.address),
        parseEther("2"),
        getAddress(alice.account.address),
        parseEther("1"),
        (endTime: bigint) => endTime > before.endTime,
        true,
      ],
    );

    // The flag has to agree with the state it claims to describe. Asserting the
    // flag alone would pass on a contract that emitted true and moved nothing.
    const after = await house.read.getAuction([auctionId]);
    assert.ok(after.endTime > before.endTime, "the close must have moved");
    assert.equal(after.extensionCount, before.extensionCount + 1);
  });

  it("is false for a buy-now purchase, which ends the auction rather than extending it", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, alice } = fixture;
    const { auctionId } = await listAuction(fixture, fixture.seller, {
      buyNow: parseEther("5"),
      duration: ONE_HOUR,
    });

    await viem.assertions.emitWithArgs(
      house.write.buyNow([auctionId], { account: alice.account, value: parseEther("5") }),
      house,
      "BidPlaced",
      [
        auctionId,
        getAddress(alice.account.address),
        parseEther("5"),
        zeroAddress,
        0n,
        (endTime: bigint) => endTime > 0n,
        false,
      ],
    );
  });

  it("is false for a Dutch purchase, which has no clock to move", async () => {
    const fixture = await deployAuctionHouse(viem);
    const { house, nft, seller, alice } = fixture;

    const tokenId = await nft.read.totalMinted();
    await nft.write.mint([seller.account.address, "ipfs://demo/item.json"], {
      account: seller.account,
    });
    await nft.write.approve([house.address, tokenId], { account: seller.account });
    await house.write.createDutchAuction(
      [nft.address, tokenId, parseEther("8"), parseEther("2"), ONE_HOUR],
      { account: seller.account },
    );
    const auctionId = (await house.read.totalAuctions()) - 1n;

    await viem.assertions.emitWithArgs(
      house.write.buy([auctionId], { account: alice.account, value: parseEther("8") }),
      house,
      "BidPlaced",
      [
        auctionId,
        getAddress(alice.account.address),
        (amount: bigint) => amount > 0n,
        zeroAddress,
        0n,
        (endTime: bigint) => endTime > 0n,
        false,
      ],
    );
  });
});

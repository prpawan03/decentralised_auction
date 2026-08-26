import type { HardhatViemHelpers } from "@nomicfoundation/hardhat-viem/types";
import type { DefaultChainType } from "hardhat/types/network";

/**
 * Shared fixture for the TypeScript integration suites.
 *
 * It lives outside `test/integration` on purpose: that directory is the
 * node:test root, and every file in it is collected as a test file.
 */

/** The viem helper bag handed out by `network.create()`. */
export type Viem = HardhatViemHelpers<DefaultChainType>;

/** The platform fee the fixture deploys with: 2.5%. */
export const FEE_BPS = 250n;

/** The default auction length used by {@link listAuction}. */
export const ONE_HOUR = 3600n;

/**
 * `AuctionHouse.Status`, in declaration order.
 *
 * `DeliveryFailed` means the auction sold but the token could not be handed
 * over, so the sale was voided: the winner holds a full refund, the seller was
 * credited nothing, and the token is owed back to the seller.
 */
export const Status = {
  Live: 0,
  Settled: 1,
  Cancelled: 2,
  ReserveNotMet: 3,
  DeliveryFailed: 4,
} as const;

/** Everything a test needs: a fresh house, a fresh collection, and six accounts. */
export type Fixture = Awaited<ReturnType<typeof deployAuctionHouse>>;

/** A single funded account from the configured mnemonic. */
export type Actor = Fixture["alice"];

/**
 * Deploys a fresh `AuctionHouse` and `DemoNFT`, so no test can see another
 * test's auctions.
 *
 * @param viem The viem helpers from `network.create()`.
 */
export async function deployAuctionHouse(viem: Viem) {
  const [deployer, feeSink, seller, alice, bob, carol] = await viem.getWalletClients();

  const house = await viem.deployContract("AuctionHouse", [
    deployer.account.address,
    feeSink.account.address,
    Number(FEE_BPS),
  ]);
  const nft = await viem.deployContract("DemoNFT");

  return { house, nft, deployer, feeSink, seller, alice, bob, carol };
}

/**
 * Mints a token to `seller`, approves the house for it, and opens an auction.
 *
 * @param fixture The deployed fixture.
 * @param seller The account that lists the token.
 * @param options Reserve price, buy-now price and duration. Prices are in wei.
 * @returns The new auction id and the escrowed token id.
 */
export async function listAuction(
  fixture: Pick<Fixture, "house" | "nft">,
  seller: Actor,
  options: { reserve?: bigint; buyNow?: bigint; duration?: bigint } = {},
): Promise<{ auctionId: bigint; tokenId: bigint }> {
  const { house, nft } = fixture;
  const { reserve = 0n, buyNow = 0n, duration = ONE_HOUR } = options;

  const tokenId = await nft.read.totalMinted();
  await nft.write.mint([seller.account.address, "ipfs://demo/item.json"], {
    account: seller.account,
  });
  await nft.write.approve([house.address, tokenId], { account: seller.account });

  const auctionId = await house.read.totalAuctions();
  await house.write.createAuction([nft.address, tokenId, reserve, buyNow, duration], {
    account: seller.account,
  });

  return { auctionId, tokenId };
}

/**
 * Pulls a credit and reports the wei the account actually gained, with the gas
 * it burned added back.
 *
 * A withdrawal is always a self-send, so the raw balance delta is short by the
 * transaction fee. Adding the fee back is what makes the assertion exact.
 *
 * @param viem The viem helpers from `network.create()`.
 * @param house The auction house.
 * @param actor The account pulling its credit.
 * @returns The amount the house paid out, in wei.
 */
export async function withdrawAndMeasure(
  viem: Viem,
  house: Fixture["house"],
  actor: Actor,
): Promise<bigint> {
  const publicClient = await viem.getPublicClient();
  const address = actor.account.address;

  const before = await publicClient.getBalance({ address });
  const hash = await house.write.withdraw({ account: actor.account });
  const receipt = await publicClient.getTransactionReceipt({ hash });
  const after = await publicClient.getBalance({ address });

  return after - before + receipt.gasUsed * receipt.effectiveGasPrice;
}

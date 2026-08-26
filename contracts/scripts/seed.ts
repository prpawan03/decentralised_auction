import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";
import { formatEther, numberToHex, parseEther, type Address } from "viem";

/**
 * Fills a freshly deployed local chain with auctions in every state the UI has
 * to render, so the demo has something to show on first load.
 *
 * Accounts 1 to 5 from the configured mnemonic act as distinct sellers and
 * bidders. Account 0 stays out of it: it owns the house and collects the fee.
 *
 *   npm run node      # in one terminal
 *   npm run deploy
 *   npm run seed
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEPLOYMENTS_DIR = path.resolve(HERE, "..", "deployments");

/** One catalogue entry. The name and image live in the token's metadata. */
interface Item {
  readonly name: string;
  readonly description: string;
  /** A real, reachable image URL. Verified against Wikimedia Commons. */
  readonly image: string;
}

/**
 * The demo catalogue. Every image URL is a live Wikimedia Commons file, so the
 * UI has something real to render without a pinning service.
 */
const CATALOGUE = {
  settled: {
    name: "Leica M3 Double-Stroke, 1955",
    description: "Chrome body, serial in the 7xxxxx range. Rangefinder recently recalibrated.",
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/7/77/Leica_M3_mg_3628.jpg/960px-Leica_M3_mg_3628.jpg",
  },
  belowReserve: {
    name: "Noguchi Coffee Table, walnut",
    description: "Isamu Noguchi for Herman Miller. Glass top, matched walnut base.",
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Noguchi_Table_%285905550025%29.jpg/960px-Noguchi_Table_%285905550025%29.jpg",
  },
  fresh: {
    name: "Kodak Retina IIc, 1954",
    description: "Folding 35mm with the Schneider Retina-Xenon C. Bellows light tight.",
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Kodak_Retina_II_C.JPG/960px-Kodak_Retina_II_C.JPG",
  },
  contested: {
    name: "Eames Aluminium Group Chair",
    description: "Charles and Ray Eames, 1958. Original leather sling, five-star base.",
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Eames_Aluminum_Group_chairs_in_the_Federal_Chancellery_building_in_Berlin.jpg/960px-Eames_Aluminum_Group_chairs_in_the_Federal_Chancellery_building_in_Berlin.jpg",
  },
  endingSoon: {
    name: "Braun ET66 Calculator",
    description: "Dieter Rams and Dietrich Lubs, 1987. The one the phone icon copied.",
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/1987_Braun_calculator_ET66_by_Dieter_Rams_%2813964223413%29.jpg/960px-1987_Braun_calculator_ET66_by_Dieter_Rams_%2813964223413%29.jpg",
  },
  buyNow: {
    name: "Braun Nizo 6080 Super 8",
    description: "Die-cast body, macro zoom, sound recording. Runs on a fresh battery pack.",
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Braun_Nizo_6080_Super_8_Camera_-_Austin_Calhoon_Phototgraph.jpg/960px-Braun_Nizo_6080_Super_8_Camera_-_Austin_Calhoon_Phototgraph.jpg",
  },
} as const satisfies Record<string, Item>;

/** How each seeded auction is meant to look in the UI. */
const STATE_LABEL = {
  fresh: "Live, no bids",
  contested: "Live, 3 bids",
  endingSoon: "Live, ends in ~75s",
  buyNow: "Live, buy-now open",
  settled: "Settled, has a winner",
  belowReserve: "Closed below reserve",
} as const;

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

const connection = await network.create();
const { viem, networkName, provider } = connection;

const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();

const deploymentFile = path.join(DEPLOYMENTS_DIR, `${chainId}.json`);
let deployment: { contracts: { AuctionHouse: Address; DemoNFT: Address } };
try {
  deployment = JSON.parse(await readFile(deploymentFile, "utf8"));
} catch {
  throw new Error(
    `No deployment record at ${deploymentFile}. Run "npm run deploy" against ${networkName} first.`,
  );
}

const house = await viem.getContractAt("AuctionHouse", deployment.contracts.AuctionHouse);
const nft = await viem.getContractAt("DemoNFT", deployment.contracts.DemoNFT);

const wallets = await viem.getWalletClients();
if (wallets.length < 6) {
  throw new Error(`Need at least 6 accounts on ${networkName}, found ${wallets.length}.`);
}
// Account 0 owns the house. Accounts 1 to 5 are the cast.
const [, ann, ben, cara, dev, eli] = wallets;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Wallet = (typeof wallets)[number];

/** Wraps an item as an ERC-721 metadata document in a `data:` URI. */
function metadataUri(item: Item): string {
  const json = JSON.stringify({
    name: item.name,
    description: item.description,
    image: item.image,
  });
  return `data:application/json;base64,${Buffer.from(json, "utf8").toString("base64")}`;
}

/** Mints an item to `seller`, approves the house and opens an auction. */
async function list(
  seller: Wallet,
  item: Item,
  options: { reserve?: bigint; buyNow?: bigint; duration: bigint },
): Promise<{ auctionId: bigint; tokenId: bigint }> {
  const { reserve = 0n, buyNow = 0n, duration } = options;

  const tokenId = await nft.read.totalMinted();
  await nft.write.mint([seller.account.address, metadataUri(item)], {
    account: seller.account,
  });
  await nft.write.approve([house.address, tokenId], { account: seller.account });

  const auctionId = await house.read.totalAuctions();
  await house.write.createAuction([nft.address, tokenId, reserve, buyNow, duration], {
    account: seller.account,
  });

  return { auctionId, tokenId };
}

/** Bids `target`, or the current minimum if the minimum has already passed it. */
async function bid(bidder: Wallet, auctionId: bigint, target: bigint): Promise<bigint> {
  const minimum = await house.read.minimumBid([auctionId]);
  const amount = target > minimum ? target : minimum;
  await house.write.bid([auctionId], { account: bidder.account, value: amount });
  return amount;
}

/** Moves the local chain's clock to `timestamp` and mines. Local networks only. */
async function fastForwardTo(timestamp: number): Promise<void> {
  await provider.request({
    method: "evm_setNextBlockTimestamp",
    params: [numberToHex(timestamp)],
  });
  await provider.request({ method: "evm_mine", params: [] });
}

/** The timestamp of the newest block. */
async function chainNow(): Promise<number> {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  return Number(block.timestamp);
}

// ---------------------------------------------------------------------------
// Phase 1 - the auctions that have to be closed already
// ---------------------------------------------------------------------------

console.log(`Seeding "${networkName}" (chain ${chainId})`);
console.log(`  AuctionHouse  ${house.address}`);
console.log(`  DemoNFT       ${nft.address}`);

// Seeding adds to the book, it does not replace it. Say so, rather than let a
// second run look like it did nothing.
const alreadyListed = await house.read.totalAuctions();
if (alreadyListed > 0n) {
  console.log(
    `  Note: ${alreadyListed} auction(s) already exist. This run appends six more.` +
      " Restart the node for a clean book.",
  );
}
console.log("");

const SHORT = 60n; // MIN_DURATION: long enough to bid, short enough to close.

const settledAuction = await list(ann, CATALOGUE.settled, {
  reserve: parseEther("1"),
  duration: SHORT,
});
await bid(cara, settledAuction.auctionId, parseEther("2.5"));
const winningBid = await bid(dev, settledAuction.auctionId, parseEther("3.2"));

const belowReserveAuction = await list(ben, CATALOGUE.belowReserve, {
  // A reserve nobody is going to meet in 60 seconds.
  reserve: parseEther("20"),
  duration: SHORT,
});
const shortfallBid = await bid(eli, belowReserveAuction.auctionId, parseEther("1.2"));

// Both auctions are shorter than the anti-snipe window, so every bid above
// pushed their close time out. Read where they actually landed rather than
// guessing, then jump past the later of the two.
const closeAt = Math.max(
  Number((await house.read.getAuction([settledAuction.auctionId])).endTime),
  Number((await house.read.getAuction([belowReserveAuction.auctionId])).endTime),
);
await fastForwardTo(closeAt + 1);

// Anyone may settle. The house owner does it here only because it is convenient.
await house.write.settle([settledAuction.auctionId]);
await house.write.settle([belowReserveAuction.auctionId]);

// ---------------------------------------------------------------------------
// Phase 2 - the live auctions
// ---------------------------------------------------------------------------

// Fast-forwarding pushed the chain's clock ahead of the wall clock. Anything
// that has to look right in a browser needs that drift added back, or the UI
// would show it as already over.
//
// It matters more than it looks. Once the chain is ahead, a new block takes the
// timestamp `max(wallClock, previous + 1)`, so the chain clock effectively stops
// until the wall clock catches up. Adding the drift back to the short auction's
// duration is what makes it close roughly 75 real seconds from now.
const drift = Math.max(0, (await chainNow()) - Math.floor(Date.now() / 1000));

const freshAuction = await list(ann, CATALOGUE.fresh, {
  reserve: parseEther("0.5"),
  duration: 2n * 24n * 3600n,
});

const contestedAuction = await list(ben, CATALOGUE.contested, {
  reserve: parseEther("1"),
  duration: 24n * 3600n,
});
const contestedBids = [
  await bid(cara, contestedAuction.auctionId, parseEther("1.1")),
  await bid(dev, contestedAuction.auctionId, parseEther("1.6")),
  await bid(eli, contestedAuction.auctionId, parseEther("2.4")),
];

const buyNowAuction = await list(dev, CATALOGUE.buyNow, {
  reserve: parseEther("1"),
  buyNow: parseEther("6"),
  duration: 3n * 24n * 3600n,
});
await bid(ann, buyNowAuction.auctionId, parseEther("1.3"));

// Last, so its clock starts as late as possible. It carries no bid on purpose:
// the first bid on it is what demonstrates the anti-snipe extension live.
const endingSoonAuction = await list(cara, CATALOGUE.endingSoon, {
  reserve: parseEther("0.4"),
  duration: BigInt(75 + drift),
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const SELLER_NAMES = new Map<string, string>([
  [ann.account.address.toLowerCase(), "acct1 Ann"],
  [ben.account.address.toLowerCase(), "acct2 Ben"],
  [cara.account.address.toLowerCase(), "acct3 Cara"],
  [dev.account.address.toLowerCase(), "acct4 Dev"],
  [eli.account.address.toLowerCase(), "acct5 Eli"],
]);

const STATUS_NAMES = ["Live", "Settled", "Cancelled", "ReserveNotMet"] as const;

const rows: string[][] = [
  ["ID", "Item", "Seller", "State", "Top bid", "Leader", "Ends in", "Buy now"],
];

/** Formats a wall-clock countdown. */
function countdown(seconds: number): string {
  if (seconds <= 0) return "any moment";
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`;
  if (seconds >= 120) return `${Math.round(seconds / 60)}m`;
  return `${seconds}s`;
}

const seeded = [
  { key: "fresh", ...freshAuction },
  { key: "contested", ...contestedAuction },
  { key: "endingSoon", ...endingSoonAuction },
  { key: "buyNow", ...buyNowAuction },
  { key: "settled", ...settledAuction },
  { key: "belowReserve", ...belowReserveAuction },
] as const;

const now = await chainNow();

for (const entry of seeded) {
  const auction = await house.read.getAuction([entry.auctionId]);
  // Subtract the drift, so the column reads as real seconds on a wall clock.
  const remaining = Number(auction.endTime) - now - drift;

  rows.push([
    String(entry.auctionId),
    CATALOGUE[entry.key].name,
    SELLER_NAMES.get(auction.seller.toLowerCase()) ?? auction.seller,
    `${STATUS_NAMES[auction.status]} (${STATE_LABEL[entry.key]})`,
    auction.highestBid === 0n ? "-" : `${formatEther(auction.highestBid)} ETH`,
    auction.highestBidder === "0x0000000000000000000000000000000000000000"
      ? "-"
      : (SELLER_NAMES.get(auction.highestBidder.toLowerCase()) ?? auction.highestBidder),
    auction.status !== 0 ? "closed" : countdown(remaining),
    auction.buyNowPrice === 0n ? "-" : `${formatEther(auction.buyNowPrice)} ETH`,
  ]);
}

const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
const line = (fill: string, join: string) =>
  join + widths.map((width) => fill.repeat(width + 2)).join(join) + join;

console.log(line("-", "+"));
rows.forEach((row, index) => {
  console.log(`| ${row.map((cell, column) => cell.padEnd(widths[column])).join(" | ")} |`);
  if (index === 0) console.log(line("-", "+"));
});
console.log(line("-", "+"));

// The pull-payment ledger, so the demo can show a real "claim" flow.
console.log("\nCredits waiting to be withdrawn:");
for (const [address, label] of SELLER_NAMES) {
  const owed = await house.read.pendingReturns([address as Address]);
  if (owed > 0n) console.log(`  ${label.padEnd(11)} ${formatEther(owed)} ETH`);
}

console.log(
  `\nSettled winner paid ${formatEther(winningBid)} ETH.` +
    ` Below-reserve bidder is owed ${formatEther(shortfallBid)} ETH back.` +
    ` Contested auction took bids of ${contestedBids.map((b) => formatEther(b)).join(", ")} ETH.`,
);
if (drift > 0) {
  console.log(
    `\nNote: the chain clock is ${drift}s ahead of the wall clock, because settling the` +
      " closed auctions needed a time jump. The seeded durations add it back, so the" +
      " 'Ends in' column above is real time. Until the wall clock catches up," +
      ` timeRemaining() reads about ${drift}s high, so a UI countdown SHOULD anchor on` +
      " the latest block timestamp rather than Date.now().",
  );
}
console.log("\nNext:  npm run export-abi");

await connection.close();

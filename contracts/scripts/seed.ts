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
  /**
   * Either a real, reachable image URL verified against Wikimedia Commons, or
   * a self-contained `data:` URI. The Dutch entries below use the latter so at
   * least part of the demo renders with no network at all, and so the seeded
   * book exercises BOTH metadata paths the frontend parses.
   */
  readonly image: string;
}

/**
 * A tiny self-contained placard, as a `data:` image.
 *
 * No pinning service, no gateway, no internet. It also gives the frontend an
 * inline-metadata token to parse alongside the remote ones, which is the other
 * half of `planTokenUri`.
 */
function inlineArtwork(label: string, hue: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480">` +
    `<rect width="480" height="480" fill="hsl(${String(hue)},45%,22%)"/>` +
    `<text x="240" y="250" font-family="monospace" font-size="34" fill="#e8f1f6" ` +
    `text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
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
  dutchFalling: {
    name: "Braun T3 Pocket Radio, 1958",
    description: "Dieter Rams. Descending price: it falls from 8 ETH toward 1 ETH over an hour.",
    image: inlineArtwork("DUTCH / T3", 205),
  },
  dutchNearFloor: {
    name: "Vitsoe 606 Shelving, one bay",
    description: "Descending price, already most of the way down to its floor.",
    image: inlineArtwork("DUTCH / 606", 145),
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
  dutchFalling: "Dutch, price falling",
  dutchNearFloor: "Dutch, near the floor",
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
  // No record on disk. That is the normal case when the deployer container is
  // restarted against a chain that already holds the contracts: the entrypoint
  // skips the deployment because the bytecode is present, and the record the
  // previous container wrote died with it. The configured addresses are the
  // same ones the entrypoint trusted for that decision, so trust them here too,
  // after confirming code actually exists at both.
  const fromEnv = {
    AuctionHouse: process.env.AUCTION_HOUSE_ADDRESS as Address | undefined,
    DemoNFT: process.env.DEMO_NFT_ADDRESS as Address | undefined,
  };
  if (!fromEnv.AuctionHouse || !fromEnv.DemoNFT) {
    throw new Error(
      `No deployment record at ${deploymentFile} and AUCTION_HOUSE_ADDRESS / DEMO_NFT_ADDRESS are not set. ` +
        `Run "npm run deploy" against ${networkName} first.`,
    );
  }
  for (const [name, address] of Object.entries(fromEnv) as [string, Address][]) {
    const code = await publicClient.getCode({ address });
    if (!code || code === "0x") {
      throw new Error(`${name} is configured at ${address} but no bytecode exists there on ${networkName}.`);
    }
  }
  console.log(`No deployment record; using configured addresses (bytecode verified).`);
  deployment = { contracts: { AuctionHouse: fromEnv.AuctionHouse, DemoNFT: fromEnv.DemoNFT } };
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

/**
 * Sends a write and waits until it is mined.
 *
 * Every helper below reads chain state right after a write: the token id after
 * a mint, the auction id after a listing, the minimum bid before a bid. Under
 * automine a write is mined before the call returns, so the reads are safe.
 * Under the interval mining the Docker stack uses (BLOCK_TIME=2) a write only
 * returns its hash, and the next read runs against a block in which the write
 * has not happened yet. The first symptom was minimumBid(0) reverting with
 * AuctionNotFound while auction 0 was being mined. Waiting for the receipt is
 * the fix; a fixed sleep would only move the race.
 */
async function send(pending: Promise<`0x${string}`>): Promise<void> {
  const hash = await pending;
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`transaction ${hash} reverted`);
  }
}

/** Mints an item to `seller`, approves the house and opens an auction. */
async function list(
  seller: Wallet,
  item: Item,
  options: { reserve?: bigint; buyNow?: bigint; duration: bigint },
): Promise<{ auctionId: bigint; tokenId: bigint }> {
  const { reserve = 0n, buyNow = 0n, duration } = options;

  const tokenId = await nft.read.totalMinted();
  await send(nft.write.mint([seller.account.address, metadataUri(item)], {
    account: seller.account,
  }));
  await send(nft.write.approve([house.address, tokenId], { account: seller.account }));

  const auctionId = await house.read.totalAuctions();
  await send(house.write.createAuction([nft.address, tokenId, reserve, buyNow, duration], {
    account: seller.account,
  }));

  return { auctionId, tokenId };
}

/**
 * Mints an item to `seller` and opens a DESCENDING auction on it.
 *
 * The argument order is the opposite way round from {list}: `createAuction`
 * takes (reserve, buyNow) ascending, `createDutchAuction` takes (start, floor)
 * descending. Keeping them in separate helpers is what stops the two being
 * transposed, which would list an item with an inverted price curve.
 */
async function listDutch(
  seller: Wallet,
  item: Item,
  options: { start: bigint; floor: bigint; duration: bigint },
): Promise<{ auctionId: bigint; tokenId: bigint }> {
  const tokenId = await nft.read.totalMinted();
  await send(nft.write.mint([seller.account.address, metadataUri(item)], {
    account: seller.account,
  }));
  await send(nft.write.approve([house.address, tokenId], { account: seller.account }));

  const auctionId = await house.read.totalAuctions();
  await send(house.write.createDutchAuction(
    [nft.address, tokenId, options.start, options.floor, options.duration],
    { account: seller.account },
  ));

  return { auctionId, tokenId };
}

/** Bids `target`, or the current minimum if the minimum has already passed it. */
async function bid(bidder: Wallet, auctionId: bigint, target: bigint): Promise<bigint> {
  const minimum = await house.read.minimumBid([auctionId]);
  const amount = target > minimum ? target : minimum;
  await send(house.write.bid([auctionId], { account: bidder.account, value: amount }));
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
await send(house.write.settle([settledAuction.auctionId]));
await send(house.write.settle([belowReserveAuction.auctionId]));

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

// The descending format. Two of them, because the interesting thing about a
// Dutch listing is WHERE ON THE SLOPE it is, and one example cannot show that.
// The first has just opened and is falling visibly; the second was given a
// floor close to its opening price, so it reads as nearly bottomed out.
const dutchFallingAuction = await listDutch(ben, CATALOGUE.dutchFalling, {
  start: parseEther("8"),
  floor: parseEther("1"),
  duration: BigInt(3600 + drift),
});

const dutchNearFloorAuction = await listDutch(eli, CATALOGUE.dutchNearFloor, {
  start: parseEther("2.2"),
  floor: parseEther("2"),
  duration: BigInt(1800 + drift),
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

const STATUS_NAMES = ["Live", "Settled", "Cancelled", "ReserveNotMet", "DeliveryFailed"] as const;

const rows: string[][] = [
  ["ID", "Item", "Seller", "State", "Top bid / price", "Leader", "Ends in", "Buy now / start->floor"],
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
  { key: "dutchFalling", ...dutchFallingAuction },
  { key: "dutchNearFloor", ...dutchNearFloorAuction },
] as const;

const now = await chainNow();

for (const entry of seeded) {
  const auction = await house.read.getAuction([entry.auctionId]);
  // Subtract the drift, so the column reads as real seconds on a wall clock.
  const remaining = Number(auction.endTime) - now - drift;

  // On a Dutch listing the two price fields mean the opposite of what their
  // names say: `buyNowPrice` is the OPENING price and `reservePrice` is the
  // FLOOR. Printing them under the English headings would advertise an
  // 8 ETH "buy now" for an item whose asking price is already far below it -
  // the same misreading the frontend had to be taught to avoid.
  const isDutch = auction.format === 1;
  const price = isDutch
    ? `${formatEther(await house.read.currentPrice([entry.auctionId]))} ETH`
    : auction.highestBid === 0n
      ? "-"
      : `${formatEther(auction.highestBid)} ETH`;
  const lastColumn = isDutch
    ? `${formatEther(auction.buyNowPrice)} -> ${formatEther(auction.reservePrice)}`
    : auction.buyNowPrice === 0n
      ? "-"
      : `${formatEther(auction.buyNowPrice)} ETH`;

  rows.push([
    String(entry.auctionId),
    CATALOGUE[entry.key].name,
    SELLER_NAMES.get(auction.seller.toLowerCase()) ?? auction.seller,
    `${STATUS_NAMES[auction.status]} (${STATE_LABEL[entry.key]})`,
    price,
    auction.highestBidder === "0x0000000000000000000000000000000000000000"
      ? "-"
      : (SELLER_NAMES.get(auction.highestBidder.toLowerCase()) ?? auction.highestBidder),
    auction.status !== 0 ? "closed" : countdown(remaining),
    lastColumn,
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

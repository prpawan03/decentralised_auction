import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";
import { formatEther, type Address } from "viem";

/**
 * The plumbing every demo scenario shares.
 *
 * A scenario is a small, self-contained story told on a local chain: it opens
 * its own auctions, drives them into one exact state, verifies that state by
 * reading it back, and prints where to look in the UI. Scenarios exist because
 * `seed.ts` produces a broad catalogue, and a broad catalogue is the wrong tool
 * for showing ONE behaviour to ONE person on a call.
 *
 *   npm run node                                          # in one terminal
 *   npm run deploy
 *   npx hardhat run scripts/scenarios/ending-soon.ts --network localhost
 *
 * Two rules hold across every scenario in this directory:
 *
 * 1. THEY MOVE THE CHAIN'S CLOCK. `evm_setNextBlockTimestamp` and `evm_mine`
 *    are development-node RPCs, and a scenario that reached a real network
 *    would either fail confusingly or - worse - list real tokens under a
 *    demo's assumptions. {connect} therefore refuses to run anywhere but chain
 *    31337. This is a hard gate, not a warning.
 *
 * 2. THEY VERIFY THEMSELVES. Every scenario reads its own outcome back off the
 *    chain and fails loudly if it is not what was intended. A demo script that
 *    silently did nothing is worse than no script at all, because the person
 *    running it only finds out in front of an audience.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEPLOYMENTS_DIR = path.resolve(HERE, "..", "..", "deployments");

/** The only chain these scripts are allowed to touch. See rule 1 above. */
export const LOCAL_CHAIN_ID = 31337;

/** Where the Vite dev server serves the app. Override for a container run. */
export const UI_ORIGIN = process.env.SCENARIO_UI_ORIGIN ?? "http://localhost:5173";

/** `AuctionHouse.Status`, in declaration order. */
export const Status = {
  Live: 0,
  Settled: 1,
  Cancelled: 2,
  ReserveNotMet: 3,
  DeliveryFailed: 4,
} as const;

/** Human names for {@link Status}, indexed by the enum value. */
export const STATUS_NAMES = [
  "Live",
  "Settled",
  "Cancelled",
  "ReserveNotMet",
  "DeliveryFailed",
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** One line of scenario narration. */
export function log(message = ""): void {
  console.log(message);
}

/** A titled section, so a long scenario log stays skimmable. */
export function heading(title: string): void {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

/**
 * Aborts the scenario with a non-zero exit code.
 *
 * `process.exit` rather than `throw`: a scenario runs under `hardhat run` with
 * an open network connection and top-level await, and an unhandled rejection
 * there has been known to surface as a stack trace with exit code 0. A demo
 * that reports success while having done nothing is the exact failure mode
 * these scripts exist to prevent, so the exit code is set by hand.
 *
 * @param message What went wrong, and what the operator should do about it.
 */
export function fail(message: string): never {
  console.error(`\nSCENARIO FAILED: ${message}`);
  process.exit(1);
}

/** Asserts a precondition or an outcome, and aborts with `message` if it fails. */
export function require_(condition: boolean, message: string): asserts condition {
  if (!condition) fail(message);
}

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

interface DeploymentRecord {
  contracts: { AuctionHouse: Address; DemoNFT: Address };
}

/**
 * Opens a connection, loads the deployment and hands back everything a
 * scenario needs.
 *
 * @param scenarioName Printed in the banner, so a scrollback shows which
 *        scenario produced which auctions.
 */
export async function connect(scenarioName: string) {
  const connection = await network.create();
  const { viem, networkName, provider, networkHelpers } = connection;

  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  // Rule 1. Before anything else, and before any transaction is signed.
  if (chainId !== LOCAL_CHAIN_ID) {
    fail(
      `refusing to run on chain ${chainId} ("${networkName}"). Scenario scripts` +
        ` manipulate block timestamps with development-node RPCs and open` +
        ` throwaway auctions, so they are restricted to the local Hardhat` +
        ` chain (${LOCAL_CHAIN_ID}). Start "npm run node" and pass` +
        ` --network localhost.`,
    );
  }

  const deploymentFile = path.join(DEPLOYMENTS_DIR, `${chainId}.json`);
  let deployment: DeploymentRecord;
  try {
    deployment = JSON.parse(await readFile(deploymentFile, "utf8")) as DeploymentRecord;
  } catch {
    fail(`no deployment record at ${deploymentFile}. Run "npm run deploy" first.`);
  }

  const house = await viem.getContractAt("AuctionHouse", deployment.contracts.AuctionHouse);
  const nft = await viem.getContractAt("DemoNFT", deployment.contracts.DemoNFT);

  // A deployment record can outlive the node it describes - restart the node
  // and the addresses in the file point at empty accounts. Reading one value
  // off the house turns that into a clear message instead of a decode error
  // three transactions later.
  try {
    await house.read.totalAuctions();
  } catch {
    fail(
      `no AuctionHouse at ${deployment.contracts.AuctionHouse}. The deployment` +
        ` record is stale - the node was probably restarted. Run "npm run deploy" again.`,
    );
  }

  const wallets = await viem.getWalletClients();
  if (wallets.length < 6) {
    fail(`need at least 6 accounts on "${networkName}", found ${wallets.length}.`);
  }

  // The same cast as `seed.ts`, so a scenario's actors read consistently with
  // the seeded book. Account 0 owns the house and takes the fee, so it never
  // sells and never bids.
  const [owner, ann, ben, cara, dev, eli] = wallets;
  const cast = { owner, ann, ben, cara, dev, eli } as const;

  const names = new Map<string, string>([
    [owner.account.address.toLowerCase(), "acct0 Owner"],
    [ann.account.address.toLowerCase(), "acct1 Ann"],
    [ben.account.address.toLowerCase(), "acct2 Ben"],
    [cara.account.address.toLowerCase(), "acct3 Cara"],
    [dev.account.address.toLowerCase(), "acct4 Dev"],
    [eli.account.address.toLowerCase(), "acct5 Eli"],
  ]);

  log(`Scenario "${scenarioName}" on "${networkName}" (chain ${chainId})`);
  log(`  AuctionHouse  ${house.address}`);
  log(`  DemoNFT       ${nft.address}`);

  // A scenario appends to whatever is already there. Saying so up front stops
  // the operator hunting for auction 0 when this run produced auction 14.
  const existing = await house.read.totalAuctions();
  log(`  Book already holds ${existing} auction(s); this run appends to it.`);

  return {
    connection,
    viem,
    networkHelpers,
    provider,
    publicClient,
    house,
    nft,
    wallets,
    cast,
    chainId,
    networkName,
    /** Maps an address to its `acctN Name` label, or back to the raw address. */
    nameOf: (address: string) => names.get(address.toLowerCase()) ?? address,
  };
}

/** Everything {@link connect} hands a scenario. */
export type Scenario = Awaited<ReturnType<typeof connect>>;

/** One funded account from the configured mnemonic. */
export type Actor = Scenario["wallets"][number];

// ---------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------

/** The timestamp of the newest block, in Unix seconds. */
export async function chainNow(ctx: Scenario): Promise<number> {
  return Number(await ctx.networkHelpers.time.latest());
}

/** The wall clock this process sees, in Unix seconds. */
export function wallNow(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * How far the chain's clock has run ahead of the wall clock, in seconds.
 *
 * Any scenario that jumps time creates this gap, and it matters to the UI: the
 * shipped countdown ticks on `Date.now()` (see `web/src/hooks/useTicker.tsx`),
 * not on the latest block timestamp. So a browser reads `endTime - wallClock`,
 * which is `drift` seconds longer than the chain thinks is left. Scenarios
 * report both numbers rather than pretending the two clocks agree.
 */
export async function clockDrift(ctx: Scenario): Promise<number> {
  return Math.max(0, (await chainNow(ctx)) - wallNow());
}

/**
 * Pins the timestamp of the next block, so the transaction that follows lands
 * at an exact, chosen second.
 *
 * WHY PIN AT ALL: without it a bid takes whatever second the node happened to
 * mine at, so two runs of the same scenario produce different bid timestamps,
 * different `AuctionExtended` boundaries and different event ordering. Anything
 * downstream that reads those timestamps - the indexer's analytics, a
 * screenshot in a deck, a regression test over the event log - then differs run
 * to run for no reason. Pinning makes a scenario reproducible: the same script
 * against the same deployment writes the same history.
 *
 * `setNextBlockTimestamp`, not `increaseTo`: `increaseTo` mines a block of its
 * own, so the transaction would land a second later and could miss a window it
 * was aimed at. This is the same idiom the anti-snipe suite uses.
 *
 * @param ctx The scenario context.
 * @param timestamp The Unix second the next block must carry.
 */
export async function pinNextBlock(ctx: Scenario, timestamp: number): Promise<void> {
  const latest = await chainNow(ctx);
  // Block timestamps are strictly increasing, so a target at or before the head
  // is not a rounding problem to paper over - it means the scenario's arithmetic
  // is wrong and every later assertion would be meaningless.
  require_(
    timestamp > latest,
    `cannot pin block at ${timestamp}: the chain is already at ${latest}.` +
      ` Time only moves forward. Restart the node for a clean clock.`,
  );
  await ctx.networkHelpers.time.setNextBlockTimestamp(timestamp);
}

/** Moves the clock to `timestamp` and mines, so the new time is observable. */
export async function fastForwardTo(ctx: Scenario, timestamp: number): Promise<void> {
  const latest = await chainNow(ctx);
  require_(
    timestamp > latest,
    `cannot fast-forward to ${timestamp}: the chain is already at ${latest}.`,
  );
  await ctx.networkHelpers.time.increaseTo(timestamp);
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/** What a listing helper hands back. */
export interface Listing {
  readonly auctionId: bigint;
  readonly tokenId: bigint;
}

/** Options common to every listing. */
export interface ListOptions {
  /** The lowest winning price, in wei. 0 means no reserve. */
  readonly reserve?: bigint;
  /** The instant purchase price, in wei. 0 disables buy-now. */
  readonly buyNow?: bigint;
  /** Seconds of bidding. Must be between MIN_DURATION and MAX_DURATION. */
  readonly duration: bigint;
}

/**
 * Mints a generative token to `seller`, approves the house and opens an
 * ascending-price (English) auction.
 *
 * `mintGenerative` rather than `mint(to, uri)`: the artwork is built inside the
 * contract, so the card renders behind the production Content-Security-Policy
 * (`img-src 'self' data: blob:`) with no network fetch and no IPFS gateway. A
 * scenario whose thumbnails are placeholders in the shape anyone is actually
 * shown is a scenario that half worked.
 *
 * @param ctx The scenario context.
 * @param seller The account that lists the token.
 * @param options Reserve, buy-now and duration.
 * @returns The new auction id and the escrowed token id.
 */
export async function listEnglish(
  ctx: Scenario,
  seller: Actor,
  options: ListOptions,
): Promise<Listing> {
  const { house, nft } = ctx;
  const { reserve = 0n, buyNow = 0n, duration } = options;

  const tokenId = await nft.read.totalMinted();
  await nft.write.mintGenerative([seller.account.address], { account: seller.account });
  await nft.write.approve([house.address, tokenId], { account: seller.account });

  const auctionId = await house.read.totalAuctions();
  await house.write.createAuction([nft.address, tokenId, reserve, buyNow, duration], {
    account: seller.account,
  });

  // The house escrows on listing, so this is a cheap proof that the listing is
  // real and not just an id in a counter.
  const owner = await nft.read.ownerOf([tokenId]);
  require_(
    owner.toLowerCase() === house.address.toLowerCase(),
    `token ${tokenId} was not escrowed by the house after listing (owner is ${owner}).`,
  );

  return { auctionId, tokenId };
}

/** Options for {@link listDutch}. */
export interface DutchOptions {
  /** The opening clock price, in wei. */
  readonly startPrice: bigint;
  /** The price the clock stops falling at, in wei. */
  readonly floorPrice: bigint;
  /** How long the clock takes to walk from the start price to the floor. */
  readonly duration: bigint;
  /**
   * Seconds of decay to run off before the scenario hands over.
   *
   * This is what puts the UI in the interesting state: a Dutch auction at
   * `elapsed = 0` is just an expensive listing, and one at `elapsed = duration`
   * is sitting on its floor. Somewhere in between is the only place a viewer
   * can watch the number fall.
   */
  readonly elapsed: number;
}

/** What {@link listDutch} hands back. */
export interface DutchSale {
  readonly auctionId: bigint;
  /** The escrowed token. */
  readonly tokenId: bigint;
  readonly startPrice: bigint;
  readonly floorPrice: bigint;
  /** The clock price at the moment this was measured, read from the contract. */
  readonly currentPrice: bigint;
  readonly startTime: bigint;
  readonly endTime: bigint;
  /** Seconds of decay that had elapsed when `currentPrice` was read. */
  readonly elapsed: number;
}

/**
 * Opens a descending-price (Dutch) sale and runs its clock partway down.
 *
 * This drives the contract's OWN Dutch format. An earlier version of this
 * helper emulated the decay with a ladder of cancelled English auctions,
 * because {@link AuctionHouse} had no descending format; that emulation is
 * gone now that `createDutchAuction`, `currentPrice` and `buy` exist. The two
 * are not interchangeable and it is worth being explicit about why: a ladder
 * shows a price that changes in visible steps, each one a separate auction id,
 * whereas the real format is a single listing whose price is a pure function
 * of elapsed time. Anything reading the book -- the UI, the indexer, a
 * leaderboard -- sees one auction rather than a trail of cancellations.
 *
 * A Dutch sale is bought with `buy(auctionId)` at `currentPrice(auctionId)`,
 * NOT with `bid()` or `buyNow()`. `bid()` reverts with `WrongFormat`, and
 * `buyNowPrice` on the stored record is the START price, not the price a buyer
 * pays now. Overpayment is accepted and the excess is credited back.
 *
 * @param ctx The scenario context.
 * @param seller The account that lists the token.
 * @param options Start price, floor, duration and how far to run the clock.
 * @returns The listing, with the clock price measured after the decay.
 */
export async function listDutch(
  ctx: Scenario,
  seller: Actor,
  options: DutchOptions,
): Promise<DutchSale> {
  const { house, nft } = ctx;
  const { startPrice, floorPrice, duration, elapsed } = options;

  require_(floorPrice > 0n && floorPrice < startPrice, "the floor must sit below the start price.");
  require_(
    elapsed > 0 && BigInt(elapsed) < duration,
    `elapsed (${elapsed}s) must be inside the decay window (0 to ${duration}s) for the` +
      " clock to be visibly mid-fall.",
  );

  const tokenId = await nft.read.totalMinted();
  await nft.write.mintGenerative([seller.account.address], { account: seller.account });
  await nft.write.approve([house.address, tokenId], { account: seller.account });

  const auctionId = await house.read.totalAuctions();
  await house.write.createDutchAuction([nft.address, tokenId, startPrice, floorPrice, duration], {
    account: seller.account,
  });

  const owner = await nft.read.ownerOf([tokenId]);
  require_(
    owner.toLowerCase() === house.address.toLowerCase(),
    `token ${tokenId} was not escrowed by the house after listing (owner is ${owner}).`,
  );

  // Run the clock down. The price is a function of block.timestamp, so moving
  // the chain's clock IS moving the price -- there is nothing else to poke.
  const record = await house.read.getAuction([auctionId]);
  await fastForwardTo(ctx, Number(record.startTime) + elapsed);

  const currentPrice = await house.read.currentPrice([auctionId]);

  // The whole point of the scenario is a price strictly between the two ends.
  // Assert it rather than trust the arithmetic: an off-by-one in the decay
  // window would otherwise produce a scenario that runs green and shows a
  // static number.
  require_(
    currentPrice < startPrice && currentPrice > floorPrice,
    `the clock reads ${currentPrice} wei, which is not strictly between the` +
      ` ${floorPrice} wei floor and the ${startPrice} wei start. The scenario would` +
      " show a price that is not visibly falling.",
  );

  return {
    auctionId,
    tokenId,
    startPrice,
    floorPrice,
    currentPrice,
    startTime: record.startTime,
    endTime: record.endTime,
    elapsed,
  };
}

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

/**
 * Places a bid at an exact chain timestamp.
 *
 * The amount defaults to the contract's own current minimum, and a requested
 * amount below that minimum is raised to it rather than being sent to revert -
 * the increment moves with the leading bid, so a hard-coded ladder in a
 * scenario would rot the first time `DEFAULT_INCREMENT_BPS` changed.
 *
 * @param ctx The scenario context.
 * @param bidder The account bidding.
 * @param auctionId The auction.
 * @param options `at` is the Unix second the bid must land on; `amount` is the
 *        target bid in wei.
 * @returns The amount actually sent and the second it landed on.
 */
export async function bidAt(
  ctx: Scenario,
  bidder: Actor,
  auctionId: bigint,
  options: { at: number; amount?: bigint },
): Promise<{ amount: bigint; at: number }> {
  const minimum = await ctx.house.read.minimumBid([auctionId]);
  const amount =
    options.amount !== undefined && options.amount > minimum ? options.amount : minimum;

  await pinNextBlock(ctx, options.at);
  await ctx.house.write.bid([auctionId], { account: bidder.account, value: amount });

  const landed = await chainNow(ctx);
  require_(
    landed === options.at,
    `bid landed at ${landed} but was pinned to ${options.at}; the scenario's timings are not reproducible.`,
  );

  return { amount, at: options.at };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** One auction the operator should look at. */
export interface Highlight {
  readonly auctionId: bigint;
  /** What this auction is for, in a few words. */
  readonly note: string;
}

/**
 * Prints the closing summary: what exists now, and where to look at it.
 *
 * Both remaining-time columns are printed on purpose. The chain's own clock is
 * the truth the contract enforces; the wall clock is what the browser's
 * countdown shows. When a scenario has jumped time the two disagree, and
 * hiding that gap is how a demo ends up looking broken.
 *
 * @param ctx The scenario context.
 * @param highlights The auctions this scenario produced.
 * @param watchFor Lines telling the viewer what the interesting thing is.
 */
export async function report(
  ctx: Scenario,
  highlights: readonly Highlight[],
  watchFor: readonly string[],
): Promise<void> {
  const now = await chainNow(ctx);
  const drift = await clockDrift(ctx);

  heading("Summary");

  for (const highlight of highlights) {
    const auction = await ctx.house.read.getAuction([highlight.auctionId]);
    const onChain = Number(auction.endTime) - now;
    const remaining = auction.status === Status.Live ? `${Math.max(0, onChain)}s` : "closed";
    const inBrowser =
      auction.status === Status.Live ? `${Math.max(0, onChain + drift)}s` : "closed";

    log(`  Auction #${highlight.auctionId} - ${highlight.note}`);
    log(`    state       ${STATUS_NAMES[auction.status]}`);
    log(
      `    endTime     ${auction.endTime} (${new Date(Number(auction.endTime) * 1000).toISOString()})`,
    );
    log(`    remaining   ${remaining} on the chain clock, ${inBrowser} on the browser's`);
    log(
      `    top bid     ${
        auction.highestBidder === ZERO_ADDRESS
          ? "none"
          : `${formatEther(auction.highestBid)} ETH by ${ctx.nameOf(auction.highestBidder)}`
      }`,
    );
    log(`    url         ${UI_ORIGIN}/auctions/${highlight.auctionId}`);
  }

  heading("What to look at");
  for (const line of watchFor) log(`  - ${line}`);

  if (drift > 0) {
    log(
      `\n  Note: this scenario moved the chain's clock, so it now runs ${drift}s ahead of` +
        ` the wall clock. The UI counts down on Date.now(), so its timer reads ${drift}s` +
        ` longer than the chain thinks is left. Restart the node to reset both.`,
    );
  }
}

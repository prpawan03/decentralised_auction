/**
 * Configuration, resolved once at start-up from the environment.
 *
 * Every value has a default that works inside the `auction` Compose network,
 * so the container needs no configuration at all to be useful. That is the
 * "zero-click" requirement: `docker compose --profile monitoring up` must
 * produce a working dashboard with no edit to any file.
 */

import { readFile, stat } from 'node:fs/promises';

/** Reads an integer from the environment, falling back when unset or junk. */
function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  // A typo in an env var MUST NOT silently become NaN and poison every
  // downstream computation. Fall back loudly instead.
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[config] ${name}="${raw}" is not a positive integer; using ${fallback}`);
    return fallback;
  }
  return parsed;
}

/**
 * Normalises an address from the environment.
 *
 * Compose passes `AUCTION_HOUSE_ADDRESS: ${AUCTION_HOUSE_ADDRESS:-}` -- i.e.
 * the EMPTY STRING is the normal case, not an error, because the address is
 * not known until the deployer has run. Empty means "fall back to the
 * deployments file".
 */
function addressFromEnv(name) {
  const raw = (process.env[name] ?? '').trim();
  if (raw === '') return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    console.warn(`[config] ${name}="${raw}" is not a 20-byte hex address; ignoring`);
    return null;
  }
  return raw;
}

export const config = Object.freeze({
  /** In-network RPC. The browser uses 127.0.0.1:8545; this service does not. */
  rpcUrl: process.env.RPC_URL ?? 'http://chain:8545',

  chainId: intFromEnv('CHAIN_ID', 31337),

  /** Not 9090: Prometheus owns that port, and 9100 is node_exporter's. */
  port: intFromEnv('EXPORTER_PORT', 9101),

  /**
   * One poll per 5s scrape. Polling on a timer rather than on the scrape
   * itself keeps a slow or wedged RPC from turning into a slow /metrics
   * response, which Prometheus would record as a scrape timeout -- losing the
   * `rpc_up 0` datapoint that is the whole point of the alert.
   */
  pollIntervalMs: intFromEnv('POLL_INTERVAL_MS', 5000),

  /**
   * Hard ceiling on any one RPC call. MUST stay well under pollIntervalMs so a
   * hung call cannot pile poll cycles on top of each other.
   */
  rpcTimeoutMs: intFromEnv('RPC_TIMEOUT_MS', 3000),

  /**
   * Cap on auctions walked per cycle. A local demo has tens; this exists so a
   * seeded-to-the-gills chain degrades into stale-but-serving rather than into
   * a poll that never finishes.
   */
  maxAuctions: intFromEnv('MAX_AUCTIONS', 500),

  auctionHouseAddress: addressFromEnv('AUCTION_HOUSE_ADDRESS'),
  demoNftAddress: addressFromEnv('DEMO_NFT_ADDRESS'),

  /**
   * The deployer writes this file. Reading it is what makes the exporter
   * zero-click: the operator never has to copy an address into an .env after
   * `make up` regenerates the chain.
   */
  deploymentsFile: process.env.DEPLOYMENTS_FILE ?? '/deployments/31337.json',
});

/**
 * Resolves contract addresses, preferring the environment and falling back to
 * the deployer's JSON record.
 *
 * This is re-run on EVERY poll, not once at start-up, and that is deliberate:
 * `make up` tears down the chain and redeploys to fresh addresses while the
 * monitoring profile keeps running. A start-up-only read would pin the
 * exporter to a dead contract until someone restarted it by hand.
 *
 * The mtime check keeps the steady-state cost to one `stat` per 5 seconds.
 */
let cache = { mtimeMs: -1, addresses: null };

export async function resolveAddresses() {
  // An explicit environment address always wins: an operator who set it is
  // overriding on purpose, and re-reading the file could silently undo that.
  if (config.auctionHouseAddress) {
    return { auctionHouse: config.auctionHouseAddress, demoNft: config.demoNftAddress, source: 'env' };
  }

  try {
    const { mtimeMs } = await stat(config.deploymentsFile);
    if (mtimeMs !== cache.mtimeMs) {
      const parsed = JSON.parse(await readFile(config.deploymentsFile, 'utf8'));
      cache = {
        mtimeMs,
        addresses: {
          auctionHouse: parsed.auctionHouse ?? null,
          demoNft: parsed.demoNft ?? null,
          source: 'deployments-file',
        },
      };
      console.info(`[config] loaded addresses from ${config.deploymentsFile}: auctionHouse=${cache.addresses.auctionHouse}`);
    }
    return cache.addresses;
  } catch {
    // ENOENT is the EXPECTED state before the deployer has run, and while the
    // monitoring profile runs without the rest of the stack. It is not an
    // error worth logging every 5 seconds -- the absence shows up in metrics
    // as auction_contracts_deployed 0, which is where an operator will look.
    return { auctionHouse: null, demoNft: null, source: 'unresolved' };
  }
}

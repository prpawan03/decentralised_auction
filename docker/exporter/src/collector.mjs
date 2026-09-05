/**
 * The collection cycle: poll the chain, decode, write gauges.
 *
 * WHY THIS SERVICE EXISTS AT ALL (read before replacing it with an off-the-
 * shelf exporter -- three were evaluated and all three are dead ends):
 *
 *   1. prometheus-community/json_exporter cannot read this chain. JSON-RPC
 *      returns quantities as HEX strings: {"result":"0x1f4"}. The exporter's
 *      SanitizeValue path ends in strconv.ParseFloat, which rejects "0x1f4"
 *      outright. There is no hex mode and no pre-processing hook, so every
 *      numeric metric would fail to parse.
 *   2. blackbox_exporter can prove the port answers and nothing more. It
 *      yields probe_success and probe_duration_seconds -- no block height, no
 *      escrow total. That covers one of the eleven metrics below.
 *   3. ethereum-metrics-exporter is stale (v0.29.2, 2024), it defaults to port
 *      9090 which collides head-on with Prometheus in this stack, and it
 *      leans on net_peerCount, admin_* and txpool_* -- none of which Hardhat
 *      implements. It would report a permanently unhealthy node.
 *
 * A ~200-line service with two dependencies is the cheaper and more honest
 * option, and it is the only one that can read contract state.
 */

import { createPublicClient, defineChain, http } from "viem";
import { AUCTION_HOUSE_ABI, MAX_PAGE_SIZE, STATUS } from "./abi.mjs";
import { config, resolveAddresses } from "./config.mjs";
import * as m from "./metrics.mjs";

/**
 * The local chain, described to viem.
 *
 * Built with defineChain rather than imported from viem/chains so CHAIN_ID
 * stays a deployment setting -- the base compose file already treats it as one
 * (`CHAIN_ID: ${CHAIN_ID:-31337}`), and a hard-coded import would desync the
 * moment somebody changed it.
 */
const chain = defineChain({
  id: config.chainId,
  name: "Auction Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

const client = createPublicClient({
  chain,
  transport: http(config.rpcUrl, {
    timeout: config.rpcTimeoutMs,
    // No retries. The poll loop IS the retry, and it runs every 5 seconds.
    // viem's default of 3 retries with backoff could stretch a single failing
    // call past the poll interval and stack cycles on top of each other.
    retryCount: 0,
  }),
  // Multicall is deliberately left off. Hardhat does not predeploy Multicall3,
  // so viem's batched path would revert against a bare node. Plain parallel
  // eth_calls over a loopback network cost microseconds.
  batch: undefined,
});

/**
 * Runs `tasks` with bounded concurrency.
 *
 * An unbounded Promise.all over hundreds of escrowOf calls opens hundreds of
 * sockets at once; Node's default agent then queues them anyway and the RPC
 * timeout starts counting against calls that have not been sent yet, so they
 * time out having never been tried. A small window keeps every in-flight call
 * genuinely in flight.
 */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Reads every auction, one clamped page at a time. */
async function readAllAuctions(address, total) {
  // The cap turns a runaway chain into stale-but-serving instead of a poll
  // that never returns. Log once per cycle so the truncation is never silent.
  const wanted = Math.min(total, config.maxAuctions);
  if (total > config.maxAuctions) {
    console.warn(
      `[collector] ${total} auctions exceeds MAX_AUCTIONS=${config.maxAuctions}; reading the first ${wanted}`,
    );
  }

  const auctions = [];
  while (auctions.length < wanted) {
    const page = await client.readContract({
      address,
      abi: AUCTION_HOUSE_ABI,
      functionName: "getAuctions",
      args: [BigInt(auctions.length), BigInt(Math.min(MAX_PAGE_SIZE, wanted - auctions.length))],
    });
    // Defensive: an empty page with the count still short would otherwise spin
    // forever. It should be unreachable, which is exactly why it is cheap to
    // guard and expensive to omit.
    if (page.length === 0) break;
    auctions.push(...page);
  }
  return auctions;
}

/**
 * Collects contract state.
 *
 * Kept separate from the chain-level collection so a missing or reverting
 * AuctionHouse degrades ONLY the auction gauges. A chain that is up with no
 * contracts on it -- the normal state between `make down` and the deployer
 * finishing -- must still report rpc_up 1 and a real block height.
 */
async function collectContractState() {
  const { auctionHouse } = await resolveAddresses();
  if (!auctionHouse) {
    m.clearContractMetrics();
    return;
  }

  const total = await client.readContract({
    address: auctionHouse,
    abi: AUCTION_HOUSE_ABI,
    functionName: "totalAuctions",
  });

  m.contractsDeployed.set(1);
  m.totalAuctions.set(Number(total));

  const counts = { live: 0, settled: 0, cancelled: 0, reserveNotMet: 0, deliveryFailed: 0 };
  let escrowWei = 0n;

  if (total > 0n) {
    const auctions = await readAllAuctions(auctionHouse, Number(total));

    // The auction id is the index: getAuctions() pages the backing array in
    // order from `offset`, and ids are never reused.
    const liveIds = [];
    auctions.forEach((auction, id) => {
      switch (auction.status) {
        case STATUS.LIVE:
          counts.live++;
          liveIds.push(BigInt(id));
          break;
        case STATUS.SETTLED:
          counts.settled++;
          break;
        case STATUS.CANCELLED:
          counts.cancelled++;
          break;
        case STATUS.RESERVE_NOT_MET:
          counts.reserveNotMet++;
          break;
        case STATUS.DELIVERY_FAILED:
          counts.deliveryFailed++;
          break;
        // A status this build does not know about is counted nowhere rather
        // than mis-attributed. The totals gauge still includes it, so the
        // discrepancy is visible on the dashboard.
        default:
          break;
      }
    });

    // Escrow is summed only over LIVE auctions: once an auction finalises, the
    // contract has already paid out or credited a refund, so its escrow is no
    // longer money the contract is holding at risk.
    //
    // Summed as BigInt and converted once at the end. Converting each call to
    // Number first would compound float64 rounding across every auction.
    const escrows = await mapWithConcurrency(liveIds, 8, (auctionId) =>
      client.readContract({
        address: auctionHouse,
        abi: AUCTION_HOUSE_ABI,
        functionName: "escrowOf",
        args: [auctionId],
      }),
    );
    for (const value of escrows) escrowWei += value;
  }

  m.liveAuctions.set(counts.live);
  m.settledTotal.set(counts.settled);
  m.cancelledTotal.set(counts.cancelled);
  m.reserveNotMetTotal.set(counts.reserveNotMet);
  m.deliveryFailedTotal.set(counts.deliveryFailed);
  m.escrowTotal.set(Number(escrowWei));
}

/**
 * One full collection cycle. NEVER throws.
 *
 * A throw here would reject the interval callback and, under Node's default
 * unhandled-rejection policy, take the process down -- turning "the chain is
 * briefly unreachable" into "the monitoring stack is gone", which is the exact
 * moment monitoring is most needed.
 */
export async function collectOnce() {
  const endPoll = m.pollDuration.startTimer();

  try {
    // eth_blockNumber is the cheapest call the node serves, which makes it the
    // right probe: the latency it measures is transport plus dispatch, not the
    // cost of whatever it asked for.
    const started = process.hrtime.bigint();
    const height = await client.getBlockNumber({ cacheTime: 0 });
    m.rpcLatency.observe(Number(process.hrtime.bigint() - started) / 1e9);

    m.rpcUp.set(1);
    m.blockHeight.set(Number(height));

    // Settled separately from the contract read: a failure to fetch the gas
    // price should not blank the auction gauges, and vice versa.
    const [block, gas] = await Promise.all([
      client.getBlock({ blockNumber: height, includeTransactions: false }),
      client.getGasPrice(),
    ]);
    m.blockTimestamp.set(Number(block.timestamp));
    m.gasPrice.set(Number(gas));
  } catch (error) {
    // The expected steady state when the monitoring profile runs alone. Kept
    // to one line so it does not drown the log at one failure per 5 seconds.
    m.rpcUp.set(0);
    m.clearChainMetrics();
    m.pollErrors.inc({ stage: "chain" });
    console.warn(
      `[collector] chain unreachable at ${config.rpcUrl}: ${error.shortMessage ?? error.message}`,
    );
    endPoll();
    return;
  }

  try {
    await collectContractState();
  } catch (error) {
    // Reached when the address is stale (a redeployed chain) or the call
    // reverts. rpc_up stays 1 because the CHAIN is fine -- conflating the two
    // would send an operator hunting the wrong fault.
    m.clearContractMetrics();
    m.pollErrors.inc({ stage: "contract" });
    console.warn(`[collector] AuctionHouse read failed: ${error.shortMessage ?? error.message}`);
    endPoll();
    return;
  }

  m.lastSuccessTimestamp.set(Date.now() / 1000);
  endPoll();
}

/** Starts the poll loop and returns a stop function for graceful shutdown. */
export function startPolling() {
  // Collect immediately so the first scrape after start-up has real data
  // instead of the zero values every gauge is born with.
  void collectOnce();
  const timer = setInterval(() => void collectOnce(), config.pollIntervalMs);
  // Without unref the timer alone would keep the event loop alive and the
  // container would ignore SIGTERM until Compose's grace period expired.
  timer.unref();
  return () => clearInterval(timer);
}

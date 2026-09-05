/**
 * The metric registry.
 *
 * ON THE `_total` SUFFIX: `auction_settled_total` and friends are Gauges, not
 * Counters, which breaks the usual Prometheus convention that `_total` implies
 * a monotonic counter. The names are kept because they read correctly on a
 * dashboard, but the TYPE is right: these are read back from contract state on
 * every poll, and a `make down && make up` resets the chain to zero. A Counter
 * would be a lie -- `rate()` and `increase()` would have to guess at a reset,
 * and would invent a spike on every fresh deployment. Do not "fix" these to
 * Counters.
 *
 * ON PRECISION: Prometheus stores every sample as a float64. A wei value above
 * 2^53 (~0.009 ETH) therefore loses exactness on the way in. That is accepted:
 * float64 keeps ~15-16 significant digits, so an escrow total in the tens of
 * ETH is still accurate to well under a microether. This gauge answers "how
 * much is at risk", not "what does the ledger say" -- for the latter, read the
 * chain.
 */

import { Registry, Gauge, Histogram, Counter, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

// Process-level metrics (heap, event-loop lag, open handles). Cheap, and they
// are what distinguishes "the chain is down" from "the exporter is wedged".
collectDefaultMetrics({ register: registry, prefix: 'auction_exporter_' });

const g = (name, help, labelNames = []) =>
  new Gauge({ name, help, labelNames, registers: [registry] });

// --- Chain liveness --------------------------------------------------------

export const rpcUp = g(
  'auction_chain_rpc_up',
  'Whether the last poll of the JSON-RPC endpoint succeeded (1) or failed (0).',
);

export const blockHeight = g(
  'auction_chain_block_height',
  'Height of the latest block on the auction chain.',
);

export const blockTimestamp = g(
  'auction_chain_block_timestamp_seconds',
  'Unix timestamp of the latest block. Subtract from time() to get chain lag; on a Hardhat node under automatic mining this grows only when a transaction is sent.',
);

export const rpcLatency = new Histogram({
  name: 'auction_chain_rpc_latency_seconds',
  help: 'Round-trip latency of a single eth_blockNumber call against the chain.',
  // Buckets are tuned for an in-network local node, where a healthy call lands
  // in single-digit milliseconds. The default prom-client buckets start at
  // 5ms and would collapse every healthy sample into one bucket, making the
  // histogram useless for spotting a chain that has gone from 2ms to 40ms.
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export const gasPrice = g(
  'auction_gas_price_wei',
  'Current gas price reported by the chain, in wei.',
);

// --- Auction state ---------------------------------------------------------

export const contractsDeployed = g(
  'auction_contracts_deployed',
  'Whether the AuctionHouse address is known AND answering calls (1) or not (0). 0 is the expected value before the deployer has run.',
);

export const totalAuctions = g(
  'auction_total_auctions',
  'Number of auctions ever created, from AuctionHouse.totalAuctions().',
);

export const liveAuctions = g(
  'auction_live_auctions',
  'Auctions currently in the Live state (still accepting bids or awaiting settlement).',
);

export const escrowTotal = g(
  'auction_escrow_total_wei',
  'Total ETH held in escrow across all live auctions, in wei. This is the money-at-risk figure: funds the contract is holding on behalf of bidders.',
);

export const settledTotal = g(
  'auction_settled_total',
  'Auctions that reached the Settled state. Gauge, not counter: it is read from chain state and resets when the chain does.',
);

export const reserveNotMetTotal = g(
  'auction_reserve_not_met_total',
  'Auctions that closed below their reserve price. Gauge, not counter: read from chain state.',
);

export const cancelledTotal = g(
  'auction_cancelled_total',
  'Auctions cancelled by their seller before any bid. Gauge, not counter: read from chain state.',
);

export const deliveryFailedTotal = g(
  'auction_delivery_failed_total',
  'Auctions that sold but whose NFT could not be handed over, so the sale was voided. Any non-zero value warrants investigation. Gauge, not counter: read from chain state.',
);

// --- Exporter self-observability -------------------------------------------

export const pollDuration = new Histogram({
  name: 'auction_exporter_poll_duration_seconds',
  help: 'Wall-clock duration of one full collection cycle.',
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export const pollErrors = new Counter({
  name: 'auction_exporter_poll_errors_total',
  help: 'Collection cycles that ended in an error, by stage. A genuine monotonic counter, unlike the auction_*_total gauges above.',
  labelNames: ['stage'],
  registers: [registry],
});

export const lastSuccessTimestamp = g(
  'auction_exporter_last_success_timestamp_seconds',
  'Unix timestamp of the last fully successful collection. Alert on time() - this exceeding a few poll intervals to catch a silently stale exporter.',
);

/**
 * Marks every chain-derived gauge as unknown.
 *
 * WHY not simply leave the last good values in place: a stale block height
 * that keeps being served looks identical to a healthy, idle chain. Prometheus
 * would happily draw a flat line and nobody would notice the chain died.
 * Clearing to 0 alongside `rpc_up 0` makes the outage unmistakable on the
 * dashboard, and `absent()`/`== 0` alerts then work as written.
 */
export function clearChainMetrics() {
  blockHeight.set(0);
  blockTimestamp.set(0);
  gasPrice.set(0);
  clearContractMetrics();
}

/** As above, but only the values that need a deployed AuctionHouse. */
export function clearContractMetrics() {
  contractsDeployed.set(0);
  totalAuctions.set(0);
  liveAuctions.set(0);
  escrowTotal.set(0);
  settledTotal.set(0);
  reserveNotMetTotal.set(0);
  cancelledTotal.set(0);
  deliveryFailedTotal.set(0);
}

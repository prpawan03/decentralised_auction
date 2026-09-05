/**
 * Container healthcheck. Mirrors docker/chain/healthcheck.js: the node:alpine
 * image ships no curl and no wget-with-timeout, so the probe is a script.
 *
 * It asks ONE question -- is this process still serving /healthz -- and
 * deliberately does not ask whether the chain is reachable. A probe that went
 * unhealthy when the chain blipped would have Compose restart the exporter,
 * discarding the counters and histograms that explain the blip. Chain health
 * is a METRIC (auction_chain_rpc_up), not a container state.
 */

const port = Number.parseInt(process.env.EXPORTER_PORT ?? '9101', 10);
const timeoutMs = 4000;

// AbortSignal.timeout rather than a manual setTimeout: it rejects the fetch
// itself, so a half-open socket cannot leave the probe hanging until Docker's
// own timeout kills it with a less useful error.
try {
  const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  process.exit(response.ok ? 0 : 1);
} catch (error) {
  console.error(`healthcheck failed: ${error.message}`);
  process.exit(1);
}

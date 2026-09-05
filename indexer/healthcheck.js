// Health probe for the indexer.
//
// The node:alpine image contains no curl, so this script replaces it.
//
// WHY /ready AND NOT /health
// Ponder exposes both. They mean different things:
//
//   /health   200 as soon as the HTTP server is listening. It stays 200 for
//             the whole of the historical backfill, so a container gated on
//             it is reported healthy while every query it serves is still
//             answering from an empty or half-written schema.
//
//   /ready    503 until the indexing run has caught up to the chain head,
//             then 200. That is the only signal that means "the data behind
//             this endpoint is current".
//
// Compose gates nothing else on this container today, but a probe that lies
// is worse than no probe: `docker compose ps` showing `healthy` is what an
// operator reads before deciding a blank dashboard is a bug in the dashboard.
//
// WHY THE BACKFILL IS NOT A FAILURE
// A cold start re-indexes from the deployment block every time, because
// `disableCache: true` is set for the local chain (see ponder.config.ts). On a
// seeded demo chain that takes a while. The Dockerfile therefore gives this
// probe a long `--start-period`, during which a non-zero exit does not count
// against the retry budget.
//
// Exit 0: the indexer is up and caught up.
// Exit 1: it did not answer, or it is still behind the chain head.

const port = Number(process.env.PONDER_PORT ?? 42069);
const url = `http://127.0.0.1:${port}/ready`;

// The timeout is shorter than the HEALTHCHECK `--timeout`, so a hung request
// fails as a clean "not ready" rather than being killed mid-flight by Docker
// and leaving no message in the container log.
const TIMEOUT_MS = 4000;

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

try {
  const response = await fetch(url, { signal: controller.signal });

  if (response.status === 200) {
    process.exit(0);
  }

  // 503 is the expected answer during a backfill, so it is reported as
  // progress rather than as an error. Anything else is a genuine surprise.
  console.error(
    response.status === 503
      ? "indexer: still backfilling (/ready 503)"
      : `indexer: /ready answered ${response.status}`,
  );
  process.exit(1);
} catch (error) {
  console.error(`indexer: /ready unreachable at ${url}: ${error.message}`);
  process.exit(1);
} finally {
  clearTimeout(timer);
}

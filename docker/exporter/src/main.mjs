/**
 * Entry point.
 *
 * Start order matters: the HTTP server comes up FIRST, before the first poll
 * finishes. Prometheus must be able to scrape a chain-is-down exporter, so
 * readiness cannot be made to depend on the chain being reachable.
 */

import { startPolling } from './collector.mjs';
import { startServer } from './server.mjs';

const server = startServer();
const stopPolling = startPolling();

/**
 * Graceful shutdown.
 *
 * Compose sends SIGTERM and waits out `stop_grace_period` before SIGKILL.
 * Closing the listener lets an in-flight scrape finish rather than handing
 * Prometheus a connection reset, which would surface as a false scrape error
 * on every ordinary `docker compose down`.
 */
function shutdown(signal) {
  console.info(`[main] ${signal} received, shutting down`);
  stopPolling();
  server.close(() => process.exit(0));

  // Backstop: a wedged keep-alive connection must not outlive the grace
  // period, or Compose escalates to SIGKILL and the exit code is a lie.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/**
 * The collector catches its own errors, so anything arriving here is a genuine
 * bug rather than an unreachable chain. Log it and exit non-zero: a monitoring
 * process that keeps running in an unknown state is worse than one that
 * restarts, because Compose's restart policy can fix the second.
 */
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled rejection:', reason);
  process.exit(1);
});

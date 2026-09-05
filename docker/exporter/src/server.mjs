/**
 * The HTTP surface: /metrics, /healthz and a small index.
 *
 * Written against node:http rather than express because the whole surface is
 * three routes. A framework here would add a dependency tree to audit for no
 * behaviour this file does not already have.
 */

import { createServer } from "node:http";
import { config } from "./config.mjs";
import { registry, rpcUp } from "./metrics.mjs";

/**
 * Reads a gauge's current value without going through the text encoder.
 * Used only by /healthz, which reports chain reachability as context.
 */
async function currentRpcUp() {
  const { values } = await rpcUp.get();
  return values[0]?.value ?? 0;
}

export function startServer() {
  const server = createServer((req, res) => {
    // Everything here is a read. A POST to /metrics is a client bug, and
    // answering it as though it were a GET hides that bug.
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }

    const path = new URL(req.url, "http://localhost").pathname;

    if (path === "/metrics") {
      // Serves whatever the last poll produced. It does NOT trigger a poll:
      // scrape latency must reflect this process, not the chain's, or a slow
      // chain becomes a scrape timeout and Prometheus records no sample at
      // all -- losing the rpc_up 0 that says the chain is down.
      registry
        .metrics()
        .then((body) => {
          res.writeHead(200, { "content-type": registry.contentType });
          res.end(body);
        })
        .catch((error) => {
          console.error(`[server] failed to encode metrics: ${error.message}`);
          res.writeHead(500, { "content-type": "text/plain" }).end("metric encoding failed\n");
        });
      return;
    }

    if (path === "/healthz") {
      // LIVENESS, not readiness. This returns 200 even when the chain is
      // unreachable, and that is the point: a Docker healthcheck failing here
      // would restart the exporter every time the chain blipped, destroying
      // the very metrics that would explain the blip. Chain reachability is
      // reported in the body as context and exported properly as
      // auction_chain_rpc_up -- alert on that, not on this endpoint.
      currentRpcUp()
        .then((up) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "ok", rpcUp: up === 1, rpcUrl: config.rpcUrl }) + "\n");
        })
        .catch(() => {
          res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}\n');
        });
      return;
    }

    if (path === "/") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(
        `auction chain exporter\n\n  /metrics   Prometheus exposition\n  /healthz   liveness\n\nchain: ${config.rpcUrl}\n`,
      );
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" }).end("not found\n");
  });

  // 0.0.0.0 is required, not lax: the container is reached over the Compose
  // bridge network, so a bind to 127.0.0.1 would be unreachable by Prometheus.
  // Exposure is controlled at the Compose layer, where the port is `expose`d
  // to the network and never published to the host.
  server.listen(config.port, "0.0.0.0", () => {
    console.info(
      `[server] listening on :${config.port}, polling ${config.rpcUrl} every ${config.pollIntervalMs}ms`,
    );
  });

  return server;
}

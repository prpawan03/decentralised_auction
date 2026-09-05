# syntax=docker/dockerfile:1.19
# ---------------------------------------------------------------------------
# Chain exporter: JSON-RPC and contract state as Prometheus metrics.
#
# This image is standalone, exactly like docker/chain.Dockerfile. It builds
# from docker/exporter/package-lock.json and NOT from the root workspace lock
# file, so a change under contracts/ or web/ never invalidates its layers and
# `make up` after a contract edit does not rebuild the monitoring stack.
#
# WHY a custom exporter rather than an off-the-shelf one: see the header
# comment in docker/exporter/src/collector.mjs. Short version -- json_exporter
# cannot parse the hex quantities JSON-RPC returns, blackbox_exporter can only
# report reachability, and ethereum-metrics-exporter is stale, collides with
# Prometheus on port 9090, and depends on RPC methods Hardhat lacks.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=24-alpine

# --- Stage 1: dependencies -------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /opt/exporter

# Manifests only. Docker caches this layer until a manifest changes.
COPY docker/exporter/package.json docker/exporter/package-lock.json ./

# `npm ci` installs the exact locked versions. Never use `npm install` here.
# The cache mount keeps the npm cache out of the image layer.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

# --- Stage 2: runtime ------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime

LABEL org.opencontainers.image.title="auction-chain-exporter" \
      org.opencontainers.image.description="Prometheus exporter for the NFT auction chain: block height, RPC health and AuctionHouse contract state." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="decentralised-auction" \
      org.opencontainers.image.source="https://github.com/prpawan03/decentralised_auction" \
      org.opencontainers.image.base.name="docker.io/library/node:24-alpine"

ENV NODE_ENV=production \
    EXPORTER_PORT=9101 \
    RPC_URL=http://chain:8545 \
    CHAIN_ID=31337 \
    POLL_INTERVAL_MS=5000 \
    npm_config_update_notifier=false

WORKDIR /opt/exporter

# Set ownership and mode DURING the copy.
#
# A separate `RUN chown -R node:node` over node_modules costs minutes and it
# writes a second full copy of every file into a new layer. `COPY --chown`
# sets the owner as the layer is written, at no cost. This was measured: the
# recursive form took 426 seconds in the deployer image.
COPY --from=deps --chown=node:node /opt/exporter/node_modules ./node_modules
COPY --chown=node:node docker/exporter/package.json ./
COPY --chown=node:node docker/exporter/src ./src
# `--chmod` sets the executable bit here, so the Git setting on the host does
# not matter. Windows Git does not keep that bit.
COPY --chown=node:node --chmod=0755 docker/exporter/healthcheck.mjs ./healthcheck.mjs

# Run as a non-root user. Nothing in this image writes to disk, so the runtime
# needs no writable directory and the compose file can set `read_only: true`.
USER node

EXPOSE 9101

# The probe replaces curl, which the alpine image does not contain.
#
# `start-period` is short because the server binds before the first poll
# finishes: the exporter is healthy the moment it is listening, whether or not
# the chain is up yet.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "/opt/exporter/healthcheck.mjs"]

# No tini here: the base compose file sets `init: true`, which gives every
# service a real process 1 to reap zombies and forward signals. Baking a second
# init into the image would only duplicate that. src/main.mjs handles SIGTERM
# itself so the shutdown is graceful rather than merely fast.
CMD ["node", "/opt/exporter/src/main.mjs"]

# syntax=docker/dockerfile:1.19
# ---------------------------------------------------------------------------
# Development chain: Hardhat 3 JSON-RPC node.
#
# This image is standalone. It does not use contracts/. A contract change
# MUST NOT rebuild this image.
#
# Ganache and Truffle are archived software. Do not add them.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=24-alpine

# --- Stage 1: dependencies -------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /opt/chain

# Copy the manifests only. Docker then caches this layer until a manifest
# changes.
COPY docker/chain/package.json docker/chain/package-lock.json ./

# `npm ci` installs the exact locked versions. Never use `npm install` here.
# The cache mount keeps the npm cache out of the image layer.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

# --- Stage 2: runtime ------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime

LABEL org.opencontainers.image.title="auction-chain" \
      org.opencontainers.image.description="Hardhat 3 local development chain for the NFT auction demonstration." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="decentralised-auction" \
      org.opencontainers.image.source="https://github.com/prpawan03/decentralised_auction" \
      org.opencontainers.image.base.name="docker.io/library/node:24-alpine"

ENV NODE_ENV=production \
    CHAIN_ID=31337 \
    CHAIN_PORT=8545 \
    BLOCK_TIME=0 \
    HARDHAT_DISABLE_TELEMETRY_PROMPT=true \
    npm_config_update_notifier=false

WORKDIR /opt/chain

# Set ownership and mode DURING the copy.
#
# A separate `RUN chown -R node:node` over node_modules costs minutes and it
# writes a second full copy of every file into a new layer. `COPY --chown`
# sets the owner as the layer is written, at no cost. This was measured: the
# recursive form took 426 seconds in the deployer image.
COPY --from=deps --chown=node:node /opt/chain/node_modules ./node_modules
COPY --chown=node:node docker/chain/package.json docker/chain/hardhat.config.js ./
# `--chmod` sets the executable bit here, so the Git setting on the host does
# not matter. Windows Git does not keep that bit.
COPY --chown=node:node --chmod=0755 docker/chain/healthcheck.js ./healthcheck.js

# The chain writes a cache and artifacts under the work directory. Create the
# two directories and give them to the `node` user. This chown is NOT
# recursive, so it stays fast.
RUN mkdir -p /opt/chain/cache /opt/chain/artifacts \
 && chown node:node /opt/chain /opt/chain/cache /opt/chain/artifacts

# Run as a non-root user.
USER node

EXPOSE 8545

# The probe replaces curl, which the alpine image does not contain.
HEALTHCHECK --interval=5s --timeout=5s --start-period=30s --retries=12 \
    CMD ["node", "/opt/chain/healthcheck.js"]

CMD ["npx", "hardhat", "node", "--hostname", "0.0.0.0", "--port", "8545"]

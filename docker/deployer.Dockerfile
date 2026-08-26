# syntax=docker/dockerfile:1.19
# ---------------------------------------------------------------------------
# Deployer: a one-shot initialisation container.
#
# The container waits for the chain, deploys the contracts, seeds the demo
# data and then exits with code 0. Compose gates the web service on that exit
# code. This replaces the `sleep 10` race in the old compose file.
#
# The build context is the REPOSITORY ROOT, because the lock file lives at the
# root of the npm workspace.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=24-alpine

# --- Stage 1: dependencies -------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# `npm ci` reads the root lock file. Copy EVERY workspace manifest, not only
# the one that this image needs. npm 10 tolerates a missing sibling manifest,
# but that behaviour is not documented, and a stricter npm would then fail the
# build. Copying all of them costs nothing and it removes the risk.
#
# `--workspace contracts --include-workspace-root` installs the contracts
# packages and the root packages. It does NOT install the web packages. This
# was measured.
COPY package.json package-lock.json ./
COPY contracts/package.json ./contracts/
COPY web/package.json ./web/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace contracts --include-workspace-root --no-audit --no-fund

# npm HOISTS most packages to /app/node_modules, but it NESTS a package under
# the workspace when two workspaces pin conflicting versions. The contracts
# tree hoists fully today. It MUST NOT be assumed to keep doing so: a future
# version conflict would nest a package and the runtime stage would then miss
# it. `mkdir -p` makes the next COPY safe in both cases.
RUN mkdir -p /app/contracts/node_modules

# --- Stage 2: runtime ------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime

LABEL org.opencontainers.image.title="auction-deployer" \
      org.opencontainers.image.description="One-shot contract deployment and demo seeding for the NFT auction demonstration." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="decentralised-auction" \
      org.opencontainers.image.source="https://github.com/prpawan03/decentralised_auction" \
      org.opencontainers.image.base.name="docker.io/library/node:24-alpine"

ENV NODE_ENV=development \
    HARDHAT_DISABLE_TELEMETRY_PROMPT=true \
    npm_config_update_notifier=false

WORKDIR /app

# Set ownership DURING the copy. A separate `RUN chown -R node:node /app`
# took 426 seconds, because it rewrote every file in node_modules into a new
# layer. `COPY --chown` does the same work for free.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node contracts ./contracts
# Both trees are needed. See the note in the deps stage.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/contracts/node_modules ./contracts/node_modules
COPY --chown=node:node scripts/rpc.mjs ./scripts/rpc.mjs

# `--chmod` sets the executable bit. Git on Windows does not keep that bit,
# so the Dockerfile MUST set it.
COPY --chmod=0755 docker/deployer-entrypoint.sh /usr/local/bin/deployer-entrypoint.sh

# The Solidity compiler writes artifacts and a cache under contracts/. Create
# the directories now and give them to the `node` user, so the container does
# not need to create them as root.
RUN mkdir -p /app/contracts/artifacts /app/contracts/cache /app/contracts/deployments \
 && chown node:node /app/contracts/artifacts /app/contracts/cache /app/contracts/deployments

USER node

ENTRYPOINT ["/usr/local/bin/deployer-entrypoint.sh"]

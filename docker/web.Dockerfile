# syntax=docker/dockerfile:1.19
# ---------------------------------------------------------------------------
# Web application.
#
# Targets:
#   dev   Vite development server on port 5173. Compose `develop: watch:`
#         copies the source into the container. There is no bind mount.
#   prod  Static files served by nginx-unprivileged on port 8080.
#
# The build context is the REPOSITORY ROOT, because the lock file lives at the
# root of the npm workspace.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=24-alpine
ARG NGINX_VERSION=1.29-alpine

# --- Stage 1: dependencies -------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Copy EVERY workspace manifest, not only the one that this image needs. npm
# 10 tolerates a missing sibling manifest, but that behaviour is not
# documented. Copying all of them removes the risk.
#
# `--workspace web --include-workspace-root` installs the web packages and
# the root packages. It does NOT install the contracts packages.
COPY package.json package-lock.json ./
COPY contracts/package.json ./contracts/
COPY web/package.json ./web/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace web --include-workspace-root --no-audit --no-fund

# npm workspaces HOIST most packages to /app/node_modules, but npm NESTS a
# package under the workspace when two workspaces pin versions that conflict.
# The web workspace pins viem, typescript and @types/node at versions that the
# contracts workspace does not share, so npm puts vite and its friends in
# /app/web/node_modules. Copying only /app/node_modules produced
# `vite: not found` (exit 127). This was measured.
#
# `mkdir -p` guarantees the directory exists, so the COPY in the next stage
# never fails when npm happens to hoist everything.
RUN mkdir -p /app/web/node_modules

# --- Stage 2: development server -------------------------------------------
FROM node:${NODE_VERSION} AS dev

LABEL org.opencontainers.image.title="auction-web-dev" \
      org.opencontainers.image.description="Vite development server for the NFT auction demonstration." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="decentralised-auction" \
      org.opencontainers.image.source="https://github.com/prpawan03/decentralised_auction" \
      org.opencontainers.image.base.name="docker.io/library/node:24-alpine"

ENV NODE_ENV=development \
    npm_config_update_notifier=false

WORKDIR /app
# Set ownership DURING the copy. A recursive chown over node_modules costs
# minutes and it doubles the image size.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node web ./web
# Both trees are needed. See the note in the deps stage.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/web/node_modules ./web/node_modules

USER node
WORKDIR /app/web

EXPOSE 5173

# The probe replaces curl, which the alpine image does not contain.
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=6 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:5173/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

# --- Stage 3: production bundle --------------------------------------------
FROM node:${NODE_VERSION} AS build

# The version reaches the bundle through Vite. Vite exposes only the
# variables whose name starts with VITE_.
ARG BUILD_VERSION=local
ENV NODE_ENV=production
ENV VITE_BUILD_VERSION=${BUILD_VERSION}

WORKDIR /app
COPY package.json package-lock.json ./
COPY web ./web
# Both trees are needed. See the note in the deps stage.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
RUN npm run build --workspace web

# --- Stage 4: production server --------------------------------------------
FROM nginxinc/nginx-unprivileged:${NGINX_VERSION} AS prod

LABEL org.opencontainers.image.title="auction-web" \
      org.opencontainers.image.description="Static build of the NFT auction demonstration, served by nginx." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="decentralised-auction" \
      org.opencontainers.image.source="https://github.com/prpawan03/decentralised_auction" \
      org.opencontainers.image.base.name="docker.io/nginxinc/nginx-unprivileged:1.29-alpine"

# The bundle is stored OUTSIDE the served directory. The entry point copies it
# into the served directory at start time. See docker/web-entrypoint.d/
# 10-runtime-config.sh for the reason.
COPY --from=build --chown=101:101 /app/web/dist /opt/site

# The nginx config is stored outside /etc/nginx for the same reason: it names
# the hosts allowed to serve token artwork, which is a deployment setting, so
# 05-nginx-config.sh renders it at start time. See that script.
COPY docker/nginx/default.conf.template /opt/nginx/default.conf.template

# `--chmod` sets the executable bit without a root step and without an extra
# layer. Git on Windows does not keep that bit, so the Dockerfile MUST set it.
# The numeric prefixes are the run order: the config must exist before the
# bundle is staged, and both before nginx starts.
COPY --chmod=0755 docker/web-entrypoint.d/05-nginx-config.sh /docker-entrypoint.d/05-nginx-config.sh
COPY --chmod=0755 docker/web-entrypoint.d/10-runtime-config.sh /docker-entrypoint.d/10-runtime-config.sh

EXPOSE 8080

# nginx-unprivileged contains no curl either. Use the built-in status route.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
    CMD ["/bin/sh", "-c", "wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1"]

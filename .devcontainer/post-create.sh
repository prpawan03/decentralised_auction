#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# postCreateCommand for the NFT auction dev container.
#
# Runs ONCE, after the container is created and before VS Code attaches
# (devcontainer.json sets "waitFor": "postCreateCommand").
#
# Contract with the rest of the repository:
#   - It does the same two things `make setup` does -- create .env from
#     .env.example, install the workspace packages -- so a contributor who
#     never opens a dev container gets an identical result from `make setup`.
#     Keep the two in step.
#   - It is IDEMPOTENT. Re-running it on an existing Codespace must not
#     clobber an edited .env or reinstall over a good node_modules.
#   - It never touches the Docker daemon. Starting the stack is the
#     developer's call (`make up`), not a side effect of opening an editor:
#     a create hook that pulls and builds six images turns a 40-second
#     Codespace start into a five-minute one.
#
# POSIX sh on purpose (not bash): it is checked with `sh -n` in review, and
# nothing below needs an array or `[[`.
# ---------------------------------------------------------------------------

# -e: stop at the first unhandled failure, so a broken install is loud.
# -u: an unset variable is a bug, not an empty string.
# There is no `set -o pipefail` -- that is a bashism and this is sh.
set -eu

# Resolve the repository root from this script's own location rather than
# trusting the caller's working directory. postCreateCommand happens to run in
# the workspace folder today, but that is not something to depend on.
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "${SCRIPT_DIR}/.." && pwd)
cd "${REPO_ROOT}"

# Colours only when stdout is a terminal. In Codespaces prebuild logs it is
# not, and raw escape codes there are just noise.
if [ -t 1 ]; then
  BOLD=$(printf '\033[1m'); DIM=$(printf '\033[2m')
  GREEN=$(printf '\033[32m'); YELLOW=$(printf '\033[33m'); RESET=$(printf '\033[0m')
else
  BOLD=''; DIM=''; GREEN=''; YELLOW=''; RESET=''
fi

say()  { printf '%s==>%s %s\n' "${GREEN}${BOLD}" "${RESET}" "$*"; }
warn() { printf '%s[!]%s %s\n' "${YELLOW}${BOLD}" "${RESET}" "$*" >&2; }

printf '\n%spost-create: preparing the auction workspace%s\n\n' "${BOLD}" "${RESET}"

# ---------------------------------------------------------------------------
# 1. Environment file
# ---------------------------------------------------------------------------
# Compose reads .env for WEB_PORT, RPC_PORT, CHAIN_ID, the demo mnemonic and
# the two contract addresses. Without it every `${VAR:-default}` in
# compose.yaml falls back silently, which mostly works and then confuses
# everyone the one time it does not.
#
# Guarded by `-f`: a developer who rebuilt the container must not lose the
# .env they edited. .env is gitignored, so it does not survive a rebuild by
# itself -- but on a Codespace rebuild the workspace volume can persist.
if [ -f .env ]; then
  say ".env already exists -- keeping it untouched"
elif [ -f .env.example ]; then
  cp .env.example .env
  say "created .env from .env.example"
else
  # Not fatal: the compose defaults still bring the stack up.
  warn ".env.example is missing; skipping .env creation"
fi

# ---------------------------------------------------------------------------
# 2. Workspace dependencies
# ---------------------------------------------------------------------------
# `npm ci` rather than `npm install`: it installs exactly what
# package-lock.json pins and it never rewrites the lock file. A dev container
# that silently drifts from the lock is a dev container that reproduces
# nothing. This is a root install; npm workspaces then links `contracts` and
# `web` into the shared node_modules.
#
# `npm ci` deletes node_modules first, so it is inherently idempotent -- but
# it is also the slow step, hence the skip when the tree is already in place
# and no newer lock file has landed.
if [ ! -f package-lock.json ]; then
  warn "package-lock.json is missing; falling back to 'npm install'"
  npm install --no-audit --no-fund
elif [ -d node_modules ] && [ ! package-lock.json -nt node_modules ]; then
  say "node_modules is newer than package-lock.json -- skipping install"
else
  say "installing workspace packages with 'npm ci' (this is the slow part)"
  # --no-audit / --no-fund: two network round trips and a wall of text that
  # nobody reads during a container create. `npm audit` is a CI job.
  npm ci --no-audit --no-fund
fi

# ---------------------------------------------------------------------------
# 3. Docker reachability check -- ADVISORY ONLY
# ---------------------------------------------------------------------------
# The docker-outside-of-docker feature mounts the host's socket, so `docker`
# here drives the HOST daemon and the stack comes up as sibling containers.
#
# This check MUST NOT fail the create. A dev container whose build aborts
# because the socket was not ready yet is worse than one that opens with a
# warning: you cannot even open a terminal to diagnose it. Every failure path
# below therefore only warns.
DOCKER_OK=0
if ! command -v docker >/dev/null 2>&1; then
  warn "the 'docker' CLI is not on PATH."
  warn "  The docker-outside-of-docker feature should have installed it."
  warn "  'make up' will not work until that is fixed."
elif ! docker info >/dev/null 2>&1; then
  warn "'docker' is installed but the daemon did not answer."
  warn "  Usually one of:"
  warn "    - Docker Desktop is not running on your machine (local dev containers)"
  warn "    - /var/run/docker.sock was not mounted"
  warn "    - this user is not in the docker group (try reopening the container)"
  warn "  Everything except 'make up' / 'make watch' still works."
else
  DOCKER_OK=1
  # Compose v2 is required: the Makefile uses `docker compose` and the overlay
  # files use the `!override` / `!reset` tags, which need v2.24 or later.
  if docker compose version >/dev/null 2>&1; then
    say "docker reachable: $(docker compose version --short 2>/dev/null || echo 'compose v2')"
  else
    DOCKER_OK=0
    warn "docker works but 'docker compose' (v2) is missing."
    warn "  The archived 'docker-compose' script is NOT a substitute:"
    warn "  the overlay files use the !override tag, which needs Compose v2.24+."
  fi
fi

# ---------------------------------------------------------------------------
# 4. What to do next
# ---------------------------------------------------------------------------
# Read the published ports out of .env so the banner shows the URLs that will
# actually work, not the defaults. Sourcing .env is avoided on purpose -- it
# would execute whatever is in there; a grep is enough for two integers.
env_port() {
  # $1 = key, $2 = default
  _v=$(sed -n "s/^[[:space:]]*$1=\([0-9][0-9]*\).*/\1/p" .env 2>/dev/null | tail -n 1)
  [ -n "${_v:-}" ] && printf '%s' "${_v}" || printf '%s' "$2"
}
WEB_PORT=$(env_port WEB_PORT 5173)
RPC_PORT=$(env_port RPC_PORT 8545)
GRAFANA_PORT=$(env_port GRAFANA_PORT 3000)
PROM_PORT=$(env_port PROMETHEUS_PORT 9090)

cat <<BANNER

${BOLD}Ready.${RESET} ${DIM}(Windows users without make: every target below is also 'npm run <name>'.)${RESET}

  ${BOLD}Start here${RESET}
    make up             build and start chain + deployer + web, in the background
    make watch          same, in the foreground, syncing source changes into the containers
    make logs           follow the logs of every service
    make down           stop and remove the containers

  ${BOLD}Optional profiles${RESET}
    make indexer        add the Ponder indexer (GraphQL, proxied through nginx)
    make monitoring     add Prometheus and Grafana
    make full           everything at once

  ${BOLD}Contracts and quality${RESET}
    make deploy         redeploy the contracts to the running chain
    make seed           recreate the demo auctions
    make test           contract tests + web tests
    make lint           check style        ${DIM}(make fmt to fix)${RESET}
    make smoke          verify a running stack answers correctly
    make help           the full target list

  ${BOLD}URLs${RESET} ${DIM}(auto-forwarded; click them in the PORTS panel)${RESET}
    Auction UI          http://127.0.0.1:${WEB_PORT}
    JSON-RPC            http://127.0.0.1:${RPC_PORT}          ${DIM}chain id 31337${RESET}
    Grafana             http://127.0.0.1:${GRAFANA_PORT}          ${DIM}'make monitoring' only${RESET}
    Prometheus          http://127.0.0.1:${PROM_PORT}          ${DIM}'make monitoring' only${RESET}

  ${DIM}From THIS shell the stack is at host.docker.internal, not 127.0.0.1 --${RESET}
  ${DIM}the containers are siblings and publish onto the host's loopback.${RESET}
  ${DIM}Browser-side E2E? Run 'npx playwright install --with-deps chromium' first.${RESET}

BANNER

if [ "${DOCKER_OK}" -ne 1 ]; then
  warn "Docker is not usable yet -- see the warnings above before running 'make up'."
fi

# Explicit success. Anything above that mattered has already aborted via -e.
exit 0

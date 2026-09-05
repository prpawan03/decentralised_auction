#!/bin/sh
# ---------------------------------------------------------------------------
# nginx configuration for the web application.
#
# WHY THIS FILE EXISTS
# The Content Security Policy has to name the hosts that serve NFT artwork and
# metadata. Those hosts are a property of the DEPLOYMENT, not of the image: an
# operator running their own IPFS gateway must be able to point the policy at
# it without rebuilding. Baking the policy into the image would make
# IPFS_GATEWAY a setting the browser honours and the CSP then blocks, which
# fails as a silent placeholder on every listing.
#
# WHY IT IS GENERATED RATHER THAN EDITED
# The container runs with `read_only: true`, so /etc/nginx/conf.d is a tmpfs
# and starts empty. This script fills it from the template baked into the
# read-only image, exactly as 10-runtime-config.sh fills the site root from
# /opt/site. This runs FIRST — the 05 prefix — because nginx reads the result.
#
# WHY envsubst TAKES AN EXPLICIT VARIABLE LIST
# An nginx config is full of `$uri`, `$auction_cache_control` and friends.
# Bare `envsubst` would replace every one of them with an empty string and
# produce a config that either fails to parse or, worse, parses into something
# that serves the wrong bytes. Naming the two variables confines substitution
# to them and leaves nginx's own variables alone.
# ---------------------------------------------------------------------------
set -eu

TEMPLATE="${NGINX_CONF_TEMPLATE:-/opt/nginx/default.conf.template}"
TARGET="${NGINX_CONF_TARGET:-/etc/nginx/conf.d/default.conf}"

echo "05-nginx-config: rendering ${TARGET}"

if [ ! -f "${TEMPLATE}" ]; then
  echo "05-nginx-config: ERROR: ${TEMPLATE} does not exist" >&2
  exit 1
fi

# Token artwork. An ERC-721 may point tokenURI at any host by design, and an
# image executes nothing, so the default is broad. Narrow it if you control
# every collection listed on your deployment.
AUCTION_CSP_IMG_SRC="${CSP_IMG_SRC:-'self' data: blob: https:}"

# The metadata JSON fetch is a real XHR, so this default is deliberately NOT
# broad: the local JSON-RPC endpoint, and the default public IPFS gateway.
# Pointing IPFS_GATEWAY somewhere else without widening this will show
# placeholder tiles instead of artwork — which is the safe failure, and the
# reason the two settings are documented together.
DEFAULT_CONNECT="'self' http://127.0.0.1:8545 http://localhost:8545 ws://127.0.0.1:8545 ws://localhost:8545 https://ipfs.io https://arweave.net"
AUCTION_CSP_CONNECT_SRC="${CSP_CONNECT_SRC:-${DEFAULT_CONNECT}}"

export AUCTION_CSP_IMG_SRC AUCTION_CSP_CONNECT_SRC

mkdir -p "$(dirname "${TARGET}")"

# The single-quoted list is the whole safety property of this script. Keep any
# new placeholder in the template and in this list in step.
envsubst '${AUCTION_CSP_IMG_SRC} ${AUCTION_CSP_CONNECT_SRC}' \
  < "${TEMPLATE}" > "${TARGET}"

# A template placeholder that survived means the variable was not in the list
# above. nginx would serve the literal `${...}` inside the CSP header, which
# browsers reject wholesale — every remote image and fetch would be blocked
# with no obvious cause. Fail loudly here instead.
if grep -q '\${' "${TARGET}"; then
  echo "05-nginx-config: ERROR: unsubstituted placeholder left in ${TARGET}:" >&2
  grep -n '\${' "${TARGET}" >&2
  exit 1
fi

echo "05-nginx-config: img-src     ${AUCTION_CSP_IMG_SRC}"
echo "05-nginx-config: connect-src ${AUCTION_CSP_CONNECT_SRC}"

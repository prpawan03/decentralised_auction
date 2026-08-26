#!/bin/sh
# ---------------------------------------------------------------------------
# Runtime configuration for the web application.
#
# WHY THIS FILE EXISTS
# The contract address is not known when the image is built. The address MUST
# NOT be baked into the bundle. A baked address forces an image rebuild after
# every chain reset. This script writes the address into a small JavaScript
# file when the container starts. One image therefore works against any chain.
#
# WHY THE BUNDLE IS COPIED
# The container runs with `read_only: true`. A read-only file system cannot
# accept a new config.js. The chosen solution keeps `read_only: true` and
# mounts a tmpfs over /usr/share/nginx/html. A tmpfs starts empty. This script
# therefore first copies the bundle from /opt/site, which is inside the
# read-only image, and then writes config.js next to the copy. The rejected
# alternative was to remove `read_only: true`. That alternative gives write
# access to the whole file system for the sake of one small file. The tmpfs is
# the smaller privilege.
#
# CONTRACT WITH THE WEB WORKSPACE
#
# 1. web/index.html MUST load this file BEFORE the application bundle:
#
#        <script src="/config.js"></script>
#        <script type="module" src="/src/main.tsx"></script>
#
# 2. The application MUST read `window.__AUCTION_CONFIG__` first. The
#    application MUST fall back to `import.meta.env` when a property is
#    absent. The Vite development server does not run this script, so the
#    fallback is the development path.
#
# 3. This script writes exactly this shape:
#
#        window.__AUCTION_CONFIG__ = {
#          chainId:             31337,                    // number
#          chainName:           "Auction Local",          // string
#          rpcUrl:              "http://127.0.0.1:8545",  // string
#          auctionHouseAddress: "0x5FbD...",              // string, 42 chars
#          demoNftAddress:      "0xe7f1...",              // string, 42 chars
#          blockExplorerUrl:    "",                       // string, optional
#          walletConnectProjectId: "",                    // string, optional
#          blockTime:           2,                        // number, seconds
#          seedDemoData:        true,                     // boolean
#          buildVersion:        "dev",                    // string
#          generatedAt:         "2026-08-26T11:36:00Z"    // string, ISO 8601
#        };
#
# 4. The matching development fallbacks are:
#
#        VITE_CHAIN_ID, VITE_CHAIN_NAME, VITE_RPC_URL,
#        VITE_AUCTION_HOUSE_ADDRESS, VITE_DEMO_NFT_ADDRESS,
#        VITE_BLOCK_TIME, VITE_SEED_DEMO_DATA, VITE_BUILD_VERSION
#
#    web/src/config/runtime.ts implements this order. It drops any value that
#    is an empty string or that still holds a `${...}` placeholder, so an
#    empty optional field is safe to write.
#
# 5. `rpcUrl` is the URL that the BROWSER uses. The value is a localhost URL
#    even when the application runs in a container. MetaMask runs on the host
#    and not inside the container network.
# ---------------------------------------------------------------------------
set -eu

SITE_SOURCE="${SITE_SOURCE:-/opt/site}"
SITE_ROOT="${SITE_ROOT:-/usr/share/nginx/html}"

echo "10-runtime-config: preparing ${SITE_ROOT}"

if [ ! -d "${SITE_SOURCE}" ]; then
  echo "10-runtime-config: ERROR: ${SITE_SOURCE} does not exist" >&2
  exit 1
fi

mkdir -p "${SITE_ROOT}"

# Copy the bundle out of the read-only image into the writable tmpfs.
# `cp -R <dir>/. <dir>` copies the contents and not the directory itself.
cp -R "${SITE_SOURCE}/." "${SITE_ROOT}/"

# Escape a value for a JavaScript double-quoted string. The expression puts a
# backslash in front of every backslash and every double quote. `tr` then
# removes any newline, because a newline would end the JavaScript string.
js_string() {
  printf '%s' "$1" | sed 's/[\\"]/\\&/g' | tr -d '\n\r'
}

# Normalise a boolean. Any value other than `true` becomes `false`.
js_bool() {
  if [ "${1:-}" = "true" ]; then printf 'true'; else printf 'false'; fi
}

# Normalise a number. A value that is not a whole number becomes the default.
js_number() {
  case "${1:-}" in
    '' | *[!0-9]*) printf '%s' "$2" ;;
    *) printf '%s' "$1" ;;
  esac
}

CHAIN_ID_VALUE="$(js_number "${CHAIN_ID:-}" 31337)"
BLOCK_TIME_VALUE="$(js_number "${BLOCK_TIME:-}" 0)"
CHAIN_NAME_VALUE="$(js_string "${CHAIN_NAME:-Auction Local}")"
RPC_URL_VALUE="$(js_string "${PUBLIC_RPC_URL:-http://127.0.0.1:8545}")"
AUCTION_HOUSE_VALUE="$(js_string "${AUCTION_HOUSE_ADDRESS:-}")"
DEMO_NFT_VALUE="$(js_string "${DEMO_NFT_ADDRESS:-}")"
SEED_VALUE="$(js_bool "${SEED_DEMO_DATA:-false}")"
BUILD_VERSION_VALUE="$(js_string "${BUILD_VERSION:-dev}")"
# Both of these are optional. The web reader drops an empty string, so an
# empty value is the same as an absent value.
BLOCK_EXPLORER_VALUE="$(js_string "${BLOCK_EXPLORER_URL:-}")"
WALLETCONNECT_VALUE="$(js_string "${WALLETCONNECT_PROJECT_ID:-}")"
GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "${SITE_ROOT}/config.js" <<EOF
// Generated when the container started.
// Source: docker/web-entrypoint.d/10-runtime-config.sh
// Do not edit this file. Do not commit this file.
window.__AUCTION_CONFIG__ = {
  chainId: ${CHAIN_ID_VALUE},
  chainName: "${CHAIN_NAME_VALUE}",
  rpcUrl: "${RPC_URL_VALUE}",
  auctionHouseAddress: "${AUCTION_HOUSE_VALUE}",
  demoNftAddress: "${DEMO_NFT_VALUE}",
  blockExplorerUrl: "${BLOCK_EXPLORER_VALUE}",
  walletConnectProjectId: "${WALLETCONNECT_VALUE}",
  blockTime: ${BLOCK_TIME_VALUE},
  seedDemoData: ${SEED_VALUE},
  buildVersion: "${BUILD_VERSION_VALUE}",
  generatedAt: "${GENERATED_AT}"
};
EOF

echo "10-runtime-config: wrote ${SITE_ROOT}/config.js"

# Warn when the address is missing. The application starts, but no auction
# loads. A silent empty address is hard to diagnose.
if [ -z "${AUCTION_HOUSE_ADDRESS:-}" ]; then
  echo "10-runtime-config: WARNING: AUCTION_HOUSE_ADDRESS is empty" >&2
fi

#!/bin/sh
# ---------------------------------------------------------------------------
# Deployer entry point.
#
# Order of work:
#   1. Wait for the chain to answer JSON-RPC.
#   2. Check that the chain identifier is the expected one.
#   3. Deploy the contracts, unless the expected bytecode is already present.
#   4. Check that bytecode exists at every expected address.
#   5. Seed the demo auctions when SEED_DEMO_DATA is `true`.
#   6. Exit with code 0.
#
# Any failure exits with a non-zero code. Compose then holds the web service,
# because the web service waits for `service_completed_successfully`.
#
# Interface with the contracts workspace:
#   `npm run deploy --workspace contracts` MUST deploy AuctionHouse and DemoNFT.
#   `npm run seed   --workspace contracts` MUST create the demo auctions.
#   Both scripts MUST read RPC_URL and DEPLOYER_PRIVATE_KEY from the
#   environment. Override the commands with DEPLOY_CMD and SEED_CMD.
# ---------------------------------------------------------------------------
set -eu

RPC_URL="${RPC_URL:-http://chain:8545}"
CHAIN_ID="${CHAIN_ID:-31337}"
SEED_DEMO_DATA="${SEED_DEMO_DATA:-true}"
DEPLOY_CMD="${DEPLOY_CMD:-npm run deploy --workspace contracts}"
SEED_CMD="${SEED_CMD:-npm run seed --workspace contracts}"
WAIT_SECONDS="${WAIT_SECONDS:-120}"
# The path is overridable so that the test harness can run this script outside
# the image.
RPC_SCRIPT="${RPC_SCRIPT:-/app/scripts/rpc.mjs}"

export RPC_URL

rpc() {
  node "${RPC_SCRIPT}" "$@"
}

log() {
  echo "deployer: $1"
}

fail() {
  echo "deployer: ERROR: $1" >&2
  exit 1
}

# --- 1. Wait for the chain -------------------------------------------------
log "waiting for the chain at ${RPC_URL} (limit ${WAIT_SECONDS}s)"
actual_chain_id="$(rpc eth_chainId --wait "${WAIT_SECONDS}" --raw)" \
  || fail "the chain did not answer within ${WAIT_SECONDS} seconds"

# --- 2. Check the chain identifier -----------------------------------------
# eth_chainId returns a hexadecimal string. Convert it to decimal.
actual_decimal="$(node -e "process.stdout.write(String(parseInt('${actual_chain_id}', 16)))")"
if [ "${actual_decimal}" != "${CHAIN_ID}" ]; then
  fail "chain id mismatch: the chain reports ${actual_decimal}, the configuration expects ${CHAIN_ID}"
fi
log "chain is up, chain id ${actual_decimal}"

# --- 3. Deploy -------------------------------------------------------------
has_code() {
  code="$(rpc eth_getCode "[\"$1\",\"latest\"]" --raw 2>/dev/null || echo 0x)"
  [ "${code}" != "0x" ] && [ -n "${code}" ]
}

if [ -n "${AUCTION_HOUSE_ADDRESS:-}" ] && has_code "${AUCTION_HOUSE_ADDRESS}"; then
  log "bytecode already exists at ${AUCTION_HOUSE_ADDRESS}, skipping the deployment"
else
  log "deploying with: ${DEPLOY_CMD}"
  # shellcheck disable=SC2086
  sh -c "${DEPLOY_CMD}" || fail "the deployment failed"
fi

# --- 4. Verify the addresses ----------------------------------------------
# Deploying from account 0 at nonce 0 always produces the same address. A
# mismatch means the .env file and the chain state disagree. Stop, because a
# silent mismatch produces a frontend that reads an empty address.
for pair in "AuctionHouse=${AUCTION_HOUSE_ADDRESS:-}" "DemoNFT=${DEMO_NFT_ADDRESS:-}"; do
  name="${pair%%=*}"
  address="${pair#*=}"
  if [ -z "${address}" ]; then
    log "WARNING: no address is configured for ${name}, skipping the check"
    continue
  fi
  if has_code "${address}"; then
    log "${name} bytecode confirmed at ${address}"
  else
    fail "no bytecode at ${address} for ${name}. Run 'make reset-chain' and try again."
  fi
done

# --- 5. Seed ---------------------------------------------------------------
if [ "${SEED_DEMO_DATA}" = "true" ]; then
  log "seeding demo data with: ${SEED_CMD}"
  sh -c "${SEED_CMD}" || fail "the seeding failed"
else
  log "SEED_DEMO_DATA is not 'true', skipping the seeding"
fi

log "initialisation complete"
exit 0

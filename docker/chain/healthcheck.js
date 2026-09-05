// Health probe for the development chain.
//
// The node:alpine image contains no curl, so this script replaces it.
//
// TWO QUESTIONS, NOT ONE
// The first version of this probe asked only "does the node answer?". A node
// that has wedged its mining loop still answers `eth_blockNumber` for ever,
// with the same number, so the container stayed "healthy" while the chain was
// dead. Compose then let the deployer through and the failure surfaced later,
// somewhere less obvious.
//
// This probe asks both questions:
//   1. Does the node answer JSON-RPC?                         (always)
//   2. Is the block height still advancing?                   (see below)
//
// WHY QUESTION 2 IS CONDITIONAL
// It depends on the mining mode, which `BLOCK_TIME` selects:
//
//   BLOCK_TIME=0   Automatic mining. One block per transaction. An IDLE node
//                  produces no blocks at all, so a still height is the
//                  correct, healthy resting state. Asserting advancement here
//                  would mark every quiet moment as a failure. The probe
//                  therefore checks liveness only.
//
//   BLOCK_TIME>0   Interval mining. The node mines an empty block every
//                  BLOCK_TIME seconds whether or not anything happened, so a
//                  still height means the mining loop has stopped. That is a
//                  real fault and this probe reports it.
//
// Set HEALTH_REQUIRE_ADVANCE to "true" or "false" to override the choice.
//
// STATE
// Detecting "stopped" needs memory across probes. The last observed height and
// the time it last CHANGED are kept in HEALTH_STATE_FILE, which lives on the
// container's tmpfs, so it is empty again after a restart. Losing that file is
// never a failure: an unreadable or unwritable state file degrades this probe
// back to a liveness check rather than reporting a fault it cannot prove.
//
// Exit 0: the node is healthy.
// Exit 1: the node did not answer, answered wrongly, or has stopped mining.

import { readFileSync, writeFileSync } from "node:fs";

const port = Number(process.env.CHAIN_PORT ?? 8545);
const blockTime = Number(process.env.BLOCK_TIME ?? 0);
const stateFile = process.env.HEALTH_STATE_FILE ?? "/tmp/chain-health.json";

// Interval mining is the only mode in which a still height proves a fault.
const requireAdvance =
  process.env.HEALTH_REQUIRE_ADVANCE === "true"
    ? true
    : process.env.HEALTH_REQUIRE_ADVANCE === "false"
      ? false
      : Number.isFinite(blockTime) && blockTime > 0;

// How long the height may stand still before the mining loop is considered
// stopped. Four intervals absorbs a slow block and a probe landing early; the
// 20-second floor keeps a very short BLOCK_TIME from making the probe jumpy.
const staleLimitMs = Math.max(blockTime * 4, 20) * 1000;

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 4000);

/** Sends one JSON-RPC call and returns `result`, or throws. */
async function rpc(method, params = []) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: controller.signal,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${method}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method}: ${JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

function readState() {
  try {
    const parsed = JSON.parse(readFileSync(stateFile, "utf8"));
    if (typeof parsed.height !== "number" || typeof parsed.changedAt !== "number") {
      return null;
    }
    return parsed;
  } catch {
    // Absent on the first probe, and unreadable if the tmpfs filled. Both mean
    // "no history", which is not a fault.
    return null;
  }
}

/** Returns true when the state was persisted. A failure is reported, not fatal. */
function writeState(height, changedAt) {
  try {
    writeFileSync(stateFile, JSON.stringify({ height, changedAt }), "utf8");
    return true;
  } catch (error) {
    console.error(`chain: WARNING: cannot write ${stateFile}: ${error.message}`);
    console.error("chain: the advance check is disabled until the file is writable.");
    return false;
  }
}

try {
  const result = await rpc("eth_blockNumber");
  if (typeof result !== "string" || !result.startsWith("0x")) {
    console.error(`chain: bad eth_blockNumber result ${JSON.stringify(result)}`);
    process.exit(1);
  }

  const height = Number.parseInt(result, 16);
  if (!Number.isFinite(height)) {
    console.error(`chain: uninterpretable block height ${result}`);
    process.exit(1);
  }

  if (!requireAdvance) {
    // Automatic mining. Answering is the whole contract.
    process.exit(0);
  }

  const now = Date.now();
  const previous = readState();

  // No history, or the chain restarted and rewound. Either way this height is
  // a new baseline and there is nothing yet to compare it against.
  if (previous === null || height < previous.height) {
    writeState(height, now);
    process.exit(0);
  }

  if (height > previous.height) {
    writeState(height, now);
    process.exit(0);
  }

  // The height is unchanged. Carry the original changedAt forward, so the
  // stall is measured from when the chain actually stopped rather than from
  // the previous probe.
  const stalledForMs = now - previous.changedAt;
  if (!writeState(height, previous.changedAt)) {
    // Without persistence the measurement cannot be trusted. Degrade to a
    // liveness check instead of failing on a number we cannot verify.
    process.exit(0);
  }

  if (stalledForMs > staleLimitMs) {
    console.error(
      `chain: block height stuck at ${height} for ${Math.round(stalledForMs / 1000)}s ` +
        `(limit ${Math.round(staleLimitMs / 1000)}s, BLOCK_TIME=${blockTime}s). ` +
        "Interval mining should produce a block even when the chain is idle, " +
        "so the mining loop has stopped.",
    );
    process.exit(1);
  }

  process.exit(0);
} catch (error) {
  console.error(`chain: ${error.message}`);
  process.exit(1);
} finally {
  clearTimeout(timer);
}

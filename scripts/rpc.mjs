#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Minimal JSON-RPC client.
//
// The container images are based on alpine. Alpine does not contain curl.
// This script replaces curl for every JSON-RPC call in this repository. The
// deployer entry point, the smoke test and the CI workflow all use it.
//
// Usage:
//   node scripts/rpc.mjs <method> [jsonParams] [options]
//
// Options:
//   --url <url>       RPC endpoint. Default: $RPC_URL, then http://127.0.0.1:8545
//   --wait <seconds>  Retry until the call succeeds or the time runs out.
//   --raw             Print the result without JSON quoting.
//
// Examples:
//   node scripts/rpc.mjs eth_chainId --wait 60
//   node scripts/rpc.mjs eth_getCode '["0x5FbD...","latest"]' --raw
//
// Exit code 0: the call returned a result.
// Exit code 1: the call failed, or the time ran out.
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

function takeOption(name) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  argv.splice(index, 2);
  return value;
}

function takeFlag(name) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return false;
  }
  argv.splice(index, 1);
  return true;
}

const url = takeOption("--url") ?? process.env.RPC_URL ?? "http://127.0.0.1:8545";
const waitSeconds = Number(takeOption("--wait") ?? 0);
const raw = takeFlag("--raw");

const method = argv[0];
if (method === undefined) {
  console.error("usage: node scripts/rpc.mjs <method> [jsonParams] [--url u] [--wait s] [--raw]");
  process.exit(1);
}

let params = [];
if (argv[1] !== undefined) {
  try {
    params = JSON.parse(argv[1]);
  } catch {
    console.error(`rpc: params are not valid JSON: ${argv[1]}`);
    process.exit(1);
  }
}

async function callOnce() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (payload.error !== undefined) {
      throw new Error(`${payload.error.code}: ${payload.error.message}`);
    }
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

const deadline = Date.now() + waitSeconds * 1000;
let lastError;

for (;;) {
  try {
    const result = await callOnce();
    process.stdout.write(
      raw && typeof result === "string" ? `${result}\n` : `${JSON.stringify(result)}\n`,
    );
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (Date.now() >= deadline) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

console.error(`rpc: ${method} failed against ${url}: ${lastError.message}`);
process.exit(1);

#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Smoke test for a running stack.
//
// The test makes these checks:
//   1. The chain answers JSON-RPC and it reports the expected chain id.
//   2. The chain reports a block number.
//   3. Bytecode exists at the AuctionHouse address.
//   4. Bytecode exists at the DemoNFT address.
//   5. The web service serves the application shell.
//   6. The shell loads /config.js, and /config.js declares the same address.
//      This check runs only when the web service serves that file, so the
//      development server does not fail the test.
//
// Run it after `make up`:
//
//     make smoke      (or)      npm run smoke
//
// Exit code 0: every check passed.
// Exit code 1: at least one check failed.
//
// This file is written in Node and not in shell, because Windows PowerShell
// has no `sh`. The CI workflow runs this same file, so a local failure and a
// CI failure have the same cause.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from "node:fs";

// --- Configuration ---------------------------------------------------------

// Read .env, but never replace a value that the environment already holds.
// CI passes its values through the environment.
function loadDotEnv(file = ".env") {
  if (!existsSync(file)) {
    return;
  }
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = trimmed.slice(index + 1).trim();
    }
  }
}

loadDotEnv();

const rpcPort = process.env.RPC_PORT ?? "8545";
const webPort = process.env.WEB_PORT ?? "5173";
const rpcUrl = process.env.RPC_URL ?? `http://127.0.0.1:${rpcPort}`;
const webUrl = (process.env.WEB_URL ?? `http://127.0.0.1:${webPort}`).replace(/\/+$/, "");
const expectedChainId = Number(process.env.CHAIN_ID ?? 31337);
const auctionHouse = process.env.AUCTION_HOUSE_ADDRESS ?? "";
const demoNft = process.env.DEMO_NFT_ADDRESS ?? "";
const waitSeconds = Number(process.env.WAIT_SECONDS ?? 90);

// --- Reporting -------------------------------------------------------------

let passed = 0;
let failed = 0;

const pass = (message) => {
  passed += 1;
  console.log(`  PASS  ${message}`);
};

const fail = (message) => {
  failed += 1;
  console.error(`  FAIL  ${message}`);
};

const skip = (message) => {
  console.log(`  SKIP  ${message}`);
};

// --- Helpers ---------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(work, seconds) {
  const deadline = Date.now() + seconds * 1000;
  let lastError;
  for (;;) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline) {
        throw lastError;
      }
      await sleep(2000);
    }
  }
}

async function rpc(method, params = []) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(rpcUrl, {
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

async function getText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal });
    const body = await response.text();
    return { status: response.status, ok: response.ok, body };
  } finally {
    clearTimeout(timer);
  }
}

// --- Checks ----------------------------------------------------------------

console.log(`smoke: chain ${rpcUrl}, web ${webUrl}`);
console.log("");

console.log("1. Chain");
let chainIsUp = false;
try {
  const hex = await withRetry(() => rpc("eth_chainId"), waitSeconds);
  const actual = Number.parseInt(hex, 16);
  chainIsUp = true;
  if (actual === expectedChainId) {
    pass(`the chain answers and reports chain id ${actual}`);
  } else {
    fail(`chain id is ${actual}, the configuration expects ${expectedChainId}`);
  }
} catch (error) {
  fail(`the chain did not answer within ${waitSeconds} seconds: ${error.message}`);
}

if (chainIsUp) {
  try {
    const block = await rpc("eth_blockNumber");
    pass(`the chain reports block ${Number.parseInt(block, 16)}`);
  } catch (error) {
    fail(`the chain did not report a block number: ${error.message}`);
  }
} else {
  fail("skipped the block number check, because the chain is down");
}

console.log("");
console.log("2. Contracts");

async function checkCode(name, address) {
  if (address === "") {
    fail(`${name}: no address is configured`);
    return;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    fail(`${name}: ${address} is not a valid address`);
    return;
  }
  if (!chainIsUp) {
    fail(`${name}: skipped, because the chain is down`);
    return;
  }
  try {
    // Retry, because the deployer may still be running.
    const code = await withRetry(async () => {
      const result = await rpc("eth_getCode", [address, "latest"]);
      if (result === "0x" || result === "0x0" || !result) {
        throw new Error("no bytecode");
      }
      return result;
    }, Math.min(waitSeconds, 60));
    pass(`${name}: ${(code.length - 2) / 2} bytes of bytecode at ${address}`);
  } catch {
    fail(`${name}: no bytecode at ${address}. The deployment did not run or it failed.`);
  }
}

await checkCode("AuctionHouse", auctionHouse);
await checkCode("DemoNFT", demoNft);

console.log("");
console.log("3. Web");

let shell = "";
try {
  const result = await withRetry(async () => {
    const response = await getText(`${webUrl}/`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    if (!/<html|<div|<script/i.test(response.body)) {
      throw new Error("the body does not look like HTML");
    }
    return response;
  }, waitSeconds);
  shell = result.body;
  pass(`the web service served the shell (${shell.length} bytes)`);
} catch (error) {
  fail(`the web service did not serve the shell at ${webUrl}/ : ${error.message}`);
}

if (shell !== "") {
  try {
    const config = await getText(`${webUrl}/config.js`);
    if (!config.ok) {
      skip("/config.js is absent. This is expected for the development server.");
    } else if (!config.body.includes("__AUCTION_CONFIG__")) {
      fail("/config.js does not declare window.__AUCTION_CONFIG__");
    } else if (auctionHouse !== "" && !config.body.includes(auctionHouse)) {
      fail(`/config.js does not carry the address ${auctionHouse}`);
    } else {
      pass("/config.js declares window.__AUCTION_CONFIG__ with the deployed address");
    }
  } catch (error) {
    skip(`/config.js could not be read: ${error.message}`);
  }
}

// --- Result ----------------------------------------------------------------

console.log("");
console.log(`smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("smoke: FAILED");
  console.error("smoke: inspect the stack with 'make logs' or 'npm run logs'.");
  process.exit(1);
}
console.log("smoke: OK");
process.exit(0);

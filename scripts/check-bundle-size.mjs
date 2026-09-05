#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Bundle size ceiling.
// Ceilings, measured 2026-09-06 on the two-format build: JavaScript is
// about 1,325 KB gzip, of which the wallet stack (RainbowKit, WalletConnect,
// the MetaMask SDK) is roughly 1,000 KB and is loaded eagerly. The JS ceiling
// is set to 1,500 KB to catch regressions from here, not to describe a goal.
// Lazy-mounting the wallet provider behind the Connect button is the planned
// reduction; when it lands, lower these numbers again.
//
// A large bundle makes the first load slow. This gate fails the build when
// the bundle grows past a limit. The limit measures the GZIP size, because
// nginx serves the files with gzip.
//
// Usage:
//   node scripts/check-bundle-size.mjs [distDir] [--max-js KB] [--max-css KB] [--max-total KB]
//
// Defaults:
//   distDir      web/dist
//   --max-js     1500   (KB, gzip, all .js files together)
//   --max-css    100   (KB, gzip, all .css files together)
//   --max-total  1700  (KB, gzip, every asset together)
//
// Exit code 0: every total is at or below its ceiling.
// Exit code 1: at least one total is above its ceiling, or dist is missing.
//
// Raise a ceiling only with a reason in the pull request. A silent raise
// removes the value of the gate.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { gzipSync } from "node:zlib";

const argv = process.argv.slice(2);

function takeOption(name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const value = argv[index + 1];
  argv.splice(index, 2);
  return value ?? fallback;
}

const maxJs = Number(takeOption("--max-js", process.env.BUNDLE_MAX_JS ?? "1500"));
const maxCss = Number(takeOption("--max-css", process.env.BUNDLE_MAX_CSS ?? "100"));
const maxTotal = Number(takeOption("--max-total", process.env.BUNDLE_MAX_TOTAL ?? "1700"));
const distDir = argv[0] ?? "web/dist";

if (!existsSync(distDir)) {
  console.error(`bundle: ${distDir} does not exist.`);
  console.error('bundle: run "npm run build --workspace web" first.');
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    // Source maps are fetched only by developer tools, never by a visitor's
    // browser, so they are not part of the payload this ceiling protects.
    if (entry.endsWith(".map")) continue;
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

const files = walk(distDir);
if (files.length === 0) {
  console.error(`bundle: ${distDir} is empty.`);
  process.exit(1);
}

const kb = (bytes) => bytes / 1024;

let jsBytes = 0;
let cssBytes = 0;
let totalBytes = 0;
const rows = [];

for (const file of files) {
  // config.js is generated at run time and it is not part of the bundle.
  if (relative(distDir, file).replace(/\\/g, "/") === "config.js") {
    continue;
  }
  const gzipped = gzipSync(readFileSync(file), { level: 9 }).length;
  totalBytes += gzipped;
  const extension = extname(file).toLowerCase();
  if (extension === ".js" || extension === ".mjs") {
    jsBytes += gzipped;
  } else if (extension === ".css") {
    cssBytes += gzipped;
  }
  rows.push({ file: relative(distDir, file).replace(/\\/g, "/"), gzipped });
}

rows.sort((a, b) => b.gzipped - a.gzipped);

console.log(`bundle: ${distDir}, ${rows.length} file(s), sizes are gzip`);
console.log("");
console.log("  Largest files:");
for (const row of rows.slice(0, 12)) {
  console.log(`    ${kb(row.gzipped).toFixed(1).padStart(8)} KB  ${row.file}`);
}
console.log("");

const checks = [
  { name: "JavaScript", actual: kb(jsBytes), ceiling: maxJs },
  { name: "CSS", actual: kb(cssBytes), ceiling: maxCss },
  { name: "Every asset", actual: kb(totalBytes), ceiling: maxTotal },
];

let failed = 0;
for (const check of checks) {
  const over = check.actual > check.ceiling;
  const verdict = over ? "OVER" : "ok";
  if (over) {
    failed += 1;
  }
  console.log(
    `  ${check.name.padEnd(12)} ${check.actual.toFixed(1).padStart(8)} KB / ${String(check.ceiling).padStart(6)} KB  ${verdict}`,
  );
}
console.log("");

if (failed > 0) {
  console.error(`bundle: FAILED. ${failed} ceiling(s) exceeded.`);
  console.error("bundle: reduce the bundle, or raise the ceiling and give the reason.");
  process.exit(1);
}

console.log("bundle: OK. Every total is at or below its ceiling.");
process.exit(0);

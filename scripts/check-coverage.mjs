#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Coverage floor gate.
//
// `npx hardhat test --coverage` writes `<root>/coverage/lcov.info`. This
// script reads that file and it compares the line coverage with a floor.
//
// Usage:
//   node scripts/check-coverage.mjs [lcovPath] [--min <percent>] [--metric lines|functions|branches]
//
// Defaults:
//   lcovPath  contracts/coverage/lcov.info
//   --min     80
//   --metric  lines
//
// Exit code 0: the coverage is at or above the floor.
// Exit code 1: the coverage is below the floor, or the report is missing.
//
// The lcov record fields that this script reads:
//   LF  lines found        LH  lines hit
//   FNF functions found    FNH functions hit
//   BRF branches found     BRH branches hit
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from "node:fs";

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

const minimum = Number(takeOption("--min", process.env.COVERAGE_MIN ?? "80"));
const metric = takeOption("--metric", "lines");
const lcovPath = argv[0] ?? "contracts/coverage/lcov.info";

const fields = {
  lines: { found: "LF", hit: "LH" },
  functions: { found: "FNF", hit: "FNH" },
  branches: { found: "BRF", hit: "BRH" },
};

if (fields[metric] === undefined) {
  console.error(`coverage: unknown metric "${metric}". Use lines, functions or branches.`);
  process.exit(1);
}

if (!existsSync(lcovPath)) {
  console.error(`coverage: ${lcovPath} does not exist.`);
  console.error('coverage: run "npx hardhat test --coverage" in contracts/ first.');
  process.exit(1);
}

const report = readFileSync(lcovPath, "utf8");

let found = 0;
let hit = 0;
let files = 0;
const perFile = [];
let currentFile = "";
let skipping = false;
let fileFound = 0;
let fileHit = 0;

for (const line of report.split(/\r?\n/)) {
  const [key, rawValue] = line.split(":");
  if (key === "SF") {
    currentFile = rawValue ?? "";
    fileFound = 0;
    fileHit = 0;
    // Vendored contracts (src/vendor) are upstream code with upstream tests.
    // Counting them would let a third-party file move this repository's own
    // floor, in either direction. Skip the record until it ends.
    if (
      currentFile.split("\\").join("/").includes("/src/vendor/") ||
      currentFile.split("\\").join("/").startsWith("src/vendor/")
    ) {
      currentFile = "";
      skipping = true;
      continue;
    }
    skipping = false;
    files += 1;
  } else if (skipping) {
    if (line.trim() === "end_of_record") skipping = false;
    continue;
  } else if (key === fields[metric].found) {
    fileFound = Number(rawValue ?? 0);
    found += fileFound;
  } else if (key === fields[metric].hit) {
    fileHit = Number(rawValue ?? 0);
    hit += fileHit;
  } else if (line.trim() === "end_of_record" && currentFile !== "") {
    perFile.push({ file: currentFile, found: fileFound, hit: fileHit });
    currentFile = "";
  }
}

if (files === 0 || found === 0) {
  console.error(`coverage: ${lcovPath} contains no ${metric} data.`);
  console.error("coverage: a report with no data is treated as a failure.");
  process.exit(1);
}

const percent = (hit / found) * 100;

console.log(`coverage: ${metric} ${hit}/${found} = ${percent.toFixed(2)}% over ${files} file(s)`);
console.log(`coverage: floor is ${minimum.toFixed(2)}%`);
console.log("");

// Show the weakest files, so a failure names the file to fix.
const weakest = perFile
  .filter((entry) => entry.found > 0)
  .map((entry) => ({ ...entry, percent: (entry.hit / entry.found) * 100 }))
  .sort((a, b) => a.percent - b.percent)
  .slice(0, 10);

console.log("  Lowest coverage per file:");
for (const entry of weakest) {
  const flag = entry.percent < minimum ? "  <-- below the floor" : "";
  console.log(
    `    ${entry.percent.toFixed(2).padStart(6)}%  ${entry.hit}/${entry.found}  ${entry.file}${flag}`,
  );
}
console.log("");

if (percent + 1e-9 < minimum) {
  console.error(
    `coverage: FAILED. ${metric} coverage is ${percent.toFixed(2)}%, the floor is ${minimum}%.`,
  );
  process.exit(1);
}

console.log(`coverage: OK. ${percent.toFixed(2)}% is at or above the ${minimum}% floor.`);
process.exit(0);

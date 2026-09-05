#!/usr/bin/env node
// ---------------------------------------------------------------------------
// First-run set-up.
//
// The script does three things:
//   1. It checks the Node version.
//   2. It creates .env from .env.example when .env is absent.
//   3. It reports whether Docker is available.
//
// The script never overwrites an existing .env.
//
// This file is written in Node and not in shell, because Windows PowerShell
// has no `cp` and no `sh`.
// ---------------------------------------------------------------------------

import { existsSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const REQUIRED_MAJOR = 22;

let problems = 0;

function ok(message) {
  console.log(`  OK    ${message}`);
}

function warn(message) {
  console.log(`  WARN  ${message}`);
}

function bad(message) {
  problems += 1;
  console.error(`  ERROR ${message}`);
}

console.log("setup: preparing the workspace");
console.log("");

// --- 1. Node version -------------------------------------------------------
const major = Number(process.versions.node.split(".")[0]);
if (major >= REQUIRED_MAJOR) {
  ok(`Node ${process.versions.node}`);
} else {
  bad(`Node ${process.versions.node} is too old. Hardhat 3 needs Node ${REQUIRED_MAJOR} or later.`);
}

// --- 2. Environment file ---------------------------------------------------
if (existsSync(".env")) {
  ok(".env already exists. The file was not changed.");
} else if (existsSync(".env.example")) {
  copyFileSync(".env.example", ".env");
  ok("created .env from .env.example");
} else {
  bad(".env.example is missing. The repository is incomplete.");
}

// --- 3. Docker -------------------------------------------------------------
function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: process.platform === "win32",
  }).trim();
}

try {
  ok(`Docker client ${run("docker", ["version", "--format", "{{.Client.Version}}"])}`);
} catch {
  bad("the `docker` command was not found. Install Docker Desktop.");
}

try {
  run("docker", ["compose", "version"]);
  ok("Docker Compose v2 is available");
} catch {
  bad("`docker compose` was not found. This project needs Compose v2.");
}

try {
  run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  ok("the Docker daemon is running");
} catch {
  warn("the Docker daemon is not running. Start Docker Desktop before `npm run up`.");
}

// --- Result ----------------------------------------------------------------
console.log("");
if (problems > 0) {
  console.error(`setup: ${problems} problem(s) found. Fix them and run setup again.`);
  process.exit(1);
}
console.log("setup: done.");
console.log("setup: run `npm run up` (or `make up`) to start the stack.");
process.exit(0);

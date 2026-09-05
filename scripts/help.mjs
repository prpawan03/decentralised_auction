#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Self-documenting list of the npm scripts.
//
// The list mirrors the Makefile. Windows PowerShell has no `make`, so this
// script gives the same help text.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";

const groups = [
  {
    title: "Set-up",
    items: [["setup", "Create .env and check that Docker is available"]],
  },
  {
    title: "Run the stack",
    items: [
      ["up", "Build and start the whole stack in the background"],
      ["dev", "Start the stack and copy source changes into the containers"],
      ["prod", "Build and start the production shape: nginx serves a static bundle"],
      ["logs", "Follow the logs of every service"],
      ["ps", "List the running services"],
      ["down", "Stop the stack and remove the containers"],
      ["clean", "Remove containers, volumes and images"],
      ["reset-chain", "Discard the chain state and deploy the contracts again"],
    ],
  },
  {
    title: "Contracts",
    items: [
      ["deploy", "Deploy the contracts to the running chain"],
      ["seed", "Create the demo auctions on the running chain"],
    ],
  },
  {
    title: "Quality",
    items: [
      ["test", "Run the contract tests and the web tests"],
      ["lint", "Check the code style without changing a file"],
      ["typecheck", "Check the types without emitting a file"],
      ["fmt", "Format the code in place"],
      ["fmt:check", "Check the formatting without changing a file"],
      ["smoke", "Check that a running stack answers correctly"],
      ["compose:config", "Check that both Compose file sets parse"],
    ],
  },
];

let version = "";
try {
  version = JSON.parse(readFileSync("package.json", "utf8")).version ?? "";
} catch {
  version = "";
}

console.log("");
console.log(`NFT auction demonstration ${version}`);
console.log("");
console.log("Usage: npm run <script>");
console.log("");

for (const group of groups) {
  console.log(`  ${group.title}`);
  for (const [name, description] of group.items) {
    console.log(`    ${name.padEnd(16)} ${description}`);
  }
  console.log("");
}

console.log("First run: npm run setup, then npm run up.");
console.log("Every script has a Makefile target with the same name.");
console.log("");

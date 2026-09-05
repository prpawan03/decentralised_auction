#!/usr/bin/env node
// ---------------------------------------------------------------------------
// GitHub Actions pin gate.
//
// Every third-party action referenced by a workflow MUST be pinned to a full
// 40-character commit SHA, with the human-readable version in a trailing
// comment:
//
//     uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
//
// WHY THIS GATE EXISTS
// A tag is a moving pointer. The owner of an action can repoint `v4` at any
// commit, and a workflow that says `@v4` then runs new code inside a job that
// holds this repository's secrets. Between 2026-03-19 and 2026-03-23 an
// attacker force-pushed a credential stealer over 76 of the 77 version tags
// of `aquasecurity/trivy-action` and over every tag of
// `aquasecurity/setup-trivy` (CVE-2026-33634 / GHSA-69fq-xp46-6x23). A commit
// SHA cannot be repointed, so a pinned workflow survives a tag force-push.
//
// The gate also enforces a MINIMUM VERSION for actions with a publicly known
// compromised range, because a pin on its own would happily freeze a workflow
// onto a malicious commit for ever.
//
// Usage:
//   node scripts/check-action-pins.mjs [workflowDir]     # default .github/workflows
//
// Exit 0: every reference is pinned, labelled and above its floor.
// Exit 1: at least one is not.
//
// A local action (`uses: ./.github/actions/x`) needs no pin: it is this
// repository's own reviewed code.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const workflowDir = process.argv[2] ?? ".github/workflows";

// Lowest version considered clean, for actions with a known compromised range.
// Keep the advisory id in the comment so the next reader can re-check it.
const VERSION_FLOORS = {
  // CVE-2026-33634: 76 of 77 action tags rewritten; v0.35.0 is the first clean release.
  "aquasecurity/trivy-action": "0.35.0",
  // Same advisory: every setup-trivy tag was rewritten.
  "aquasecurity/setup-trivy": "0.2.6",
};

const SHA_RE = /^[0-9a-f]{40}$/;
const USES_RE = /^\s*(?:-\s*)?uses:\s*["']?([^"'\s#]+)["']?\s*(?:#\s*(.*?))?\s*$/;

if (!existsSync(workflowDir)) {
  console.error(`action-pins: ${workflowDir} does not exist.`);
  process.exit(1);
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

function versionFromComment(comment) {
  const match = /v?(\d+(?:\.\d+)*)/.exec(comment ?? "");
  return match ? match[1] : null;
}

const files = readdirSync(workflowDir)
  .filter((n) => n.endsWith(".yml") || n.endsWith(".yaml"))
  .sort();

if (files.length === 0) {
  console.error(`action-pins: no workflow files in ${workflowDir}.`);
  process.exit(1);
}

const problems = [];
let checked = 0;

for (const file of files) {
  const path = join(workflowDir, file);
  readFileSync(path, "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      // A commented-out line is documentation. The policy block in ci.yml
      // contains the literal text `uses: someone/action@v4` as an example and
      // MUST NOT fail this gate.
      if (/^\s*#/.test(line)) return;

      const match = USES_RE.exec(line);
      if (!match) return;

      const [, reference, comment] = match;
      const where = `${path}:${index + 1}`;

      // This repository's own composite actions and reusable workflows.
      if (reference.startsWith("./")) return;

      checked += 1;

      if (reference.startsWith("docker://")) {
        if (!reference.includes("@sha256:")) {
          problems.push(`${where}: docker action is not pinned to a digest -> ${reference}`);
        }
        return;
      }

      const at = reference.lastIndexOf("@");
      if (at === -1) {
        problems.push(`${where}: no version reference at all -> ${reference}`);
        return;
      }

      const ref = reference.slice(at + 1);
      const ownerRepo = reference.slice(0, at).split("/").slice(0, 2).join("/");

      if (!SHA_RE.test(ref)) {
        problems.push(
          `${where}: pinned to the moving tag "${ref}" instead of a 40-character commit SHA -> ${reference}`,
        );
        return;
      }

      if (!comment) {
        problems.push(
          `${where}: pinned to a SHA but has no trailing "# <version>" comment. ` +
            `An unlabelled SHA cannot be reviewed or updated -> ${reference}`,
        );
        return;
      }

      const floor = VERSION_FLOORS[ownerRepo];
      if (floor) {
        const version = versionFromComment(comment);
        if (version === null) {
          problems.push(
            `${where}: ${ownerRepo} has a known compromised tag range, so its comment MUST name a version. Found "# ${comment}".`,
          );
        } else if (compareVersions(version, floor) < 0) {
          problems.push(
            `${where}: ${ownerRepo} ${version} is at or below the known compromised range. Use ${floor} or later.`,
          );
        }
      }
    });
}

if (problems.length > 0) {
  console.error("action-pins: FAILED\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    `\naction-pins: ${problems.length} problem(s) in ${files.length} workflow file(s).`,
  );
  console.error("\nResolve a tag to its commit SHA with:");
  console.error("  git ls-remote https://github.com/<owner>/<repo> 'refs/tags/<tag>^{}'");
  console.error("  # If that prints nothing the tag is lightweight; drop the ^{}.");
  console.error("Then write:  uses: <owner>/<repo>@<sha>  # <tag>");
  process.exit(1);
}

console.log(
  `action-pins: OK. ${checked} action reference(s) in ${files.length} workflow file(s) are pinned to a commit SHA and labelled.`,
);

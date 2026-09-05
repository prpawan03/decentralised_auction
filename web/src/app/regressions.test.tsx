import { readFileSync, globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Executable guards against the specific defects this rewrite exists to fix.
 *
 * These are source-level assertions rather than behavioural ones on purpose:
 * each defect is a STRUCTURAL mistake that the replaced app's behavioural
 * tests happened not to catch. Asserting on the shape of the code is what
 * stops the shape from coming back.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");

function sourceFiles(): string[] {
  return globSync("**/*.{ts,tsx}", { cwd: SRC })
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
    .map((f) => join(SRC, f));
}

/**
 * Source with comments stripped.
 *
 * These guards assert on CODE, and the codebase's own explanations quote the
 * very patterns being banned. Matching raw text would make each guard fail on
 * the comment that documents it, so comments come out first.
 */
function read(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** A path relative to src/, forward-slashed, so assertions read the same on any OS. */
function rel(file: string): string {
  return `src/${file
    .slice(SRC.length + 1)
    .split(sep)
    .join("/")}`;
}

describe("exactly one Toaster", () => {
  it("is mounted in exactly one file, and that file is the root layout", () => {
    // The replaced app mounted one inside every auction card. react-hot-toast
    // renders each toast into EVERY mounted Toaster, so a single "Bid placed"
    // appeared 13 times on a 13-card page and was announced 13 times.
    const mounting = sourceFiles().filter((f) => /<Toaster\b/.test(read(f)));
    expect(mounting.map(rel)).toEqual(["src/app/RootLayout.tsx"]);
  });

  it("mounts it only once within that file", () => {
    const layout = read(join(SRC, "app", "RootLayout.tsx"));
    expect(layout.match(/<Toaster\b/g)).toHaveLength(1);
  });
});

describe("success is never claimed before a receipt confirms", () => {
  it("confines the success toast to the receipt watcher", () => {
    // The old code fired a success toast right after .send() resolved.
    // .send() resolving means the WALLET accepted the request, not that the
    // transaction succeeded, so a reverted bid produced a green success toast.
    const callers = sourceFiles().filter((f) => /toast\.success\(/.test(read(f)));
    expect(callers.map(rel)).toEqual(["src/hooks/useTxTracker.tsx"]);
  });

  it("checks the receipt status explicitly, because reverted txs get receipts too", () => {
    const tracker = read(join(SRC, "hooks", "useTxTracker.tsx"));
    expect(tracker).toMatch(/receipt\.data\.status === "success"/);
  });

  it("moves a freshly submitted transaction to pending, never to success", () => {
    const tracker = read(join(SRC, "hooks", "useTxTracker.tsx"));
    expect(tracker).toMatch(/case "hash":[\s\S]{0,200}?status: "pending"/);
  });
});

describe("no browser prompt, alert or confirm", () => {
  it("collects a bid in a real modal instead", () => {
    // The browser's built-in dialogs cannot be styled, validated, tested or
    // made accessible, and several browsers suppress them outright, which
    // silently drops the bid.
    const banned = /\bwindow\.(prompt|alert|confirm)\s*\(|(?<![.\w])(prompt|alert|confirm)\s*\(/;
    const offenders = sourceFiles().filter((f) => banned.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("no useState seeded from a prop", () => {
  it("derives during render instead of mirroring props into state", () => {
    // The old AuctionItem seeded price state from the item prop. When a new
    // bid arrived the prop changed and the state did not, so the card showed a
    // stale price for as long as it stayed mounted.
    const pattern = /useState\(\s*(?:props\.|item\.|auction\.)/;
    const offenders = sourceFiles().filter((f) => pattern.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("one shared ticker, not one interval per card", () => {
  it("creates a timer in only the two places that legitimately need one", () => {
    const timers = sourceFiles().filter((f) =>
      /\bsetInterval\s*\(|\bsetTimeout\s*\(/.test(read(f)),
    );
    // useTicker owns the page clock. AddressChip's timeout only clears a
    // "copied" label after four seconds: a one-shot, not a recurring clock.
    expect(timers.map(rel).sort()).toEqual([
      "src/components/ui/AddressChip.tsx",
      "src/hooks/useTicker.tsx",
    ]);
  });

  it("uses no setInterval at all, so the clock cannot drift", () => {
    const timers = sourceFiles().filter((f) => /\bsetInterval\s*\(/.test(read(f)));
    expect(timers.map(rel)).toEqual([]);
  });

  it("schedules to the next whole second", () => {
    const ticker = read(join(SRC, "hooks", "useTicker.tsx"));
    expect(ticker).toMatch(/1000 - \(Date\.now\(\) % 1000\)/);
  });
});

describe("every write simulates before it signs", () => {
  it("pairs useWriteContract with useSimulateContract in the same module", () => {
    const writers = sourceFiles().filter((f) => /useWriteContract/.test(read(f)));
    expect(writers.length).toBeGreaterThan(0);
    for (const file of writers) {
      expect(
        /useSimulateContract/.test(read(file)),
        `${rel(file)} calls useWriteContract with no useSimulateContract in the same module`,
      ).toBe(true);
    }
  });
});

describe("the auction list is one multicall, not N sequential reads", () => {
  it("reads the board through useReadContracts and a paged getAuctions", () => {
    const hooks = read(join(SRC, "hooks", "useAuctions.ts"));
    expect(hooks).toMatch(/useReadContracts/);
    expect(hooks).toMatch(/functionName: "getAuctions"/);
    // No awaited loop anywhere: that is the N-round-trip shape being banned.
    expect(hooks).not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*await/s);
  });
});

describe("the contract address is never baked in at build time", () => {
  it("resolves the address through runtime config, not import.meta.env alone", () => {
    const contracts = read(join(SRC, "config", "contracts.ts"));
    expect(contracts).toMatch(/config\.auctionHouseAddress/);
    expect(contracts).not.toMatch(/import\.meta\.env/);

    const runtime = read(join(SRC, "config", "runtime.ts"));
    // Layer 1 must be consulted before layer 2.
    expect(runtime.indexOf("__AUCTION_CONFIG__")).toBeLessThan(runtime.indexOf("import.meta.env"));
  });
});

describe("Tailwind v4 is CSS-first", () => {
  it("ships no tailwind.config.* and no postcss.config.*", () => {
    const web = join(SRC, "..");
    expect(globSync("tailwind.config.*", { cwd: web })).toEqual([]);
    expect(globSync("postcss.config.*", { cwd: web })).toEqual([]);
  });

  it("declares the theme tokens in CSS", () => {
    const css = readFileSync(join(SRC, "styles", "theme.css"), "utf8");
    expect(css).toMatch(/@theme\s*\{/);
    expect(css).toMatch(/--color-action:/);
  });
});

describe("wagmi stays on 2.x for RainbowKit", () => {
  it("pins an exact 2.x version", () => {
    const pkg = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    // RainbowKit 2.2.11 declares peerDependencies.wagmi ^2.9.0 and has no v3
    // support. wagmi 3 does not fail at install time; it fails at runtime, with
    // an empty wallet modal, which is far harder to diagnose.
    expect(pkg.dependencies["wagmi"]).toMatch(/^2\./);
    expect(pkg.dependencies["viem"]).toMatch(/^2\./);
    expect(pkg.dependencies["@rainbow-me/rainbowkit"]).toBe("2.2.11");
  });
});

describe("prefers-reduced-motion is honoured", () => {
  it("neutralises animation, transition and smooth scrolling", () => {
    const css = readFileSync(join(SRC, "styles", "index.css"), "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/animation-duration: 0\.001ms !important/);
    expect(css).toMatch(/transition-duration: 0\.001ms !important/);
    expect(css).toMatch(/scroll-behavior: auto !important/);
  });

  it("clears the sticky header on anchor navigation", () => {
    const css = readFileSync(join(SRC, "styles", "index.css"), "utf8");
    expect(css).toMatch(/scroll-padding-top/);
    expect(css).toMatch(/scroll-margin-top/);
  });

  it("draws a visible focus ring on every focusable element", () => {
    const css = readFileSync(join(SRC, "styles", "index.css"), "utf8");
    expect(css).toMatch(/:focus-visible \{[\s\S]*?outline: 2px solid/);
  });
});

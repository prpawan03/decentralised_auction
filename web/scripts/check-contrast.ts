/* ---------------------------------------------------------------------------
 * WCAG 2.2 contrast gate.
 *
 * This does NOT assert conformance. It parses the real token values out of
 * src/styles/theme.css, computes the relative-luminance ratio for every pair
 * the UI actually paints, compares each against its Success Criterion
 * threshold, prints the table, and exits non-zero if anything falls short.
 *
 * Thresholds (WCAG 2.2 Level AA):
 *   1.4.3  Contrast (Minimum) ....... 4.5:1 body text
 *                                     3.0:1 large text (>=24px, or >=18.66px bold)
 *   1.4.11 Non-text Contrast ........ 3.0:1 UI component boundaries, focus rings
 *
 * Run: npm run check:contrast
 * ------------------------------------------------------------------------- */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME_FILE = join(HERE, "..", "src", "styles", "theme.css");

type Rgb = { r: number; g: number; b: number };
type Tokens = Record<string, string>;

/* -- colour maths ---------------------------------------------------------- */

function parseHex(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Not a 6-digit hex colour: "${hex}"`);
  }
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/** WCAG 2.x relative luminance. https://www.w3.org/TR/WCAG22/#dfn-relative-luminance */
function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio. https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio */
function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/* -- token extraction ------------------------------------------------------ */

/**
 * Pull `--color-*: #hex;` declarations out of a slice of CSS. Deliberately
 * simple: the theme file is ours and is required to stay this shape.
 */
function extractTokens(css: string): Tokens {
  const tokens: Tokens = {};
  const re = /--(color-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) tokens[m[1]!] = m[2]!;
  return tokens;
}

function sliceBetween(css: string, startMarker: string, endMarker: string): string {
  const a = css.indexOf(startMarker);
  const b = css.indexOf(endMarker);
  if (a === -1 || b === -1 || b < a) {
    throw new Error(
      `theme.css is missing the ${startMarker} / ${endMarker} markers. ` +
        `check-contrast.ts relies on them to find the light-theme overrides.`,
    );
  }
  return css.slice(a, b);
}

const css = readFileSync(THEME_FILE, "utf8");
const lightSlice = sliceBetween(css, "LIGHT-THEME-TOKENS-START", "LIGHT-THEME-TOKENS-END");
/* Dark lives in @theme, i.e. everything that is NOT the light slice. */
const darkTokens = extractTokens(css.replace(lightSlice, ""));
const lightTokens: Tokens = { ...darkTokens, ...extractTokens(lightSlice) };

/* -- the pairs the UI actually paints -------------------------------------- */

type Level = "text" | "large" | "ui";

interface Pair {
  fg: string;
  bg: string;
  level: Level;
  where: string;
}

const THRESHOLD: Record<Level, number> = { text: 4.5, large: 3, ui: 3 };
const SC: Record<Level, string> = {
  text: "1.4.3",
  large: "1.4.3 large",
  ui: "1.4.11",
};

const SURFACES = ["color-ground", "color-surface", "color-raised"] as const;

const pairs: Pair[] = [];

/* Body / secondary / tertiary text must work on every surface it can land on. */
for (const bg of SURFACES) {
  pairs.push({ fg: "color-ink", bg, level: "text", where: "primary text" });
  pairs.push({ fg: "color-ink-2", bg, level: "text", where: "secondary text" });
  pairs.push({ fg: "color-ink-3", bg, level: "text", where: "tertiary text / column meta" });
  pairs.push({ fg: "color-action", bg, level: "text", where: "link / ghost button label" });
  pairs.push({ fg: "color-action-hover", bg, level: "text", where: "link hover" });
  pairs.push({ fg: "color-live", bg, level: "text", where: "live / winning label" });
  pairs.push({ fg: "color-warn", bg, level: "text", where: "ending-soon / anti-snipe label" });
  pairs.push({ fg: "color-danger", bg, level: "text", where: "outbid / ended / error label" });
  /* Control borders and focus rings are UI components: SC 1.4.11 applies. */
  pairs.push({ fg: "color-line-strong", bg, level: "ui", where: "input & button border" });
  pairs.push({ fg: "color-action", bg, level: "ui", where: "focus-visible ring" });
}

/* Solid fills carry their own foreground token. */
pairs.push({ fg: "color-on-action", bg: "color-action", level: "text", where: "primary button label" });
pairs.push({ fg: "color-on-live", bg: "color-live", level: "text", where: "LIVE pill label" });
pairs.push({ fg: "color-on-warn", bg: "color-warn", level: "text", where: "ENDING pill label" });
pairs.push({ fg: "color-on-danger", bg: "color-danger", level: "text", where: "OUTBID pill label" });

/* Surfaces stack on each other; the seam has to read without a drop shadow. */
pairs.push({ fg: "color-line-strong", bg: "color-surface", level: "ui", where: "panel edge" });

function evaluate(themeName: string, tokens: Tokens) {
  return pairs.map((p) => {
    const fgHex = tokens[p.fg];
    const bgHex = tokens[p.bg];
    if (!fgHex) throw new Error(`[${themeName}] unknown token --${p.fg}`);
    if (!bgHex) throw new Error(`[${themeName}] unknown token --${p.bg}`);
    const ratio = contrastRatio(parseHex(fgHex), parseHex(bgHex));
    const need = THRESHOLD[p.level];
    return {
      theme: themeName,
      where: p.where,
      fg: `--${p.fg}`,
      bg: `--${p.bg}`,
      ratio,
      need,
      sc: SC[p.level],
      /* truncate, not round: 4.499 must not be reported as a passing 4.50 */
      ok: Math.floor(ratio * 100) / 100 >= need,
    };
  });
}

const rows = [...evaluate("dark", darkTokens), ...evaluate("light", lightTokens)];
const failures = rows.filter((r) => !r.ok);

const pad = (s: string, n: number) => s.padEnd(n, " ");

console.log("");
console.log(`WCAG 2.2 AA contrast gate  ${THEME_FILE}`);
console.log("-".repeat(104));
console.log(
  pad("theme", 7) +
    pad("where", 33) +
    pad("foreground", 21) +
    pad("background", 17) +
    pad("result", 14) +
    pad("need", 7) +
    "SC",
);
console.log("-".repeat(104));
for (const r of rows) {
  console.log(
    pad(r.theme, 7) +
      pad(r.where, 33) +
      pad(r.fg, 21) +
      pad(r.bg, 17) +
      pad(`${r.ok ? "PASS" : "FAIL"} ${r.ratio.toFixed(2)}:1`, 14) +
      pad(r.need.toFixed(1), 7) +
      r.sc,
  );
}
console.log("-".repeat(104));
console.log(
  `${rows.length} pairs checked across 2 themes: ${rows.length - failures.length} pass, ${failures.length} fail`,
);

if (failures.length > 0) {
  console.error("");
  console.error("Contrast gate FAILED. Fix the token values in src/styles/theme.css:");
  for (const f of failures) {
    console.error(
      `  [${f.theme}] ${f.where}: ${f.fg} on ${f.bg} is ${f.ratio.toFixed(2)}:1, needs ${f.need}:1 (SC ${f.sc})`,
    );
  }
  process.exit(1);
}

console.log("Contrast gate PASSED.");
console.log("");

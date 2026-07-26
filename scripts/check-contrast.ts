/**
 * scripts/check-contrast.ts — WCAG 2.x contrast gate for the Chronicle ink scale.
 *
 * The ink tokens (`--color-ink*` in app/globals.css) are used for every text
 * surface in the app, including 9-12px micro-labels, so each one must clear the
 * WCAG 2.x SC 1.4.3 AA threshold for normal text (4.5:1) against BOTH page
 * backgrounds — `--color-base` (the app/landing background) and
 * `--color-surface` (cards, panels, the side panel).
 *
 * Tokens are read out of app/globals.css rather than hard-coded here, so this
 * script gates the real source of truth: change a hex there, re-run this, and a
 * regression fails loudly. Any future `--color-ink-*` token is picked up
 * automatically by the same prefix rule.
 *
 * Dependency-free on purpose — pure arithmetic over the CSS file, no packages.
 *
 * Usage:
 *   npx tsx scripts/check-contrast.ts
 *
 * Exit code:
 *   0 — every ink token clears 4.5:1 on both backgrounds
 *   1 — at least one pair fails, or the tokens could not be parsed
 *
 * Reference: WCAG 2.2 "relative luminance" + "contrast ratio" definitions
 * (https://www.w3.org/TR/WCAG22/#dfn-relative-luminance).
 */
import { readFileSync } from "node:fs";

const CSS_PATH = "app/globals.css";

/** WCAG 2.x SC 1.4.3 AA, normal text (< 18pt, or < 14pt bold). */
const AA_NORMAL = 4.5;

/** Token prefix that identifies a foreground text colour in the ink scale. */
const INK_PREFIX = "--color-ink";

/** Backgrounds every ink token has to survive. */
const BACKGROUND_TOKENS = ["--color-base", "--color-surface"] as const;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Pull `--token: #RRGGBB;` declarations out of the stylesheet. Only 6-digit hex
 * literals are collected — the shadcn `:root` vars are oklch()/var() and are
 * deliberately not in scope for this gate.
 */
function parseHexTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const re = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    // First declaration wins: @theme inline is the locked palette and precedes
    // the :root shadcn block, which re-declares some of the same hexes.
    if (!tokens.has(m[1])) tokens.set(m[1], m[2].toUpperCase());
  }
  return tokens;
}

function hexToRgb(hex: string): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/** sRGB 8-bit channel → linear-light value, per the WCAG 2.x transfer function. */
function linearize(channel8Bit: number): number {
  const c = channel8Bit / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance L. */
function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG 2.x contrast ratio (L_lighter + 0.05) / (L_darker + 0.05). */
function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function fmt(n: number, places: number): string {
  return n.toFixed(places);
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function padLeft(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

function main(): void {
  const css = readFileSync(CSS_PATH, "utf8");
  const tokens = parseHexTokens(css);

  const missing = BACKGROUND_TOKENS.filter((t) => !tokens.has(t));
  if (missing.length > 0) {
    console.error(
      `[check-contrast] ✗  ERROR: ${CSS_PATH} is missing background token(s): ${missing.join(", ")}`,
    );
    process.exit(1);
  }

  const inkTokens = [...tokens.keys()]
    .filter((name) => name.startsWith(INK_PREFIX))
    .sort();
  if (inkTokens.length === 0) {
    console.error(
      `[check-contrast] ✗  ERROR: no ${INK_PREFIX}* tokens found in ${CSS_PATH}`,
    );
    process.exit(1);
  }

  const backgrounds = BACKGROUND_TOKENS.map((name) => {
    const hex = tokens.get(name) as string;
    return { name, hex, rgb: hexToRgb(hex) };
  });

  console.log(
    `[check-contrast] source=${CSS_PATH}  threshold=${fmt(AA_NORMAL, 1)}:1 (WCAG 2.x AA, normal text)`,
  );
  for (const bg of backgrounds) {
    console.log(
      `[check-contrast] background ${pad(bg.name, 16)} ${bg.hex}  L=${fmt(relativeLuminance(bg.rgb), 4)}`,
    );
  }
  console.log("");

  const nameWidth = Math.max(...inkTokens.map((n) => n.length), 5);
  const header =
    `  ${pad("token", nameWidth)}  ${pad("hex", 7)}  ${padLeft("L", 6)}` +
    backgrounds.map((bg) => `  ${padLeft("on " + bg.hex, 12)}`).join("") +
    "   verdict";
  console.log(header);
  console.log(`  ${"-".repeat(header.length - 2)}`);

  const failures: string[] = [];
  for (const name of inkTokens) {
    const hex = tokens.get(name) as string;
    const rgb = hexToRgb(hex);
    const ratios = backgrounds.map((bg) => contrastRatio(rgb, bg.rgb));
    const worst = Math.min(...ratios);
    const ok = worst >= AA_NORMAL;
    if (!ok) {
      const which = backgrounds
        .map((bg, i) => ({ bg, ratio: ratios[i] }))
        .filter((x) => x.ratio < AA_NORMAL)
        .map((x) => `${x.bg.name} (${fmt(x.ratio, 2)}:1)`)
        .join(", ");
      failures.push(`${name} ${hex} fails AA on ${which}`);
    }
    console.log(
      `  ${pad(name, nameWidth)}  ${pad(hex, 7)}  ${padLeft(fmt(relativeLuminance(rgb), 4), 6)}` +
        ratios.map((r) => `  ${padLeft(fmt(r, 2) + ":1", 12)}`).join("") +
        `   ${ok ? "PASS" : "FAIL"}`,
    );
  }
  console.log("");

  if (failures.length > 0) {
    for (const f of failures) {
      console.error(`[check-contrast] ✗  ERROR: ${f}`);
    }
    console.error(
      `\n[check-contrast] ${failures.length} of ${inkTokens.length} ink token(s) below ${fmt(AA_NORMAL, 1)}:1 — fix the token, do not lower the bar`,
    );
    process.exit(1);
  }

  console.log(
    `[check-contrast] ✓  all ${inkTokens.length} ink token(s) clear ${fmt(AA_NORMAL, 1)}:1 on ${backgrounds.length} background(s)`,
  );
}

main();

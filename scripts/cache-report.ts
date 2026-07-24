/**
 * scripts/cache-report.ts — prompt-caching savings report.
 *
 * Scans persisted artifacts that carry token-usage fields and reports total
 * input/output tokens, the % of input tokens served from cache, and the net $
 * saved vs a no-caching counterfactual (including the 1.25x cache-write
 * premium). Pricing comes from lib/pricing.ts (a dated constants table).
 *
 * Sources scanned (usage is optional everywhere — old artifacts are skipped):
 *   - data/cases/<case>/metadata.json          (usageTotals, from extract-case)
 *   - data/cases/<case>/eval_runs/*.json        (usage, from eval-case3 dev runs)
 *   - held_out/case3/eval_runs/*.json           (usage, from eval-case3 / live eval)
 *
 * Peek-budget note: for held_out/case3 eval_runs this reads ONLY the top-level
 * `usage` aggregate — never the per-event `predicted` array or ground truth.
 *
 * Usage:
 *   npx tsx scripts/cache-report.ts
 *   npx tsx scripts/cache-report.ts --model claude-sonnet-4-6
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeUsage, sumUsage, type ExtractUsage } from "../lib/measure";
import { estimateCost, PRICING_AS_OF, DEFAULT_MODEL } from "../lib/pricing";

interface Found {
  source: string; // repo-relative path
  usage: ExtractUsage;
}

function hasUsageShape(u: unknown): boolean {
  if (!u || typeof u !== "object") return false;
  const o = u as Record<string, unknown>;
  return (
    "input_tokens" in o ||
    "output_tokens" in o ||
    "cache_read_input_tokens" in o ||
    "cache_creation_input_tokens" in o
  );
}

function rel(cwd: string, p: string): string {
  return p.startsWith(cwd + "/") ? p.slice(cwd.length + 1) : p;
}

/** Pull usage from a metadata.json object: prefer usageTotals, else sum perDoc. */
function usageFromMetadata(obj: Record<string, unknown>): ExtractUsage | null {
  if (hasUsageShape(obj.usageTotals)) return normalizeUsage(obj.usageTotals);
  if (Array.isArray(obj.perDoc)) {
    const list = obj.perDoc
      .map((d) => (d as Record<string, unknown>)?.usage)
      .filter(hasUsageShape)
      .map(normalizeUsage);
    if (list.length > 0) return sumUsage(list);
  }
  return null;
}

/** Pull the top-level `usage` aggregate from an eval_run JSON. Never touches
 *  `predicted` — peek-budget safe for held_out/case3. */
function usageFromRun(obj: Record<string, unknown>): ExtractUsage | null {
  return hasUsageShape(obj.usage) ? normalizeUsage(obj.usage) : null;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function scanRunsDir(cwd: string, dir: string, found: Found[]): void {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json") || name.startsWith("summary-")) continue;
    const path = join(dir, name);
    const obj = readJson(path);
    if (!obj) continue;
    const usage = usageFromRun(obj);
    if (usage) found.push({ source: rel(cwd, path), usage });
  }
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function fmtUSD(n: number): string {
  return `$${n.toFixed(4)}`;
}

function main(): void {
  const cwd = process.cwd();
  const argv = process.argv.slice(2);
  const modelIdx = argv.indexOf("--model");
  const model = modelIdx !== -1 ? argv[modelIdx + 1] : DEFAULT_MODEL;

  const found: Found[] = [];

  // 1. data/cases/<case>/{metadata.json, eval_runs/*.json}
  const casesRoot = join(cwd, "data", "cases");
  if (existsSync(casesRoot)) {
    for (const caseName of readdirSync(casesRoot).sort()) {
      const caseDir = join(casesRoot, caseName);
      if (!statSync(caseDir).isDirectory()) continue;

      const metaPath = join(caseDir, "metadata.json");
      const metaObj = existsSync(metaPath) ? readJson(metaPath) : null;
      if (metaObj) {
        const usage = usageFromMetadata(metaObj);
        if (usage) found.push({ source: rel(cwd, metaPath), usage });
      }
      scanRunsDir(cwd, join(caseDir, "eval_runs"), found);
    }
  }

  // 2. held_out/case3/eval_runs/*.json (top-level usage only)
  scanRunsDir(cwd, join(cwd, "held_out", "case3", "eval_runs"), found);

  console.log(
    `[cache-report] pricing as of ${PRICING_AS_OF} · model ${model}`,
  );

  if (found.length === 0) {
    console.log(
      "[cache-report] no persisted artifacts carry usage fields yet.\n" +
        "  Usage is written by scripts/extract-case.ts (metadata.json) and\n" +
        "  scripts/eval-case3.ts / the live /api/eval route (eval_runs).\n" +
        "  Re-run one of those (after the temperature-0 + usage change) to populate.",
    );
    return;
  }

  const totals = sumUsage(found.map((f) => f.usage));
  const cost = estimateCost(totals, model);

  console.log(`[cache-report] scanned ${found.length} artifact(s) with usage:`);
  for (const f of found) console.log(`  - ${f.source}`);

  console.log("[cache-report] tokens:");
  console.log(`    uncached input : ${fmtInt(totals.input_tokens)}`);
  console.log(`    cache read     : ${fmtInt(totals.cache_read_input_tokens)}`);
  console.log(`    cache write    : ${fmtInt(totals.cache_creation_input_tokens)}`);
  console.log(`    output         : ${fmtInt(totals.output_tokens)}`);
  console.log(`    total input    : ${fmtInt(cost.totalInputTokens)}`);
  console.log(
    `    served from cache: ${(cost.cacheReadFraction * 100).toFixed(1)}%`,
  );

  const pctSaved =
    cost.noCacheUSD > 0 ? (cost.savedUSD / cost.noCacheUSD) * 100 : 0;
  console.log("[cache-report] cost:");
  console.log(`    with caching   : ${fmtUSD(cost.withCacheUSD)}`);
  console.log(`    without caching: ${fmtUSD(cost.noCacheUSD)}`);
  console.log(
    `    net saved      : ${fmtUSD(cost.savedUSD)} (${pctSaved.toFixed(1)}%)  [incl. 1.25x cache-write premium]`,
  );
}

main();

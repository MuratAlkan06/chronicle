/**
 * scripts/eval-case3.ts — held-out Case 3 measurement CLI (makes EVAL.md:150
 * true) + N-run mean±range aggregation for measurement rigor (Phase A, issue #7).
 *
 * What it does, per run:
 *   1. Extract every held_out/case3/docs/*.pdf via the SAME extractor the live
 *      /api/eval route uses (lib/claude extractDocWithUsage). Temperature is
 *      pinned to 0 for models that accept it and OMITTED for post-Opus-4.6
 *      models (they 400 on a non-default value) — see --model below.
 *   2. Evaluate predicted vs held_out/case3/ground_truth.json (lib/eval).
 *   3. Persist an audit JSON into held_out/case3/eval_runs/ in the existing
 *      eval_run format (+ token usage).
 * Across --runs N (default 3) sequential runs it then prints and persists a
 * summary: mean/min/max for strict+loose P/R/F1, and per-run tp/fp/fn.
 *
 * A "measurement event" for peek-budget accounting = one invocation (N runs,
 * mean±range reported). See docs/EVAL.md "Held-out measurement protocol".
 *
 * HELD-OUT HYGIENE (case3 only, per BACKEND-STANDARDS §J.5 + resolved #7):
 * refuses to run unless .gt_hash.lock matches `git hash-object ground_truth.json`
 * and prompts/ is git-clean; writes the active prompt hash to prompt_hash.txt.
 *
 * Usage:
 *   npx tsx scripts/eval-case3.ts                 # case3, 3 runs (the deliverable)
 *   npx tsx scripts/eval-case3.ts --runs 5        # case3, 5 runs
 *   npx tsx scripts/eval-case3.ts --model claude-opus-4-7   # case3 escape hatch
 *   npx tsx scripts/eval-case3.ts --dry-run       # list docs, no API calls
 *   npx tsx scripts/eval-case3.ts case1 --runs 2 --runs-dir /tmp/x   # dev machinery check
 *
 * --model <id> overrides the extraction model (default: lib/claude ACTIVE_MODEL).
 * The recorded run's `model` field and its `temperature` (0 or null-for-default)
 * reflect what was actually sent.
 *
 * The case1/case2 mode runs the identical N-run machinery against a dev case
 * (data/cases/<id>) WITHOUT the held-out hygiene gates — dev cases are not
 * measurement events. It exists to exercise this script without spending the
 * Case 3 peek budget.
 */
// Load .env.local before lib/claude reads ANTHROPIC_API_KEY.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Missing file is fine — env may already be set in the shell.
}

import {
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import pLimit from "p-limit";
import { z } from "zod";
import {
  extractDocWithUsage,
  ACTIVE_MODEL,
  supportsTemperaturePin,
} from "../lib/claude";
import { type GtEvent, type TierResult } from "../lib/eval";
import {
  assembleRunRecord,
  isDegenerateRun,
  sumUsage,
  summarizeRuns,
  ZERO_USAGE,
  type DocOutcome,
  type ExtractUsage,
  type RunMetrics,
} from "../lib/measure";
import { EventTypeSchema, DateConfidenceSchema } from "../lib/schema";

const CONCURRENCY = 8; // mirror /api/eval + BACKEND-STANDARDS J.3
const DEFAULT_RUNS = 3;
const ACTIVE_PROMPT = "prompts/system_extract_v4.md";

// ---------------------------------------------------------------------------
// GT schema (inline — not exported from lib/eval per scope rules; mirrors the
// copy in app/api/eval/route.ts + scripts/eval-train.ts).
// ---------------------------------------------------------------------------

const GtEventSchema = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_confidence: DateConfidenceSchema,
  event_type: EventTypeSchema,
  title: z.string(),
  source_document: z.string(),
  in_scope: z.boolean(),
  notes: z.string().optional(),
});

const GtFileSchema = z.object({
  case_id: z.enum(["case1", "case2", "case3"]),
  patient: z.string(),
  labeled_at: z.string(),
  labeler_notes: z.string(),
  events: z.array(GtEventSchema),
});

// ---------------------------------------------------------------------------
// CLI config
// ---------------------------------------------------------------------------

type CaseId = "case1" | "case2" | "case3";

interface CaseConfig {
  caseId: CaseId;
  caseDir: string;
  docsDir: string;
  gtPath: string;
  runsDir: string;
  heldOut: boolean; // enforce hash-lock + prompt-clean gates, write prompt_hash.txt
}

function isCaseId(s: string): s is CaseId {
  return s === "case1" || s === "case2" || s === "case3";
}

function resolveConfig(
  caseId: CaseId,
  cwd: string,
  runsDirOverride: string | null,
): CaseConfig {
  if (caseId === "case3") {
    const caseDir = join(cwd, "held_out", "case3");
    return {
      caseId,
      caseDir,
      docsDir: join(caseDir, "docs"),
      gtPath: join(caseDir, "ground_truth.json"),
      runsDir: runsDirOverride ?? join(caseDir, "eval_runs"),
      heldOut: true,
    };
  }
  const caseDir = join(cwd, "data", "cases", caseId);
  return {
    caseId,
    caseDir,
    docsDir: join(caseDir, "docs"),
    gtPath: join(caseDir, "ground_truth.json"),
    runsDir: runsDirOverride ?? join(caseDir, "eval_runs"),
    heldOut: false,
  };
}

// ---------------------------------------------------------------------------
// Held-out hygiene (case3 only) — mirrors app/api/eval/route.ts step 2+3.
// Returns the full active-prompt git hash.
// ---------------------------------------------------------------------------

function gitHashObject(path: string): string {
  return execFileSync("git", ["hash-object", path], { encoding: "utf8" }).trim();
}

function enforceHeldOutHygiene(cfg: CaseConfig, cwd: string): string {
  const lockPath = join(cfg.caseDir, ".gt_hash.lock");
  if (!existsSync(lockPath)) {
    fail(`gt_hash_mismatch: ${lockPath} missing — refusing to run`);
  }
  const lockedHash = readFileSync(lockPath, "utf8").trim();
  const liveHash = gitHashObject(cfg.gtPath);
  if (lockedHash !== liveHash) {
    fail(
      "gt_hash_mismatch: Case 3 ground truth has been modified since H0 lock — eval refused",
    );
  }

  const dirty = execFileSync("git", ["status", "--porcelain", "prompts/"], {
    encoding: "utf8",
  });
  if (dirty.trim().length > 0) {
    fail(
      "prompt_dirty: prompts/ has uncommitted changes — eval refused for reproducibility",
    );
  }

  const promptHash = gitHashObject(join(cwd, ACTIVE_PROMPT));
  writeFileSync(join(cfg.caseDir, "prompt_hash.txt"), promptHash + "\n", "utf8");
  console.log(`[eval-case3] held-out hygiene OK (gt lock + prompt clean); prompt ${promptHash.slice(0, 7)}`);
  return promptHash;
}

// ---------------------------------------------------------------------------
// One extraction+eval run
// ---------------------------------------------------------------------------

async function runOnce(
  cfg: CaseConfig,
  pdfFiles: string[],
  runIndex: number,
  model: string,
): Promise<DocOutcome[]> {
  const limit = pLimit(CONCURRENCY);
  // Promise.all preserves input (doc) order regardless of completion order, so
  // the doc-order flatten in assembleRunRecord is deterministic across runs.
  // Per-doc failures are CAUGHT (not thrown) so one bad doc can't abort the run:
  // a run with >=1 success persists (recording the failures); a run where every
  // doc fails is degenerate and refused by the caller (isDegenerateRun).
  return Promise.all(
    pdfFiles.map((filename) =>
      limit(async (): Promise<DocOutcome> => {
        const docId = filename.replace(/\.pdf$/i, "");
        let buffer: Buffer;
        try {
          buffer = readFileSync(join(cfg.docsDir, filename));
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          console.error(`[eval-case3] run ${runIndex} doc=${docId} READ FAILED: ${error}`);
          return { docId, ok: false, events: [], usage: ZERO_USAGE, error };
        }
        try {
          const { events, usage } = await extractDocWithUsage(buffer, docId, filename, { model });
          console.log(`[eval-case3] run ${runIndex} doc=${docId} events=${events.length}`);
          return { docId, ok: true, events, usage };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          console.error(`[eval-case3] run ${runIndex} doc=${docId} EXTRACT FAILED: ${error}`);
          return { docId, ok: false, events: [], usage: ZERO_USAGE, error };
        }
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtTier(r: TierResult): string {
  return `P=${r.precision.toFixed(2)} R=${r.recall.toFixed(2)} F1=${r.f1.toFixed(2)}`;
}

function fmtTriple(t: { mean: number; min: number; max: number }): string {
  return `mean=${t.mean.toFixed(3)} min=${t.min.toFixed(3)} max=${t.max.toFixed(3)}`;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(`[eval-case3] ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  caseId: CaseId;
  runs: number;
  runsDir: string | null;
  model: string | null;
  dryRun: boolean;
} {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const caseArg = positional[0] ?? "case3";
  if (!isCaseId(caseArg)) {
    fail(`invalid case '${caseArg}' — expected case1, case2, or case3`);
  }

  let runs = DEFAULT_RUNS;
  const runsIdx = argv.indexOf("--runs");
  if (runsIdx !== -1) {
    const v = Number(argv[runsIdx + 1]);
    if (!Number.isInteger(v) || v < 1) {
      fail(`--runs expects a positive integer, got '${argv[runsIdx + 1]}'`);
    }
    runs = v;
  }

  let runsDir: string | null = null;
  const dirIdx = argv.indexOf("--runs-dir");
  if (dirIdx !== -1) {
    if (!argv[dirIdx + 1]) fail("--runs-dir expects a path");
    runsDir = argv[dirIdx + 1];
  }

  // --model <id>: override the extraction model (default lib/claude ACTIVE_MODEL).
  // The Case 3 escape hatch (docs/BUILD.md, EVAL.md §6) runs `--model
  // claude-opus-4-7`; temperature is pinned or omitted automatically per model.
  let model: string | null = null;
  const modelIdx = argv.indexOf("--model");
  if (modelIdx !== -1) {
    if (!argv[modelIdx + 1]) fail("--model expects a model id");
    model = argv[modelIdx + 1];
  }

  return {
    caseId: caseArg,
    runs,
    runsDir,
    model,
    dryRun: argv.includes("--dry-run"),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { caseId, runs, runsDir, model: modelArg, dryRun } = parseArgs(argv);
  const cwd = process.cwd();
  const cfg = resolveConfig(caseId, cwd, runsDir);

  // Resolve the extraction model + whether temperature can be pinned for it.
  // pinnedTemp is 0 for models that accept temperature, null (= model default)
  // for post-Opus-4.6 models — recorded verbatim in each run + the summary.
  const model = modelArg ?? ACTIVE_MODEL;
  const pinnedTemp: number | null = supportsTemperaturePin(model) ? 0 : null;
  const tempLabel = pinnedTemp === null ? "default" : String(pinnedTemp);

  if (!existsSync(cfg.docsDir)) {
    fail(`docs dir not found: ${cfg.docsDir}`);
  }
  const pdfFiles = readdirSync(cfg.docsDir)
    .filter((n) => n.toLowerCase().endsWith(".pdf"))
    .sort();
  if (pdfFiles.length === 0) {
    fail(`no PDFs found in ${cfg.docsDir}`);
  }
  if (!existsSync(cfg.gtPath)) {
    fail(`ground truth not found: ${cfg.gtPath}`);
  }

  if (dryRun) {
    console.log(
      `[eval-case3] DRY RUN — case=${cfg.caseId} runs=${runs} docs=${pdfFiles.length} model=${model} temp=${tempLabel} runsDir=${cfg.runsDir} heldOut=${cfg.heldOut}`,
    );
    for (const name of pdfFiles) console.log(`[eval-case3] would extract ${name}`);
    console.log("[eval-case3] dry run complete — no API calls made");
    return;
  }

  // Held-out hygiene (case3) or a clear dev-mode notice (case1/case2).
  let promptHash = "";
  if (cfg.heldOut) {
    promptHash = enforceHeldOutHygiene(cfg, cwd);
  } else {
    console.log(
      `[eval-case3] DEV MODE (${cfg.caseId}) — held-out hygiene gates skipped; not a measurement event`,
    );
    try {
      promptHash = gitHashObject(join(cwd, ACTIVE_PROMPT));
    } catch {
      promptHash = "unknown";
    }
  }

  const gtRaw = JSON.parse(readFileSync(cfg.gtPath, "utf8"));
  const gtParse = GtFileSchema.safeParse(gtRaw);
  if (!gtParse.success) {
    fail(
      `ground_truth.json schema invalid: ${gtParse.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  const gtEvents: GtEvent[] = gtParse.data.events;

  mkdirSync(cfg.runsDir, { recursive: true });
  console.log(
    `[eval-case3] case=${cfg.caseId} runs=${runs} docs=${pdfFiles.length} model=${model} temp=${tempLabel} prompt=${promptHash.slice(0, 7)}`,
  );

  const runMetrics: RunMetrics[] = [];
  const runFiles: string[] = [];
  const runUsages: ExtractUsage[] = [];

  for (let i = 1; i <= runs; i++) {
    const outcomes = await runOnce(cfg, pdfFiles, i, model);

    // Degenerate-run guard (issue #7): NEVER persist a zero-success run. Abort
    // the whole invocation loudly BEFORE writing this run file; because fail()
    // exits, the post-loop summary is never written either. A run with >=1
    // success is allowed through and persists its failures below.
    if (isDegenerateRun(outcomes)) {
      fail(
        `run ${i}/${runs}: all ${outcomes.length} document(s) failed extraction (0 successful) — ` +
          `NOT a measurement (auth/transport failure, tells us nothing about model performance). ` +
          `Refusing to persist; no run file and no summary written. ` +
          `First error: ${outcomes.find((o) => !o.ok)?.error ?? "unknown"}`,
      );
    }

    const failures = outcomes
      .filter((o) => !o.ok)
      .map((o) => ({ docId: o.docId, error: o.error ?? "unknown" }));
    const record = assembleRunRecord({
      caseId: cfg.caseId,
      model,
      promptHash,
      temperature: pinnedTemp,
      run: i,
      runs,
      perDoc: outcomes
        .filter((o) => o.ok)
        .map((o) => ({ docId: o.docId, events: o.events, usage: o.usage })),
      failures,
      gtEvents,
    });
    runUsages.push(record.usage);
    runMetrics.push({ strict: record.metrics.strict, loose: record.metrics.loose });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const runPath = join(cfg.runsDir, `${stamp}.json`);
    writeFileSync(
      runPath,
      JSON.stringify({ generatedAt: new Date().toISOString(), ...record }, null, 2) + "\n",
      "utf8",
    );
    runFiles.push(runPath);
    if (failures.length > 0) {
      console.warn(
        `[eval-case3] run ${i}/${runs} persisted a PARTIAL run — ${failures.length} doc failure(s): ${failures
          .map((f) => f.docId)
          .join(", ")}`,
      );
    }
    console.log(
      `[eval-case3] run ${i}/${runs} strict ${fmtTier(record.metrics.strict)} | loose ${fmtTier(record.metrics.loose)} → ${runPath}`,
    );
  }

  // Aggregate.
  const summary = summarizeRuns(runMetrics);
  const usageTotals = sumUsage(runUsages);

  console.log(`\n[eval-case3] ===== ${cfg.caseId} · ${runs} runs · summary =====`);
  console.log(`[eval-case3] strict P   ${fmtTriple(summary.strict.precision)}`);
  console.log(`[eval-case3] strict R   ${fmtTriple(summary.strict.recall)}`);
  console.log(`[eval-case3] strict F1  ${fmtTriple(summary.strict.f1)}`);
  console.log(`[eval-case3] loose  P   ${fmtTriple(summary.loose.precision)}`);
  console.log(`[eval-case3] loose  R   ${fmtTriple(summary.loose.recall)}`);
  console.log(`[eval-case3] loose  F1  ${fmtTriple(summary.loose.f1)}`);
  for (const r of summary.perRun.strict) {
    console.log(
      `[eval-case3]   run ${r.run}: strict tp/fp/fn=${r.tp}/${r.fp}/${r.fn} F1=${r.f1.toFixed(2)}`,
    );
  }

  const summaryStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const summaryPath = join(cfg.runsDir, `summary-${summaryStamp}.json`);
  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        caseId: cfg.caseId,
        model,
        temperature: pinnedTemp,
        promptHash,
        runs,
        summary,
        usageTotals,
        runFiles,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(`[eval-case3] wrote summary → ${summaryPath}`);
}

main().catch((err) => {
  console.error("[eval-case3] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});

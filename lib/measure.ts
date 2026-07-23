/**
 * Chronicle — measurement helpers (pure functions, no I/O).
 *
 * Two concerns, both used by the held-out measurement machinery
 * (scripts/eval-case3.ts, scripts/cache-report.ts, app/api/eval/route.ts):
 *
 *  1. API-usage accounting — normalize + sum the Anthropic `usage` object into
 *     the four fields Chronicle persists (input/output/cache-read/cache-write).
 *  2. N-run aggregation — mean/min/max over repeated measurement runs, so a
 *     "measurement event" reports central tendency + range instead of a single
 *     noisy number (Phase A rigor per docs/EVAL.md).
 *
 * Kept separate from lib/eval.ts (matching algorithm) and lib/claude.ts (API
 * client) so it can be unit-tested with no SDK import and no network.
 */
import { evaluate, breakdown, type GtEvent, type TierResult } from "./eval";
import type { EventType, TimelineEvent } from "./schema";

// ---------------------------------------------------------------------------
// API-usage accounting
// ---------------------------------------------------------------------------

/**
 * The four token-usage fields Chronicle persists per extraction call. Mirrors
 * the Anthropic `Message.usage` shape (input_tokens, output_tokens,
 * cache_read_input_tokens, cache_creation_input_tokens). The SDK types the two
 * cache fields as `number | null`; we coerce null/missing to 0 so every
 * persisted artifact carries plain numbers and old artifacts (no usage at all)
 * normalize cleanly to zeros.
 */
export interface ExtractUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export const ZERO_USAGE: ExtractUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Coerce a raw Anthropic `usage` object (or any partial/old artifact `usage`
 * blob, or null/undefined) into a fully-populated ExtractUsage. Unknown or null
 * fields become 0 — this is what makes old artifacts without usage fields
 * readable everywhere.
 */
export function normalizeUsage(raw: unknown): ExtractUsage {
  const u = (raw ?? {}) as Record<string, unknown>;
  return {
    input_tokens: num(u.input_tokens),
    output_tokens: num(u.output_tokens),
    cache_read_input_tokens: num(u.cache_read_input_tokens),
    cache_creation_input_tokens: num(u.cache_creation_input_tokens),
  };
}

/** Element-wise sum of a list of usages. Empty list → ZERO_USAGE. */
export function sumUsage(list: ExtractUsage[]): ExtractUsage {
  return list.reduce<ExtractUsage>(
    (acc, u) => ({
      input_tokens: acc.input_tokens + u.input_tokens,
      output_tokens: acc.output_tokens + u.output_tokens,
      cache_read_input_tokens: acc.cache_read_input_tokens + u.cache_read_input_tokens,
      cache_creation_input_tokens:
        acc.cache_creation_input_tokens + u.cache_creation_input_tokens,
    }),
    { ...ZERO_USAGE },
  );
}

// ---------------------------------------------------------------------------
// N-run aggregation
// ---------------------------------------------------------------------------

export interface StatTriple {
  mean: number;
  min: number;
  max: number;
}

export interface TierRunSummary {
  precision: StatTriple;
  recall: StatTriple;
  f1: StatTriple;
}

export interface PerRunStat {
  run: number; // 1-based
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface RunMetrics {
  strict: TierResult;
  loose: TierResult;
}

export interface RunsSummary {
  runs: number;
  strict: TierRunSummary;
  loose: TierRunSummary;
  perRun: {
    strict: PerRunStat[];
    loose: PerRunStat[];
  };
}

function stat(values: number[]): StatTriple {
  if (values.length === 0) return { mean: 0, min: 0, max: 0 };
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    mean: sum / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function tierSummary(results: TierResult[]): TierRunSummary {
  return {
    precision: stat(results.map((r) => r.precision)),
    recall: stat(results.map((r) => r.recall)),
    f1: stat(results.map((r) => r.f1)),
  };
}

function perRunStats(results: TierResult[]): PerRunStat[] {
  return results.map((r, i) => ({
    run: i + 1,
    tp: r.tp,
    fp: r.fp,
    fn: r.fn,
    precision: r.precision,
    recall: r.recall,
    f1: r.f1,
  }));
}

/**
 * Aggregate the strict + loose TierResults from N measurement runs into
 * mean/min/max for P/R/F1 per tier, plus a per-run tp/fp/fn breakdown. Empty
 * input → a zeroed summary (never NaN).
 */
export function summarizeRuns(runs: RunMetrics[]): RunsSummary {
  const strict = runs.map((r) => r.strict);
  const loose = runs.map((r) => r.loose);
  return {
    runs: runs.length,
    strict: tierSummary(strict),
    loose: tierSummary(loose),
    perRun: {
      strict: perRunStats(strict),
      loose: perRunStats(loose),
    },
  };
}

// ---------------------------------------------------------------------------
// Measurement-run record assembly (pure)
// ---------------------------------------------------------------------------

/** One document's SUCCESSFUL extraction result: events + the call's token usage. */
export interface DocExtraction {
  docId: string;
  events: TimelineEvent[];
  usage: ExtractUsage;
}

/**
 * One document's extraction OUTCOME during a measurement run. `ok` distinguishes
 * a successful model call (events + usage) from a failure (auth/transport/parse
 * error — events `[]`, usage ZERO_USAGE, `error` set). This is what the harness
 * accumulates per doc so it can tell a partial run (some docs failed, some
 * succeeded) from a degenerate one (nothing succeeded). Consumed by
 * isDegenerateRun.
 */
export interface DocOutcome {
  docId: string;
  ok: boolean;
  events: TimelineEvent[];
  usage: ExtractUsage;
  error?: string;
}

/** A document that failed to extract, recorded explicitly in the run artifact. */
export interface DocFailure {
  docId: string;
  error: string;
}

/**
 * A run is DEGENERATE when ZERO documents produced a successful extraction —
 * every doc failed, or there were no docs at all. Such a run carries no
 * information about model performance: it reflects an auth/transport failure
 * (e.g. an invalid ANTHROPIC_API_KEY → 401 on every call), not a measurement.
 * The harness must NEVER persist a degenerate run (it would masquerade as a
 * real tp=0/fn=n_gt score). Accepts the minimal `{ ok }` shape so both persist
 * paths (scripts/eval-case3.ts, the live app/api/eval route) can call it.
 */
export function isDegenerateRun(outcomes: readonly { ok: boolean }[]): boolean {
  return outcomes.every((o) => !o.ok);
}

/**
 * The persisted shape of a single measurement run (held_out/case3/eval_runs/*),
 * minus `generatedAt` which the writer stamps at flush time. Additive to the
 * historical eval_run shape (predicted/metrics/byEventType) — the new fields
 * are caseId/run/runs/temperature/usage/perDocUsage.
 */
export interface RunRecord {
  caseId: string;
  promptHash: string;
  temperature: number;
  run: number;
  runs: number;
  predicted: TimelineEvent[];
  metrics: { strict: TierResult; loose: TierResult };
  byEventType: {
    strict: Record<EventType, TierResult>;
    loose: Record<EventType, TierResult>;
  };
  usage: ExtractUsage;
  perDocUsage: { docId: string; usage: ExtractUsage }[];
  /**
   * Docs that failed extraction this run, recorded explicitly so a persisted
   * PARTIAL run is auditable (empty on a fully-successful run). A run where ALL
   * docs fail is degenerate (isDegenerateRun) and never reaches persistence.
   */
  docFailures: DocFailure[];
}

/**
 * Assemble one run's persisted record from per-doc extractions + ground truth.
 * Pure: predicted events are flattened in DOC ORDER (deterministic, independent
 * of extraction-concurrency scheduling), then scored via lib/eval. This is the
 * unit-testable core of scripts/eval-case3.ts (and mirrors the live /api/eval
 * run shape).
 */
export function assembleRunRecord(input: {
  caseId: string;
  promptHash: string;
  temperature: number;
  run: number;
  runs: number;
  perDoc: DocExtraction[];
  /** Docs that threw during extraction this run (default []). Recorded in the
   *  artifact; their events/usage are absent from perDoc by construction. */
  failures?: DocFailure[];
  gtEvents: GtEvent[];
}): RunRecord {
  const predicted = input.perDoc.flatMap((d) => d.events);
  return {
    caseId: input.caseId,
    promptHash: input.promptHash,
    temperature: input.temperature,
    run: input.run,
    runs: input.runs,
    predicted,
    metrics: {
      strict: evaluate(predicted, input.gtEvents, "strict"),
      loose: evaluate(predicted, input.gtEvents, "loose"),
    },
    byEventType: {
      strict: breakdown(predicted, input.gtEvents, "strict"),
      loose: breakdown(predicted, input.gtEvents, "loose"),
    },
    usage: sumUsage(input.perDoc.map((d) => d.usage)),
    perDocUsage: input.perDoc.map((d) => ({ docId: d.docId, usage: d.usage })),
    docFailures: input.failures ?? [],
  };
}

/**
 * Chronicle — eval matching algorithm (pure functions, no I/O).
 *
 * Mirrors the pseudocode in docs/EVAL.md "Matching algorithm pseudocode" line-
 * for-line. Both Cases 1+2 cached eval (scripts/eval-train.ts) and Case 3 live
 * eval (app/api/eval/route.ts) call into these functions.
 *
 * Per Q17: strict = same event_type, exact-day, title token-overlap ≥ 0.5;
 * loose = same event_type, ±3 days, title token-overlap ≥ 0.5. OOS events
 * (in_scope: false) excluded from FN denominator.
 */
import type { TimelineEvent, EventType } from "./schema";

export type Tier = "strict" | "loose";

export interface GtEvent {
  id: string; // "gt_NNN"
  date: string; // YYYY-MM-DD
  date_confidence: "exact" | "approximate" | "inferred";
  event_type: EventType;
  title: string;
  source_document: string;
  in_scope: boolean;
  notes?: string;
}

export interface TierResult {
  tier: Tier;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  n_gt: number; // == in-scope GT count for the (filtered) input
}

const ALL_EVENT_TYPES: EventType[] = [
  "lab",
  "imaging",
  "visit",
  "diagnosis",
  "medication",
  "procedure",
  "referral",
];

const DAY_MS = 86_400_000;

function titleTokens(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const denom = Math.max(a.size, b.size);
  return denom === 0 ? 0 : inter / denom;
}

/** Predicted source may carry a `_pinpointed: false` marker if lib/match.ts
 * could not locate the snippet (per Q14). Default true when absent. */
interface SourceWithPinpoint {
  document_id: string;
  page: number;
  snippet: string;
  _pinpointed?: boolean;
}

function isPinpointed(p: TimelineEvent): boolean {
  const src = p.source as SourceWithPinpoint;
  return src._pinpointed !== false;
}

/**
 * True iff `pred` matches `gt` under tier rules. Pure (no allocations beyond
 * the Set literals).
 */
export function matchesEvent(pred: TimelineEvent, gt: GtEvent, tier: Tier): boolean {
  if (pred.event_type !== gt.event_type) return false;

  if (overlap(titleTokens(pred.title), titleTokens(gt.title)) < 0.5) return false;

  const diffDays = Math.abs(Date.parse(pred.date) - Date.parse(gt.date)) / DAY_MS;
  if (tier === "strict") return diffDays === 0;
  if (tier === "loose") return diffDays <= 3;
  return false;
}

/**
 * Greedy 1-1 matching. Iterate predicted in array order; for each, take the
 * first unmatched in-scope GT candidate whose `matchesEvent` is true,
 * preferring same-source-document candidates. Mark both as matched.
 *
 * The `|| 1` in the precision/recall/f1 expressions is the JS-idiom
 * zero-guard from the docs/EVAL.md pseudocode — it returns 0 (not NaN) when
 * the denominator would otherwise be 0, which is the correct behavior at
 * the empty-input boundary (no predictions and no GT → no signal).
 */
export function evaluate(
  predicted: TimelineEvent[],
  gt: GtEvent[],
  tier: Tier,
): TierResult {
  const inScopeGt = gt.filter((g) => g.in_scope);
  const matchedGt = new Set<string>();
  // Track matched predictions by ARRAY INDEX, not by p.id — the model can emit
  // colliding ids across docs and we'd undercount tp if we deduped by id.
  const matchedPredIdx = new Set<number>();

  for (let i = 0; i < predicted.length; i++) {
    const p = predicted[i];
    const candidates = inScopeGt.filter(
      (g) => !matchedGt.has(g.id) && matchesEvent(p, g, tier),
    );
    candidates.sort((a, b) => {
      const aSame = a.source_document === p.source.document_id ? 0 : 1;
      const bSame = b.source_document === p.source.document_id ? 0 : 1;
      return aSame - bSame;
    });
    if (candidates.length > 0) {
      matchedGt.add(candidates[0].id);
      matchedPredIdx.add(i);
    }
  }

  const validPred = predicted.filter(isPinpointed);
  const tp = matchedPredIdx.size;
  const fp = validPred.length - matchedPredIdx.size;
  const fn = inScopeGt.length - matchedGt.size;

  const precision = tp / (tp + fp || 1);
  const recall = tp / (tp + fn || 1);
  const f1 = (2 * precision * recall) / (precision + recall || 1);

  return { tier, tp, fp, fn, precision, recall, f1, n_gt: inScopeGt.length };
}

/**
 * Per-event-type breakdown. Returns one entry per EventType (even if n_gt is
 * 0 for that type — rendering wants a stable column set).
 */
export function breakdown(
  predicted: TimelineEvent[],
  gt: GtEvent[],
  tier: Tier,
): Record<EventType, TierResult> {
  const out = {} as Record<EventType, TierResult>;
  for (const t of ALL_EVENT_TYPES) {
    const predT = predicted.filter((p) => p.event_type === t);
    const gtT = gt.filter((g) => g.event_type === t);
    out[t] = evaluate(predT, gtT, tier);
  }
  return out;
}

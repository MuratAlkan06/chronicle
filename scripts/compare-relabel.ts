/**
 * scripts/compare-relabel.ts — rescoring comparison for the blind relabel
 * experiment (issue #24).
 *
 * THE MEASUREMENT INSTRUMENT. Scores the EXISTING cached predictions
 * (`data/cases/<case>/events.json`, never modified) against two label sets —
 * the original `data/cases/<case>/ground_truth.json` and the blind
 * `label_packet/<case>/blind_labels.json` — through the unchanged production
 * matcher (`evaluate` / `breakdown` / `matchesEvent` imported from
 * `lib/eval.ts`). No model is run; nothing under `held_out/` is opened; Case 3
 * is refused by name in any spelling (docs/RESOLVED-DECISIONS.md #10).
 *
 * WHY: docs/EVAL.md §7 showed the published dev macro-mean strict F1 measures
 * `event_type` + exact-day agreement only — title-blind rescoring returns
 * bit-identical tp/fp/fn — because dev labels and dev predictions co-phrase. §7
 * ends by naming this experiment as the honest next step: labels written by
 * someone who has not seen the model output, scored against the same cached
 * predictions, measure the label-phrasing effect directly and cost zero Case 3
 * budget. The delta between the two label sets IS the measurement.
 *
 * DIAGNOSTIC, NOT A GATE. Exits 0 no matter what it finds — no finding is ever
 * a failure — and is not wired into CI. It exits 1 only on invalid input, the
 * same contract `scripts/analyze-title-overlap.ts` documents in §7. If the blind
 * labels do not exist yet it explains that and exits 0: the experiment has not
 * been run, which is not an error.
 *
 * READ THIS BEFORE READING ITS NUMBERS — three confounds it reports rather than
 * silently absorbs, because each moves F1 for reasons that are not phrasing:
 *   (a) in_scope. The FN denominator is the in-scope GT count. If the blind
 *       labeler used the OOS mechanism differently, recall moves on its own.
 *   (b) source_document spelling. `evaluate()`'s same-document tie-break
 *       compares `gt.source_document` to the prediction's `source.document_id`,
 *       which carries no ".pdf". The original dev GT uses the ".pdf" form
 *       throughout, so the tie-break is INERT on the original labels. A blind
 *       file spelled without the suffix activates it.
 *   (c) labeling granularity. Different event counts mean the two label sets do
 *       not describe the same population, and per-event status change is then
 *       only defined up to an alignment. Section [4] reports both an
 *       alignment-free census and an aligned one, and never hides the residue.
 *
 * Usage:
 *   npx tsx scripts/compare-relabel.ts                    # case1 + case2
 *   npx tsx scripts/compare-relabel.ts case1
 *   npx tsx scripts/compare-relabel.ts --packet=/tmp/pkt
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  evaluate,
  breakdown,
  matchesEvent,
  type GtEvent,
  type Tier,
  type TierResult,
} from "../lib/eval";
import { normalize } from "../lib/normalize";
import {
  CaseFixtureSchema,
  EventTypeSchema,
  DateConfidenceSchema,
  type EventType,
  type TimelineEvent,
} from "../lib/schema";

const TAG = "[compare-relabel]";

type CaseId = "case1" | "case2";
const ALL_CASES: CaseId[] = ["case1", "case2"];
const ALL_EVENT_TYPES: EventType[] = [
  "lab",
  "imaging",
  "visit",
  "diagnosis",
  "medication",
  "procedure",
  "referral",
];
const TIERS: Tier[] = ["strict", "loose"];
const DAY_MS = 86_400_000;
const THRESHOLD = 0.5;
const DEFAULT_PACKET_ROOT = "label_packet";

type Which = "original" | "blind";
const WHICH: Which[] = ["original", "blind"];

// ---------------------------------------------------------------------------
// LOCAL MIRROR of two lib/eval.ts leaf helpers, for the same reason
// scripts/analyze-title-overlap.ts carries one: `titleTokens` and `overlap` are
// module-private in lib/eval.ts, and this slice must leave that file
// byte-identical, so they are reproduced verbatim here rather than exported.
//
// THESE ARE A MIRROR, NOT THE PRODUCTION FUNCTIONS. Every match decision below
// goes through the real exported `matchesEvent` / `evaluate` / `breakdown`; the
// mirror only *reports* intermediate values the production API does not return.
// The fidelity argument is source identity, not agreement on these fixtures:
// after renaming (`titleTokensMirror` -> `titleTokens`, `overlapMirror` ->
// `overlap`) the block below is byte-identical to lib/eval.ts lines 50-60, and
// hashes to sha256 e928483d4be0c4faf9d3045932e49ed1bb7975ba91c2351da18692790d07c5da
// — the same value docs/EVAL.md §7 carve-out 1 records for the mirror in
// scripts/analyze-title-overlap.ts. That makes the two equivalent on ALL inputs,
// not merely on these fixtures, and it is the claim to re-check whenever
// lib/eval.ts changes.
//
// THE HASH CONVENTION MATTERS AND §7 DOES NOT STATE IT: the digest is over
// lib/eval.ts lines 50-60 WITH a trailing newline (equivalently, lines 50-61
// without one). Dropping the trailing newline yields 6b046d75…a524 instead, and
// the block is still byte-identical — so a mismatch against e928483d is a
// boundary-convention difference until you have checked that first.
//
// `verifyMirror()` below is the same runtime tripwire scripts/analyze-title-
// overlap.ts uses, and it has the same documented blind spot: it compares only
// the `>= 0.5` boolean, so it cannot detect a max-vs-min denominator swap. Do
// not cite it as proof of mirror fidelity.
// ---------------------------------------------------------------------------
function titleTokensMirror(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function overlapMirror(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const denom = Math.max(a.size, b.size);
  return denom === 0 ? 0 : inter / denom;
}

function titleOverlap(a: string, b: string): number {
  return overlapMirror(titleTokensMirror(a), titleTokensMirror(b));
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;
}

function withinTier(diff: number, tier: Tier): boolean {
  return tier === "strict" ? diff === 0 : diff <= 3;
}

// ---------------------------------------------------------------------------
// Input loading — same shapes and same zod validation as scripts/eval-train.ts.
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

const STUB_KEY = "_comment_DELETE_THIS_BEFORE_LABELING";

interface LoadedCase {
  caseId: CaseId;
  predicted: TimelineEvent[];
  gt: Record<Which, GtEvent[]>;
  labeledAt: Record<Which, string>;
}

function die(msg: string): never {
  console.error(`${TAG} ${msg}`);
  process.exit(1);
}

function loadJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    die(`${path}: not valid JSON — ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** True when the file is still the untouched packet template. */
function isTemplate(raw: unknown): boolean {
  const events = (raw as { events?: unknown[] }).events;
  if (!Array.isArray(events)) return false;
  return events.some(
    (e) => e && typeof e === "object" && STUB_KEY in (e as Record<string, unknown>),
  );
}

function loadCase(caseId: CaseId, packetRoot: string): LoadedCase {
  const caseDir = resolve(process.cwd(), "data", "cases", caseId);
  const eventsPath = join(caseDir, "events.json");
  const origPath = join(caseDir, "ground_truth.json");
  const blindPath = join(packetRoot, caseId, "blind_labels.json");

  if (!existsSync(eventsPath)) die(`${caseId}: cached predictions missing at ${eventsPath}`);
  if (!existsSync(origPath)) die(`${caseId}: original labels missing at ${origPath}`);

  const fixture = CaseFixtureSchema.safeParse(loadJson(eventsPath));
  if (!fixture.success) die(`${caseId}: events.json schema invalid`);

  const orig = GtFileSchema.safeParse(loadJson(origPath));
  if (!orig.success) die(`${caseId}: ground_truth.json schema invalid`);

  const blindRaw = loadJson(blindPath);
  const blind = GtFileSchema.safeParse(blindRaw);
  if (!blind.success) {
    die(
      `${caseId}: ${blindPath} is not a valid label file — run ` +
        `npx tsx scripts/validate-blind-labels.ts ${caseId} for the per-field report`,
    );
  }

  return {
    caseId,
    predicted: fixture.data.events,
    gt: { original: orig.data.events, blind: blind.data.events },
    labeledAt: { original: orig.data.labeled_at, blind: blind.data.labeled_at },
  };
}

// ---------------------------------------------------------------------------
// Self-checks, printed before any mirror-derived number.
// ---------------------------------------------------------------------------
function verifyMirror(cases: LoadedCase[]): { checked: number; disagreements: string[] } {
  const disagreements: string[] = [];
  let checked = 0;
  for (const c of cases) {
    for (const which of WHICH) {
      for (const p of c.predicted) {
        for (const g of c.gt[which]) {
          for (const tier of TIERS) {
            const prod = matchesEvent(p, g, tier);
            const mirrored =
              p.event_type === g.event_type &&
              overlapMirror(titleTokensMirror(p.title), titleTokensMirror(g.title)) >= THRESHOLD &&
              withinTier(dayDiff(p.date, g.date), tier);
            checked++;
            if (prod !== mirrored) {
              disagreements.push(`${c.caseId}/${which} ${tier} pred="${p.title}" gt=${g.id}`);
            }
          }
        }
      }
    }
  }
  return { checked, disagreements };
}

// ---------------------------------------------------------------------------
// Greedy 1-1 pairing, mirroring the loop inside lib/eval.ts `evaluate()` so the
// PAIRS can be recovered (evaluate() returns only counts). The match predicate
// is the production `matchesEvent`. `pairingAgrees` checks this reproduces
// evaluate()'s tp/fn exactly.
// ---------------------------------------------------------------------------
interface Pairing {
  pairs: Array<{ pred: TimelineEvent; predIdx: number; gt: GtEvent }>;
  unmatchedGt: GtEvent[];
  matchedPredIdx: Set<number>;
  matchedGtIds: Set<string>;
}

function greedyPairs(predicted: TimelineEvent[], gt: GtEvent[], tier: Tier): Pairing {
  const inScopeGt = gt.filter((g) => g.in_scope);
  const matchedGtIds = new Set<string>();
  const matchedPredIdx = new Set<number>();
  const pairs: Pairing["pairs"] = [];

  for (let i = 0; i < predicted.length; i++) {
    const p = predicted[i];
    const candidates = inScopeGt.filter(
      (g) => !matchedGtIds.has(g.id) && matchesEvent(p, g, tier),
    );
    candidates.sort((a, b) => {
      const aSame = a.source_document === p.source.document_id ? 0 : 1;
      const bSame = b.source_document === p.source.document_id ? 0 : 1;
      return aSame - bSame;
    });
    if (candidates.length > 0) {
      matchedGtIds.add(candidates[0].id);
      matchedPredIdx.add(i);
      pairs.push({ pred: p, predIdx: i, gt: candidates[0] });
    }
  }

  return {
    pairs,
    unmatchedGt: inScopeGt.filter((g) => !matchedGtIds.has(g.id)),
    matchedPredIdx,
    matchedGtIds,
  };
}

function pairingAgrees(predicted: TimelineEvent[], gt: GtEvent[], tier: Tier): boolean {
  const prod = evaluate(predicted, gt, tier);
  const mine = greedyPairs(predicted, gt, tier);
  return prod.tp === mine.pairs.length && prod.fn === mine.unmatchedGt.length;
}

// ---------------------------------------------------------------------------
// Failure attribution — the same four causes and the same precedence
// docs/EVAL.md §7 uses (scripts/analyze-title-overlap.ts `attribute`).
// ---------------------------------------------------------------------------
type Cause = "type" | "date" | "overlap" | "contention";
const CAUSES: Cause[] = ["type", "date", "overlap", "contention"];

function attribute(gt: GtEvent, predicted: TimelineEvent[], tier: Tier): Cause {
  if (predicted.some((p) => matchesEvent(p, gt, tier))) return "contention";
  const sameType = predicted.filter((p) => p.event_type === gt.event_type);
  if (sameType.length === 0) return "type";
  const inDate = sameType.filter((p) => withinTier(dayDiff(p.date, gt.date), tier));
  if (inDate.length === 0) return "date";
  return "overlap";
}

/** Best same-type candidate for a GT event (max overlap, tie-break nearer
 * date, then array order) — same rule as the §7 diagnostic.
 *
 * Returns NaN when the case has NO prediction of that event_type. That is a
 * different thing from an overlap of 0.000 (candidates exist, they share no
 * token) and the distribution must not fold the two together — the first is the
 * attribution table's `type` cause, the second its `overlap` cause. */
function bestOverlap(gt: GtEvent, predicted: TimelineEvent[]): number {
  let bestOv = -1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const p of predicted) {
    if (p.event_type !== gt.event_type) continue;
    const ov = titleOverlap(p.title, gt.title);
    const dd = dayDiff(p.date, gt.date);
    if (ov > bestOv || (ov === bestOv && dd < bestDiff)) {
      bestOv = ov;
      bestDiff = dd;
    }
  }
  return bestOv < 0 ? NaN : bestOv;
}

// ---------------------------------------------------------------------------
// Formatting.
// ---------------------------------------------------------------------------
function f2(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : "—";
}
function f3(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : "—";
}
function signed(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const s = n.toFixed(3);
  return n > 0 ? `+${s}` : n === 0 ? "+0.000" : s;
}
function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`;
}
function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(xs: number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}
function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
function padL(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}
function rule(ch = "-", n = 100): string {
  return ch.repeat(n);
}
function head(title: string): void {
  console.log("");
  console.log(rule("="));
  console.log(title);
  console.log(rule("="));
}
function f1From(tp: number, fp: number, fn: number): { p: number; r: number; f1: number } {
  const p = tp / (tp + fp || 1);
  const r = tp / (tp + fn || 1);
  return { p, r, f1: (2 * p * r) / (p + r || 1) };
}
function counts(r: TierResult): string {
  return `tp${r.tp}/fp${r.fp}/fn${r.fn}`;
}
function docCanon(ref: string): string {
  return ref.replace(/\.pdf$/i, "");
}

// ---------------------------------------------------------------------------
// [0] Label-set census — the confounds, stated before any F1.
// ---------------------------------------------------------------------------
function sectionCensus(cases: LoadedCase[]): void {
  head("[0] LABEL-SET CENSUS — confounds that move F1 for reasons other than phrasing");
  console.log(
    "Read this before section [1]. Nothing here is a finding about phrasing; it is the",
  );
  console.log("list of ways the two label sets differ in kind rather than in wording.");
  console.log("");
  console.log(
    `  ${pad("case", 7)}${pad("labels", 9)}${pad("labeled", 9)}${pad("in-scope", 10)}${pad("OOS", 6)}` +
      `${pad("date_conf (exact/approx/inferred)", 36)}${pad("src_doc w/o .pdf", 18)}tie-break-eligible`,
  );
  for (const c of cases) {
    for (const which of WHICH) {
      const gt = c.gt[which];
      const inScope = gt.filter((g) => g.in_scope);
      const conf = (k: string): number => gt.filter((g) => g.date_confidence === k).length;
      const noSuffix = gt.filter((g) => !/\.pdf$/i.test(g.source_document)).length;
      // How many (prediction, in-scope GT) pairs the same-document tie-break can
      // even see: pairs where the strings compare equal at all.
      let tieBreakEligible = 0;
      for (const p of c.predicted) {
        for (const g of inScope) {
          if (g.source_document === p.source.document_id) tieBreakEligible++;
        }
      }
      console.log(
        `  ${pad(c.caseId, 7)}${pad(which, 9)}${padL(String(gt.length), 4)}     ` +
          `${padL(String(inScope.length), 5)}     ${padL(String(gt.length - inScope.length), 3)}   ` +
          `${pad(`${conf("exact")} / ${conf("approximate")} / ${conf("inferred")}`, 36)}` +
          `${padL(String(noSuffix), 8)}          ${padL(String(tieBreakEligible), 6)}`,
      );
    }
  }
  console.log("");
  console.log(
    "  in-scope is the FN denominator. OOS differences move recall on their own.",
  );
  console.log(
    "  tie-break-eligible counts (prediction, in-scope GT) pairs whose source_document",
  );
  console.log(
    "  string equals the prediction's document_id. lib/eval.ts sorts same-document",
  );
  console.log(
    "  candidates first; at 0 the tie-break is inert and array order decides instead.",
  );
}

// ---------------------------------------------------------------------------
// [1] Aggregate scores.
// ---------------------------------------------------------------------------
interface Aggregate {
  macroF1: Record<Which, number>;
  micro: Record<Which, { tp: number; fp: number; fn: number }>;
}

function sectionAggregate(cases: LoadedCase[]): Record<Tier, Aggregate> {
  head("[1] AGGREGATE — cached predictions scored against each label set");
  console.log("Same predictions, same lib/eval.ts evaluate(). Only the labels differ.");

  const out = {} as Record<Tier, Aggregate>;

  for (const tier of TIERS) {
    console.log("");
    console.log(`  tier = ${tier}`);
    console.log(
      `    ${pad("case", 8)}${pad("label set", 11)}${pad("counts", 16)}` +
        `${pad("P", 8)}${pad("R", 8)}${pad("F1", 8)}Δ F1 (blind − original)`,
    );
    const macro = { original: [] as number[], blind: [] as number[] };
    const micro = {
      original: { tp: 0, fp: 0, fn: 0 },
      blind: { tp: 0, fp: 0, fn: 0 },
    };

    for (const c of cases) {
      const res: Record<Which, TierResult> = {
        original: evaluate(c.predicted, c.gt.original, tier),
        blind: evaluate(c.predicted, c.gt.blind, tier),
      };
      for (const which of WHICH) {
        const r = res[which];
        macro[which].push(r.f1);
        micro[which].tp += r.tp;
        micro[which].fp += r.fp;
        micro[which].fn += r.fn;
        const delta = which === "blind" ? signed(res.blind.f1 - res.original.f1) : "";
        console.log(
          `    ${pad(c.caseId, 8)}${pad(which, 11)}${pad(counts(r), 16)}` +
            `${pad(f2(r.precision), 8)}${pad(f2(r.recall), 8)}${pad(f2(r.f1), 8)}${delta}`,
        );
      }
    }

    const macroO = mean(macro.original);
    const macroB = mean(macro.blind);
    const microO = f1From(micro.original.tp, micro.original.fp, micro.original.fn);
    const microB = f1From(micro.blind.tp, micro.blind.fp, micro.blind.fn);

    console.log("");
    console.log(
      `    macro-mean F1   original ${f3(macroO)}   blind ${f3(macroB)}   Δ ${signed(macroB - macroO)}`,
    );
    console.log(
      `    micro           original ${f3(microO.f1)} (tp${micro.original.tp}/fp${micro.original.fp}/fn${micro.original.fn})` +
        `   blind ${f3(microB.f1)} (tp${micro.blind.tp}/fp${micro.blind.fp}/fn${micro.blind.fn})` +
        `   Δ ${signed(microB.f1 - microO.f1)}`,
    );

    out[tier] = {
      macroF1: { original: macroO, blind: macroB },
      micro: { original: micro.original, blind: micro.blind },
    };
  }

  return out;
}

// ---------------------------------------------------------------------------
// [2] Per-event-type breakdown.
// ---------------------------------------------------------------------------
function sectionByType(cases: LoadedCase[]): void {
  head("[2] PER-EVENT-TYPE — micro across the requested cases, per label set");
  console.log(
    "n_gt is that label set's in-scope count for the type, so it moves with the labels;",
  );
  console.log("an F1 delta on a type whose n_gt also moved is not a like-for-like comparison.");

  for (const tier of TIERS) {
    console.log("");
    console.log(`  tier = ${tier}`);
    console.log(
      `    ${pad("type", 12)}${pad("n_gt orig", 11)}${pad("n_gt blind", 12)}` +
        `${pad("orig counts", 15)}${pad("orig F1", 9)}${pad("blind counts", 15)}${pad("blind F1", 10)}Δ F1`,
    );

    for (const t of ALL_EVENT_TYPES) {
      const acc: Record<Which, { tp: number; fp: number; fn: number; n_gt: number }> = {
        original: { tp: 0, fp: 0, fn: 0, n_gt: 0 },
        blind: { tp: 0, fp: 0, fn: 0, n_gt: 0 },
      };
      for (const c of cases) {
        for (const which of WHICH) {
          const bd = breakdown(c.predicted, c.gt[which], tier)[t];
          acc[which].tp += bd.tp;
          acc[which].fp += bd.fp;
          acc[which].fn += bd.fn;
          acc[which].n_gt += bd.n_gt;
        }
      }
      const o = f1From(acc.original.tp, acc.original.fp, acc.original.fn);
      const b = f1From(acc.blind.tp, acc.blind.fp, acc.blind.fn);
      const oc = `tp${acc.original.tp}/fp${acc.original.fp}/fn${acc.original.fn}`;
      const bc = `tp${acc.blind.tp}/fp${acc.blind.fp}/fn${acc.blind.fn}`;
      console.log(
        `    ${pad(t, 12)}${padL(String(acc.original.n_gt), 6)}     ${padL(String(acc.blind.n_gt), 6)}      ` +
          `${pad(oc, 15)}${pad(f2(o.f1), 9)}${pad(bc, 15)}${pad(f2(b.f1), 10)}${signed(b.f1 - o.f1)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// [3] Title-overlap distribution — the mechanism §7 identified, measured under
// each label set. Mirror-derived (continuous values); see the mirror note.
// ---------------------------------------------------------------------------
function sectionOverlap(cases: LoadedCase[]): void {
  head("[3] TITLE-OVERLAP DISTRIBUTION — best same-type candidate per in-scope GT event");
  console.log(
    "overlap(A,B) = |A∩B| / max(|A|,|B|) over token SETS; the production gate needs >= 0.50.",
  );
  console.log(
    "Values below are mirror-derived (lib/eval.ts keeps these helpers module-private).",
  );

  // Explicit predicates rather than range arithmetic: the two endpoints (no
  // shared token at all, and identical token sets) are the interesting ones and
  // must not be folded into a neighbouring band.
  const bands: Array<{ label: string; hit: (v: number) => boolean }> = [
    { label: "0.000 (no shared token)", hit: (v) => v === 0 },
    { label: "(0.00, 0.25)", hit: (v) => v > 0 && v < 0.25 },
    { label: "[0.25, 0.40)", hit: (v) => v >= 0.25 && v < 0.4 },
    { label: "[0.40, 0.50) just below the gate", hit: (v) => v >= 0.4 && v < 0.5 },
    { label: "[0.50, 0.75)", hit: (v) => v >= 0.5 && v < 0.75 },
    { label: "[0.75, 1.00)", hit: (v) => v >= 0.75 && v < 1 },
    { label: "1.000 (identical token set)", hit: (v) => v === 1 },
  ];

  for (const which of WHICH) {
    const all: number[] = [];
    let noCandidate = 0;
    let inScopeTotal = 0;
    for (const c of cases) {
      for (const g of c.gt[which]) {
        if (!g.in_scope) continue;
        inScopeTotal++;
        const ov = bestOverlap(g, c.predicted);
        if (Number.isNaN(ov)) noCandidate++;
        else all.push(ov);
      }
    }
    console.log("");
    console.log(
      `  ${which}: ${inScopeTotal} in-scope GT events, of which ${noCandidate} have NO prediction of ` +
        `their event_type (excluded from the bands — that is the 'type' cause, not an overlap failure)`,
    );
    console.log(
      `    n=${all.length} scored   median ${f3(median(all))}   mean ${f3(mean(all))}   ` +
        `min ${f3(all.length ? Math.min(...all) : NaN)}   max ${f3(all.length ? Math.max(...all) : NaN)}`,
    );
    let banded = 0;
    for (const b of bands) {
      const n = all.filter(b.hit).length;
      banded += n;
      console.log(`    ${pad(b.label, 34)}${padL(String(n), 4)}  ${padL(pct(n, all.length), 7)}`);
    }
    if (banded !== all.length) {
      console.log(`    !! bands cover ${banded} of ${all.length} values — band predicates are wrong`);
    }
    console.log(
      `    ${pad("clears the 0.50 gate", 34)}${padL(String(all.filter((v) => v >= 0.5).length), 4)}  ${padL(pct(all.filter((v) => v >= 0.5).length, all.length), 7)}`,
    );
  }

  console.log("");
  console.log("  Title identity among MATCHED pairs (tier=strict):");
  console.log(
    `    ${pad("label set", 11)}${pad("matched", 9)}${pad("byte-identical", 16)}${pad("normalized-equal", 18)}identical token set`,
  );
  for (const which of WHICH) {
    let n = 0;
    let exact = 0;
    let norm = 0;
    let tok = 0;
    for (const c of cases) {
      for (const { pred, gt } of greedyPairs(c.predicted, c.gt[which], "strict").pairs) {
        n++;
        if (pred.title === gt.title) exact++;
        if (normalize(pred.title).toLowerCase() === normalize(gt.title).toLowerCase()) norm++;
        if (titleOverlap(pred.title, gt.title) === 1) tok++;
      }
    }
    console.log(
      `    ${pad(which, 11)}${padL(String(n), 4)}     ` +
        `${pad(`${exact} (${pct(exact, n)})`, 16)}${pad(`${norm} (${pct(norm, n)})`, 18)}${tok} (${pct(tok, n)})`,
    );
  }
}

// ---------------------------------------------------------------------------
// [4] Match-status change.
//
// Two censuses, because they answer different questions and only one of them
// needs an alignment:
//   (a) prediction-level, alignment-free. A prediction is the SAME object under
//       both scorings, so "did prediction i match" is comparable without any
//       assumption. This is the number to trust.
//   (b) GT-level, aligned on (event_type, date, source_document-canonical) —
//       the objective fields — so that the subjective field (title) is what
//       varies. Events with no counterpart are reported, never dropped.
// ---------------------------------------------------------------------------
interface AlignedPair {
  orig: GtEvent;
  blind: GtEvent;
}

interface Alignment {
  pairs: AlignedPair[];
  origOnly: GtEvent[];
  blindOnly: GtEvent[];
  ambiguousKeys: number;
}

function alignmentKey(g: GtEvent): string {
  return `${g.event_type}|${g.date}|${docCanon(g.source_document)}`;
}

function alignGt(orig: GtEvent[], blind: GtEvent[]): Alignment {
  const group = (xs: GtEvent[]): Map<string, GtEvent[]> => {
    const m = new Map<string, GtEvent[]>();
    for (const g of xs) {
      const k = alignmentKey(g);
      const arr = m.get(k) ?? [];
      arr.push(g);
      m.set(k, arr);
    }
    return m;
  };
  const go = group(orig.filter((g) => g.in_scope));
  const gb = group(blind.filter((g) => g.in_scope));

  const pairs: AlignedPair[] = [];
  const origOnly: GtEvent[] = [];
  const blindOnly: GtEvent[] = [];
  let ambiguousKeys = 0;

  for (const k of [...new Set([...go.keys(), ...gb.keys()])].sort()) {
    const a = go.get(k) ?? [];
    const b = gb.get(k) ?? [];
    if (a.length > 1 || b.length > 1) ambiguousKeys++;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) pairs.push({ orig: a[i], blind: b[i] });
    for (let i = n; i < a.length; i++) origOnly.push(a[i]);
    for (let i = n; i < b.length; i++) blindOnly.push(b[i]);
  }

  return { pairs, origOnly, blindOnly, ambiguousKeys };
}

interface LostRecord {
  caseId: CaseId;
  tier: Tier;
  blind: GtEvent;
  orig: GtEvent;
  cause: Cause;
}

function sectionStatusChange(cases: LoadedCase[]): LostRecord[] {
  head("[4] MATCH-STATUS CHANGE — what stopped matching, and what started");
  const lost: LostRecord[] = [];

  console.log("");
  console.log("  (a) prediction-level, alignment-free — the same prediction object under both");
  console.log("      scorings. 'lost' = matched under original, unmatched under blind.");
  console.log("");
  console.log(
    `    ${pad("case", 8)}${pad("tier", 8)}${pad("n_pred", 8)}${pad("matched orig", 14)}${pad("matched blind", 15)}${pad("lost", 7)}gained`,
  );
  for (const c of cases) {
    for (const tier of TIERS) {
      const o = greedyPairs(c.predicted, c.gt.original, tier).matchedPredIdx;
      const b = greedyPairs(c.predicted, c.gt.blind, tier).matchedPredIdx;
      const lostN = [...o].filter((i) => !b.has(i)).length;
      const gainedN = [...b].filter((i) => !o.has(i)).length;
      console.log(
        `    ${pad(c.caseId, 8)}${pad(tier, 8)}${padL(String(c.predicted.length), 4)}    ` +
          `${padL(String(o.size), 8)}      ${padL(String(b.size), 8)}       ${padL(String(lostN), 4)}   ${gainedN}`,
      );
    }
  }

  console.log("");
  console.log("  (b) GT-level, aligned on (event_type, date, source_document) — the objective");
  console.log("      fields — so the title is what varies. Unaligned events are listed, not");
  console.log("      dropped: they are labeling-granularity or date differences, not phrasing.");
  console.log("");
  console.log(
    `    ${pad("case", 8)}${pad("tier", 8)}${pad("aligned", 9)}${pad("orig-only", 11)}${pad("blind-only", 12)}${pad("lost", 7)}${pad("gained", 8)}ambiguous keys`,
  );
  for (const c of cases) {
    const al = alignGt(c.gt.original, c.gt.blind);
    for (const tier of TIERS) {
      const oMatched = greedyPairs(c.predicted, c.gt.original, tier).matchedGtIds;
      const bMatched = greedyPairs(c.predicted, c.gt.blind, tier).matchedGtIds;
      let lostN = 0;
      let gainedN = 0;
      for (const p of al.pairs) {
        const wasMatched = oMatched.has(p.orig.id);
        const isMatched = bMatched.has(p.blind.id);
        if (wasMatched && !isMatched) {
          lostN++;
          lost.push({
            caseId: c.caseId,
            tier,
            blind: p.blind,
            orig: p.orig,
            cause: attribute(p.blind, c.predicted, tier),
          });
        }
        if (!wasMatched && isMatched) gainedN++;
      }
      console.log(
        `    ${pad(c.caseId, 8)}${pad(tier, 8)}${padL(String(al.pairs.length), 5)}    ` +
          `${padL(String(al.origOnly.length), 6)}     ${padL(String(al.blindOnly.length), 6)}      ` +
          `${padL(String(lostN), 4)}   ${pad(String(gainedN), 8)}${al.ambiguousKeys}`,
      );
    }
  }
  console.log("");
  console.log(
    "  orig-only / blind-only are in-scope GT events with no counterpart at the same",
  );
  console.log(
    "  (type, date, document). They are a real difference between the label sets, but",
  );
  console.log("  not one this experiment attributes to phrasing. ambiguous keys = keys holding");
  console.log("  more than one event on a side; those are paired in file order.");

  return lost;
}

// ---------------------------------------------------------------------------
// [5] Attribution.
// ---------------------------------------------------------------------------
function sectionAttribution(cases: LoadedCase[], lost: LostRecord[]): void {
  head("[5] FAILURE-CAUSE ATTRIBUTION — the four causes docs/EVAL.md §7 uses");
  console.log(
    "type = no prediction of that event_type · date = none inside the tier's tolerance ·",
  );
  console.log(
    "overlap = same-type in-date candidates exist, none reaches 0.50 · contention = a",
  );
  console.log("qualifying candidate existed but greedy 1-1 gave it to another GT event.");

  console.log("");
  console.log("  (a) every unmatched in-scope GT event, under each label set");
  console.log("");
  console.log(
    `    ${pad("case", 8)}${pad("tier", 8)}${pad("label set", 11)}${pad("unmatched", 11)}` +
      CAUSES.map((c) => pad(c, 12)).join(""),
  );
  for (const c of cases) {
    for (const tier of TIERS) {
      for (const which of WHICH) {
        const { unmatchedGt } = greedyPairs(c.predicted, c.gt[which], tier);
        const tally = new Map<Cause, number>(CAUSES.map((x) => [x, 0]));
        for (const g of unmatchedGt) {
          const cause = attribute(g, c.predicted, tier);
          tally.set(cause, (tally.get(cause) ?? 0) + 1);
        }
        console.log(
          `    ${pad(c.caseId, 8)}${pad(tier, 8)}${pad(which, 11)}${padL(String(unmatchedGt.length), 5)}      ` +
            CAUSES.map((x) => padL(String(tally.get(x) ?? 0), 5) + "       ").join(""),
        );
      }
    }
  }

  console.log("");
  console.log("  (b) LOST matches only — aligned GT events that matched under the original");
  console.log("      labels and stopped matching under the blind ones");
  console.log("");
  if (lost.length === 0) {
    console.log("    none — no aligned GT event lost its match under the blind labels");
  } else {
    console.log(
      `    ${pad("case", 8)}${pad("tier", 8)}${pad("cause", 12)}${pad("blind title", 42)}best overlap vs same-type pred`,
    );
    const sorted = [...lost].sort(
      (a, b) =>
        a.caseId.localeCompare(b.caseId) ||
        a.tier.localeCompare(b.tier) ||
        a.blind.id.localeCompare(b.blind.id),
    );
    for (const l of sorted) {
      const c = cases.find((x) => x.caseId === l.caseId);
      const ov = c ? bestOverlap(l.blind, c.predicted) : NaN;
      console.log(
        `    ${pad(l.caseId, 8)}${pad(l.tier, 8)}${pad(l.cause, 12)}${pad(JSON.stringify(l.blind.title).slice(0, 40), 42)}${f3(ov)}`,
      );
    }
    console.log("");
    console.log(
      `    ${pad("tier", 8)}${pad("lost", 7)}` + CAUSES.map((x) => pad(x, 12)).join(""),
    );
    for (const tier of TIERS) {
      const rows = lost.filter((l) => l.tier === tier);
      console.log(
        `    ${pad(tier, 8)}${padL(String(rows.length), 4)}   ` +
          CAUSES.map((x) => padL(String(rows.filter((l) => l.cause === x).length), 5) + "       ").join(
            "",
          ),
      );
    }
  }
}

// ---------------------------------------------------------------------------
function main(): void {
  const raw = process.argv.slice(2);

  // Held-out guard on RAW argv, before flags are filtered — same shape and same
  // reason as scripts/analyze-title-overlap.ts.
  const refuseCase3 = (a: string): boolean =>
    a.replace(/^-+/, "").split("=")[0].toLowerCase() === "case3";
  for (const a of raw) {
    if (refuseCase3(a)) {
      console.error(`${TAG} invalid case '${a}' — this comparison runs on case1/case2 only.`);
      console.error(`${TAG} Case 3 is held out (docs/RESOLVED-DECISIONS.md #10) and is never read here.`);
      process.exit(1);
    }
  }

  const packetFlag = raw.find((a) => a.startsWith("--packet="));
  const packetRoot = resolve(
    process.cwd(),
    packetFlag ? packetFlag.slice("--packet=".length) : DEFAULT_PACKET_ROOT,
  );

  const args = raw.filter((a) => !a.startsWith("--"));
  const ids = args.length > 0 ? args : ALL_CASES;
  for (const a of ids) {
    if (a !== "case1" && a !== "case2") {
      console.error(`${TAG} invalid case '${a}' — this comparison runs on case1/case2 only.`);
      process.exit(1);
    }
  }
  const requested = ids as CaseId[];

  // ---- The not-yet-run gate. Exits 0: "the experiment has not happened" is a
  // state, not an error. -----------------------------------------------------
  const missing: string[] = [];
  const unlabeled: string[] = [];
  for (const caseId of requested) {
    const p = join(packetRoot, caseId, "blind_labels.json");
    if (!existsSync(p)) {
      missing.push(p);
    } else if (isTemplate(loadJson(p))) {
      unlabeled.push(p);
    }
  }
  if (missing.length > 0 || unlabeled.length > 0) {
    console.log(rule("="));
    console.log(`${TAG} nothing to compare yet — the blind relabeling has not been done`);
    console.log(rule("="));
    for (const p of missing) console.log(`  no blind labels at   ${p}`);
    for (const p of unlabeled) console.log(`  still the template   ${p}`);
    console.log("");
    console.log("  This tool measures the delta between the ORIGINAL labels and labels written");
    console.log("  by someone who has not seen the model output (issue #24). Until those blind");
    console.log("  labels exist there is no delta to measure, so it stops here rather than");
    console.log("  reporting a comparison of the original labels with themselves.");
    console.log("");
    console.log("  The sequence is:");
    console.log("    1. npx tsx scripts/make-label-packet.ts        # writes label_packet/<case>/");
    console.log("    2. label label_packet/<case>/blind_labels.json # blind: do not open events.json");
    console.log("    3. npx tsx scripts/validate-blind-labels.ts    # must exit 0");
    console.log("    4. npx tsx scripts/compare-relabel.ts          # this tool");
    console.log("");
    console.log(`${TAG} exit 0 — not an error`);
    return;
  }

  const cases = requested.map((c) => loadCase(c, packetRoot));

  console.log(rule("="));
  console.log(`${TAG} blind relabel rescoring — issue #24, Cases 1+2 only, no network`);
  console.log(rule("="));
  console.log(`  packet root: ${packetRoot}`);
  console.log(
    "  predictions: data/cases/<case>/events.json (cached, read-only — never rewritten here)",
  );
  console.log("  matcher:     lib/eval.ts evaluate() / breakdown() / matchesEvent(), unmodified");
  console.log("  held_out/:   not opened");
  for (const c of cases) {
    console.log(
      `  loaded ${c.caseId}: ${c.predicted.length} predicted · original ${c.gt.original.length} labels ` +
        `(${c.gt.original.filter((g) => g.in_scope).length} in-scope, labeled ${c.labeledAt.original}) · ` +
        `blind ${c.gt.blind.length} labels (${c.gt.blind.filter((g) => g.in_scope).length} in-scope, labeled ${c.labeledAt.blind})`,
    );
  }

  const mc = verifyMirror(cases);
  console.log("");
  console.log(
    `  MIRROR CHECK: local titleTokens/overlap mirror agrees with production matchesEvent on ` +
      `${mc.checked - mc.disagreements.length}/${mc.checked} (prediction, GT, tier) triples.`,
  );
  if (mc.disagreements.length > 0) {
    console.log("  !! MIRROR DISAGREES — every mirror-derived number below is untrustworthy:");
    for (const d of mc.disagreements) console.log(`     ${d}`);
  }
  console.log(
    "    (boolean-only check with a known blind spot — see the mirror note in this file",
  );
  console.log("     and docs/EVAL.md §7; source identity, not this check, is the fidelity claim)");

  const pairingOk = cases.every((c) =>
    WHICH.every((w) => TIERS.every((t) => pairingAgrees(c.predicted, c.gt[w], t))),
  );
  console.log(
    `  PAIRING CHECK: greedy-pair mirror reproduces production evaluate() tp and fn on all ` +
      `${cases.length * WHICH.length * TIERS.length} (case, label set, tier) combinations: ${pairingOk ? "PASS" : "FAIL"}`,
  );

  sectionCensus(cases);
  sectionAggregate(cases);
  sectionByType(cases);
  sectionOverlap(cases);
  const lost = sectionStatusChange(cases);
  sectionAttribution(cases, lost);

  console.log("");
  console.log(rule("="));
  console.log(`${TAG} done — diagnostic only, no gate, exit 0`);
  console.log(rule("="));
}

main();

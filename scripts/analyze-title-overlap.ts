/**
 * scripts/analyze-title-overlap.ts — diagnostic for the title token-overlap
 * gate in `lib/eval.ts` (issue #22).
 *
 * DIAGNOSTIC, NOT A GATE. Always exits 0 on findings; never wired into CI.
 *
 * Reads only the cached dev cases (`data/cases/case1`, `data/cases/case2`) —
 * predictions from `events.json`, labels from `ground_truth.json`. No network,
 * no model calls, and NOTHING under `held_out/` is opened. Case 3 is a
 * terminal, unrecoverable held-out budget (docs/RESOLVED-DECISIONS.md #10) and
 * every question this script answers is answerable on Cases 1+2.
 *
 * What it measures, for Cases 1+2, per event_type and in aggregate:
 *   [1] title-identity rate of matched GT/prediction pairs (exact / normalized
 *       / token-set), i.e. how tautological the dev metric is by construction;
 *   [2] the overlap distribution of best same-type candidate pairs and how
 *       close they sit to the 0.5 cliff;
 *   [3] the structural ceiling — pairs whose token-set sizes differ by more
 *       than 2x can never reach 0.5 because the denominator is max(|A|,|B|);
 *   [4] a terseness perturbation study — shorten GT titles toward a head-noun
 *       form and recompute strict/loose P/R/F1 with the production evaluate();
 *   [5] failure-cause attribution for every unmatched in-scope GT event at
 *       each perturbation level (type / date / overlap / contention).
 *
 * Usage:
 *   npx tsx scripts/analyze-title-overlap.ts
 *   npx tsx scripts/analyze-title-overlap.ts case1
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { evaluate, breakdown, matchesEvent, type GtEvent, type Tier } from "../lib/eval";
import { normalize } from "../lib/normalize";
import {
  CaseFixtureSchema,
  EventTypeSchema,
  DateConfidenceSchema,
  type EventType,
  type TimelineEvent,
} from "../lib/schema";

const TAG = "[title-overlap]";

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
const DAY_MS = 86_400_000;
const THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// LOCAL MIRROR of two lib/eval.ts leaf helpers.
//
// `titleTokens` and `overlap` are module-private in lib/eval.ts. Exporting them
// would mean modifying lib/eval.ts, which this slice is forbidden to do (the
// file must come out byte-identical), so they are reproduced verbatim here.
//
// THESE ARE A MIRROR, NOT THE PRODUCTION FUNCTIONS. Everything that decides a
// match in this script goes through the real exported `matchesEvent` /
// `evaluate` / `breakdown`; the mirror is used only to *report* intermediate
// numbers the production API does not return.
//
// WHY THE MIRROR CAN BE TRUSTED: source identity, not agreement on dev. The two
// function bodies below are byte-identical to lib/eval.ts's after renaming
// (`titleTokensMirror` -> `titleTokens`, `overlapMirror` -> `overlap`): the
// renamed 11-line block hashes to sha256 e928483d…c5da, the same as lib/eval.ts
// lines 50-60. That makes them equivalent on ALL inputs, not just these
// fixtures. If lib/eval.ts ever changes, re-check that hash — it is the
// reliable desync detector, NOT the runtime self-check below.
//
// `verifyMirror()` below is a tripwire, not the proof. See the comment there
// for the blind spot it is known to have.
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

/** Production tokenization, order-preserving and de-duplicated. */
function orderedTokens(s: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of s.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
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

interface LoadedCase {
  caseId: CaseId;
  predicted: TimelineEvent[];
  gt: GtEvent[];
}

function loadCase(caseId: CaseId): LoadedCase {
  const caseDir = join(process.cwd(), "data", "cases", caseId);
  const eventsPath = join(caseDir, "events.json");
  const gtPath = join(caseDir, "ground_truth.json");

  if (!existsSync(eventsPath) || !existsSync(gtPath)) {
    console.error(`${TAG} ${caseId}: missing events.json or ground_truth.json under ${caseDir}`);
    process.exit(1);
  }

  const fixture = CaseFixtureSchema.safeParse(JSON.parse(readFileSync(eventsPath, "utf8")));
  if (!fixture.success) {
    console.error(`${TAG} ${caseId}: events.json schema invalid`);
    process.exit(1);
  }
  const gtFile = GtFileSchema.safeParse(JSON.parse(readFileSync(gtPath, "utf8")));
  if (!gtFile.success) {
    console.error(`${TAG} ${caseId}: ground_truth.json schema invalid`);
    process.exit(1);
  }

  return { caseId, predicted: fixture.data.events, gt: gtFile.data.events };
}

// ---------------------------------------------------------------------------
// Mirror verification: for EVERY (prediction, GT) pair in the loaded cases, the
// production predicate must equal type-equality AND mirror-overlap >= 0.5 AND
// date-within-tier. Any disagreement invalidates every mirror-derived number in
// this report, and is printed loudly.
//
// KNOWN BLIND SPOT — do not cite the 596/596 result as proof of mirror
// fidelity. This compares only the `>= 0.5` BOOLEAN, whereas sections [1]-[3]
// report the mirror's CONTINUOUS overlap values. Fault injection, on these
// fixtures:
//
//   mirror loses .toLowerCase()      -> CAUGHT      (590/596)
//   mirror denominator max -> min    -> NOT CAUGHT  (596/596 still passes,
//                                       while the continuous values shift —
//                                       e.g. identical-token-set rate among
//                                       matched pairs 57.9% -> 73.7%)
//   threshold 0.5 -> 0.4             -> NOT CAUGHT  (no type-and-date
//                                       qualifying pair lies in [0.4, 0.5),
//                                       so the boolean never moves)
//
// i.e. this check cannot discriminate the max-vs-min denominator property that
// the report's whole mechanism argument rests on. It catches gross tokenizer
// divergence and nothing subtler. The fidelity argument is the source-identity
// hash documented at the mirror definition above.
// ---------------------------------------------------------------------------
interface MirrorCheck {
  pairsChecked: number;
  disagreements: string[];
}

function verifyMirror(cases: LoadedCase[]): MirrorCheck {
  const disagreements: string[] = [];
  let pairsChecked = 0;
  for (const c of cases) {
    for (const p of c.predicted) {
      for (const g of c.gt) {
        for (const tier of ["strict", "loose"] as Tier[]) {
          const prod = matchesEvent(p, g, tier);
          const mirrored =
            p.event_type === g.event_type &&
            titleOverlap(p.title, g.title) >= THRESHOLD &&
            withinTier(dayDiff(p.date, g.date), tier);
          pairsChecked++;
          if (prod !== mirrored) {
            disagreements.push(
              `${c.caseId} ${tier} pred="${p.title}" gt=${g.id} prod=${prod} mirror=${mirrored}`,
            );
          }
        }
      }
    }
  }
  return { pairsChecked, disagreements };
}

// ---------------------------------------------------------------------------
// Greedy 1-1 pairing, mirroring the loop inside lib/eval.ts `evaluate()` so the
// PAIRS can be recovered (evaluate() returns only counts). The match predicate
// itself is the production `matchesEvent`. `assertPairingAgrees` below checks
// this mirror reproduces evaluate()'s tp/fn exactly.
// ---------------------------------------------------------------------------
interface Pairing {
  pairs: Array<{ pred: TimelineEvent; gt: GtEvent }>;
  unmatchedGt: GtEvent[];
}

function greedyPairs(predicted: TimelineEvent[], gt: GtEvent[], tier: Tier): Pairing {
  const inScopeGt = gt.filter((g) => g.in_scope);
  const matchedGt = new Set<string>();
  const pairs: Array<{ pred: TimelineEvent; gt: GtEvent }> = [];

  for (const p of predicted) {
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
      pairs.push({ pred: p, gt: candidates[0] });
    }
  }

  return { pairs, unmatchedGt: inScopeGt.filter((g) => !matchedGt.has(g.id)) };
}

function pairingAgrees(predicted: TimelineEvent[], gt: GtEvent[], tier: Tier): boolean {
  const prod = evaluate(predicted, gt, tier);
  const mine = greedyPairs(predicted, gt, tier);
  return prod.tp === mine.pairs.length && prod.fn === mine.unmatchedGt.length;
}

// ---------------------------------------------------------------------------
// Perturbation: shorten GT titles toward a head-noun form.
//
//   prefix-k  keep the first k unique production tokens of the GT title, in
//             order. Naive terseness — conflates two effects: fewer tokens
//             (which lowers the ceiling) AND possibly dropping the tokens that
//             actually matched.
//   oracle-k  keep the k tokens that maximize the intersection with that GT
//             event's best same-type candidate prediction (computed once, at
//             k=all). An UPPER BOUND on any k-token rephrasing drawn from the
//             GT title's own vocabulary — it isolates the max()-denominator
//             ceiling from the "dropped the matching words" confound.
// ---------------------------------------------------------------------------
type Policy = "prefix" | "oracle";
type Level = number | "all";
const LEVELS: Level[] = ["all", 4, 3, 2, 1];

function perturbTitle(
  gt: GtEvent,
  level: Level,
  policy: Policy,
  keepPreference: Set<string>,
): string {
  const toks = orderedTokens(gt.title);
  if (level === "all" || toks.length <= level) return gt.title;
  if (policy === "prefix") return toks.slice(0, level).join(" ");
  const preferred = toks.filter((t) => keepPreference.has(t));
  const rest = toks.filter((t) => !keepPreference.has(t));
  return [...preferred, ...rest].slice(0, level).join(" ");
}

/** GT ids are only unique within a case (both cases start at `gt_001`), so the
 * oracle keep-preference map is keyed `<caseId>::<gtId>`. */
function keepKey(caseId: CaseId, gtId: string): string {
  return `${caseId}::${gtId}`;
}

function perturbGt(
  caseId: CaseId,
  gt: GtEvent[],
  level: Level,
  policy: Policy,
  keepPreference: Map<string, Set<string>>,
): GtEvent[] {
  return gt.map((g) => ({
    ...g,
    title: perturbTitle(
      g,
      level,
      policy,
      keepPreference.get(keepKey(caseId, g.id)) ?? new Set<string>(),
    ),
  }));
}

// ---------------------------------------------------------------------------
// Best same-type candidate for a GT event (max overlap, tie-break nearer date,
// then array order). Used for the overlap distribution, the structural-ceiling
// count, and to seed the oracle keep-preference.
// ---------------------------------------------------------------------------
interface BestCandidate {
  gt: GtEvent;
  pred: TimelineEvent | null;
  overlap: number;
  dateDiff: number;
}

function bestCandidate(gt: GtEvent, predicted: TimelineEvent[]): BestCandidate {
  let best: TimelineEvent | null = null;
  let bestOv = -1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const p of predicted) {
    if (p.event_type !== gt.event_type) continue;
    const ov = titleOverlap(p.title, gt.title);
    const dd = dayDiff(p.date, gt.date);
    if (ov > bestOv || (ov === bestOv && dd < bestDiff)) {
      best = p;
      bestOv = ov;
      bestDiff = dd;
    }
  }
  return { gt, pred: best, overlap: best ? bestOv : 0, dateDiff: best ? bestDiff : NaN };
}

// ---------------------------------------------------------------------------
// Failure attribution for one unmatched in-scope GT event.
// ---------------------------------------------------------------------------
type Cause = "type" | "date" | "overlap" | "contention";

function attribute(gt: GtEvent, predicted: TimelineEvent[], tier: Tier): Cause {
  if (predicted.some((p) => matchesEvent(p, gt, tier))) return "contention";
  const sameType = predicted.filter((p) => p.event_type === gt.event_type);
  if (sameType.length === 0) return "type";
  const inDate = sameType.filter((p) => withinTier(dayDiff(p.date, gt.date), tier));
  if (inDate.length === 0) return "date";
  return "overlap";
}

// ---------------------------------------------------------------------------
// Small formatting helpers.
// ---------------------------------------------------------------------------
function f2(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : "—";
}

function f3(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : "—";
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

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function padL(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

function rule(ch = "-", n = 96): string {
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

// ---------------------------------------------------------------------------
// Section 1 — title identity of matched pairs.
// ---------------------------------------------------------------------------
type IdentityRow = {
  key: string;
  n: number;
  exact: number;
  normalized: number;
  tokenSet: number;
};

function normKey(s: string): string {
  return normalize(s).toLowerCase();
}

function sectionIdentity(cases: LoadedCase[]): void {
  head("[1] TITLE-IDENTITY RATE of matched GT/prediction pairs (tier=strict, k=all)");
  console.log(
    "exact = byte-identical strings · norm = equal after NFKC+whitespace-collapse+lowercase",
  );
  console.log("token = identical production token SETS (i.e. overlap == 1.000)");
  console.log("");

  const byType = new Map<string, IdentityRow>();
  const rows: string[] = [];
  let total = 0;
  let exactAll = 0;
  let normAll = 0;
  let tokAll = 0;

  for (const c of cases) {
    const { pairs } = greedyPairs(c.predicted, c.gt, "strict");
    for (const { pred, gt } of pairs) {
      const isExact = pred.title === gt.title;
      const isNorm = normKey(pred.title) === normKey(gt.title);
      const ov = titleOverlap(pred.title, gt.title);
      const isTok = ov === 1;
      total++;
      if (isExact) exactAll++;
      if (isNorm) normAll++;
      if (isTok) tokAll++;

      const row = byType.get(gt.event_type) ?? {
        key: gt.event_type,
        n: 0,
        exact: 0,
        normalized: 0,
        tokenSet: 0,
      };
      row.n++;
      if (isExact) row.exact++;
      if (isNorm) row.normalized++;
      if (isTok) row.tokenSet++;
      byType.set(gt.event_type, row);

      const flag = isExact ? "EXACT" : isNorm ? "norm " : isTok ? "tokEq" : "     ";
      rows.push(
        `  ${pad(c.caseId, 6)} ${pad(gt.event_type, 11)} ${flag} ov=${f3(ov)}  ` +
          `GT="${gt.title}"` +
          (isExact ? "" : `  PRED="${pred.title}"`),
      );
    }
  }

  console.log(`  ${pad("event_type", 12)}${padL("pairs", 6)}${padL("exact", 8)}${padL("norm", 8)}${padL("tokenSet", 10)}`);
  console.log(`  ${rule("-", 44)}`);
  for (const t of ALL_EVENT_TYPES) {
    const r = byType.get(t);
    if (!r) continue;
    console.log(
      `  ${pad(t, 12)}${padL(String(r.n), 6)}${padL(pct(r.exact, r.n), 8)}` +
        `${padL(pct(r.normalized, r.n), 8)}${padL(pct(r.tokenSet, r.n), 10)}`,
    );
  }
  console.log(`  ${rule("-", 44)}`);
  console.log(
    `  ${pad("ALL", 12)}${padL(String(total), 6)}${padL(pct(exactAll, total), 8)}` +
      `${padL(pct(normAll, total), 8)}${padL(pct(tokAll, total), 10)}`,
  );
  console.log("");
  console.log("  per-pair detail:");
  for (const r of rows) console.log(r);
}

// ---------------------------------------------------------------------------
// Section 2 — overlap distribution of best same-type candidate pairs.
// ---------------------------------------------------------------------------
function sectionDistribution(cases: LoadedCase[]): BestCandidate[] {
  head("[2] OVERLAP DISTRIBUTION — best same-type candidate per in-scope GT event");
  console.log("gtTok/prTok = production token-SET sizes · margin = overlap - 0.5 (the cliff)");
  console.log("");

  const all: BestCandidate[] = [];
  for (const c of cases) {
    for (const g of c.gt.filter((x) => x.in_scope)) {
      all.push(bestCandidate(g, c.predicted));
    }
  }

  console.log(
    `  ${pad("case", 6)}${pad("gt", 8)}${pad("event_type", 12)}${padL("gtTok", 6)}${padL("prTok", 6)}` +
      `${padL("overlap", 9)}${padL("margin", 9)}${padL("dayDiff", 9)}  title`,
  );
  console.log(`  ${rule("-", 92)}`);
  let ci = 0;
  for (const c of cases) {
    for (const g of c.gt.filter((x) => x.in_scope)) {
      const bc = all[ci++];
      const gtTok = titleTokensMirror(g.title).size;
      const prTok = bc.pred ? titleTokensMirror(bc.pred.title).size : 0;
      console.log(
        `  ${pad(c.caseId, 6)}${pad(g.id, 8)}${pad(g.event_type, 12)}${padL(String(gtTok), 6)}` +
          `${padL(bc.pred ? String(prTok) : "—", 6)}${padL(f3(bc.overlap), 9)}` +
          `${padL((bc.overlap - THRESHOLD >= 0 ? "+" : "") + f3(bc.overlap - THRESHOLD), 9)}` +
          `${padL(Number.isFinite(bc.dateDiff) ? String(bc.dateDiff) : "—", 9)}  "${g.title}"`,
      );
    }
  }

  const withCand = all.filter((b) => b.pred !== null);
  const ovs = withCand.map((b) => b.overlap);
  console.log("");
  console.log(
    `  aggregate over ${withCand.length} GT events that HAVE a same-type candidate ` +
      `(${all.length - withCand.length} have none):`,
  );
  console.log(
    `    min=${f3(Math.min(...ovs))}  median=${f3(median(ovs))}  max=${f3(Math.max(...ovs))}  ` +
      `mean=${f3(ovs.reduce((a, b) => a + b, 0) / ovs.length)}`,
  );
  console.log(
    `    at/above 0.5: ${ovs.filter((o) => o >= THRESHOLD).length}/${ovs.length}  ` +
      `· exactly 1.000: ${ovs.filter((o) => o === 1).length}/${ovs.length}  ` +
      `· in [0.5,0.7) i.e. within 0.2 of the cliff: ${ovs.filter((o) => o >= 0.5 && o < 0.7).length}`,
  );

  console.log("");
  console.log("  per event_type (best-candidate overlap):");
  console.log(`  ${pad("event_type", 12)}${padL("n", 4)}${padL("min", 8)}${padL("median", 8)}${padL("max", 8)}`);
  console.log(`  ${rule("-", 40)}`);
  for (const t of ALL_EVENT_TYPES) {
    const sub = withCand.filter((b) => b.gt.event_type === t).map((b) => b.overlap);
    if (sub.length === 0) continue;
    console.log(
      `  ${pad(t, 12)}${padL(String(sub.length), 4)}${padL(f3(Math.min(...sub)), 8)}` +
        `${padL(f3(median(sub)), 8)}${padL(f3(Math.max(...sub)), 8)}`,
    );
  }

  // How much of each matched intersection is boilerplate? A GT token is
  // "discriminative" within (case, event_type) when it appears in exactly one
  // GT title of that type; everything else is shared scaffolding. If a pair's
  // intersection contains no discriminative token, the matcher agreed on the
  // template and not on the clinical content.
  console.log("");
  console.log("  boilerplate check — matched pairs (strict) whose token intersection contains");
  console.log("  NO token unique to that GT event within its (case, event_type) group:");
  let boiler = 0;
  let matchedTotal = 0;
  for (const c of cases) {
    const freq = new Map<string, Map<string, number>>();
    for (const g of c.gt.filter((x) => x.in_scope)) {
      const m = freq.get(g.event_type) ?? new Map<string, number>();
      for (const t of titleTokensMirror(g.title)) m.set(t, (m.get(t) ?? 0) + 1);
      freq.set(g.event_type, m);
    }
    for (const { pred, gt } of greedyPairs(c.predicted, c.gt, "strict").pairs) {
      matchedTotal++;
      const m = freq.get(gt.event_type) ?? new Map<string, number>();
      const inter = [...titleTokensMirror(gt.title)].filter((t) =>
        titleTokensMirror(pred.title).has(t),
      );
      const discriminative = inter.filter((t) => (m.get(t) ?? 0) === 1);
      if (discriminative.length === 0) {
        boiler++;
        console.log(
          `    ${pad(c.caseId, 6)} ${pad(gt.id, 8)} ${pad(gt.event_type, 11)} ` +
            `shared={${inter.join(",")}}  GT="${gt.title}"  PRED="${pred.title}"`,
        );
      }
    }
  }
  console.log(`    → ${boiler}/${matchedTotal} matched pairs (${pct(boiler, matchedTotal)})`);

  return all;
}

// ---------------------------------------------------------------------------
// Section 3 — structural ceiling.
// ---------------------------------------------------------------------------
function sectionCeiling(cases: LoadedCase[], best: BestCandidate[]): void {
  head("[3] STRUCTURAL CEILING — token-set size ratio > 2 makes overlap >= 0.5 impossible");
  console.log("overlap = |A∩B| / max(|A|,|B|)  =>  overlap <= min(|A|,|B|) / max(|A|,|B|)");
  console.log("");

  let over2 = 0;
  let considered = 0;
  const rows: string[] = [];
  let bi = 0;
  for (const c of cases) {
    for (const g of c.gt.filter((x) => x.in_scope)) {
      const bc = best[bi++];
      if (!bc.pred) continue;
      considered++;
      const a = titleTokensMirror(g.title).size;
      const b = titleTokensMirror(bc.pred.title).size;
      const ratio = Math.max(a, b) / Math.min(a, b);
      const ceiling = Math.min(a, b) / Math.max(a, b);
      if (ratio > 2) {
        over2++;
        rows.push(
          `  ${pad(c.caseId, 6)}${pad(g.id, 8)}${pad(g.event_type, 12)}` +
            `${padL(`${a}/${b}`, 8)}${padL(f2(ratio), 8)}${padL(f3(ceiling), 9)}  ` +
            `GT="${g.title}" PRED="${bc.pred.title}"`,
        );
      }
    }
  }

  console.log(
    `  best-candidate pairs with max/min token ratio > 2: ${over2}/${considered} ` +
      `(${pct(over2, considered)})`,
  );
  if (rows.length > 0) {
    console.log(
      `  ${pad("case", 6)}${pad("gt", 8)}${pad("event_type", 12)}${padL("gt/pr", 8)}${padL("ratio", 8)}${padL("ceiling", 9)}`,
    );
    for (const r of rows) console.log(r);
  }

  // The same ceiling, but stated as "how short can the GT title get before the
  // best candidate becomes unreachable" — this is what the perturbation study
  // below then confirms end-to-end through the production evaluate().
  console.log("");
  console.log("  breaking point per GT event — smallest k where a k-token GT title can still");
  console.log("  reach 0.5 against its best candidate (ceiling k/max(k,prTok) >= 0.5, ORACLE");
  console.log("  token choice, i.e. assuming every kept token is one the prediction has):");
  console.log(`  ${pad("event_type", 12)}${padL("n", 4)}${padL("prTok med", 11)}${padL("min k", 8)}`);
  console.log(`  ${rule("-", 36)}`);
  for (const t of ALL_EVENT_TYPES) {
    const sub = best.filter((b) => b.gt.event_type === t && b.pred !== null);
    if (sub.length === 0) continue;
    const prToks = sub.map((b) => titleTokensMirror(b.pred!.title).size);
    const ks = sub.map((b) => {
      const pr = titleTokensMirror(b.pred!.title).size;
      const gtN = titleTokensMirror(b.gt.title).size;
      const inter = [...titleTokensMirror(b.gt.title)].filter((x) =>
        titleTokensMirror(b.pred!.title).has(x),
      ).length;
      for (let k = 1; k <= gtN; k++) {
        const hit = Math.min(k, inter);
        if (hit / Math.max(k, pr) >= THRESHOLD) return k;
      }
      return NaN;
    });
    const finite = ks.filter((k) => Number.isFinite(k));
    console.log(
      `  ${pad(t, 12)}${padL(String(sub.length), 4)}${padL(f2(median(prToks)), 11)}` +
        `${padL(finite.length ? String(median(finite)) : "unreachable", 8)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Title-blind ceiling: replace EVERY title (both sides) with one constant
// string, so overlap is 1.0 for every pair and the production gate degenerates
// to event_type + date. This is what the extractor scores when phrasing is
// removed from the metric entirely — the upper bound the title gate is
// discounting from, and the honest separator between "wrong event" and
// "right event, different words".
// ---------------------------------------------------------------------------
const BLIND = "x";

function blindPred(events: TimelineEvent[]): TimelineEvent[] {
  return events.map((e) => ({ ...e, title: BLIND }));
}

function blindGt(events: GtEvent[]): GtEvent[] {
  return events.map((e) => ({ ...e, title: BLIND }));
}

function sectionTitleBlind(cases: LoadedCase[]): void {
  console.log("");
  console.log("  TITLE-BLIND CEILING (all titles replaced by one constant ⇒ overlap ≡ 1.0, so the");
  console.log("  production gate reduces to event_type + date). Upper bound on what the title gate");
  console.log("  can cost, and the split between 'wrong event' and 'right event, different words':");
  let sTp = 0;
  let sFp = 0;
  let sFn = 0;
  const f1s: number[] = [];
  for (const c of cases) {
    const real = evaluate(c.predicted, c.gt, "strict");
    const blind = evaluate(blindPred(c.predicted), blindGt(c.gt), "strict");
    f1s.push(blind.f1);
    sTp += blind.tp;
    sFp += blind.fp;
    sFn += blind.fn;
    console.log(
      `    ${pad(c.caseId, 6)} strict F1 with title gate = ${f2(real.f1)} (tp${real.tp}/fp${real.fp}/fn${real.fn})  ` +
        `→ title-blind = ${f2(blind.f1)} (tp${blind.tp}/fp${blind.fp}/fn${blind.fn})  ` +
        `Δ = ${(blind.f1 - real.f1 >= 0 ? "+" : "") + f2(blind.f1 - real.f1)}`,
    );
  }
  console.log(
    `    macro-mean title-blind strict F1 = ${f3(f1s.reduce((a, b) => a + b, 0) / f1s.length)}  ` +
      `· micro tp/fp/fn = ${sTp}/${sFp}/${sFn}`,
  );
  console.log("    per event_type, title-blind strict (tp/fp/fn summed over C1+C2):");
  for (const t of ALL_EVENT_TYPES) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let nGt = 0;
    for (const c of cases) {
      const bd = breakdown(blindPred(c.predicted), blindGt(c.gt), "strict");
      tp += bd[t].tp;
      fp += bd[t].fp;
      fn += bd[t].fn;
      nGt += bd[t].n_gt;
    }
    if (nGt === 0) continue;
    console.log(
      `      ${pad(t, 12)}n_gt=${padL(String(nGt), 2)}  tp/fp/fn=${pad(`${tp}/${fp}/${fn}`, 9)}` +
        `F1=${f2(f1From(tp, fp, fn).f1)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Section 4 — terseness perturbation, scored with the production evaluate().
// ---------------------------------------------------------------------------
interface LevelScore {
  perCase: Map<CaseId, { p: number; r: number; f1: number }>;
  macroF1: number;
  micro: { tp: number; fp: number; fn: number; p: number; r: number; f1: number };
  byType: Map<EventType, { tp: number; fp: number; fn: number; nGt: number; f1: number }>;
}

function scoreLevel(
  cases: LoadedCase[],
  level: Level,
  policy: Policy,
  keep: Map<string, Set<string>>,
  tier: Tier,
): LevelScore {
  const perCase = new Map<CaseId, { p: number; r: number; f1: number }>();
  const byType = new Map<EventType, { tp: number; fp: number; fn: number; nGt: number; f1: number }>();
  let tp = 0;
  let fp = 0;
  let fn = 0;

  for (const t of ALL_EVENT_TYPES) byType.set(t, { tp: 0, fp: 0, fn: 0, nGt: 0, f1: 0 });

  for (const c of cases) {
    const pgt = perturbGt(c.caseId, c.gt, level, policy, keep);
    const r = evaluate(c.predicted, pgt, tier);
    perCase.set(c.caseId, { p: r.precision, r: r.recall, f1: r.f1 });
    tp += r.tp;
    fp += r.fp;
    fn += r.fn;

    const bd = breakdown(c.predicted, pgt, tier);
    for (const t of ALL_EVENT_TYPES) {
      const acc = byType.get(t)!;
      acc.tp += bd[t].tp;
      acc.fp += bd[t].fp;
      acc.fn += bd[t].fn;
      acc.nGt += bd[t].n_gt;
    }
  }

  for (const t of ALL_EVENT_TYPES) {
    const acc = byType.get(t)!;
    acc.f1 = f1From(acc.tp, acc.fp, acc.fn).f1;
  }

  const f1s = [...perCase.values()].map((v) => v.f1);
  return {
    perCase,
    macroF1: f1s.reduce((a, b) => a + b, 0) / (f1s.length || 1),
    micro: { tp, fp, fn, ...f1From(tp, fp, fn) },
    byType,
  };
}

function sectionPerturbation(
  cases: LoadedCase[],
  keep: Map<string, Set<string>>,
): void {
  head("[4] TERSENESS PERTURBATION — GT titles shortened to k tokens, scored by production evaluate()");
  console.log("prefix-k = first k unique GT tokens in order (naive terseness)");
  console.log("oracle-k = the k GT tokens that maximize intersection with the best same-type");
  console.log("           candidate — an UPPER BOUND that isolates the max()-denominator cap");
  console.log("k=all is the unperturbed baseline. Micro = tp/fp/fn summed over C1+C2.");

  // Do the two policies ever disagree? If not, that is itself a result about
  // how the dev titles are phrased and must be stated, not hidden behind two
  // identical tables.
  let diverged = 0;
  let comparisons = 0;
  const divergedRows: string[] = [];
  for (const c of cases) {
    for (const level of LEVELS) {
      const a = perturbGt(c.caseId, c.gt, level, "prefix", keep);
      const b = perturbGt(c.caseId, c.gt, level, "oracle", keep);
      for (let i = 0; i < a.length; i++) {
        comparisons++;
        if (a[i].title !== b[i].title) {
          diverged++;
          divergedRows.push(
            `    ${pad(c.caseId, 6)}${pad(a[i].id, 8)}k=${level}  prefix="${a[i].title}"  oracle="${b[i].title}"`,
          );
        }
      }
    }
  }
  console.log("");
  console.log(
    `  policy divergence: ${diverged}/${comparisons} (GT event, k) perturbations produce a ` +
      `different title under oracle-k than prefix-k.`,
  );
  for (const r of divergedRows) console.log(r);
  const policiesScoreSame = LEVELS.every((l) => {
    const a = scoreLevel(cases, l, "prefix", keep, "strict").micro;
    const b = scoreLevel(cases, l, "oracle", keep, "strict").micro;
    return a.tp === b.tp && a.fp === b.fp && a.fn === b.fn;
  });
  console.log(
    `  → prefix-k and oracle-k produce identical micro tp/fp/fn at every level: ` +
      `${policiesScoreSame ? "YES" : "NO"}.`,
  );
  console.log(
    "    In Cases 1+2 the tokens a prediction shares with its GT label are almost always the",
  );
  console.log(
    "    LEADING tokens and the divergent ones are trailing — prediction and label co-phrase from",
  );
  console.log(
    "    the head — so the oracle upper bound collapses onto naive prefix truncation. That means",
  );
  console.log(
    "    the collapse below CANNOT be blamed on truncation discarding the matching words: even the",
  );
  console.log("    best possible k-token rephrasing of each label scores the same.");

  for (const policy of ["prefix", "oracle"] as Policy[]) {
    for (const tier of ["strict", "loose"] as Tier[]) {
      console.log("");
      console.log(`  ── policy=${policy}  tier=${tier} ──`);
      const scores = LEVELS.map((l) => scoreLevel(cases, l, policy, keep, tier));

      const hdr = LEVELS.map((l) => padL(`k=${l}`, 8)).join("");
      console.log(`  ${pad("row", 22)}${hdr}`);
      console.log(`  ${rule("-", 22 + 8 * LEVELS.length)}`);
      for (const c of cases) {
        console.log(
          `  ${pad(`${c.caseId} F1`, 22)}` +
            scores.map((s) => padL(f2(s.perCase.get(c.caseId)!.f1), 8)).join(""),
        );
      }
      console.log(
        `  ${pad("macro-mean F1", 22)}` + scores.map((s) => padL(f2(s.macroF1), 8)).join(""),
      );
      console.log(
        `  ${pad("micro P", 22)}` + scores.map((s) => padL(f2(s.micro.p), 8)).join(""),
      );
      console.log(
        `  ${pad("micro R", 22)}` + scores.map((s) => padL(f2(s.micro.r), 8)).join(""),
      );
      console.log(
        `  ${pad("micro F1", 22)}` + scores.map((s) => padL(f2(s.micro.f1), 8)).join(""),
      );
      console.log(
        `  ${pad("micro tp/fp/fn", 22)}` +
          scores.map((s) => padL(`${s.micro.tp}/${s.micro.fp}/${s.micro.fn}`, 8)).join(""),
      );
      console.log(`  ${rule("-", 22 + 8 * LEVELS.length)}`);
      console.log(`  per event_type F1 (tp/fp/fn summed over C1+C2, then P/R/F1):`);
      const collapse: string[] = [];
      for (const t of ALL_EVENT_TYPES) {
        const nGt = scores[0].byType.get(t)!.nGt;
        if (nGt === 0) continue;
        const series = scores.map((s) => s.byType.get(t)!.f1);
        console.log(
          `  ${pad(`  ${t} (n_gt=${nGt})`, 22)}` + series.map((v) => padL(f2(v), 8)).join(""),
        );
        const zeroAt = series.findIndex((v) => v === 0);
        collapse.push(`${t}=${zeroAt === -1 ? "never" : `k${LEVELS[zeroAt]}`}`);
      }
      console.log(`  collapse point (largest k at which per-type F1 is 0.00): ${collapse.join("  ")}`);
    }
  }

  // Strict vs loose: if every level agrees, the date tier is contributing
  // nothing and the whole movement belongs to the title gate.
  const sameTier = LEVELS.every((l) => {
    const s = scoreLevel(cases, l, "prefix", keep, "strict").micro;
    const o = scoreLevel(cases, l, "prefix", keep, "loose").micro;
    return s.tp === o.tp && s.fp === o.fp && s.fn === o.fn;
  });
  console.log("");
  console.log(
    `  strict vs loose: micro tp/fp/fn identical at EVERY level: ${sameTier ? "YES" : "NO"}` +
      (sameTier
        ? " — the ±3-day tier recovers nothing here, so every point of movement above is the title gate."
        : ""),
  );
}

// ---------------------------------------------------------------------------
// Section 5 — failure-cause attribution.
// ---------------------------------------------------------------------------
function sectionAttribution(cases: LoadedCase[], keep: Map<string, Set<string>>): void {
  head("[5] FAILURE-CAUSE ATTRIBUTION for every unmatched in-scope GT event");
  console.log("contention = a qualifying prediction existed but greedy 1-1 gave it to another GT");
  console.log("type       = no prediction of that event_type at all");
  console.log("date       = same-type prediction(s) exist, none inside the tier's date tolerance");
  console.log("overlap    = same-type + in-date prediction(s) exist, none reaches overlap 0.5");

  const causes: Cause[] = ["contention", "type", "date", "overlap"];

  for (const policy of ["prefix", "oracle"] as Policy[]) {
    for (const tier of ["strict", "loose"] as Tier[]) {
      console.log("");
      console.log(`  ── policy=${policy}  tier=${tier} ──`);
      console.log(
        `  ${pad("level", 8)}${padL("unmatched", 11)}` +
          causes.map((c) => padL(c, 12)).join(""),
      );
      console.log(`  ${rule("-", 19 + 12 * causes.length)}`);
      const perLevelDetail: string[][] = [];
      for (const level of LEVELS) {
        const counts = new Map<Cause, number>(causes.map((c) => [c, 0]));
        const detail: string[] = [];
        let unmatched = 0;
        for (const c of cases) {
          const pgt = perturbGt(c.caseId, c.gt, level, policy, keep);
          const { unmatchedGt } = greedyPairs(c.predicted, pgt, tier);
          for (const g of unmatchedGt) {
            const cause = attribute(g, c.predicted, tier);
            counts.set(cause, counts.get(cause)! + 1);
            unmatched++;
            detail.push(
              `      ${pad(c.caseId, 6)}${pad(g.id, 8)}${pad(g.event_type, 12)}${pad(cause, 12)}"${g.title}"`,
            );
          }
        }
        console.log(
          `  ${pad(`k=${level}`, 8)}${padL(String(unmatched), 11)}` +
            causes.map((c) => padL(String(counts.get(c)), 12)).join(""),
        );
        perLevelDetail.push([`    k=${level}:`, ...detail]);
      }
      if (policy === "prefix" && tier === "strict") {
        console.log("");
        console.log("  per-event detail (policy=prefix, tier=strict):");
        for (const block of perLevelDetail) for (const line of block) console.log(line);
      }
    }
  }

  console.log("");
  console.log("  overlap-attributed misses by event_type (policy=oracle, tier=strict):");
  console.log(`  ${pad("event_type", 12)}` + LEVELS.map((l) => padL(`k=${l}`, 8)).join(""));
  console.log(`  ${rule("-", 12 + 8 * LEVELS.length)}`);
  const perType = new Map<EventType, number[]>();
  for (const t of ALL_EVENT_TYPES) perType.set(t, []);
  for (const level of LEVELS) {
    const counts = new Map<EventType, number>(ALL_EVENT_TYPES.map((t) => [t, 0]));
    for (const c of cases) {
      const pgt = perturbGt(c.caseId, c.gt, level, "oracle", keep);
      for (const g of greedyPairs(c.predicted, pgt, "strict").unmatchedGt) {
        if (attribute(g, c.predicted, "strict") === "overlap") {
          counts.set(g.event_type, counts.get(g.event_type)! + 1);
        }
      }
    }
    for (const t of ALL_EVENT_TYPES) perType.get(t)!.push(counts.get(t)!);
  }
  for (const t of ALL_EVENT_TYPES) {
    const series = perType.get(t)!;
    if (series.every((n) => n === 0)) continue;
    console.log(`  ${pad(t, 12)}` + series.map((n) => padL(String(n), 8)).join(""));
  }
}

// ---------------------------------------------------------------------------
function main(): void {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const ids = (args.length > 0 ? args : ALL_CASES) as string[];
  for (const a of ids) {
    if (a !== "case1" && a !== "case2") {
      console.error(`${TAG} invalid case '${a}' — this diagnostic runs on case1/case2 only.`);
      console.error(`${TAG} Case 3 is held out (docs/RESOLVED-DECISIONS.md #10) and is never read here.`);
      process.exit(1);
    }
  }
  const cases = (ids as CaseId[]).map(loadCase);

  console.log(rule("="));
  console.log(`${TAG} title token-overlap diagnostic — Cases 1+2 only, no network, held_out/ never read`);
  console.log(rule("="));
  console.log(
    `  gate under test: lib/eval.ts matchesEvent — same event_type AND ` +
      `overlap(titleTokens(pred), titleTokens(gt)) >= 0.5 AND date within tier`,
  );
  console.log(`  overlap(A,B) = |A∩B| / max(|A|,|B|)  (denominator is max, so overlap <= min/max)`);
  for (const c of cases) {
    console.log(
      `  loaded ${c.caseId}: ${c.predicted.length} predicted, ` +
        `${c.gt.filter((g) => g.in_scope).length} in-scope GT (${c.gt.length} labeled)`,
    );
  }

  // Mirror + pairing self-checks, printed before any mirror-derived number.
  const mc = verifyMirror(cases);
  console.log("");
  console.log(
    `  MIRROR CHECK: local overlap/titleTokens mirror agrees with production matchesEvent on ` +
      `${mc.pairsChecked - mc.disagreements.length}/${mc.pairsChecked} (prediction, GT, tier) triples.`,
  );
  if (mc.disagreements.length > 0) {
    console.log("  !! MIRROR DISAGREES — every mirror-derived number below is untrustworthy:");
    for (const d of mc.disagreements) console.log(`     ${d}`);
  }
  const pairingOk = cases.every(
    (c) =>
      pairingAgrees(c.predicted, c.gt, "strict") && pairingAgrees(c.predicted, c.gt, "loose"),
  );
  console.log(
    `  PAIRING CHECK: greedy-pair mirror reproduces production evaluate() tp and fn on ` +
      `all ${cases.length * 2} (case, tier) combinations: ${pairingOk ? "PASS" : "FAIL"}`,
  );

  // Anchor: unperturbed production numbers, so the reader can tie this report to
  // the published dev figures before reading anything perturbed.
  console.log("");
  console.log("  BASELINE (unperturbed, production evaluate):");
  const baseF1: number[] = [];
  for (const c of cases) {
    const s = evaluate(c.predicted, c.gt, "strict");
    const l = evaluate(c.predicted, c.gt, "loose");
    baseF1.push(s.f1);
    console.log(
      `    ${pad(c.caseId, 6)} strict P=${f2(s.precision)} R=${f2(s.recall)} F1=${f2(s.f1)} ` +
        `(tp${s.tp}/fp${s.fp}/fn${s.fn}, n_gt=${s.n_gt})  |  loose P=${f2(l.precision)} ` +
        `R=${f2(l.recall)} F1=${f2(l.f1)}`,
    );
  }
  console.log(
    `    macro-mean strict F1 = ${f3(baseF1.reduce((a, b) => a + b, 0) / baseF1.length)}`,
  );
  sectionTitleBlind(cases);

  // Oracle keep-preference: for each GT event, the tokens its best same-type
  // candidate also has. Computed ONCE at k=all so the oracle policy does not
  // chase the perturbation.
  const keep = new Map<string, Set<string>>();
  for (const c of cases) {
    for (const g of c.gt) {
      const bc = bestCandidate(g, c.predicted);
      keep.set(
        keepKey(c.caseId, g.id),
        bc.pred ? titleTokensMirror(bc.pred.title) : new Set<string>(),
      );
    }
  }

  sectionIdentity(cases);
  const best = sectionDistribution(cases);
  sectionCeiling(cases, best);
  sectionPerturbation(cases, keep);
  sectionAttribution(cases, keep);

  console.log("");
  console.log(rule("="));
  console.log(`${TAG} done — diagnostic only, no gate, exit 0`);
  console.log(rule("="));
}

main();

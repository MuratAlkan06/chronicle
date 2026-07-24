import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleRunRecord,
  isDegenerateRun,
  normalizeUsage,
  sumUsage,
  summarizeRuns,
  ZERO_USAGE,
  type DocExtraction,
  type ExtractUsage,
  type RunMetrics,
} from "./measure";
import type { GtEvent, TierResult } from "./eval";
import type { TimelineEvent } from "./schema";

// ---------------------------------------------------------------------------
// normalizeUsage — old artifacts + null cache fields must read cleanly
// ---------------------------------------------------------------------------

test("normalizeUsage: full Anthropic-shaped usage passes through", () => {
  const u = normalizeUsage({
    input_tokens: 100,
    output_tokens: 40,
    cache_read_input_tokens: 6852,
    cache_creation_input_tokens: 0,
  });
  assert.deepEqual(u, {
    input_tokens: 100,
    output_tokens: 40,
    cache_read_input_tokens: 6852,
    cache_creation_input_tokens: 0,
  });
});

test("normalizeUsage: null cache fields (SDK shape on first call) coerce to 0", () => {
  const u = normalizeUsage({
    input_tokens: 8421,
    output_tokens: 512,
    cache_read_input_tokens: null,
    cache_creation_input_tokens: null,
  });
  assert.equal(u.cache_read_input_tokens, 0);
  assert.equal(u.cache_creation_input_tokens, 0);
  assert.equal(u.input_tokens, 8421);
});

test("normalizeUsage: missing / undefined / null input → all zeros (old artifacts)", () => {
  assert.deepEqual(normalizeUsage(undefined), ZERO_USAGE);
  assert.deepEqual(normalizeUsage(null), ZERO_USAGE);
  assert.deepEqual(normalizeUsage({}), ZERO_USAGE);
  // A partial old artifact with only input_tokens still normalizes.
  assert.deepEqual(normalizeUsage({ input_tokens: 5 }), {
    ...ZERO_USAGE,
    input_tokens: 5,
  });
});

test("normalizeUsage: non-numeric junk fields coerce to 0", () => {
  const u = normalizeUsage({
    input_tokens: "nope",
    output_tokens: NaN,
    cache_read_input_tokens: {},
    cache_creation_input_tokens: 12,
  });
  assert.deepEqual(u, { ...ZERO_USAGE, cache_creation_input_tokens: 12 });
});

// ---------------------------------------------------------------------------
// sumUsage
// ---------------------------------------------------------------------------

test("sumUsage: element-wise sum across calls", () => {
  const list: ExtractUsage[] = [
    { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 6852 },
    { input_tokens: 120, output_tokens: 55, cache_read_input_tokens: 6852, cache_creation_input_tokens: 0 },
    { input_tokens: 90, output_tokens: 33, cache_read_input_tokens: 6852, cache_creation_input_tokens: 0 },
  ];
  assert.deepEqual(sumUsage(list), {
    input_tokens: 310,
    output_tokens: 128,
    cache_read_input_tokens: 13704,
    cache_creation_input_tokens: 6852,
  });
});

test("sumUsage: empty list → ZERO_USAGE (no NaN)", () => {
  assert.deepEqual(sumUsage([]), ZERO_USAGE);
});

// ---------------------------------------------------------------------------
// summarizeRuns — mean/min/max aggregation over repeated measurement runs
// ---------------------------------------------------------------------------

function tier(
  t: "strict" | "loose",
  o: { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number },
): TierResult {
  return { tier: t, n_gt: 20, ...o };
}

test("summarizeRuns: mean/min/max computed per tier for P/R/F1", () => {
  // Mirrors the two real Case-3 runs (0.41, 0.45) plus a synthetic third so
  // min != max on every axis.
  const runs: RunMetrics[] = [
    {
      strict: tier("strict", { tp: 8, fp: 11, fn: 12, precision: 0.42, recall: 0.4, f1: 0.41 }),
      loose: tier("loose", { tp: 8, fp: 11, fn: 12, precision: 0.42, recall: 0.4, f1: 0.41 }),
    },
    {
      strict: tier("strict", { tp: 9, fp: 11, fn: 11, precision: 0.45, recall: 0.45, f1: 0.45 }),
      loose: tier("loose", { tp: 9, fp: 11, fn: 11, precision: 0.45, recall: 0.45, f1: 0.45 }),
    },
    {
      strict: tier("strict", { tp: 10, fp: 10, fn: 10, precision: 0.5, recall: 0.5, f1: 0.5 }),
      loose: tier("loose", { tp: 11, fp: 9, fn: 9, precision: 0.55, recall: 0.55, f1: 0.55 }),
    },
  ];

  const s = summarizeRuns(runs);
  assert.equal(s.runs, 3);

  // strict F1: (0.41 + 0.45 + 0.50) / 3 = 0.4533…
  assert.ok(Math.abs(s.strict.f1.mean - 0.45333333333333) < 1e-9);
  assert.equal(s.strict.f1.min, 0.41);
  assert.equal(s.strict.f1.max, 0.5);
  assert.equal(s.strict.precision.min, 0.42);
  assert.equal(s.strict.precision.max, 0.5);

  // loose diverges from strict on the third run.
  assert.equal(s.loose.f1.max, 0.55);
  assert.ok(Math.abs(s.loose.f1.mean - 0.47) < 1e-9);

  // per-run tp/fp/fn preserved, 1-based run index.
  assert.equal(s.perRun.strict.length, 3);
  assert.equal(s.perRun.strict[0].run, 1);
  assert.equal(s.perRun.strict[0].tp, 8);
  assert.equal(s.perRun.strict[2].fn, 10);
  assert.equal(s.perRun.loose[2].tp, 11);
});

test("summarizeRuns: single run → mean=min=max", () => {
  const runs: RunMetrics[] = [
    {
      strict: tier("strict", { tp: 9, fp: 11, fn: 11, precision: 0.45, recall: 0.45, f1: 0.45 }),
      loose: tier("loose", { tp: 9, fp: 11, fn: 11, precision: 0.45, recall: 0.45, f1: 0.45 }),
    },
  ];
  const s = summarizeRuns(runs);
  assert.deepEqual(s.strict.f1, { mean: 0.45, min: 0.45, max: 0.45 });
});

test("summarizeRuns: empty runs → zeroed summary, no NaN", () => {
  const s = summarizeRuns([]);
  assert.equal(s.runs, 0);
  assert.deepEqual(s.strict.f1, { mean: 0, min: 0, max: 0 });
  assert.equal(Number.isFinite(s.loose.precision.mean), true);
  assert.equal(s.perRun.strict.length, 0);
});

// ---------------------------------------------------------------------------
// isDegenerateRun — the load-bearing "never persist a zero-success run" guard
// ---------------------------------------------------------------------------

test("isDegenerateRun: empty outcomes → true (zero successful extractions)", () => {
  assert.equal(isDegenerateRun([]), true);
});

test("isDegenerateRun: every doc failed → true (auth/transport failure, not a measurement)", () => {
  assert.equal(isDegenerateRun([{ ok: false }, { ok: false }, { ok: false }]), true);
});

test("isDegenerateRun: at least one success → false (partial run may persist)", () => {
  assert.equal(isDegenerateRun([{ ok: false }, { ok: true }, { ok: false }]), false);
});

test("isDegenerateRun: all succeeded → false", () => {
  assert.equal(isDegenerateRun([{ ok: true }, { ok: true }]), false);
  assert.equal(isDegenerateRun([{ ok: true }]), false);
});

// ---------------------------------------------------------------------------
// assembleRunRecord — the mocked machinery test (scripts/eval-case3.ts core).
// No API, no disk: a fake extractor's per-doc output is fed straight in.
// ---------------------------------------------------------------------------

function ev(o: Partial<TimelineEvent> & { id: string; docId: string }): TimelineEvent {
  return {
    id: o.id,
    date: o.date ?? "2024-01-15",
    date_text: null,
    date_confidence: "exact",
    event_type: o.event_type ?? "visit",
    title: o.title ?? "PCP visit — initial workup",
    summary: "s",
    severity: "info",
    values: null,
    provider: null,
    source: { document_id: o.docId, page: 1, snippet: "x" },
    related_ids: [],
  };
}

function gtEv(o: Partial<GtEvent> & { id: string }): GtEvent {
  return {
    id: o.id,
    date: o.date ?? "2024-01-15",
    date_confidence: "exact",
    event_type: o.event_type ?? "visit",
    title: o.title ?? "PCP visit — initial workup",
    source_document: o.source_document ?? "d1",
    in_scope: o.in_scope ?? true,
  };
}

test("assembleRunRecord: flattens predicted in DOC order + sums usage + scores", () => {
  // Two docs, out-of-alpha usage magnitudes so order is observable.
  const perDoc: DocExtraction[] = [
    {
      docId: "d1",
      events: [ev({ id: "d1e1", docId: "d1", title: "PCP visit — initial workup" })],
      usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 6852 },
    },
    {
      docId: "d2",
      events: [
        ev({ id: "d2e1", docId: "d2", event_type: "lab", title: "HbA1c — 9.2 %", date: "2024-02-01" }),
        ev({ id: "d2e2", docId: "d2", title: "PCP follow-up — labs" }),
      ],
      usage: { input_tokens: 90, output_tokens: 8, cache_read_input_tokens: 6852, cache_creation_input_tokens: 0 },
    },
  ];
  const gt: GtEvent[] = [
    gtEv({ id: "gt1", title: "PCP visit — initial workup", source_document: "d1" }),
    gtEv({ id: "gt2", event_type: "lab", title: "HbA1c — 9.2 %", date: "2024-02-01", source_document: "d2" }),
  ];

  const rec = assembleRunRecord({
    caseId: "case1",
    model: "claude-sonnet-4-6",
    promptHash: "abc1234",
    temperature: 0,
    run: 2,
    runs: 3,
    perDoc,
    gtEvents: gt,
  });

  // Deterministic doc-order flatten (d1 event first, then d2's two).
  assert.deepEqual(rec.predicted.map((e) => e.id), ["d1e1", "d2e1", "d2e2"]);

  // Metadata carried through.
  assert.equal(rec.caseId, "case1");
  assert.equal(rec.model, "claude-sonnet-4-6");
  assert.equal(rec.promptHash, "abc1234");
  assert.equal(rec.temperature, 0);
  assert.equal(rec.run, 2);
  assert.equal(rec.runs, 3);

  // Scored via lib/eval: gt1 (visit) + gt2 (lab) both matched; d2e2 is an FP.
  assert.equal(rec.metrics.strict.tp, 2);
  assert.equal(rec.metrics.strict.fp, 1);
  assert.equal(rec.metrics.strict.fn, 0);
  assert.equal(rec.metrics.strict.n_gt, 2);
  assert.ok(rec.byEventType.strict.lab, "byEventType has per-type entries");
  assert.ok(rec.byEventType.loose.visit);

  // Usage persistence shape: aggregate = element-wise sum; perDocUsage per doc.
  assert.deepEqual(rec.usage, {
    input_tokens: 190,
    output_tokens: 18,
    cache_read_input_tokens: 6852,
    cache_creation_input_tokens: 6852,
  });
  assert.deepEqual(rec.perDocUsage.map((d) => d.docId), ["d1", "d2"]);
  assert.equal(rec.perDocUsage[0].usage.cache_creation_input_tokens, 6852);
});

test("assembleRunRecord: N runs feed summarizeRuns end-to-end (mocked machinery)", () => {
  // Simulate the eval-case3 loop: same docs extracted twice (deterministic
  // predicted → identical metrics), aggregated into a mean/min/max summary.
  const perDoc: DocExtraction[] = [
    {
      docId: "d1",
      events: [ev({ id: "d1e1", docId: "d1" })],
      usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 6852 },
    },
  ];
  const gt: GtEvent[] = [gtEv({ id: "gt1", source_document: "d1" })];

  const records = [1, 2].map((i) =>
    assembleRunRecord({ caseId: "case1", model: "claude-sonnet-4-6", promptHash: "h", temperature: 0, run: i, runs: 2, perDoc, gtEvents: gt }),
  );
  const summary = summarizeRuns(records.map((r) => ({ strict: r.metrics.strict, loose: r.metrics.loose })));

  assert.equal(summary.runs, 2);
  assert.equal(summary.strict.f1.mean, 1); // perfect match both runs
  assert.equal(summary.strict.f1.min, 1);
  assert.equal(summary.strict.f1.max, 1);
  assert.equal(summary.perRun.strict[1].run, 2);

  const totalUsage = sumUsage(records.map((r) => r.usage));
  assert.equal(totalUsage.input_tokens, 200);
  assert.equal(totalUsage.cache_creation_input_tokens, 13704);
});

test("assembleRunRecord: no failures param → docFailures is [] (fully-successful run)", () => {
  const perDoc: DocExtraction[] = [
    { docId: "d1", events: [ev({ id: "d1e1", docId: "d1" })], usage: ZERO_USAGE },
  ];
  const rec = assembleRunRecord({
    caseId: "case1", model: "claude-sonnet-4-6", promptHash: "h", temperature: 0, run: 1, runs: 1,
    perDoc, gtEvents: [gtEv({ id: "gt1", source_document: "d1" })],
  });
  assert.deepEqual(rec.docFailures, []);
});

test("assembleRunRecord: PARTIAL run records docFailures explicitly; failed docs absent from predicted/usage", () => {
  // d1 succeeded; d2 threw (auth). Only d1's event is scored; d2 is recorded as
  // a failure, not silently dropped.
  const perDoc: DocExtraction[] = [
    {
      docId: "d1",
      events: [ev({ id: "d1e1", docId: "d1" })],
      usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  ];
  const rec = assembleRunRecord({
    caseId: "case1", model: "claude-sonnet-4-6", promptHash: "h", temperature: 0, run: 1, runs: 1,
    perDoc,
    failures: [{ docId: "d2", error: "401 authentication_error" }],
    gtEvents: [
      gtEv({ id: "gt1", source_document: "d1" }),
      gtEv({ id: "gt2", event_type: "lab", title: "HbA1c — 9.2 %", source_document: "d2" }),
    ],
  });

  assert.deepEqual(rec.docFailures, [{ docId: "d2", error: "401 authentication_error" }]);
  // Only d1's event survives → gt2 (d2) is an unrecoverable FN, not a silent gap.
  assert.deepEqual(rec.predicted.map((e) => e.id), ["d1e1"]);
  assert.deepEqual(rec.perDocUsage.map((d) => d.docId), ["d1"]);
  assert.equal(rec.usage.input_tokens, 100);
  assert.equal(rec.metrics.strict.fn, 1); // gt2 unmatched (its doc failed)
});

// ---------------------------------------------------------------------------
// model + temperature persistence — a run must be attributable to the model
// used, and honestly record whether temperature was pinned or ran at default.
// ---------------------------------------------------------------------------

test("assembleRunRecord: records model id + pinned temperature (default sonnet path)", () => {
  const perDoc: DocExtraction[] = [
    { docId: "d1", events: [ev({ id: "d1e1", docId: "d1" })], usage: ZERO_USAGE },
  ];
  const rec = assembleRunRecord({
    caseId: "case3", model: "claude-sonnet-4-6", promptHash: "h", temperature: 0,
    run: 1, runs: 3, perDoc, gtEvents: [gtEv({ id: "gt1", source_document: "d1" })],
  });
  assert.equal(rec.model, "claude-sonnet-4-6");
  assert.equal(rec.temperature, 0);
});

test("assembleRunRecord: escape-hatch model records temperature=null (ran at model default)", () => {
  // Opus 4.7 rejects a pinned temperature → the harness sends none and records
  // null, so the persisted measurement says "model default", not a false "0".
  const perDoc: DocExtraction[] = [
    { docId: "d1", events: [ev({ id: "d1e1", docId: "d1" })], usage: ZERO_USAGE },
  ];
  const rec = assembleRunRecord({
    caseId: "case3", model: "claude-opus-4-7", promptHash: "h", temperature: null,
    run: 1, runs: 3, perDoc, gtEvents: [gtEv({ id: "gt1", source_document: "d1" })],
  });
  assert.equal(rec.model, "claude-opus-4-7");
  assert.equal(rec.temperature, null);
});

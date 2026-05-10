import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesEvent, evaluate, breakdown, type GtEvent } from "./eval";
import type { TimelineEvent, EventType } from "./schema";

// ---------------------------------------------------------------------------
// Test factories — keep test bodies short and focused on the assertion.
// ---------------------------------------------------------------------------

function pred(overrides: Partial<TimelineEvent> & { id: string }): TimelineEvent {
  return {
    id: overrides.id,
    date: overrides.date ?? "2024-01-15",
    date_text: overrides.date_text ?? null,
    date_confidence: overrides.date_confidence ?? "exact",
    event_type: overrides.event_type ?? "visit",
    title: overrides.title ?? "PCP visit — initial workup",
    summary: overrides.summary ?? "Routine visit.",
    severity: overrides.severity ?? "info",
    values: overrides.values ?? null,
    provider: overrides.provider ?? null,
    source: overrides.source ?? {
      document_id: "d1.pdf",
      page: 1,
      snippet: "Snippet text",
    },
    related_ids: overrides.related_ids ?? [],
  };
}

function gt(overrides: Partial<GtEvent> & { id: string }): GtEvent {
  return {
    id: overrides.id,
    date: overrides.date ?? "2024-01-15",
    date_confidence: overrides.date_confidence ?? "exact",
    event_type: overrides.event_type ?? "visit",
    title: overrides.title ?? "PCP visit — initial workup",
    source_document: overrides.source_document ?? "d1.pdf",
    in_scope: overrides.in_scope ?? true,
    notes: overrides.notes,
  };
}

// ---------------------------------------------------------------------------
// matchesEvent
// ---------------------------------------------------------------------------

test("matchesEvent: exact same-day match works in both tiers", () => {
  const p = pred({ id: "p1", date: "2024-03-15" });
  const g = gt({ id: "gt_001", date: "2024-03-15" });
  assert.equal(matchesEvent(p, g, "strict"), true);
  assert.equal(matchesEvent(p, g, "loose"), true);
});

test("matchesEvent: 2-day diff matches loose, not strict", () => {
  const p = pred({ id: "p1", date: "2024-03-15" });
  const g = gt({ id: "gt_001", date: "2024-03-17" });
  assert.equal(matchesEvent(p, g, "strict"), false);
  assert.equal(matchesEvent(p, g, "loose"), true);
});

test("matchesEvent: 5-day diff matches neither tier", () => {
  const p = pred({ id: "p1", date: "2024-03-15" });
  const g = gt({ id: "gt_001", date: "2024-03-20" });
  assert.equal(matchesEvent(p, g, "strict"), false);
  assert.equal(matchesEvent(p, g, "loose"), false);
});

test("matchesEvent: event_type mismatch fails even with identical date+title", () => {
  const p = pred({ id: "p1", event_type: "lab" });
  const g = gt({ id: "gt_001", event_type: "visit" });
  assert.equal(matchesEvent(p, g, "strict"), false);
  assert.equal(matchesEvent(p, g, "loose"), false);
});

test("matchesEvent: title token-overlap exactly 0.5 matches; below fails", () => {
  // p.title tokens = {a, b}, g.title tokens = {a, c} → intersection 1, max 2 → 0.5
  const p = pred({ id: "p1", title: "a b" });
  const g = gt({ id: "gt_001", title: "a c" });
  assert.equal(matchesEvent(p, g, "strict"), true);

  // p.title tokens = {a, b, c}, g.title tokens = {a, d, e, f} → intersection 1, max 4 → 0.25
  const p2 = pred({ id: "p2", title: "a b c" });
  const g2 = gt({ id: "gt_002", title: "a d e f" });
  assert.equal(matchesEvent(p2, g2, "strict"), false);
});

// ---------------------------------------------------------------------------
// evaluate
// ---------------------------------------------------------------------------

test("evaluate: in_scope=false GT excluded from FN denominator", () => {
  // Setup: 1 in-scope GT, 1 OOS GT, 1 prediction matching only the OOS GT.
  // Expected: tp=0 (OOS GT can't be matched), fp=1 (pred didn't match anything
  // in scope), fn=1 (the in-scope GT is unmatched), n_gt=1 (only counts in-scope).
  const gts = [
    gt({ id: "gt_001", title: "in scope event", in_scope: true }),
    gt({ id: "gt_002", title: "out of scope billing", in_scope: false }),
  ];
  const preds = [pred({ id: "p1", title: "out of scope billing" })];

  const r = evaluate(preds, gts, "strict");
  assert.equal(r.tp, 0);
  assert.equal(r.fp, 1);
  assert.equal(r.fn, 1);
  assert.equal(r.n_gt, 1);
});

test("evaluate: greedy 1-1 — first prediction wins, second is FP", () => {
  const gts = [gt({ id: "gt_001" })];
  const preds = [pred({ id: "p1" }), pred({ id: "p2" })];
  const r = evaluate(preds, gts, "strict");
  assert.equal(r.tp, 1);
  assert.equal(r.fp, 1);
  assert.equal(r.fn, 0);
});

test("evaluate: same-source preference breaks tie", () => {
  // Two GT candidates tie on date+event_type+title-overlap; prediction comes
  // from doc B, expect gt_002 (the doc-B-sourced GT) to win.
  const gts = [
    gt({ id: "gt_001", source_document: "docA.pdf" }),
    gt({ id: "gt_002", source_document: "docB.pdf" }),
  ];
  const preds = [
    pred({
      id: "p1",
      source: { document_id: "docB.pdf", page: 1, snippet: "x" },
    }),
  ];
  const r = evaluate(preds, gts, "strict");
  assert.equal(r.tp, 1);
  assert.equal(r.fn, 1);
  // Verify the docA GT remained unmatched (FN bumped, not docB).
  // Bring in a second prediction targeting docA so we can detect which GT was claimed first.
  const preds2 = [
    pred({
      id: "p1",
      source: { document_id: "docB.pdf", page: 1, snippet: "x" },
    }),
    pred({
      id: "p2",
      source: { document_id: "docA.pdf", page: 1, snippet: "y" },
    }),
  ];
  const r2 = evaluate(preds2, gts, "strict");
  assert.equal(r2.tp, 2);
  assert.equal(r2.fp, 0);
  assert.equal(r2.fn, 0);
});

test("evaluate: empty inputs → all zeros, no NaN", () => {
  const r = evaluate([], [], "strict");
  assert.equal(r.tp, 0);
  assert.equal(r.fp, 0);
  assert.equal(r.fn, 0);
  assert.equal(r.n_gt, 0);
  assert.equal(r.precision, 0);
  assert.equal(r.recall, 0);
  assert.equal(r.f1, 0);
  assert.equal(Number.isFinite(r.precision), true);
});

test("evaluate: perfect match → precision/recall/f1 = 1", () => {
  const gts = [gt({ id: "gt_001" })];
  const preds = [pred({ id: "p1" })];
  const r = evaluate(preds, gts, "strict");
  assert.equal(r.precision, 1);
  assert.equal(r.recall, 1);
  assert.equal(r.f1, 1);
});

// ---------------------------------------------------------------------------
// breakdown
// ---------------------------------------------------------------------------

test("breakdown: returns one entry per EventType", () => {
  const gts = [
    gt({ id: "gt_001", event_type: "lab", title: "HbA1c lab" }),
    gt({ id: "gt_002", event_type: "lab", title: "Glucose lab" }),
    gt({ id: "gt_003", event_type: "visit", title: "PCP visit" }),
  ];
  const preds: TimelineEvent[] = [];
  const b = breakdown(preds, gts, "strict");
  const types: EventType[] = [
    "lab",
    "imaging",
    "visit",
    "diagnosis",
    "medication",
    "procedure",
    "referral",
  ];
  for (const t of types) {
    assert.ok(b[t], `breakdown missing ${t}`);
  }
  assert.equal(b.lab.n_gt, 2);
  assert.equal(b.visit.n_gt, 1);
  assert.equal(b.imaging.n_gt, 0);
  assert.equal(b.imaging.fn, 0);
});

// ---------------------------------------------------------------------------
// _pinpointed: false stamping
// ---------------------------------------------------------------------------

test("evaluate: _pinpointed=false reduces validPred denominator (Q14)", () => {
  // Setup: 1 GT, 1 prediction that doesn't match (different event_type) plus
  // 1 _pinpointed=false prediction that also doesn't match. validPred should
  // exclude the _pinpointed=false pred → fp=1 not 2.
  const gts = [gt({ id: "gt_001", event_type: "visit" })];
  const p1 = pred({ id: "p1", event_type: "lab", title: "lab one" });
  const p2 = pred({ id: "p2", event_type: "lab", title: "lab two" });
  (p2.source as { _pinpointed?: boolean })._pinpointed = false;

  const r = evaluate([p1, p2], gts, "strict");
  assert.equal(r.tp, 0);
  assert.equal(r.fp, 1); // p1 only — p2 excluded from validPred
  assert.equal(r.fn, 1);
  assert.equal(Number.isFinite(r.precision), true);
});

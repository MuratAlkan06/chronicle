import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSnippet, matchSnippetInText } from "./match";

// Deterministic source for the d1_pcp_2023_01.pdf text excerpt — sourced from
// prompts/few_shot.md lines 17-46 (the FEW-SHOT 1 document body). Used as
// real-fixture ground truth for the three matcher assertions below.
const D1_PCP_TEXT = `
Sarah Levy, MD — Internal Medicine
Patient: Chen, Sarah   DOB: 11-Jun-1976 (47F)   MRN: 4471028
Date of Service: 01/12/2023   Visit type: Annual physical

Chief Complaint
Routine annual physical. Patient reports fatigue and increased thirst.

History of Present Illness (HPI)
Pt presents today for routine annual physical. Reports fatigue × 3 months and increased thirst.
She describes the fatigue as a generalized "low energy" feeling, worse in the afternoons.
Polydipsia developed gradually; she now keeps a water bottle at her desk and refills it 3-4× per day.
On direct questioning she notes nocturia × 1 most nights.

Vitals
BP 132/84   HR 78   T 98.4°F   RR 14   SpO2 99% RA   BMI 28.4

Labs (drawn today, results posted same day)
| Test             | Result | Flag | Reference     |
| Glucose, fasting | 187    | H    | 70-99 mg/dL   |
| HbA1c            | 9.2 %  | H    | 4.0-5.6 %     |
| LDL              | 132    | H    | <100 mg/dL    |
HbA1c: 9.2% (H) — Reference range 4.0-5.6%.
Results consistent with new-onset Type 2 diabetes.

Assessment & Plan
Assessment: Type 2 Diabetes Mellitus (E11.9) — added to problem list.
1. T2D, new diagnosis. Initiate metformin per below.
Plan: Start metformin 500 mg PO b.i.d. with meals. F/u in 3 months for repeat A1c.
`;

test("real fixture: case1 visit snippet matches d1 text", () => {
  const snippet = "Pt presents today for routine annual physical. Reports fatigue × 3 months and increased thirst.";
  const result = matchSnippetInText(D1_PCP_TEXT, snippet);
  assert.equal(result.matched, true);
  assert.ok(result.startSpan !== null && result.endSpan !== null);
  assert.ok(result.windowSize !== null && result.windowSize >= 5);
});

test("real fixture: case1 lab snippet matches d1 text", () => {
  const snippet = "HbA1c: 9.2% (H) — Reference range 4.0-5.6%.";
  const result = matchSnippetInText(D1_PCP_TEXT, snippet);
  assert.equal(result.matched, true);
});

test("real fixture: case1 medication snippet matches d1 text", () => {
  const snippet = "Plan: Start metformin 500 mg PO b.i.d. with meals. F/u in 3 months for repeat A1c.";
  const result = matchSnippetInText(D1_PCP_TEXT, snippet);
  assert.equal(result.matched, true);
});

test("negative: one-character substitution does NOT match (containment, not fuzzy)", () => {
  const snippet = "HbA1c: 9.3% (H) — Reference range 4.0-5.6%.";
  const result = matchSnippetInText(D1_PCP_TEXT, snippet);
  assert.equal(result.matched, false);
  assert.equal(result.startSpan, null);
  assert.equal(result.endSpan, null);
  assert.equal(result.windowSize, null);
});

test("case-insensitive containment", () => {
  const result = matchSnippetInText(D1_PCP_TEXT, "PT PRESENTS TODAY FOR ROUTINE ANNUAL PHYSICAL");
  assert.equal(result.matched, true);
});

test("smaller window preferred when both fit", () => {
  const spans = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
  const result = matchSnippet(spans, "gamma delta epsilon zeta eta");
  assert.equal(result.matched, true);
  // Should land on a window of size 5 starting at index 2, not the whole array.
  assert.equal(result.windowSize, 5);
  assert.equal(result.startSpan, 2);
  assert.equal(result.endSpan, 7);
});

test("empty spans array returns no match", () => {
  assert.deepEqual(matchSnippet([], "anything"), {
    matched: false,
    startSpan: null,
    endSpan: null,
    windowSize: null,
  });
});

test("empty snippet returns no match", () => {
  assert.equal(matchSnippet(["a", "b", "c"], "").matched, false);
});

test("degenerate small-doc fallback: spans.length < 5 still attempts whole-array window", () => {
  const spans = ["the", "quick", "brown", "fox"];
  const result = matchSnippet(spans, "quick brown fox");
  assert.equal(result.matched, true);
  assert.equal(result.startSpan, 0);
  assert.equal(result.endSpan, 4);
  assert.equal(result.windowSize, 4);
});

test("snippet longer than 30 spans returns no match (window cap is honored)", () => {
  const spans = Array.from({ length: 50 }, (_, i) => `tok${i}`);
  const longSnippet = spans.slice(0, 35).join(" ");
  const result = matchSnippet(spans, longSnippet);
  assert.equal(result.matched, false);
});

test("dehyphenation across line break enables match", () => {
  // Real PDF text-layer wrap: word "metformin" emits as "met-\nformin"; after
  // dehyphenation the snippet "metformin 500 mg PO b.i.d." matches.
  const text = "Plan: Start met-\nformin 500 mg PO b.i.d.";
  const result = matchSnippetInText(text, "metformin 500 mg PO b.i.d.");
  assert.equal(result.matched, true);
});

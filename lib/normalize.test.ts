import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "./normalize";

test("empty string returns empty", () => {
  assert.equal(normalize(""), "");
});

test("all-whitespace collapses to empty after trim", () => {
  assert.equal(normalize("   \n\t  "), "");
});

test("collapses NBSP and narrow-NBSP to single ASCII space", () => {
  assert.equal(normalize("HbA1c 9.2% (H)"), "HbA1c 9.2% (H)");
});

test("dehyphenates soft line-break by joining the two word parts", () => {
  // Real PDF wrap: word "metformin" breaks as "met-\nformin" and rejoins to "metformin".
  assert.equal(normalize("met-\nformin"), "metformin");
  assert.equal(normalize("met-  \n  formin"), "metformin");
  // The hyphen + line-break disappears; the two halves are concatenated as-is
  // (we do not drop characters from either half).
  assert.equal(normalize("meta-\nformin"), "metaformin");
});

test("strips literal soft hyphen U+00AD", () => {
  assert.equal(normalize("met­formin"), "metformin");
});

test("preserves en-dash and em-dash (snippets contain them)", () => {
  assert.equal(normalize("HbA1c — 9.2%"), "HbA1c — 9.2%");
  assert.equal(normalize("range 4.0–5.6"), "range 4.0–5.6");
});

test("NFKC normalizes curly quotes via compatibility", () => {
  // U+2018 / U+2019 are not decomposed by NFKC (they stay as-is) — verify the
  // characters that ARE decomposed (e.g. U+FF21 fullwidth A -> A).
  assert.equal(normalize("ＡＢＣ"), "ABC");
});

test("preserves case (does not lowercase)", () => {
  assert.equal(normalize("HbA1c"), "HbA1c");
});

test("handles 'Δ metformin' from MOCK_DATA case1 event #7", () => {
  assert.equal(normalize("Δ metformin → 1000 mg PO b.i.d."), "Δ metformin → 1000 mg PO b.i.d.");
});

test("collapses runs of mixed whitespace to single space", () => {
  assert.equal(normalize("a  \t \n  b"), "a b");
});

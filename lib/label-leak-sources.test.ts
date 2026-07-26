import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coversPath,
  firstCovering,
  leakSources,
  LABELED_CASES,
  type LeakSource,
} from "./label-leak-sources";

// ---------------------------------------------------------------------------
// coversPath — the three entry spellings
// ---------------------------------------------------------------------------

test("coversPath: exact entry matches only itself", () => {
  assert.equal(coversPath("MOCK_DATA.md", "MOCK_DATA.md"), true);
  assert.equal(coversPath("MOCK_DATA.md", "docs/MOCK_DATA.md"), false);
  assert.equal(coversPath("MOCK_DATA.md", "MOCK_DATA.md.bak"), false);
});

test("coversPath: trailing-slash entry covers the whole subtree", () => {
  assert.equal(coversPath("prompts/", "prompts/few_shot.md"), true);
  assert.equal(coversPath("prompts/", "prompts/archive/v1.md"), true);
  // The bare directory path itself, as `git ls-files` would never emit but a
  // caller might pass.
  assert.equal(coversPath("prompts/", "prompts"), true);
  // Sibling directories sharing a prefix must NOT be swallowed.
  assert.equal(coversPath("prompts/", "prompts-old/few_shot.md"), false);
  assert.equal(coversPath("held_out/", "held_out_notes.md"), false);
});

test("coversPath: `*` matches within one path segment only", () => {
  assert.equal(coversPath("lib/*.test.ts", "lib/eval.test.ts"), true);
  assert.equal(coversPath("lib/*.test.ts", "lib/label-leak-sources.test.ts"), true);
  assert.equal(coversPath("lib/*.test.ts", "lib/eval.ts"), false);
  // A nested file is deliberately NOT covered: an unmatched leak fails the gate,
  // which is the safe direction. See the doc comment on coversPath.
  assert.equal(coversPath("lib/*.test.ts", "lib/sub/eval.test.ts"), false);
  assert.equal(coversPath("lib/*.test.ts", "scripts/eval.test.ts"), false);
});

test("coversPath: regex metacharacters in an entry are literal", () => {
  // `.` must not act as a wildcard, or `data/case3_eval_fallback.json` would
  // also cover `data/case3_eval_fallbackXjson`.
  assert.equal(coversPath("data/case3_eval_fallback.json", "data/case3_eval_fallback.json"), true);
  assert.equal(coversPath("lib/*.test.ts", "lib/evalXtestXts"), false);
});

// ---------------------------------------------------------------------------
// firstCovering
// ---------------------------------------------------------------------------

test("firstCovering: returns undefined for an unlisted path", () => {
  assert.equal(firstCovering("README.md", leakSources()), undefined);
});

test("firstCovering: returns the entry, so callers can print WHY", () => {
  const found = firstCovering("prompts/few_shot.md", leakSources());
  assert.ok(found, "prompts/few_shot.md must be covered");
  assert.equal(found.path, "prompts/");
  assert.match(found.why, /few_shot\.md 9\/21/);
});

// ---------------------------------------------------------------------------
// leakSources — the list itself. These assert the properties Amendment 2 of
// docs/PREREG-24-blind-relabel.md binds the protocol to; scripts/check-label-
// leaks.ts asserts the stronger, data-driven property (the list is a superset of
// the measured verbatim-title hit set) against the real repository.
// ---------------------------------------------------------------------------

const REQUIRED = [
  // Named by the original, byte-locked protocol.
  "prompts/system_extract_v4.md",
  "data/eval_reports/case1.json",
  "data/case3_eval_fallback.json",
  "held_out/case3/ground_truth.json",
  // Added by Amendment 1.
  "MOCK_DATA.md",
  "lib/fixtures.ts",
  "STATE.md",
  "lib/claude.ts",
  "docs/EVAL.md",
  "prompts/few_shot.md",
  // Added by Amendment 2 — the eight files two hand sweeps missed.
  "app/page.tsx",
  "docs/CASES.md",
  "scripts/verify-extract-route.ts",
  "lib/measure.test.ts",
  "lib/eval.test.ts",
  "lib/claude.test.ts",
  "lib/gemini.test.ts",
  "lib/normalize.test.ts",
];

for (const path of REQUIRED) {
  test(`leakSources: covers ${path}`, () => {
    assert.ok(
      firstCovering(path, leakSources()),
      `${path} carries original ground-truth titles, predictions, or the event count for Cases 1+2 and must be forbidden`,
    );
  });
}

test("leakSources: covers both cases' data directories, including source_drafts", () => {
  const sources = leakSources();
  for (const c of LABELED_CASES) {
    for (const f of ["ground_truth.json", "events.json", "metadata.json"]) {
      assert.ok(firstCovering(`data/cases/${c}/${f}`, sources), `data/cases/${c}/${f}`);
    }
    assert.ok(
      firstCovering(`data/cases/${c}/source_drafts/d1_x.md`, sources),
      `data/cases/${c}/source_drafts/`,
    );
  }
});

test("leakSources: does NOT forbid the packet's own working material", () => {
  // `label_packet/` is what the labeler is supposed to read. If a future entry
  // ever swallowed it the protocol would forbid the sitting itself.
  const sources = leakSources();
  assert.equal(firstCovering("label_packet/case1/README.md", sources), undefined);
  assert.equal(firstCovering("label_packet/case1/blind_labels.json", sources), undefined);
});

test("leakSources: does NOT forbid the pre-registration or the toolkit's own scripts", () => {
  // The prereg quotes zero ground-truth titles by design — Amendment 2 keeps it
  // that way — and the labeler must be able to read the protocol they are bound
  // by. Same for the three scripts they are told to run.
  const sources = leakSources();
  for (const p of [
    "docs/PREREG-24-blind-relabel.md",
    "scripts/make-label-packet.ts",
    "scripts/validate-blind-labels.ts",
    "scripts/compare-relabel.ts",
    "scripts/check-label-leaks.ts",
    "lib/label-leak-sources.ts",
  ]) {
    assert.equal(firstCovering(p, sources), undefined, p);
  }
});

test("leakSources: every entry carries a quantified or categorical reason", () => {
  for (const s of leakSources()) {
    assert.ok(s.why.length > 40, `${s.path}: "why" is too vague to stop a labeler`);
  }
});

test("leakSources: is case-parameterized and defaults to both dev cases", () => {
  const both: LeakSource[] = leakSources();
  const one = leakSources(["case1"]);
  assert.ok(both.length > one.length);
  assert.equal(firstCovering("data/cases/case2/events.json", one), undefined);
  assert.ok(firstCovering("data/cases/case2/events.json", both));
});

test("leakSources: no duplicate entries", () => {
  const paths = leakSources().map((s) => s.path);
  assert.equal(new Set(paths).size, paths.length);
});

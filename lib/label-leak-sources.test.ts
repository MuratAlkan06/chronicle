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
  // Amendment 2 §4's point about this entry: few_shot.md leaks more than the
  // file the original protocol named, so the `why` has to say so. It says it
  // categorically now rather than with a count — see the next test.
  assert.match(found.why, /few_shot\.md/);
  assert.match(found.why, /system_extract_v4\.md/);
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

test("leakSources: names every leaking file in both cases' data directories", () => {
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

// ---------------------------------------------------------------------------
// Amendment 3 §7. The rule inside `data/cases/<case>/` is file-by-file, not
// subtree, so that the equivalent PDFs stay open — the packet's reading-order
// table sends the labeler to them and Part A's protocol tells them to read them
// in a PDF viewer. A blanket subtree entry contradicted both, and a protocol
// that contradicts itself is resolved by whoever is reading it.
//
// These two tests are a pair and neither is complete alone: the one above says
// the leaking files are still named individually, and the one below says the
// narrowing actually landed. Re-widening the entry to `data/cases/<case>/`
// passes the first and fails the second.
// ---------------------------------------------------------------------------

test("leakSources: does NOT forbid the equivalent PDFs the reading order sends the labeler to", () => {
  const sources = leakSources();
  for (const c of LABELED_CASES) {
    for (const p of [
      `data/cases/${c}/docs/d1_pcp_2023_01.pdf`,
      `data/cases/${c}/docs`,
      `data/cases/${c}`,
    ]) {
      assert.equal(
        firstCovering(p, sources),
        undefined,
        `${p} is permitted reading under Amendment 3 §7; a rule covering it contradicts the packet's own reading-order table`,
      );
    }
  }
});

test("leakSources: the data-directory rules are individual files, not a subtree", () => {
  // Stated as a property of the ENTRIES rather than of `coversPath`, because the
  // failure being guarded is someone re-collapsing the four paths back into one
  // directory entry for tidiness. `source_drafts/` is the one legitimate
  // directory rule in there — it has no permitted members.
  for (const c of LABELED_CASES) {
    for (const s of leakSources()) {
      if (!s.path.startsWith(`data/cases/${c}/`) && s.path !== `data/cases/${c}/`) continue;
      assert.ok(
        !s.path.endsWith("/") || s.path === `data/cases/${c}/source_drafts/`,
        `${s.path} closes a subtree under data/cases/${c}/ that holds permitted PDFs`,
      );
    }
  }
});

test("leakSources: does NOT forbid the packet's own working material", () => {
  // `label_packet/` is one of the two things the closed default leaves open. If
  // a future entry ever swallowed it the protocol would forbid the sitting
  // itself, and there would be nothing left to read.
  const sources = leakSources();
  assert.equal(firstCovering("label_packet/case1/README.md", sources), undefined);
  assert.equal(firstCovering("label_packet/case1/blind_labels.json", sources), undefined);
});

test("leakSources: forbids the protocol document and the decision log", () => {
  // REVERSED 2026-07-26. This test previously asserted the opposite, on the
  // ground that both files quote zero ground-truth TITLES and that a labeler
  // must be able to read the protocol binding them. Both halves failed.
  //
  // The first is the exact test #14 of the decision log exists to call
  // insufficient: a control's arithmetic is part of its disclosure surface, and
  // these two carry the arithmetic. The prereg states the aggregate original
  // event count, the per-case split and a per-document figure in plain prose,
  // because an amendment describing a count leak has to name what leaked; the
  // decision log preserves, by its own append-only convention, the superseded
  // entry whose reason strings divided by that same aggregate.
  //
  // The second was answered by making the packet SELF-CONTAINED. The labeler is
  // bound by the protocol quoted verbatim in Parts A–D of their own README, not
  // by a document they have to leave the packet to read.
  const sources = leakSources();
  for (const p of ["docs/PREREG-24-blind-relabel.md", "docs/RESOLVED-DECISIONS.md"]) {
    assert.ok(firstCovering(p, sources), `${p} carries the count anchor in prose and must be forbidden`);
  }
});

test("leakSources: no `why` cites a section of a forbidden document", () => {
  // A reason that says WHERE in a closed document the figures are is a pointer
  // wearing a warning's clothes, and it is rendered into the packet README and
  // the handover banner. `§`, `Amendment N` and `#N` cross-references all fail
  // here; the entries state the KIND of leak instead.
  for (const s of leakSources()) {
    assert.doesNotMatch(s.why, /§/, `${s.path}: "why" cites a section marker`);
    assert.doesNotMatch(s.why, /\bAmendment\b/i, `${s.path}: "why" cites an amendment`);
    assert.doesNotMatch(s.why, /(?:^|\s)#\d+/, `${s.path}: "why" cites a numbered decision entry`);
  }
});

test("leakSources: does NOT forbid the toolkit's own scripts", () => {
  // These carry no answer — they read the labels at runtime rather than quoting
  // them — so they are not instances the list needs to illustrate. That is NOT a
  // permission: under the closed default in lib/label-packet.ts the labeler
  // reads the packet and the case PDFs and nothing else, so these are shut to
  // them by the rule rather than by this array. What the assertion protects is a
  // blanket `scripts/` entry, which would forbid the two commands the labeler is
  // told to run.
  const sources = leakSources();
  for (const p of [
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

// ---------------------------------------------------------------------------
// The count invariant. `scripts/make-label-packet.ts` renders every `why` into
// the packet README's rule block and prints it again in the runtime DO NOT OPEN
// banner, so a `why` is labeler-facing text. Until 2026-07-26 each one carried
// an `N/21` title count whose denominator IS the aggregate original in-scope
// ground-truth event count for the two cases being relabeled — the anchor the
// packet exists to withhold, in rule 1 of mandatory reading. See Amendment 3 §2
// of docs/PREREG-24-blind-relabel.md.
//
// These assertions are deliberately written against the SHAPE of the leak
// rather than against the literal number, so they keep working if the cases
// ever change: no `why` may carry an `N/M` ratio at all, and none may put an
// integer next to event/title/label/prediction wording. `lib/*.test.ts`'s
// "5 of the 9 files" is a count of FILES, which a labeler can get from `ls`.
// ---------------------------------------------------------------------------

test("leakSources: no `why` carries an N/M ratio — the denominator would be the event total", () => {
  for (const s of leakSources()) {
    assert.doesNotMatch(
      s.why,
      /\b\d+\s*\/\s*\d+\b/,
      `${s.path}: "why" carries a ratio. Its denominator is an event count and this string is rendered into the packet README and the DO NOT OPEN banner.`,
    );
  }
});

test("leakSources: no `why` states the aggregate or per-case original event count", () => {
  // The three integers that are the answer: 13 (case1), 8 (case2), 21 (both).
  // The lookarounds keep this precise rather than brittle: `§7`, `system_
  // extract_v4.md` and `lib/*.test.ts` are references, not quantities, and a
  // rule that fired on them would be turned off within a week.
  const answers = [13, 8, 21];
  for (const s of leakSources()) {
    for (const n of answers) {
      assert.doesNotMatch(
        s.why,
        new RegExp(`(?<![\\w./§])${n}(?![\\w./])`),
        `${s.path}: "why" states ${n}, an original event count for Cases 1+2, and this string is rendered into the packet`,
      );
    }
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

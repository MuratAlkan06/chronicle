/**
 * lib/label-packet.test.ts — coverage for the blind labeling packet (issue #24).
 *
 * The end-to-end test at the bottom is the point of this file. Before it existed
 * `npm test` executed NOT ONE LINE of the packet generator — `npm test` globs
 * `lib/*.test.ts`, and all four scripts sit outside it — so the most
 * safety-critical file in the toolkit was verified by being run by hand and read
 * over. It was read over twice, through two amendments, and still shipped the
 * segmentation key it exists to withhold: a stripped-marker count in every
 * document header and again in the closing summary, halving straight into each
 * document's original event count (Amendment 3 §1 of
 * docs/PREREG-24-blind-relabel.md).
 *
 * So the e2e test does not check that the generator ran. It generates a real
 * packet into a temp root and then tries to BREAK it, asserting the emitted tree
 * and the generator's own stdout carry (a) no verbatim original title, (b) no
 * `[SNIPPET]` marker, and (c) no recoverable per-document or aggregate event
 * count.
 *
 * WHY THIS FILE READS ground_truth.json. It is the scorer, not packet input —
 * the same arrangement `scripts/check-label-leaks.ts` uses. A test that asserts
 * "the packet does not contain the answers" has to know the answers. It holds no
 * title or count as a literal, so this file adds no new leak source of its own;
 * it is covered by the `lib/*.test.ts` entry in lib/label-leak-sources.ts
 * regardless.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SNIPPET_MARKER,
  MARKER_RESIDUE,
  stripSnippetMarkers,
  hasMarkerResidue,
  docOrder,
  packetDocFile,
  packetReadme,
  templateJson,
  sittingState,
  asPacketCaseId,
  granularitySection,
  PROTOCOL_BLOCKS,
  PROMPT_BLOCKS,
  SITTING_RULE_LINES,
  STUB_KEY,
  PLACEHOLDER_PATIENT,
  type PacketDoc,
} from "./label-packet";
import { leakSources, firstCovering } from "./label-leak-sources";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CASES = ["case1", "case2"] as const;
type CaseId = (typeof CASES)[number];

// ---------------------------------------------------------------------------
// stripSnippetMarkers — whole-line markers only, and nothing else touched.
// ---------------------------------------------------------------------------

test("stripSnippetMarkers: removes both halves of a marked block, keeps the text", () => {
  const src = ["Intro.", "", "[SNIPPET — DO NOT EDIT]", "HbA1c drawn today.", "[/SNIPPET]", "", "Outro."].join("\n");
  const { body, stripped } = stripSnippetMarkers(src);
  assert.equal(stripped, 2);
  assert.equal(body, ["Intro.", "", "HbA1c drawn today.", "", "Outro."].join("\n"));
});

test("stripSnippetMarkers: leaves no positional scar where a marker line was", () => {
  // The markers sit between blank lines in the real drafts. If stripping left the
  // surrounding blanks adjacent, a run of two blank lines would mark every
  // removal site and the count would be recoverable from the packet alone —
  // which is route R4 of the packet inversion.
  const src = ["A", "", "[SNIPPET — DO NOT EDIT]", "B", "[/SNIPPET]", "", "C"].join("\n");
  const { body } = stripSnippetMarkers(src);
  assert.doesNotMatch(body, /\n[ \t]*\n[ \t]*\n/, "double blank line marks where a marker was removed");
});

test("stripSnippetMarkers: does not touch the word SNIPPET inside prose", () => {
  const src = "The snippet anchors a [SNIPPET] reference mid-sentence.";
  const { body, stripped } = stripSnippetMarkers(src);
  assert.equal(stripped, 0);
  assert.equal(body, src);
});

test("stripSnippetMarkers: tolerates indentation around a marker line", () => {
  const { stripped } = stripSnippetMarkers("  [SNIPPET — DO NOT EDIT]\ntext\n  [/SNIPPET]");
  assert.equal(stripped, 2);
});

test("SNIPPET_MARKER: matches a whole marker line and nothing broader", () => {
  assert.ok(SNIPPET_MARKER.test("[SNIPPET — DO NOT EDIT]"));
  assert.ok(SNIPPET_MARKER.test("[/SNIPPET]"));
  assert.ok(!SNIPPET_MARKER.test("text [SNIPPET] text"));
});

// ---------------------------------------------------------------------------
// hasMarkerResidue — deliberately wider than the stripper.
// ---------------------------------------------------------------------------

test("hasMarkerResidue: catches marker spellings the stripper would miss", () => {
  // This is the whole reason the residue check does not reuse SNIPPET_MARKER. If
  // the drafts' marker spelling drifts, the stripper silently becomes a no-op;
  // a check written against the stripper's own regex drifts with it and passes,
  // and the packet ships the answer key.
  for (const drifted of ["[SNIPPET-DO NOT EDIT]", "[ SNIPPET ]", "[/ SNIPPET ]", "prefix [SNIPPET] suffix", "DO NOT EDIT"]) {
    assert.ok(hasMarkerResidue(drifted), `residue check missed ${JSON.stringify(drifted)}`);
    assert.ok(MARKER_RESIDUE.test(drifted));
  }
});

test("hasMarkerResidue: false on clean clinical text", () => {
  assert.equal(hasMarkerResidue("Pt presents for routine annual physical.\nA1c 9.2%."), false);
});

test("hasMarkerResidue: a fully stripped document has no residue", () => {
  const { body } = stripSnippetMarkers("[SNIPPET — DO NOT EDIT]\nx\n[/SNIPPET]");
  assert.equal(hasMarkerResidue(body), false);
});

// ---------------------------------------------------------------------------
// docOrder
// ---------------------------------------------------------------------------

test("docOrder: sorts by the dN_ prefix numerically, not lexically", () => {
  const names = ["d10_x.md", "d2_x.md", "d1_x.md"];
  assert.deepEqual([...names].sort((a, b) => docOrder(a) - docOrder(b)), ["d1_x.md", "d2_x.md", "d10_x.md"]);
});

test("docOrder: an unprefixed name sorts last rather than to zero", () => {
  assert.ok(docOrder("README.md") > docOrder("d99_x.md"));
});

// ---------------------------------------------------------------------------
// packetDocFile — THE header that carried the leak.
// ---------------------------------------------------------------------------

const doc = (over: Partial<PacketDoc> = {}): PacketDoc => ({
  order: 3,
  draftFile: "d3_pcp_2023_05.md",
  sourceDocument: "d3_pcp_2023_05.pdf",
  body: "Body text.\n",
  ...over,
});

test("packetDocFile: header carries the source_document value and the provenance", () => {
  const out = packetDocFile("case1", doc(), 7);
  assert.match(out, /source_document value to use in blind_labels\.json: "d3_pcp_2023_05\.pdf"/);
  assert.match(out, /\[SNIPPET\] marker lines removed; document text is otherwise verbatim/);
  assert.ok(out.endsWith("Body text.\n"));
});

test("packetDocFile: header states NO quantity of markers", () => {
  // The regression. The header used to read "N [SNIPPET] marker line(s)
  // removed"; markers are paired, so N/2 was this document's original event
  // count, four lines under the value the labeler must copy.
  const out = packetDocFile("case1", doc(), 7);
  const header = /^<!--[\s\S]*?-->/.exec(out)?.[0] ?? "";
  assert.doesNotMatch(header, /\d[^\n]{0,40}SNIPPET|SNIPPET[^\n]{0,40}\d/, "header pairs a number with SNIPPET");
});

test("packetDocFile: the ONLY integers in the header are the ordinal and the document total", () => {
  // Attribution, not absence: both are counts of files the labeler is holding
  // and can get from `ls`. Anything else in there is derived from something the
  // labeler is not supposed to have. Lookarounds exclude digits inside the case
  // name and the document filename.
  const total = 7;
  const out = packetDocFile("case2", doc({ order: 4 }), total);
  const header = /^<!--[\s\S]*?-->/.exec(out)?.[0] ?? "";
  const standalone = [...header.matchAll(/(?<![\w.\-/])(\d+)(?![\w.\-/])/g)].map((m) => Number(m[1]));
  assert.deepEqual(
    standalone.filter((n) => n !== 4 && n !== total),
    [],
    `header carries an integer that is neither the reading-order ordinal nor the document total: ${standalone}`,
  );
});

// ---------------------------------------------------------------------------
// packetReadme / templateJson / granularitySection
// ---------------------------------------------------------------------------

const readmeDocs: PacketDoc[] = [
  doc({ order: 1, draftFile: "d1_a.md", sourceDocument: "d1_a.pdf" }),
  doc({ order: 2, draftFile: "d2_b.md", sourceDocument: "d2_b.pdf" }),
];

test("packetReadme: renders the reading order with the .pdf source_document spelling", () => {
  const md = packetReadme("case1", readmeDocs);
  assert.match(md, /\| 1 \| `docs\/d1_a\.md` \| `"d1_a\.pdf"` \|/);
  assert.match(md, /Write `source_document` exactly as shown, with the `\.pdf` suffix/);
});

test("packetReadme: renders the forbidden list from lib/label-leak-sources.ts", () => {
  const md = packetReadme("case1", readmeDocs);
  for (const p of ["MOCK_DATA.md", "lib/fixtures.ts", "STATE.md", "prompts/", "docs/CASES.md", "held_out/"]) {
    assert.ok(md.includes(p), `packet README omits the forbidden path ${p}`);
  }
});

test("packetReadme: names only THIS case's data paths, not the other dev case's", () => {
  const md = packetReadme("case1", readmeDocs);
  assert.ok(md.includes("data/cases/case1/"));
  assert.ok(!md.includes("data/cases/case2/"), "case1's packet must not name case2's data paths");
});

test("packetReadme: states the closed default verbatim, as the definition of what is forbidden", () => {
  // The terminating move. Three rounds of enumerate-and-deny each shipped a leak
  // through a file nobody had thought to name — the packet header, then the
  // forbidden list's own reason strings, then the protocol document the packet
  // pointed into. A fourth enumeration would have the same shape. The rule is
  // now default-deny, rendered from ONE constant that the generator's handover
  // banner prints too, so the two surfaces cannot drift into contradicting each
  // other.
  const md = packetReadme("case1", readmeDocs);
  assert.ok(md.includes(SITTING_RULE_LINES.join("\n> ")), "the README does not carry the rule verbatim");
  assert.match(md, /\*\*THE RULE\./);
  // Demoted, in the same breath: the list is evidence, not the boundary.
  assert.match(md, /\*\*examples, not the definition\.\*\*/);
  assert.match(md, /Nothing is\s*\n?permitted by being absent from this list/);
});

test("packetReadme: the forbidden list is not rendered as a numbered rule block", () => {
  // Shape, not wording. Numbering the list made it read as the enumeration OF
  // what is forbidden, which is what made a path's absence read as permission.
  const md = packetReadme("case1", readmeDocs);
  const list = md.split("### Why the rule is not paranoia")[1] ?? "";
  assert.ok(list.includes("- `MOCK_DATA.md`"), "the list must still render, as bullets");
  assert.doesNotMatch(list, /^\s{0,3}\d+\. `/m, "the forbidden list is numbered again");
  assert.doesNotMatch(md, /rules 1–\d+|rules 1-\d+/, "the README still speaks of numbered rules");
});

test("packetReadme: bounds what the labeler runs, and does not name the answer-bearing gate", () => {
  // `scripts/check-label-leaks.ts` reads ground_truth.json and prints per-file
  // title counts against the original labels. The README used to name it — in
  // order to say "do not run this" — which is a pointer that has to be resisted
  // rather than a door that is shut. Under the closed default the commands are
  // enumerated positively instead, and the gate refuses to run mid-sitting on
  // its own account (see the sitting-guard tests at the foot of this file), so
  // naming it buys nothing and costs a name.
  const md = packetReadme("case2", readmeDocs);
  assert.match(md, /\*\*What you run — exhaustively:\*\*/);
  assert.ok(md.includes("scripts/validate-blind-labels.ts"));
  assert.ok(md.includes("scripts/compare-relabel.ts"));
  assert.ok(!md.includes("check-label-leaks"), "the packet names the answer-bearing gate");
  assert.ok(!md.includes("label-leak-sources"), "the packet points at the list's source file");
  assert.match(md, /do \*\*not\*\* run the extractor/);
});

test("packetReadme: states the docs/*.pdf carve-out positively, beside the rules that close its siblings", () => {
  // Amendment 3 §7. The rule block used to close `data/cases/<case>/` as a
  // subtree while the reading-order table below it pointed at
  // `data/cases/<case>/docs/*.pdf` as the "equivalent PDF". A packet that
  // contradicts itself is resolved by the reader, in the convenient direction,
  // and the convenient direction landed in the directory that also holds
  // ground_truth.json. Silence would not have fixed it: dropping the subtree
  // rule without saying anything leaves the labeler inferring a permission from
  // a gap in a list. It has to be stated.
  const md = packetReadme("case1", readmeDocs);
  assert.match(md, /`data\/cases\/case1\/docs\/\*\.pdf` is permitted reading/);
  assert.match(md, /\*\*What is open — exhaustively:\*\*/);
  // "What you are doing" bounds the sitting's sources. It said "from the
  // documents in `docs/` and nothing else", which excluded the very PDFs the
  // rest of the packet now tells the labeler to prefer — the original
  // contradiction, relocated one section earlier. Fixing the rule block alone
  // would have moved the defect rather than removed it.
  const scope = md.split("## Rules of this sitting")[0];
  assert.match(scope, /and nothing else/, "the sitting's sources must still be bounded");
  assert.match(scope, /equivalent PDFs/, "the bound must admit the PDFs the packet permits");
  assert.ok(md.includes("data/cases/case1/ground_truth.json"), "the siblings must still be named one by one");
  assert.ok(md.includes("data/cases/case1/events.json"));
  assert.ok(md.includes("data/cases/case1/metadata.json"));
  assert.ok(md.includes("data/cases/case1/source_drafts/"));
});

test("packetReadme: no list entry closes the directory the reading-order table sends the labeler into", () => {
  // The defect stated as a property rather than as a string: however the list is
  // rendered — numbered before, bulleted now — no entry may name the PDF
  // directory as a whole subtree while the table below cites paths inside it.
  const md = packetReadme("case1", readmeDocs);
  const rules = md.split("## Reading order")[0];
  const entry = /^(?:\s{0,3}\d+\.|[-*])\s+`data\/cases\/case1\/(?:`|docs)/m;
  assert.ok(!entry.test(rules), "a list entry closes the whole data directory or the PDF directory");
  assert.ok(md.includes("data/cases/case1/docs/d1_a.pdf"), "the reading-order table must still cite the PDFs");
});

test("packetReadme: withholds the target event count without restating, bounding or locating it", () => {
  const md = packetReadme("case1", readmeDocs);
  assert.match(md, /\*\*not restated,\s+paraphrased, or bounded anywhere\s+in this packet\*\*/);
  // And without saying WHERE it is. This bullet used to open "§5's labeling
  // checklist names one", which points a labeler at the section of a closed
  // document that holds the anchor — a pointer with no path in it, so the
  // path-token audit could not see it.
  assert.match(md, /Where it lives is not stated here either/);
  assert.doesNotMatch(md, /§\d[^\n]{0,40}(checklist|names one)/);
});

test("templateJson: is a stub the validator will refuse until it is edited", () => {
  const parsed = JSON.parse(templateJson("case1"));
  assert.equal(parsed.case_id, "case1");
  assert.ok(String(parsed.patient).startsWith("REPLACE_"));
  assert.ok(String(parsed.labeled_at).startsWith("REPLACE_"));
  assert.equal(parsed.events.length, 1);
  assert.ok(STUB_KEY in parsed.events[0], "the stub key must be present so the validator blocks a pristine template");
});

test("templateJson: the template gives no example date, type or phrasing to anchor on", () => {
  const parsed = JSON.parse(templateJson("case2"));
  const ev = parsed.events[0];
  assert.equal(ev.date, "REPLACE_YYYY-MM-DD");
  assert.ok(String(ev.title).startsWith("REPLACE_"));
  // The enum fields list every legal value rather than picking one, so neither
  // is an example.
  assert.ok(String(ev.event_type).includes(" | "));
  assert.ok(String(ev.date_confidence).includes(" | "));
});

// ---------------------------------------------------------------------------
// sittingState — the one answer to "has labeling started?", shared by the
// generator's clobber guard and the leak gate's sitting guard.
// ---------------------------------------------------------------------------

test("sittingState: a missing file is absent, an untouched template is pristine", () => {
  assert.equal(sittingState(undefined, "case1"), "absent");
  assert.equal(sittingState(templateJson("case1"), "case1"), "pristine");
  assert.equal(sittingState(templateJson("case2"), "case2"), "pristine");
});

test("sittingState: any edit at all is a sitting in progress", () => {
  // Byte-equality, not a JSON parse and not a stub-key probe. A labeler who has
  // typed one character has started; a file that merely still parses as the
  // template has not necessarily.
  const t = templateJson("case1");
  assert.equal(sittingState(t.replace("gt_001", "gt_002"), "case1"), "in-progress");
  assert.equal(sittingState(t.replace(/\n$/, ""), "case1"), "in-progress");
  assert.equal(sittingState(t + " ", "case1"), "in-progress");
  assert.equal(sittingState("", "case1"), "in-progress");
});

test("sittingState: another case's template is not this case's pristine state", () => {
  assert.equal(sittingState(templateJson("case2"), "case1"), "in-progress");
});

test("sittingState: an unclassifiable packet directory fails closed", () => {
  // No template exists to compare against, so there is no basis for calling it
  // pristine. The guard's job is to refuse when it cannot clear something.
  assert.equal(sittingState(templateJson("case1"), undefined), "in-progress");
  assert.equal(sittingState(undefined, undefined), "absent");
});

test("asPacketCaseId: maps a packet subdirectory name onto its template, or nothing", () => {
  assert.equal(asPacketCaseId("case1"), "case1");
  assert.equal(asPacketCaseId("case2"), "case2");
  for (const n of ["case3", "case1.kept", "docs", "", "CASE1"]) {
    assert.equal(asPacketCaseId(n), undefined, n);
  }
});

test("granularitySection: marks both generator-authored replacements as [REPLACED]", () => {
  const s = granularitySection();
  // Two replacement passages, each carrying a `[REPLACED]` marker, plus the
  // prose sentence that tells the labeler what the marker means — so three
  // occurrences of the token, not two. Asserted on substance: both replacement
  // bodies must be present and both must be marked, because an unmarked
  // replacement would read as a verbatim quote from the prompt.
  assert.equal((s.match(/\[REPLACED\]/g) ?? []).length, 3);
  assert.match(s, /Both replacements are marked `\[REPLACED\]`/);
  assert.match(s, /forward-looking plans \(an intention recorded for a future date\)[\s\S]{0,120}<-- \[REPLACED\]/);
  assert.match(s, /\[REPLACED\]\nIf this document merely REFERENCES a prior event for context/);
  assert.ok(s.includes("Do not open `prompts/system_extract_v4.md` for this sitting."));
});

// ---------------------------------------------------------------------------
// THE POINTER AUDIT — the closed default, turned back on the packet itself.
//
// The rule says the labeler reads this packet and the case PDFs and nothing
// else. A packet that then cites a repository document by section has revoked
// its own rule for the reader who follows the citation, and that is exactly how
// the last round shipped: `packetReadme` sent the labeler into
// `docs/PREREG-24-blind-relabel.md` twice, once at a section reached by
// scrolling past the one that states the withheld aggregate in prose.
//
// So this is a property, not a string check. Every repo-path-shaped token the
// packet names must fall into one of four buckets, and there is no fifth:
//   - the packet's own material, which is open;
//   - `data/cases/<case>/docs/…`, the one carve-out, which is open;
//   - a command the labeler is told to run;
//   - a path on the forbidden list — i.e. named IN ORDER TO CLOSE IT.
// A file mentioned for any other reason is a pointer, whatever the sentence
// around it says.
// ---------------------------------------------------------------------------

/** Repo-path-shaped tokens the packet names inside backticks. Bare identifiers
 * (`in_scope`, `matchesEvent`) are not paths and are not scanned. */
function pathTokens(md: string): string[] {
  const re = /`([A-Za-z0-9_][A-Za-z0-9_.*/-]*(?:\.(?:md|ts|tsx|json|jsonc|pdf|html)|\/))`/g;
  return [...new Set([...md.matchAll(re)].map((m) => m[1]))];
}

test("packetReadme: names no repository path except to close it, to run it, or because it is open", () => {
  const caseId: CaseId = "case1";
  const md = packetReadme(caseId, readmeDocs);
  const sources = leakSources([caseId]);

  /** Open: the packet itself, and the one carve-out. */
  const open = new Set<string>([
    "label_packet/",
    "blind_labels.json",
    "docs/", // the packet's own document directory
    `data/cases/${caseId}/`, // named only to say that nothing else in it is open
    `data/cases/${caseId}/docs/`,
    `data/cases/${caseId}/docs/*.pdf`,
    ...readmeDocs.map((d) => `docs/${d.draftFile}`),
    ...readmeDocs.map((d) => `data/cases/${caseId}/docs/${d.sourceDocument}`),
  ]);
  /** Run, not read. The generator is named as the artifact's provenance stamp,
   * which is how a labeler reports a defective packet against the right thing. */
  const runnable = new Set([
    "scripts/validate-blind-labels.ts",
    "scripts/compare-relabel.ts",
    "scripts/make-label-packet.ts",
  ]);

  for (const tok of pathTokens(md)) {
    if (open.has(tok) || runnable.has(tok)) continue;
    // Bare filenames in prose (`ground_truth.json`, `source_drafts/`) refer to
    // the labeled case's directory; resolve them there before judging.
    const covered =
      firstCovering(tok, sources) ?? firstCovering(`data/cases/${caseId}/${tok}`, sources);
    assert.ok(
      covered,
      `the packet names "${tok}", which is neither open to the labeler, nor a command they run, nor on the forbidden list — so it is a pointer out of the packet`,
    );
  }
});

test("packetReadme: cites no section of any repository document", () => {
  // The failure this closes is narrower than the one above and survived it: a
  // path may legitimately appear because it is forbidden, and a "see Amendment 3
  // §7 of <that path>" rides in on the same legitimacy. A section reference is a
  // reading instruction; the packet issues none.
  for (const c of CASES) {
    const md = packetReadme(c, readmeDocs);
    // Scanned with the VERBATIM quotation removed. Part A reproduces docs/EVAL.md
    // §5 byte-for-byte — the generator's fidelity check refuses to write a packet
    // otherwise — and §5's own text says "see the correction note below and §7".
    // The packet may not edit that; the test above asserts it is closed in place
    // instead. Everything OUTSIDE the quotation is the generator's own prose, and
    // that is what this assertion binds.
    const authored = PROTOCOL_BLOCKS.reduce((acc, b) => acc.replace(b.text, ""), md);
    assert.doesNotMatch(authored, /\bAmendment\b/i, "the packet cites an amendment of the pre-registration");
    assert.doesNotMatch(authored, /\bSee [^\n.]*§/i, "the packet issues a section reading instruction");
    assert.doesNotMatch(
      authored,
      /§\d+ of `?docs\//i,
      "the packet cites a section of a repository document by path",
    );
    // The prereg may be NAMED — it is on the forbidden list and the list is
    // rendered — but only there, and exactly once.
    const prereg = [...md.matchAll(/PREREG-24-blind-relabel\.md/g)].length;
    assert.equal(prereg, 1, `the pre-registration is named ${prereg} times; only its forbidden-list entry may name it`);

    // A BARE section reference is worse than a cited one, and it is what the
    // path-token scan above cannot see: "§5's labeling checklist names one"
    // told the labeler that the withheld target count lives in a section of a
    // document they do not hold, without ever naming a path. So every section
    // reference in authored prose must sit in a paragraph that also names the
    // document it belongs to — which puts it beside that document's own closure.
    for (const para of authored.split(/\n\s*\n/)) {
      if (!/§\d/.test(para)) continue;
      assert.ok(
        para.includes("EVAL.md"),
        `a section reference appears in a paragraph that does not name the document it is in: ${JSON.stringify(para.slice(0, 120))}`,
      );
    }
  }
});

test("packetReadme: contains the §7 citation it cannot remove, and closes it in place", () => {
  // The one irreducible pointer. docs/EVAL.md §5's items 4 and 5 carry
  // `[Corrected …]` markers reading "see the correction note below and §7", and
  // Part A quotes §5 VERBATIM — the generator's fidelity check asserts the block
  // appears byte-for-byte in docs/EVAL.md, and reproducing the labeler's
  // conditions exactly is the experiment. Editing the citation out would
  // falsify the quotation. It is therefore neutralised where it appears instead:
  // Part A states that §7 is closed and that Part B IS that correction.
  const md = packetReadme("case1", readmeDocs);
  assert.ok(md.includes("See the correction note below and §7."), "the verbatim quotation must be intact");
  assert.match(md, /Do not go looking for §7\./);
  assert.match(md, /\*\*Part B below IS that correction, in full\.\*\*/);
});

test("PROTOCOL_BLOCKS / PROMPT_BLOCKS: every block has a label and non-trivial text", () => {
  for (const b of [...PROTOCOL_BLOCKS, ...PROMPT_BLOCKS]) {
    assert.ok(b.label.length > 3, `block label too short: ${b.label}`);
    assert.ok(b.text.length > 60, `block "${b.label}" text too short to be the real passage`);
  }
});

// ---------------------------------------------------------------------------
// END-TO-END. Generate a real packet into a temp root, then try to invert it.
// ---------------------------------------------------------------------------

interface Emitted {
  case: CaseId;
  rel: string;
  text: string;
}

/** Everything the labeler holds, split into the two surfaces that matter:
 * generator-AUTHORED text (headers, README, template) and verbatim document
 * BODIES. A number in a body is a lab value or a date and is attributable to
 * nothing; a number in authored text came from the generator and has to be
 * accounted for. */
const headerOf = (e: Emitted): string => (/^<!--[\s\S]*?-->/.exec(e.text)?.[0] ?? "");
const bodyOf = (e: Emitted): string => e.text.replace(/^<!--[\s\S]*?-->\n/, "");
const isDoc = (e: Emitted): boolean => e.rel.startsWith("docs/");
const authoredOf = (e: Emitted): string => (isDoc(e) ? headerOf(e) : e.text);

/** Markdown ordinals, section references and correspondence notation are not
 * quantities. The packet is full of them — the forbidden-list rules are a
 * numbered list that runs past both case totals, and docs/EVAL.md §5's protocol
 * items are quoted verbatim with their numbering. A count check that cannot tell
 * "rule 13" from "13 events" fails on every run and gets deleted. */
const ORDINAL_FORMS = [
  /^\s{0,4}\d+\.\s/gm, // "12. `data/cases/case1/` — …"
  /§\d+/g, // "§5's labeling checklist"
  /\b[Ii]tems?\s+\d+/g, // "Item 4's second sentence"
  /\b[Rr]ules?\s+\d+/g, // "rules 1–17"
  /\b\d+-\d+\b/g, // "mapping 1-1"
  /\b\d+×/g, // "2× on token count"
];
function withoutOrdinals(s: string): string {
  return ORDINAL_FORMS.reduce((acc, re) => acc.replace(re, " "), s);
}
/** Standalone integers only: never a digit inside an identifier, filename or
 * date (`case2`, `d3_referral_2024_03`, `system_extract_v4`). */
function standaloneIntegers(s: string): number[] {
  return [...s.matchAll(/(?<![\w.\-/])(\d+)(?![\w.\-/])/g)].map((m) => Number(m[1]));
}

/**
 * Generator stdout with the IO-ledger lines removed, so the count scan sees
 * prose and not file bookkeeping.
 *
 * The per-file ledger rows carry byte sizes and sha256 prefixes; the ledger
 * SUMMARY line counts file reads. Every integer on those lines is a count of
 * files or bytes by construction. The summary is excluded for a specific
 * measured reason: it collides with the cross-case event total in exactly one of
 * four run configurations, and the collision is arithmetic rather than causal —
 *
 *   reads = 2 fidelity + 2·|cases| listings + |drafts| + |clobber-guard reads|
 *   both cases, fresh   2+4+13+0 = 19      both cases, re-run  2+4+13+2 = 21
 *   case1 only, fresh   2+2+ 7+0 = 11      case2 only, fresh   2+2+ 6+0 = 10
 *
 * against event totals of 13 (case1), 8 (case2), 21 (both). A quantity that
 * tracked the labels would print 13 for case1-only and 8 for case2-only; it
 * prints 11 and 10. Without this exclusion the re-run configuration could not be
 * covered at all, which would leave the clobber-guard path untested. Every other
 * stdout line is still scanned, including the per-case summary — that is where
 * the aggregate marker count used to be printed.
 */
function scannableStdout(s: string): string {
  return s
    .split("\n")
    .filter(
      (l) =>
        !/^\s+\d+B\s+[0-9a-f]{12}\s/.test(l) &&
        !/^\s+(packet-content|listing|fidelity-check|clobber-guard)\s/.test(l) &&
        !/\d+ read\(s\) total by this script/.test(l) &&
        !/a syscall-level trace of this run will count a few more than \d+/.test(l),
    )
    .join("\n");
}

const dataPresent = CASES.every((c) => existsSync(join(REPO_ROOT, "data", "cases", c, "source_drafts")));

test("end-to-end: the generated packet leaks no title, no marker and no event count", { skip: !dataPresent ? "data/cases/* not present in this checkout" : false }, () => {
  const outRoot = mkdtempSync(join(tmpdir(), "label-packet-e2e-"));
  try {
    const run = spawnSync(
      join(REPO_ROOT, "node_modules", ".bin", "tsx"),
      [join(REPO_ROOT, "scripts", "make-label-packet.ts"), `--out=${outRoot}`],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
    );
    assert.equal(run.status, 0, `generator exited ${run.status}\n${run.stderr}`);
    const stdout = run.stdout;

    // Second run over the packet just written. This is the configuration a
    // labeler actually hits when they regenerate, and it is the only one that
    // exercises the clobber guard's pristine-template path — the guard must
    // recognise its own output as safe to rewrite, or regenerating would refuse.
    // It also prints a different read total, so the count scan below covers both
    // stdout shapes rather than only the fresh one.
    const rerun = spawnSync(
      join(REPO_ROOT, "node_modules", ".bin", "tsx"),
      [join(REPO_ROOT, "scripts", "make-label-packet.ts"), `--out=${outRoot}`],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
    );
    assert.equal(rerun.status, 0, `generator refused to regenerate over its own pristine packet\n${rerun.stderr}`);
    assert.match(rerun.stdout, /existing blind_labels\.json is a pristine template/);
    const rerunStdout = rerun.stdout;

    // ---- collect what the labeler receives --------------------------------
    const emitted: Emitted[] = [];
    for (const c of CASES) {
      const caseDir = join(outRoot, c);
      assert.ok(existsSync(caseDir), `generator wrote no packet for ${c}`);
      const walk = (dir: string, prefix: string): void => {
        for (const d of readdirSync(dir, { withFileTypes: true })) {
          if (d.isDirectory()) walk(join(dir, d.name), `${prefix}${d.name}/`);
          else emitted.push({ case: c, rel: `${prefix}${d.name}`, text: readFileSync(join(dir, d.name), "utf8") });
        }
      };
      walk(caseDir, "");
    }
    const docsOut = emitted.filter(isDoc);
    assert.ok(docsOut.length > 0, "packet contains no documents");

    // ---- the answer sheet, read only to score -----------------------------
    const perDoc = new Map<string, number>(); // `${case}/${pdf}` -> event count
    const caseTotal = new Map<CaseId, number>();
    const titles = new Map<CaseId, string[]>();
    for (const c of CASES) {
      const gt: { events: Array<{ source_document: string; title: string }> } = JSON.parse(
        readFileSync(join(REPO_ROOT, "data", "cases", c, "ground_truth.json"), "utf8"),
      );
      for (const e of gt.events) perDoc.set(`${c}/${e.source_document}`, (perDoc.get(`${c}/${e.source_document}`) ?? 0) + 1);
      caseTotal.set(c, gt.events.length);
      titles.set(c, gt.events.map((e) => e.title).filter((t) => t.length >= 6));
    }
    /** Every integer that IS an answer, or decodes to one by the paired-marker
     * rule the packet README states. */
    const answers = new Map<number, string>();
    for (const c of CASES) {
      answers.set(caseTotal.get(c)!, `${c}'s original event total`);
      answers.set(caseTotal.get(c)! * 2, `${c}'s marker-line total, which halves to its event total`);
    }
    // The CROSS-CASE total belongs here too, and leaving it out is how the
    // second leak survived: the forbidden-list entries quantified every title
    // leak as `N/21`, and 21 is the sum over both cases, not either case's
    // total. The labeler works both packets, so a two-case total is an anchor on
    // the second one — after labeling case1 at n, case2's expected count is
    // 21 − n. It is an answer whether or not it names a case.
    const bothCases = CASES.reduce((a, c) => a + caseTotal.get(c)!, 0);
    answers.set(bothCases, "the original event total across BOTH cases");
    answers.set(bothCases * 2, "the marker-line total across both cases, which halves to their event total");

    // ---- (a) no verbatim original ground-truth title ----------------------
    for (const e of emitted) {
      for (const t of titles.get(e.case)!) {
        assert.ok(
          !authoredOf(e).includes(t),
          `${e.case}/${e.rel}: generator-authored packet text reproduces an original ground-truth title verbatim`,
        );
      }
    }
    // A title may survive in a document BODY only because the document itself
    // says it — data/cases/case2/source_drafts/d3_referral_2024_03.md carries
    // "OB/GYN annual visit" in its list of enclosed documents. That is
    // irreducible: the labeler is meant to read the document. It is asserted
    // rather than ignored, so that a title appearing in a body the SOURCE DRAFT
    // does not contain would fail here.
    for (const e of docsOut) {
      for (const t of titles.get(e.case)!) {
        if (!bodyOf(e).includes(t)) continue;
        const src = readFileSync(join(REPO_ROOT, "data", "cases", e.case, "source_drafts", e.rel.replace(/^docs\//, "")), "utf8");
        assert.ok(src.includes(t), `${e.case}/${e.rel}: a title appears in the body that the source draft does not contain`);
      }
    }

    // ---- (b) no [SNIPPET] marker anywhere in a document -------------------
    for (const e of docsOut) {
      assert.equal(hasMarkerResidue(bodyOf(e)), false, `${e.case}/${e.rel}: marker vocabulary survived into the document body`);
      for (const line of bodyOf(e).split("\n")) {
        assert.equal(SNIPPET_MARKER.test(line.trim()), false, `${e.case}/${e.rel}: a marker line survived stripping`);
      }
    }

    // ---- (c) no recoverable per-document or aggregate event count ---------
    // (c1) per-document header: only the ordinal and the document total.
    for (const e of docsOut) {
      const total = docsOut.filter((d) => d.case === e.case).length;
      const ordinal = Number(/document (\d+) of/.exec(headerOf(e))?.[1] ?? NaN);
      assert.ok(Number.isFinite(ordinal), `${e.case}/${e.rel}: header has no reading-order ordinal`);
      const leftovers = standaloneIntegers(headerOf(e)).filter((n) => n !== ordinal && n !== total);
      assert.deepEqual(leftovers, [], `${e.case}/${e.rel}: header carries integer(s) ${leftovers} beyond the ordinal and the document total`);
    }

    // (c2) no authored integer is an answer, in any packet file or in stdout.
    const surfaces: Array<{ what: string; text: string }> = [
      ...emitted.map((e) => ({ what: `${e.case}/${e.rel}`, text: authoredOf(e) })),
      { what: "generator stdout", text: scannableStdout(stdout) },
      { what: "generator stdout (re-run over the existing packet)", text: scannableStdout(rerunStdout) },
    ];
    for (const { what, text } of surfaces) {
      for (const n of standaloneIntegers(withoutOrdinals(text))) {
        const why = answers.get(n);
        assert.equal(why, undefined, `${what}: states ${n} — ${why}`);
      }
    }

    // (c2b) no `N/M` ratio whose numerator or denominator is an answer.
    // Separate from (c2) on purpose: `standaloneIntegers` excludes digits
    // adjacent to `/` so that path fragments (`data/cases/case1/`) are not read
    // as numbers, and that exclusion also swallows the ratio form — which is
    // precisely the shape the packet leaked in until 2026-07-26, when every
    // forbidden-list entry was quantified as `N/21` and the denominator was the
    // aggregate event total. A check that cannot see the historical leak is not
    // a check.
    for (const { what, text } of surfaces) {
      for (const m of text.matchAll(/(?<![\w.])(\d+)\s*\/\s*(\d+)(?![\w.])/g)) {
        for (const part of [Number(m[1]), Number(m[2])]) {
          assert.equal(
            answers.get(part),
            undefined,
            `${what}: states the ratio ${m[0]}, and ${part} is ${answers.get(part)}`,
          );
        }
      }
    }

    // (c3) no quantity sits beside marker/snippet/strip wording.
    for (const { what, text } of surfaces) {
      for (const line of withoutOrdinals(text).split("\n")) {
        assert.doesNotMatch(
          line,
          /\b\d+\b[^\n]{0,60}(marker|snippet|strip)|(marker|snippet|strip)[^\n]{0,60}\b\d+\b/i,
          `${what}: a quantity sits next to marker/snippet/strip wording`,
        );
      }
    }

    // (c4) no positional residue marking where marker lines were removed.
    for (const e of docsOut) {
      const lines = bodyOf(e).split("\n");
      assert.doesNotMatch(bodyOf(e), /\n[ \t]*\n[ \t]*\n/, `${e.case}/${e.rel}: a run of blank lines marks a removal site`);
      assert.equal(
        lines.filter((l) => l.trim() !== "" && l !== l.trimEnd()).length,
        0,
        `${e.case}/${e.rel}: trailing whitespace marks a removal site`,
      );
    }

    // (c5) document byte size must not rank-order the documents by event count.
    for (const c of CASES) {
      const cd = docsOut.filter((d) => d.case === c);
      if (cd.length < 3) continue;
      const key = (e: Emitted): number => perDoc.get(`${c}/${e.rel.replace(/^docs\//, "").replace(/\.md$/, ".pdf")}`) ?? 0;
      const bySize = [...cd].sort((a, b) => a.text.length - b.text.length).map((e) => e.rel);
      const byCount = [...cd].sort((a, b) => key(a) - key(b)).map((e) => e.rel);
      assert.notDeepEqual(bySize, byCount, `${c}: document size rank order reproduces the event-count rank order`);
    }
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// THE LEAK GATE'S SITTING GUARD.
//
// `scripts/check-label-leaks.ts` reads the original labels and prints, per file,
// how many original titles that file carries — and the packet README names it to
// the labeler, while explaining that the list they are reading is enforced. A
// labeler who runs it mid-sitting to check themselves is handed a ranked map of
// where the answers are.
//
// Exercised through the REAL script rather than through `sittingState` alone,
// because the property that matters is not "the predicate returned in-progress"
// but "not one answer reached the terminal", and only the script can show that.
// The unit tests above cover the predicate's edges; these cover the wiring.
// ---------------------------------------------------------------------------

const gtPresent = CASES.every((c) => existsSync(join(REPO_ROOT, "data", "cases", c, "ground_truth.json")));
const skipGate = !gtPresent ? "data/cases/*/ground_truth.json not present in this checkout" : false;

function runGate(packetRoot: string, ...flags: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(
    join(REPO_ROOT, "node_modules", ".bin", "tsx"),
    [join(REPO_ROOT, "scripts", "check-label-leaks.ts"), `--packet=${packetRoot}`, ...flags],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function writeLabels(root: string, dir: string, contents: string): void {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, "blind_labels.json"), contents, "utf8");
}

/** The answers, read only to assert that a refused run printed none of them. */
function originalTitles(): string[] {
  return CASES.flatMap((c) => {
    const gt: { events: Array<{ title: string }> } = JSON.parse(
      readFileSync(join(REPO_ROOT, "data", "cases", c, "ground_truth.json"), "utf8"),
    );
    return gt.events.map((e) => e.title).filter((t) => t.length >= 6);
  });
}

/** A packet that has been labeled in: the patient placeholder filled in, which
 * is the first thing a labeler touches. Any single byte would do — the guard
 * tests byte-equality — but a plausible edit makes the test read as the scenario
 * it is standing in for. */
function editedLabels(caseId: CaseId): string {
  return templateJson(caseId).replace(PLACEHOLDER_PATIENT, "REDACTED PATIENT, 54F");
}

test("check-label-leaks: refuses while a sitting is in progress, without reading an answer", { skip: skipGate }, () => {
  const root = mkdtempSync(join(tmpdir(), "leak-gate-sitting-"));
  try {
    writeLabels(root, "case1", editedLabels("case1"));
    writeLabels(root, "case2", templateJson("case2"));
    const r = runGate(root);

    assert.equal(r.status, 1, `gate ran during a sitting\n${r.stdout}`);
    assert.match(r.stderr, /REFUSED — a labeling sitting is in progress/);
    assert.match(r.stderr, /case1[/\\]blind_labels\.json/, "the refusal must name the file to act on");
    assert.ok(
      !/case2[/\\]blind_labels\.json/.test(r.stderr),
      "a pristine template is not a sitting and must not be reported as one",
    );

    // The property the guard exists for.
    const printed = r.stdout + r.stderr;
    for (const t of originalTitles()) {
      assert.ok(!printed.includes(t), "a refused run printed an original ground-truth title");
    }
    assert.ok(!/hits\s+file/.test(r.stdout), "a refused run printed the per-file hit table");
    assert.ok(!/\d+\/\d+\s+\S/.test(r.stdout), "a refused run printed per-file title counts");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check-label-leaks: an unrecognised packet directory fails closed", { skip: skipGate }, () => {
  // No template exists for `case1.kept`, so nothing can clear it. The blocked
  // state is the safe one to land in when the guard cannot classify something.
  const root = mkdtempSync(join(tmpdir(), "leak-gate-unknown-"));
  try {
    writeLabels(root, "case1.kept", templateJson("case1"));
    const r = runGate(root);
    assert.equal(r.status, 1, `gate ran over an unclassifiable packet\n${r.stdout}`);
    assert.match(r.stderr, /REFUSED — a labeling sitting is in progress/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check-label-leaks: still runs before the sitting, which is where the protocol puts it", { skip: skipGate }, () => {
  // The guard must not cost the gate its legitimate use. Two pre-sitting states:
  // a freshly generated packet, and no packet at all.
  const root = mkdtempSync(join(tmpdir(), "leak-gate-pristine-"));
  try {
    writeLabels(root, "case1", templateJson("case1"));
    writeLabels(root, "case2", templateJson("case2"));
    const r = runGate(root);
    assert.equal(r.status, 0, `gate refused a pristine packet\n${r.stderr}`);
    assert.match(r.stdout, /sitting guard:\s+clear/);
    assert.match(r.stdout, /PASS — the forbidden list is a superset of the hit set/);

    const none = runGate(join(root, "not-generated-yet"));
    assert.equal(none.status, 0, `gate refused with no packet present\n${none.stderr}`);
    assert.match(none.stdout, /sitting guard:\s+clear — no packet under/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check-label-leaks: --sitting-over reopens it once the sitting cannot be protected", { skip: skipGate }, () => {
  // After compare-relabel.ts has run, contamination is no longer preventable and
  // this is a maintenance check again. compare-relabel.ts writes no artifact, so
  // the flag is an assertion by the operator rather than a detected fact — and
  // the script says so rather than implying it checked.
  const root = mkdtempSync(join(tmpdir(), "leak-gate-over-"));
  try {
    writeLabels(root, "case1", editedLabels("case1"));
    const r = runGate(root, "--sitting-over");
    assert.equal(r.status, 0, `--sitting-over did not reopen the gate\n${r.stderr}`);
    assert.match(r.stdout, /OVERRIDDEN by --sitting-over/);
    assert.match(r.stdout, /your assertion that compare-relabel\.ts has run/);
    assert.match(r.stdout, /PASS — the forbidden list is a superset of the hit set/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

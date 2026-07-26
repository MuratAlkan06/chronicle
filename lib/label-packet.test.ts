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
 * packet into a temp root and then tries to BREAK it.
 *
 * WHAT IT ASSERTS CHANGED SHAPE ON 2026-07-26, and the change is the point.
 * Rounds of this audit closed one observable at a time — a printed count, then a
 * whitespace scar, then structural proxies, then byte-size rank order — and each
 * fix was followed by another route through the same door. The door was that the
 * packet shipped a marker-STRIPPED COPY of every source draft. A copy is a
 * second ledger: `source_bytes − copy_bytes` is a fixed constant times that
 * document's original event count, and the constant falls out of the deltas
 * themselves. Every observable of a derived artifact carries that information,
 * so no enumeration of observables could terminate.
 *
 * The copies are gone. The packet is a README and a blind-label template; the
 * labeler reads `data/cases/<case>/docs/*.pdf` in place. So the count family of
 * assertions is replaced by a STRUCTURAL one — **no artifact in the packet is
 * derived from `source_drafts/` at all** — which is a property of the artifact
 * set rather than a scan for the current spelling of a leak. The title, marker,
 * pointer and section-citation audits are kept as they were, and the title one
 * gets strictly stronger: with no document body in the packet, the number of
 * verbatim original titles a packet may contain is zero.
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
  docOrder,
  packetReadme,
  templateJson,
  sittingState,
  asPacketCaseId,
  granularitySection,
  PACKET_ARTIFACTS,
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
// PACKET_ARTIFACTS — the closed list of what a packet may contain.
//
// The expected set is written out HERE rather than imported and compared
// against itself, so that adding a member to the constant fails this test
// instead of moving it. That is the whole tripwire: the artifact this audit
// removed — a marker-stripped copy of every case document — can only come back
// through that array.
// ---------------------------------------------------------------------------

test("PACKET_ARTIFACTS: a packet is a README and a blind-label template, and nothing else", () => {
  assert.deepEqual([...PACKET_ARTIFACTS].sort(), ["README.md", "blind_labels.json"]);
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
// packetReadme / templateJson / granularitySection
// ---------------------------------------------------------------------------

const readmeDocs: PacketDoc[] = [
  { order: 1, sourceDocument: "d1_a.pdf" },
  { order: 2, sourceDocument: "d2_b.pdf" },
];

test("packetReadme: the reading order points at the PDFs, in place, by full path", () => {
  // The reading-order table IS the manifest. It used to have a fourth column
  // naming an "equivalent PDF" beside a packet-local `.md` copy; the copy was
  // the derived artifact whose size leaked each document's event count, so the
  // PDF is no longer the alternative — it is the document.
  const md = packetReadme("case1", readmeDocs);
  assert.match(md, /\| 1 \| `data\/cases\/case1\/docs\/d1_a\.pdf` \| `"d1_a\.pdf"` \|/);
  assert.match(md, /\| 2 \| `data\/cases\/case1\/docs\/d2_b\.pdf` \| `"d2_b\.pdf"` \|/);
  assert.match(md, /Write `source_document` exactly as shown, with the `\.pdf` suffix/);
  assert.match(md, /Open each PDF in a PDF viewer/);
});

test("packetReadme: sends the labeler to no packet-local copy of any document", () => {
  // The structural property, stated on the rendering rather than on the emitted
  // tree, so it fails at unit speed. Every case document's filename carries a
  // `dN_` reading-order stem, so a backticked `.md` path with that stem in it
  // can only be a markdown copy of a document — the artifact this round removed.
  // Written against the stem rather than against the literal `docs/` prefix so
  // that relocating the copies would not slip past, and so that the repository's
  // own `docs/EVAL.md` and friends are untouched by it.
  for (const c of CASES) {
    const md = packetReadme(c, readmeDocs);
    assert.doesNotMatch(md, /`[^`]*d\d+_[^`]*\.md`/, "the README points at a markdown copy of a case document");
    assert.doesNotMatch(md, /marker lines stripped|marker lines removed/, "the README describes a stripped copy");
    assert.match(md, /This packet carries your instructions, not the documents\./);
  }
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
  // rest of the packet told the labeler to prefer — the original contradiction,
  // relocated one section earlier. There is only one source now, so the bound
  // and the carve-out name the same thing and cannot disagree.
  const scope = md.split("## Rules of this sitting")[0];
  assert.match(scope, /and nothing else/, "the sitting's sources must still be bounded");
  assert.match(scope, /case\s+PDFs/, "the bound must name the PDFs as the documents");
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

  /** Open: the packet itself, and the one carve-out. The packet's own
   * `docs/` subdirectory used to be in here; it no longer exists. */
  const open = new Set<string>([
    "label_packet/",
    "blind_labels.json",
    `data/cases/${caseId}/`, // named only to say that nothing else in it is open
    `data/cases/${caseId}/docs/`,
    `data/cases/${caseId}/docs/*.pdf`,
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

/** EVERY byte the labeler holds is now generator-authored, so this split has
 * collapsed and the scans below apply to whole files.
 *
 * There used to be two surfaces: authored text (document headers, README,
 * template) and verbatim document BODIES, with the count scans applied only to
 * the first because a number in a body is a lab value and is attributable to
 * nothing. That carve-out is what a derived copy costs — it exempts most of the
 * packet from the audit and then leaks through the exempt part's SIZE. With the
 * copies gone there is no exempt part. */
const authoredOf = (e: Emitted): string => e.text;

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
 * Generator stdout with the WRITE-ledger rows removed, so the count scan sees
 * prose and not file bookkeeping.
 *
 * Those rows carry a byte size and a sha256 prefix per written file. Both
 * measure an artifact the labeler holds and can measure for themselves, and a
 * hex prefix parses as an integer often enough to make the scan useless.
 *
 * TWO EXCLUSIONS WERE DROPPED HERE ON 2026-07-26, which is a strengthening.
 * The read-ledger summary used to be excluded because it collided with the
 * cross-case event total in one run configuration: the old read count scaled
 * with the number of DOCUMENTS, since every draft was opened and copied. It no
 * longer does — the generator opens no document, so the count is two fidelity
 * checks, one directory listing per case, and one clobber-guard read per
 * existing packet. It cannot reach an event total for arithmetic reasons rather
 * than by luck, so the summary lines are now scanned like everything else.
 */
function scannableStdout(s: string): string {
  return s
    .split("\n")
    .filter((l) => !/^\s+\d+B\s+[0-9a-f]{12}\s/.test(l))
    .join("\n");
}

/** The drafts are never read BY THE PACKET; this file reads them only to prove
 * that nothing in the packet came from them. */
const draftsDirFor = (c: CaseId): string => join(REPO_ROOT, "data", "cases", c, "source_drafts");
const dataPresent = CASES.every((c) => existsSync(draftsDirFor(c)));

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
    assert.ok(emitted.length > 0, "generator wrote nothing");

    // ---- the answer sheet, read only to score -----------------------------
    const caseTotal = new Map<CaseId, number>();
    const titles = new Map<CaseId, string[]>();
    for (const c of CASES) {
      const gt: { events: Array<{ source_document: string; title: string }> } = JSON.parse(
        readFileSync(join(REPO_ROOT, "data", "cases", c, "ground_truth.json"), "utf8"),
      );
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

    // ---- (a) NO verbatim original ground-truth title, anywhere ------------
    // Strictly stronger than it used to be. While the packet shipped document
    // copies this assertion had to carve out document BODIES, because one dev
    // document genuinely contains a title the original labeler reused verbatim
    // — case2's referral letter, which names the enclosed documents. (Not quoted
    // here. This file is on the forbidden list under `lib/*.test.ts`, but a
    // check that has to hold an answer as a literal in order to run is a check
    // that creates the thing it audits, and it does not have to: the titles are
    // loaded from ground_truth.json at runtime.) The carve-out was correct and
    // it was also the hole: most of the packet's bytes sat outside the audit.
    // With no body in the packet the exemption is gone and the permitted count
    // is zero. That one occurrence is still there — in the PDF, which is the
    // document itself, and which the labeler is supposed to read.
    for (const e of emitted) {
      for (const t of titles.get(e.case)!) {
        assert.ok(
          !authoredOf(e).includes(t),
          `${e.case}/${e.rel}: the packet reproduces an original ground-truth title verbatim`,
        );
      }
    }

    // ---- (b) NOTHING IN THE PACKET IS DERIVED FROM source_drafts/ ----------
    // This replaces the whole family of observable-by-observable count checks —
    // the per-document header scan, the whitespace-scar scan and the byte-size
    // rank-order scan. Each of those closed one way of reading a quantity off a
    // derived artifact, and the next audit found another, because ANY observable
    // of a derived artifact correlates with what was removed to make it. The
    // property that terminates the regress is that there is no derived artifact.
    //
    // Asserted three ways, because "derived" has three failure modes: an extra
    // file, a document's content, and a document's identity.
    for (const c of CASES) {
      // (b1) The artifact SET is closed. A copy would be a file.
      const rels = emitted.filter((e) => e.case === c).map((e) => e.rel).sort();
      assert.deepEqual(
        rels,
        ["README.md", "blind_labels.json"],
        `${c}: the packet contains a file that is neither the README nor the label template`,
      );
      assert.ok(!existsSync(join(outRoot, c, "docs")), `${c}: the packet has a docs/ directory again`);

      // (b2) No CONTENT of any draft appears in any artifact. A substantive line
      // of a clinical document has no business in a README, so a single hit is
      // either a copy, an excerpt or a quoted example — all of them derived.
      const draftLines = new Set<string>();
      for (const n of readdirSync(draftsDirFor(c))) {
        if (!/^d\d+_.*\.md$/.test(n)) continue;
        for (const line of readFileSync(join(draftsDirFor(c), n), "utf8").split("\n")) {
          const t = line.trim();
          if (t.length >= 25 && /[A-Za-z]/.test(t)) draftLines.add(t);
        }
      }
      assert.ok(draftLines.size > 0, `${c}: no draft lines to check against — the check would be vacuous`);
      for (const e of emitted.filter((x) => x.case === c)) {
        for (const line of e.text.split("\n")) {
          const t = line.trim();
          assert.ok(
            !(t.length >= 25 && draftLines.has(t)),
            `${c}/${e.rel}: carries a line that came from a source draft: ${JSON.stringify(t.slice(0, 80))}`,
          );
        }
      }

      // (b3) No artifact is NAMED after a document, so there is no per-document
      // artifact to set against a per-document draft in the first place. Without
      // a pairing there is no differential to compute, whatever the observable.
      for (const e of emitted.filter((x) => x.case === c)) {
        assert.doesNotMatch(e.rel, /d\d+_/, `${e.case}/${e.rel}: an artifact is named after a case document`);
      }
    }

    // The generator must not have OPENED a draft either — its read ledger is
    // printed in full, so this is checkable from stdout rather than inferred.
    for (const [what, text] of [
      ["generator stdout", stdout],
      ["generator stdout (re-run)", rerunStdout],
    ] as const) {
      assert.ok(!text.includes("source_drafts/d"), `${what}: the generator read a source draft`);
      assert.ok(!/^\s+packet-content\s/m.test(text), `${what}: a read was ledgered as packet content`);
    }

    // ---- (c) no recoverable per-document or aggregate event count ---------
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

    // (c4) and (c5) are GONE, and their absence is the result of this round
    // rather than an omission. (c4) checked that stripping left no whitespace
    // scar; (c5) checked that document byte sizes did not rank-order the
    // documents by event count. Both were checks ON A DERIVED ARTIFACT, and both
    // were reached around: the differential that closed them out is
    // `source_bytes − copy_bytes`, which is exactly divisible by the marker
    // pair's constant size and needs neither the whitespace nor the ranking.
    // There is no derived artifact left for either to inspect, and (b) above
    // asserts that rather than asserting a property of one.
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
});

test("end-to-end: the generator refuses to write into a packet holding artifacts it does not produce", { skip: !dataPresent ? "data/cases/* not present in this checkout" : false }, () => {
  // The upgrade path, which is where this round's change could still ship the
  // artifact it removes. Packets generated before 2026-07-26 carry a `docs/`
  // subdirectory of marker-stripped document copies. Regenerating in place
  // rewrites the README and the template and would leave every one of those
  // copies sitting beside them — with the new README stating that no such file
  // exists, which is worse than either shape on its own.
  const outRoot = mkdtempSync(join(tmpdir(), "label-packet-stale-"));
  try {
    mkdirSync(join(outRoot, "case1", "docs"), { recursive: true });
    writeFileSync(join(outRoot, "case1", "docs", "d1_x.md"), "a stale marker-stripped copy\n", "utf8");
    writeFileSync(join(outRoot, "case1", "blind_labels.json"), templateJson("case1"), "utf8");

    const r = spawnSync(
      join(REPO_ROOT, "node_modules", ".bin", "tsx"),
      [join(REPO_ROOT, "scripts", "make-label-packet.ts"), "case1", `--out=${outRoot}`],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
    );
    assert.equal(r.status, 1, `generator regenerated over a stale document copy\n${r.stdout}`);
    assert.match(r.stderr, /holds \d+ entr\(ies\) this generator does not write/);
    assert.match(r.stderr, /docs/);
    // Refuses rather than deletes: the packet directory is open to the labeler,
    // so anything unexpected in it might be theirs.
    assert.ok(existsSync(join(outRoot, "case1", "docs", "d1_x.md")), "the guard deleted a file it did not write");
    assert.ok(!existsSync(join(outRoot, "case1", "README.md")), "the guard let a partial packet be written");
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
    assert.ok(!/carries\s+file/.test(r.stdout), "a refused run printed the per-file hit table");
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

    // A PASSING run is the one that actually prints the hit table, and the table
    // used to rank every file as `N/M` where M is the aggregate original event
    // count for the two cases being relabeled. The gate that measures the anchor
    // was the last thing printing it. Ranked categorically now — asserted on the
    // shape rather than on any literal, so it holds if the cases change.
    assert.match(r.stdout, /carries\s+file/, "the hit table must still rank its entries");
    assert.match(r.stdout, /\b(COMPLETE|MOST|MANY|SEVERAL|A FEW)\b\s+\S/, "the ranking must be categorical");
    for (const line of r.stdout.split("\n")) {
      assert.doesNotMatch(
        line,
        /(?<![\w.])\d+\s*\/\s*\d+(?![\w.])/,
        `the gate prints a ratio, whose denominator is the aggregate event count: ${JSON.stringify(line)}`,
      );
    }
    const gtTotal = CASES.reduce((n, c) => {
      const gt: { events: Array<{ in_scope: boolean }> } = JSON.parse(
        readFileSync(join(REPO_ROOT, "data", "cases", c, "ground_truth.json"), "utf8"),
      );
      return n + gt.events.filter((e) => e.in_scope).length;
    }, 0);
    for (const n of [...r.stdout.matchAll(/(?<![\w.\-/])(\d+)(?![\w.\-/])/g)].map((m) => Number(m[1]))) {
      assert.notEqual(n, gtTotal, `the gate prints ${n}, the aggregate in-scope original event count`);
    }

    const none = runGate(join(root, "not-generated-yet"));
    assert.equal(none.status, 0, `gate refused with no packet present\n${none.stderr}`);
    assert.match(none.stdout, /sitting guard:\s+clear — no packet under/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// THE RESCORER'S OWN SITTING GATE.
//
// `scripts/compare-relabel.ts` IS the anchor: its sections print each label
// set's in-scope count, the per-type `n_gt` breakdown and the overlap-band
// distribution, for the ORIGINAL labels as well as the blind ones. Its
// single-case form is documented, supported usage and the packet README names
// the script to the labeler — so `compare-relabel.ts case1` used to hand a
// labeler who had finished case1 the full case1 report while case2 was still
// untouched, contaminating a case they had not started. Direct disclosure from
// an authorized command, run out of order, and unrecoverable.
//
// The gate is therefore evaluated over EVERY case rather than over the
// requested ones, using the same `sittingState` predicate as the two guards
// above. Exercised through the REAL script, for the reason the leak-gate block
// states: the property is not "the predicate returned pristine" but "no count
// reached the terminal".
// ---------------------------------------------------------------------------

function runCompare(packetRoot: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(
    join(REPO_ROOT, "node_modules", ".bin", "tsx"),
    [join(REPO_ROOT, "scripts", "compare-relabel.ts"), ...args, `--packet=${packetRoot}`],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
  );
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** A structurally valid, wholly synthetic blind-label file — enough to put a
 * packet into the "labeled" state. Nothing in it is read from the original
 * labels; being wrong about the case is fine and being derived from it is not. */
function labeledJson(caseId: CaseId): string {
  return (
    JSON.stringify(
      {
        case_id: caseId,
        patient: "SYNTHETIC FIXTURE PATIENT",
        labeled_at: "2026-07-26T00:00:00Z",
        labeler_notes: "fixture for the compare-relabel sitting gate; not a real labeling",
        events: [
          {
            id: "gt_001",
            date: "2024-01-01",
            date_confidence: "exact",
            event_type: "visit",
            title: "synthetic fixture label deliberately matching nothing",
            source_document: "d1_synthetic_fixture.pdf",
            in_scope: true,
          },
        ],
      },
      null,
      2,
    ) + "\n"
  );
}

/** Every integer that IS an answer about the original labels. Same construction
 * as the packet inverter's, loaded at runtime so this file holds no count. */
function answerIntegers(): Set<number> {
  const out = new Set<number>();
  let total = 0;
  let inScope = 0;
  for (const c of CASES) {
    const gt: { events: Array<{ in_scope: boolean }> } = JSON.parse(
      readFileSync(join(REPO_ROOT, "data", "cases", c, "ground_truth.json"), "utf8"),
    );
    out.add(gt.events.length);
    out.add(gt.events.filter((e) => e.in_scope).length);
    total += gt.events.length;
    inScope += gt.events.filter((e) => e.in_scope).length;
  }
  out.add(total);
  out.add(inScope);
  return out;
}

const predictionsPresent = CASES.every((c) => existsSync(join(REPO_ROOT, "data", "cases", c, "events.json")));
const skipCompare =
  !gtPresent || !predictionsPresent
    ? "data/cases/*/{ground_truth,events}.json not present in this checkout"
    : false;

test("compare-relabel: a single-case run reports nothing while any other packet is unlabeled", { skip: skipCompare }, () => {
  const root = mkdtempSync(join(tmpdir(), "compare-relabel-gate-"));
  try {
    // The scenario the gate exists for: case1 finished, case2 not started, and
    // the labeler types the single-case invocation the script's own header
    // offers them.
    writeLabels(root, "case1", labeledJson("case1"));
    writeLabels(root, "case2", templateJson("case2"));

    const r = runCompare(root, "case1");
    assert.equal(r.status, 0, `the gate must stay exit-0 — not-yet-run is a state, not an error\n${r.stderr}`);
    assert.match(r.stdout, /nothing to compare yet/);
    assert.match(r.stdout, /still the template\s+\S*case2[/\\]blind_labels\.json/, "the refusal must name the unlabeled packet");

    // Not one section of the report was produced. Asserted section by section
    // rather than on the banner alone: each of these prints a count.
    for (const section of [
      /LABEL-SET CENSUS/,
      /AGGREGATE/,
      /PER-EVENT-TYPE/,
      /TITLE-OVERLAP DISTRIBUTION/,
      /MATCH-STATUS CHANGE/,
      /FAILURE-CAUSE ATTRIBUTION/,
      /loaded case1:/,
    ]) {
      assert.doesNotMatch(r.stdout, section, `a refused run produced report output: ${section}`);
    }

    // And the property those sections are a proxy for: no answer-bearing
    // integer reached the terminal at all. Ordinals are stripped first — the
    // refusal ends with a numbered four-step sequence.
    const answers = answerIntegers();
    const printed = withoutOrdinals(r.stdout + r.stderr);
    for (const n of standaloneIntegers(printed)) {
      assert.ok(!answers.has(n), `a refused run printed ${n}, which is an original event count`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compare-relabel: the same invocation works once every packet is labeled", { skip: skipCompare }, () => {
  // The gate must not cost the tool its legitimate use, and it is SELF-CLEARING
  // — which is why there is no `--sitting-over`-style override here. The moment
  // every packet is labeled the per-case run works, with no flag and no
  // operator assertion.
  const root = mkdtempSync(join(tmpdir(), "compare-relabel-open-"));
  try {
    writeLabels(root, "case1", labeledJson("case1"));
    writeLabels(root, "case2", labeledJson("case2"));

    const r = runCompare(root, "case1");
    assert.equal(r.status, 0, `the rescorer refused a fully labeled packet\n${r.stderr}`);
    assert.doesNotMatch(r.stdout, /nothing to compare yet/);
    assert.match(r.stdout, /LABEL-SET CENSUS/);
    assert.match(r.stdout, /loaded case1:/);
    assert.doesNotMatch(r.stdout, /loaded case2:/, "a single-case run must still report only the case asked for");

    // A half-written label file in a case you did NOT ask for is refused rather
    // than skipped: the gate tests whether labeling has started, and only the
    // schema check catches a sitting that started and did not finish.
    writeLabels(root, "case2", templateJson("case2").replace(PLACEHOLDER_PATIENT, "REDACTED PATIENT, 54F"));
    const mid = runCompare(root, "case1");
    assert.equal(mid.status, 1, `a one-keystroke edit to case2 reopened the case1 report\n${mid.stdout}`);
    assert.match(mid.stderr, /case2: .*is not a valid label file/);
    assert.doesNotMatch(mid.stdout, /LABEL-SET CENSUS/);
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

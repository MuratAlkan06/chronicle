/**
 * scripts/make-label-packet.ts — blind labeling packet generator (issue #24).
 *
 * Emits, per dev case, everything a human needs to re-label Cases 1+2 FROM
 * SCRATCH and nothing that could leak the answer. The packet it writes is
 * working material, not a tracked artifact (`label_packet/` is gitignored).
 *
 * WHY: v0.3.5 (docs/EVAL.md §7) showed the published dev macro-mean strict F1
 * measures `event_type` + exact-day agreement only — title-blind rescoring
 * returns bit-identical tp/fp/fn — and that two docs/EVAL.md §5 labeling
 * instructions given to Case 3's labeler are false. Issue #24 measures the
 * labeling-phrasing effect directly, on non-held-out data, at zero cost to
 * Case 3's terminal budget (docs/RESOLVED-DECISIONS.md #10): re-label Cases 1+2
 * blind to model output, then rescore the EXISTING cached predictions with the
 * unchanged matcher. This script produces the labeling side of that.
 *
 * ---------------------------------------------------------------------------
 * BLINDNESS IS STRUCTURAL, NOT ADVISORY.
 *
 * Every read of repository source material goes through `readAllowed` /
 * `listAllowed`, which check an explicit ALLOWLIST built up-front and an
 * explicit DENYLIST. There is exactly one further reader, `readOwnPacketFile`,
 * which reads the packet's OWN `blind_labels.json` for the clobber guard and
 * emits nothing. All three append to a read ledger printed in full at the end of
 * every run, so the printed ledger is the complete list.
 *
 * That is checkable rather than asserted: grepping this file for
 * `readFileSync|readdirSync|readFile|createReadStream|openSync` returns five
 * lines — THIS sentence, which names the patterns and so matches itself; the
 * `node:fs` import; and exactly three call sites, one inside each of those three
 * functions and nowhere else. (It returned four before 2026-07-26, which was
 * wrong by one for the same self-matching reason: the count never included this
 * line. Prose that states its own grep result has to count itself.)
 *
 * The denylist covers `held_out/**`, `ground_truth.json`, `events.json`,
 * `data/eval_reports/**`, `data/case3_eval_fallback.json`, `metadata.json`
 * (it carries the model's event COUNT) and anything matching /case3/i.
 *
 * Two allowlisted files are read for a purpose other than packet content:
 * `docs/EVAL.md` and `prompts/system_extract_v4.md`, read ONLY to confirm the
 * protocol and granularity blocks inlined below appear in them verbatim. Those
 * reads return booleans; neither file's content is written into a packet. Both
 * quote original GT titles elsewhere in the file — EVAL.md in §7, the prompt in
 * its v3-vs-v2 versioning note (four Case 1 visit titles) and its "Title (≤ 70
 * chars)" section — which is precisely why the blocks are inlined here and
 * verified, rather than sliced out of those files at runtime.
 *
 * Symmetrically, every write goes through `writePacket`, which appends to a
 * write ledger (path, bytes, sha256) also printed in full. Reads in, writes out,
 * both auditable from one run's stdout.
 * ---------------------------------------------------------------------------
 *
 * Also stripped, deliberately (see the packet README's "What was withheld"):
 *   - `[SNIPPET — DO NOT EDIT]` / `[/SNIPPET]` marker lines in the drafts.
 *     There is exactly ONE marked block per ORIGINAL GROUND-TRUTH EVENT, in
 *     every document of both cases, with zero mismatches. The markers are
 *     therefore a complete answer key to the original labels AND to their
 *     granularity, laid over the documents.
 *
 *     **And so is a COUNT of them.** Markers are paired: halve a per-document
 *     marker-line count and you have that document's original event count; sum
 *     them and you have the case total. Until 2026-07-26 this script printed
 *     exactly that number twice — in every packet document's provenance header,
 *     four lines under the `source_document` value the labeler must copy, and
 *     again in the closing per-case summary. All 13 documents' original event
 *     counts were recoverable by dividing by two, and the packet README stated
 *     the decoding rule outright. Both numbers are gone; see the count invariant
 *     in `lib/label-packet.ts` for the rule that replaced them and Amendment 3
 *     of docs/PREREG-24-blind-relabel.md for what it invalidated.
 *
 *     They do NOT "map 1-1 onto `events.json` `source.snippet` anchors" — the
 *     claim this comment and the packet README both carried until 2026-07-26.
 *     Measured: several marked blocks have no prediction snippet, and rather
 *     more prediction snippets have no marked block. The stripping was always
 *     the right mitigation; only its stated rationale was wrong, and wrong in
 *     the direction that made the leak sound smaller than it is.
 *
 *     Stripping makes the packet read like the PDF the model actually saw, and
 *     that is now checked DIRECTLY rather than inferred: `pdftotext` extracts a
 *     clean text layer from all 13 dev PDFs (case1 7, case2 6; ~11.5k non-
 *     whitespace characters each case) and finds ZERO marker lines in any of
 *     them. That supersedes the earlier argument from the print-ready HTML
 *     twins, which reached the same conclusion one step removed — the twins are
 *     what the PDFs were exported from, whereas this reads the PDFs themselves.
 *     The snippet TEXT itself stays verbatim — it is part of the document.
 *     Because the ORIGINALS still carry the key, the packet README puts
 *     `data/cases/<case>/source_drafts/` on the forbidden list.
 *   - `source_drafts/README.md`, which names the planted d3-vs-d5 contradiction.
 *   - Any target event count. §5's checklist carries one; it is an anchor, and
 *     handing it to a blind labeler contaminates the count comparison. It is
 *     not restated here either, in any form — including here. The packet
 *     README's "What was withheld" withholds it without naming it, which is the
 *     only way a withheld anchor stays withheld.
 *
 * RENDERING LIVES IN `lib/label-packet.ts`. `npm test` runs `lib/*.test.ts` and
 * nothing else, so while the rendering was in this file no test executed one
 * line of it. This file is now the IO half — allowlist, denylist, ledgers,
 * clobber guard, argv guards — and `lib/label-packet.test.ts` covers the other
 * half, including an end-to-end run of THIS script into a temp root that asserts
 * the emitted tree and this script's own stdout carry no recoverable count.
 *
 * Usage:
 *   npx tsx scripts/make-label-packet.ts                 # case1 + case2
 *   npx tsx scripts/make-label-packet.ts case1
 *   npx tsx scripts/make-label-packet.ts --out=/tmp/pkt  # alternate output root
 *
 * Exit codes:
 *   0 — packet written
 *   1 — refused (case3 named, bad case, unsafe output root, or an existing
 *       packet already holds edited labels)
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { leakSources, type LeakSource } from "../lib/label-leak-sources";
import {
  PROTOCOL_BLOCKS,
  PROMPT_BLOCKS,
  SITTING_RULE_LINES,
  type ProtocolBlock,
  type PacketDoc,
  docOrder,
  stripSnippetMarkers,
  hasMarkerResidue,
  templateJson,
  sittingState,
  packetReadme,
  packetDocFile,
} from "../lib/label-packet";

const TAG = "[label-packet]";

/** Repo root, derived from THIS FILE's own location rather than from
 * `process.cwd()`. The `--out` guard in `main` tests resolved ABSOLUTE paths for
 * containment under it, so the guard holds whatever directory the script is
 * invoked from — a cwd-relative string test does not (run from `scripts/`,
 * `--out=../data/x` lands in `data/` while spelling itself `../data/x`). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type CaseId = "case1" | "case2";
const ALL_CASES: CaseId[] = ["case1", "case2"];
const DEFAULT_OUT_ROOT = "label_packet";
const EVAL_DOC_PATH = "docs/EVAL.md";
const PROMPT_PATH = "prompts/system_extract_v4.md";

// ---------------------------------------------------------------------------
// IO LEDGER — the auditable core. Nothing reads or writes outside these two.
// ---------------------------------------------------------------------------
type ReadPurpose = "packet-content" | "listing" | "fidelity-check" | "clobber-guard";

interface ReadRecord {
  path: string; // repo-relative
  purpose: ReadPurpose;
  bytes: number;
  emitted: boolean; // does any byte of this read reach the packet?
}

interface WriteRecord {
  path: string; // repo-relative
  bytes: number;
  sha256: string;
}

const READS: ReadRecord[] = [];
const WRITES: WriteRecord[] = [];

/** Paths this run is permitted to read, resolved absolute. Built before any
 * read happens; `readAllowed` refuses anything not in it. */
const ALLOWED_FILES = new Set<string>();
const ALLOWED_DIRS = new Set<string>();

/** Defense in depth behind the allowlist: even if a path were mistakenly
 * allowlisted, these patterns refuse it. Tested against the repo-relative path
 * with `/` separators. */
const DENY_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /(^|\/)held_out(\/|$)/, why: "held_out/ is terminal held-out budget (RESOLVED-DECISIONS #10)" },
  { re: /case3/i, why: "anything Case 3 is held out" },
  { re: /(^|\/)ground_truth\.json$/, why: "original labels are the baseline this experiment measures against" },
  { re: /(^|\/)events\.json$/, why: "cached model predictions — the answer" },
  { re: /(^|\/)eval_reports(\/|$)/, why: "scored reports derived from predictions + labels" },
  { re: /(^|\/)metadata\.json$/, why: "carries the model's event COUNT for the case" },
];

/** THE HUMAN-SIDE FORBIDDEN LIST NOW LIVES IN `lib/label-leak-sources.ts`.
 *
 * It used to be a local array here. It is shared because
 * `scripts/check-label-leaks.ts` greps every tracked file for verbatim original
 * ground-truth titles and fails on any hit that is not on this list — and a gate
 * that checks a DIFFERENT list from the one the packet prints is not a gate.
 * Adding an entry there updates the packet README, the handover banner below and
 * that gate in one edit. See Amendment 2 of docs/PREREG-24-blind-relabel.md for
 * why the list stopped being maintainable by hand.
 *
 * It is NOT the definition of what the labeler may not open — that is the closed
 * default in `SITTING_RULE_LINES`, which both the README and the banner below
 * render, and which this list only illustrates. An enumeration permits by
 * omission, and it did, three times.
 *
 * It is the HUMAN-side counterpart to DENY_PATTERNS above. The generator is
 * structurally blind: not one of these paths is on the allowlist, several are on
 * the denylist, and no byte of any of them can reach a packet. That does nothing
 * about the actual risk, which is that a human labeling inside this checkout can
 * open any of them in one keystroke. **Tooling blindness is not protocol
 * blindness**, and a packet generator is the last moment anyone is paying
 * attention before the sitting starts.
 *
 * Checked here for EXISTENCE ONLY — `existsSync`, never a read — so the
 * read-call-site audit property stated at the top of this file is unaffected:
 * importing that list adds no reader, and none of these paths is ever opened by
 * this script. */

/** A wildcard entry (`lib/*.test.ts`) names a CLASS of files, not a file, so
 * `existsSync` on it is always false and would demote the most future-proof
 * rules to a "not present in this checkout" footnote. A class rule does not go
 * stale because one member is missing, so wildcard entries are always reported
 * as present.
 *
 * Enumerating a wildcard's members would need a directory listing, adding a
 * fourth read call site and breaking the audit property stated at the top of
 * this file for a cosmetic gain. `scripts/check-label-leaks.ts` enumerates them
 * instead — it is allowed to read, and its whole job is to. */
function leakSourcePresent(s: LeakSource): boolean {
  return s.path.includes("*") || existsSync(resolve(REPO_ROOT, s.path));
}

/** Printed at the END of every run — the moment the packet is handed over. */
function reportLeakSources(cases: CaseId[]): void {
  const sources = leakSources(cases);
  const present = sources.filter(leakSourcePresent);
  const absent = sources.filter((s) => !leakSourcePresent(s));

  console.log("");
  console.log("=".repeat(96));
  console.log(`${TAG} BEFORE YOU LABEL — your PACKET is blind. This REPOSITORY is not.`);
  console.log("=".repeat(96));
  // THE rule, rendered from the same constant the packet README renders, because
  // a banner that says something subtly different from the packet is a
  // contradiction resolved by whoever happens to be reading one of them.
  for (const line of SITTING_RULE_LINES) console.log(`  ${line}`);
  console.log("");
  console.log("  That is the protocol's own first line — label in one sitting, working ONLY from");
  console.log("  the packet — stated as a closed default rather than as a list of forbidden files,");
  console.log("  because the list has been wrong three times and each miss was a file nobody had");
  console.log("  thought to name. Everything the labeler needs is inlined in the packet, which is");
  console.log("  what makes a closed default liveable rather than merely strict.");
  console.log("");
  console.log("  The paths below are EXAMPLES OF WHAT THE RULE CLOSES, not the rule. Nothing is");
  console.log("  permitted by being absent from them. This generator cannot read any of them and");
  console.log("  no byte of any of them is in the packet; it also cannot stop you opening one.");
  console.log("  Each carries the original ground-truth titles for these cases, the model's");
  console.log("  predicted titles, or the event count and segmentation the labels were written");
  console.log("  at — and title phrasing is the single quantity this experiment exists to");
  console.log("  measure. There is no partial contamination: one line read is the measurement");
  console.log("  gone.");
  console.log("");
  for (const s of present) {
    console.log(`  DO NOT OPEN   ${s.path}`);
    console.log(`                ${s.why}`);
  }
  if (absent.length > 0) {
    console.log("");
    console.log(`  Not present in this checkout (listed so the rule does not go stale): ${absent
      .map((s) => s.path)
      .join(", ")}`);
  }
  console.log("");
  console.log("  OPEN, exhaustively: your packet directory, and the PDFs under");
  console.log("  data/cases/<case>/docs/. Those PDFs are the documents themselves, and the");
  console.log("  protocol quoted in your packet tells you to open them in a PDF viewer. Nothing");
  console.log("  else in that directory is open to you. Listing it is not opening a file in it —");
  console.log("  but the answer key is the next entry along, so decide before you go in there,");
  console.log("  not while you are in there.");
  console.log("");
  console.log("  If you catch yourself weighing whether some OTHER file is safe, you have already");
  console.log("  left the packet. You do not have to work out what it contains; the answer is no.");
  console.log("  And if the packet is missing something you genuinely need, that is a defect in");
  console.log("  the packet — report it rather than going to look for it.");
  console.log("");
  console.log("  Your commands are validate-blind-labels.ts and, once every packet is labeled,");
  console.log("  compare-relabel.ts. No others.");
}

function repoRel(abs: string): string {
  return relative(process.cwd(), abs).split(sep).join("/");
}

function denyCheck(abs: string): void {
  const rel = repoRel(abs);
  for (const { re, why } of DENY_PATTERNS) {
    if (re.test(rel)) {
      console.error(`${TAG} REFUSED read of "${rel}" — ${why}`);
      console.error(`${TAG} this is a bug in the packet generator, not a user error; nothing was written`);
      process.exit(1);
    }
  }
}

function readAllowed(abs: string, purpose: ReadPurpose): string {
  const rel = repoRel(abs);
  if (!ALLOWED_FILES.has(abs)) {
    console.error(`${TAG} REFUSED read of "${rel}" — not on the allowlist`);
    process.exit(1);
  }
  denyCheck(abs);
  const content = readFileSync(abs, "utf8");
  READS.push({
    path: rel,
    purpose,
    bytes: Buffer.byteLength(content, "utf8"),
    emitted: purpose === "packet-content",
  });
  return content;
}

function listAllowed(abs: string): string[] {
  const rel = repoRel(abs);
  if (!ALLOWED_DIRS.has(abs)) {
    console.error(`${TAG} REFUSED listing of "${rel}/" — not on the allowlist`);
    process.exit(1);
  }
  denyCheck(abs);
  const names = readdirSync(abs).sort();
  READS.push({ path: `${rel}/ (names only)`, purpose: "listing", bytes: 0, emitted: false });
  return names;
}

/** The one read that is NOT of repository source material: the packet's own
 * blind_labels.json, read by the clobber guard. Ledgered like everything else so
 * the printed ledger is the complete list. Its content never leaves the guard. */
function readOwnPacketFile(abs: string): string {
  const content = readFileSync(abs, "utf8");
  READS.push({
    path: repoRel(abs),
    purpose: "clobber-guard",
    bytes: Buffer.byteLength(content, "utf8"),
    emitted: false,
  });
  return content;
}

function writePacket(abs: string, content: string): void {
  const bytes = Buffer.byteLength(content, "utf8");
  writeFileSync(abs, content, "utf8");
  WRITES.push({
    path: repoRel(abs),
    bytes,
    sha256: createHash("sha256").update(content, "utf8").digest("hex"),
  });
}


interface FidelityResult {
  label: string;
  verbatim: boolean;
}

/** Reads a source file and returns, per block, whether the block appears in it
 * verbatim. The file's content is scoped to this function and is never returned
 * or written: docs/EVAL.md §7 and prompts/system_extract_v4.md's versioning
 * notes both quote original labels and predictions. */
function verifyFidelity(relPath: string, blocks: ProtocolBlock[]): FidelityResult[] {
  const src = readAllowed(resolve(process.cwd(), relPath), "fidelity-check");
  return blocks.map((b) => ({ label: b.label, verbatim: src.includes(b.text) }));
}

// ---------------------------------------------------------------------------
// Source documents.
// ---------------------------------------------------------------------------
interface CaseListing {
  draftsDir: string;
  draftNames: string[]; // reading order
  pdfNames: Set<string>;
}

function collectDocs(caseId: CaseId, listing: CaseListing): PacketDoc[] {
  const { draftsDir, draftNames, pdfNames } = listing;

  return draftNames.map((name, i) => {
    const raw = readAllowed(join(draftsDir, name), "packet-content");
    const { body } = stripSnippetMarkers(raw);
    const pdfName = name.replace(/\.md$/, ".pdf");
    if (!pdfNames.has(pdfName)) {
      console.error(`${TAG} ${caseId}: draft "${name}" has no matching PDF "${pdfName}" in docs/`);
      process.exit(1);
    }

    // Fail-closed residue check. `hasMarkerResidue` matches a WIDER pattern than
    // the stripper does, which is the whole value of it: if the drafts' marker
    // spelling ever drifts, the stripper silently becomes a no-op, and a check
    // written against the stripper's own regex would drift with it and pass. The
    // failure this guards is a packet that ships the answer key.
    //
    // It reports a path and a kind, never a count and never the offending text.
    // A count of marker lines is the segmentation key (they are paired, one
    // block per original event); printing it on the failure path would leak it
    // to the same person who is about to read the packet, which is the exact
    // defect Amendment 3 §1 records. The draft is on disk for whoever debugs it.
    if (hasMarkerResidue(body)) {
      console.error(`${TAG} REFUSED — ${caseId}/${name}: [SNIPPET] marker text survived stripping.`);
      console.error(`${TAG} The marker spelling in the drafts has probably drifted from SNIPPET_MARKER`);
      console.error(`${TAG} in lib/label-packet.ts. Nothing was written. Do NOT hand over this packet.`);
      process.exit(1);
    }

    return { order: i + 1, draftFile: name, sourceDocument: pdfName, body };
  });
}

// ---------------------------------------------------------------------------
// Clobber guard.
// ---------------------------------------------------------------------------
/** Refuses to overwrite anything but a pristine template. A labeling sitting that
 * has begun differs from the template in at least one byte; a pristine template
 * is a harmless no-op rewrite. There is no --force; move the file aside instead.
 *
 * The test itself is `sittingState` in lib/label-packet.ts, shared with
 * `scripts/check-label-leaks.ts`'s sitting guard. Two guards asking "has labeling
 * started?" must not be able to answer it differently — see the note on that
 * function. */
function assertNotClobbering(caseId: CaseId, labelsPath: string): void {
  if (!existsSync(labelsPath)) return;
  const existing = readOwnPacketFile(labelsPath);
  if (sittingState(existing, caseId) === "pristine") {
    console.log(`${TAG} ${caseId}: existing blind_labels.json is a pristine template — safe to rewrite`);
    return;
  }
  console.error(`${TAG} REFUSED — ${repoRel(labelsPath)} differs from a pristine template.`);
  console.error(`${TAG} A labeling sitting may be in progress. Regenerating would destroy it.`);
  console.error(`${TAG} Move the file aside first if you really want a fresh packet:`);
  console.error(`${TAG}   mv ${repoRel(labelsPath)} ${repoRel(labelsPath)}.kept`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
function buildAllowlist(cases: CaseId[]): Map<CaseId, CaseListing> {
  ALLOWED_FILES.add(resolve(process.cwd(), "docs/EVAL.md"));
  ALLOWED_FILES.add(resolve(process.cwd(), PROMPT_PATH));
  const out = new Map<CaseId, CaseListing>();

  for (const caseId of cases) {
    const draftsDir = resolve(process.cwd(), "data", "cases", caseId, "source_drafts");
    const pdfDir = resolve(process.cwd(), "data", "cases", caseId, "docs");
    for (const d of [draftsDir, pdfDir]) {
      if (!existsSync(d)) {
        console.error(`${TAG} ${caseId}: missing ${repoRel(d)}`);
        process.exit(1);
      }
    }
    ALLOWED_DIRS.add(draftsDir);
    ALLOWED_DIRS.add(pdfDir);

    // Allowlist only the numbered document drafts. `source_drafts/README.md` is
    // excluded by the `d<N>_` pattern AND named explicitly — it describes the
    // contradiction planted between two of the documents. The `.html` twins are
    // never allowlisted either, so `readAllowed` would refuse any of them.
    const draftNames = listAllowed(draftsDir)
      .filter((n) => n.endsWith(".md") && n !== "README.md" && /^d\d+_/.test(n))
      .sort((a, b) => docOrder(a) - docOrder(b) || a.localeCompare(b));
    for (const n of draftNames) ALLOWED_FILES.add(join(draftsDir, n));

    const pdfNames = new Set(listAllowed(pdfDir).filter((n) => n.toLowerCase().endsWith(".pdf")));
    out.set(caseId, { draftsDir, draftNames, pdfNames });
  }

  return out;
}

function main(): void {
  const raw = process.argv.slice(2);

  // Held-out guard on RAW argv, before flags are filtered — same shape as
  // scripts/analyze-title-overlap.ts, for the same reason: a guard placed after
  // the filter lets `--case3` through silently.
  const refuseCase3 = (a: string): boolean =>
    a.replace(/^-+/, "").split("=")[0].toLowerCase() === "case3";
  for (const a of raw) {
    if (refuseCase3(a)) {
      console.error(`${TAG} invalid case '${a}' — this generator runs on case1/case2 only.`);
      console.error(`${TAG} Case 3 is held out (docs/RESOLVED-DECISIONS.md #10) and is never read here.`);
      process.exit(1);
    }
  }

  const outFlag = raw.find((a) => a.startsWith("--out="));
  const outRoot = resolve(process.cwd(), outFlag ? outFlag.slice("--out=".length) : DEFAULT_OUT_ROOT);
  const outRel = repoRel(outRoot);

  // Containment is tested on the RESOLVED ABSOLUTE path against REPO_ROOT, not
  // on the cwd-relative string. A cwd-relative test is only as good as the cwd:
  // run from `scripts/`, `--out=../data/x` resolves into `data/` while spelling
  // itself "../data/x", which no `^data` anchor matches. An absolute prefix test
  // cannot be walked out of with `..`, because `resolve` has already collapsed
  // them.
  const forbiddenRoots: Array<{ name: string; abs: string; why: string }> = [
    { name: "held_out/", abs: resolve(REPO_ROOT, "held_out"), why: "terminal held-out budget (docs/RESOLVED-DECISIONS.md #10)" },
    { name: "data/", abs: resolve(REPO_ROOT, "data"), why: "holds the cached predictions and the original labels" },
  ];
  const within = (child: string, parent: string): boolean =>
    child === parent || child.startsWith(parent + sep);
  const hit = forbiddenRoots.find((f) => within(outRoot, f.abs));
  if (hit) {
    console.error(`${TAG} REFUSED — output root "${outRel}" resolves to ${outRoot},`);
    console.error(`${TAG} which is inside ${hit.name} — ${hit.why}`);
    process.exit(1);
  }
  if (/case3/i.test(outRoot)) {
    console.error(`${TAG} REFUSED — output root "${outRel}" resolves to ${outRoot}, which names case3`);
    process.exit(1);
  }

  const args = raw.filter((a) => !a.startsWith("--"));
  const ids = args.length > 0 ? args : ALL_CASES;
  for (const a of ids) {
    if (a !== "case1" && a !== "case2") {
      console.error(`${TAG} invalid case '${a}' — this generator runs on case1/case2 only.`);
      process.exit(1);
    }
  }
  const cases = ids as CaseId[];

  console.log("=".repeat(96));
  console.log(`${TAG} blind labeling packet generator — issue #24, Cases 1+2 only`);
  console.log("=".repeat(96));
  console.log(`  output root: ${outRel}/`);
  console.log(`  cases: ${cases.join(", ")}`);

  const listings = buildAllowlist(cases);

  // Fidelity checks before anything is written. If an inlined block has drifted
  // from its source, the packet would misreport what the labeler was told —
  // which is the one thing this packet exists to reproduce.
  const fidelity: Array<{ source: string; results: FidelityResult[] }> = [
    { source: EVAL_DOC_PATH, results: verifyFidelity(EVAL_DOC_PATH, PROTOCOL_BLOCKS) },
    { source: PROMPT_PATH, results: verifyFidelity(PROMPT_PATH, PROMPT_BLOCKS) },
  ];
  console.log("");
  console.log("  FIDELITY (every inlined block must appear verbatim in its source file):");
  for (const { source, results } of fidelity) {
    console.log(`    ${source}`);
    for (const f of results) {
      console.log(`      ${f.verbatim ? "verbatim" : "MISMATCH"}  ${f.label}`);
    }
  }
  if (fidelity.some(({ results }) => results.some((f) => !f.verbatim))) {
    console.error(`${TAG} REFUSED — an inlined block has drifted from its source; nothing written`);
    process.exit(1);
  }

  // Two passes: collect + clobber-check EVERY requested case before writing
  // ANY of them, so a refusal on the second case cannot leave the first
  // half-regenerated.
  const planned = cases.map((caseId) => {
    const listing = listings.get(caseId);
    if (!listing) {
      console.error(`${TAG} ${caseId}: no listing — internal error`);
      process.exit(1);
    }
    const caseOut = join(outRoot, caseId);
    const labelsPath = join(caseOut, "blind_labels.json");
    const template = templateJson(caseId);
    assertNotClobbering(caseId, labelsPath);
    return { caseId, caseOut, labelsPath, template, docs: collectDocs(caseId, listing) };
  });

  for (const { caseId, caseOut, labelsPath, template, docs } of planned) {
    mkdirSync(join(caseOut, "docs"), { recursive: true });
    writePacket(join(caseOut, "README.md"), packetReadme(caseId, docs));
    writePacket(labelsPath, template);
    for (const d of docs) {
      writePacket(join(caseOut, "docs", d.draftFile), packetDocFile(caseId, d, docs.length));
    }

    // Document count only. This line used to add the case's total stripped
    // marker-line count, which halves straight into the case's original event
    // total — printed to the terminal at the moment the packet is handed to the
    // labeler. `docs.length` is a count of files the labeler is holding; it is
    // not derived from the labels and stays.
    console.log("");
    console.log(`  ${caseId}: ${docs.length} document(s) written`);
    console.log(`  ${" ".repeat(caseId.length)}  [SNIPPET] marker lines stripped; document text otherwise verbatim`);
  }

  // ---- IO ledger -----------------------------------------------------------
  console.log("");
  console.log("=".repeat(96));
  console.log(`${TAG} FILES READ (complete — every read in this script goes through readAllowed/listAllowed)`);
  console.log("=".repeat(96));
  for (const r of READS) {
    const emitted = r.emitted ? "-> packet" : "not emitted";
    console.log(`  ${r.purpose.padEnd(15)} ${String(r.bytes).padStart(7)}B  ${emitted.padEnd(11)}  ${r.path}`);
  }
  console.log("");
  // WHAT THIS NUMBER COUNTS, stated so an auditor comparing it against an
  // OS-level trace does not trip on the difference. It counts reads THIS SCRIPT
  // performs through readAllowed / listAllowed / readOwnPacketFile, and nothing
  // else. It structurally cannot count the module loader reading this file and
  // its imports before main() runs — those are code, not repository source
  // material, and no byte of them can reach a packet — so a syscall-level trace
  // of the same run will always report a few more.
  //
  // The total also depends on prior state: a FRESH run (no label_packet/) makes
  // 19 reads for both cases; re-running over existing packets adds one
  // clobber-guard read per case, which is why this line prints a live count
  // rather than a fixed number.
  const guardReads = READS.filter((r) => r.purpose === "clobber-guard").length;
  console.log(
    `  ${READS.length} read(s) total by this script — ${READS.length - guardReads} of repository source material,` +
      ` ${guardReads} clobber-guard read(s) of the packet's own blind_labels.json.`,
  );
  console.log(
    `  Excludes the module loader's own reads of this script and its imports (code, not`,
  );
  console.log(
    `  source material): a syscall-level trace of this run will count a few more than ${READS.length}.`,
  );
  console.log(
    `  Not read, by explicit denylist: held_out/**, */ground_truth.json, */events.json,`,
  );
  console.log(
    `  data/eval_reports/**, data/case3_eval_fallback.json, */metadata.json, /case3/i.`,
  );
  console.log(
    `  docs/EVAL.md and ${PROMPT_PATH} are read for the verbatim fidelity`,
  );
  console.log(
    `  checks only; neither one's content is written into a packet — both quote original`,
  );
  console.log(`  labels or predictions elsewhere in the file (EVAL.md §7; the prompt's`);
  console.log(`  versioning notes and Title section).`);

  console.log("");
  console.log("=".repeat(96));
  console.log(`${TAG} FILES WRITTEN (complete — every write goes through writePacket)`);
  console.log("=".repeat(96));
  for (const w of WRITES) {
    console.log(`  ${String(w.bytes).padStart(7)}B  ${w.sha256.slice(0, 12)}  ${w.path}`);
  }

  // Last thing printed, deliberately: the tooling is blind, the repo is not, and
  // this is the moment the packet is handed to a human.
  reportLeakSources(cases);

  console.log("");
  console.log(`${TAG} done — ${WRITES.length} file(s) written under ${outRel}/`);
  console.log(`${TAG} next: label, then npx tsx scripts/validate-blind-labels.ts <case>`);
}

main();

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
 * **NO READ THIS SCRIPT PERFORMS CONTRIBUTES A BYTE TO A PACKET.** That is a
 * property of the type, not a promise: `ReadPurpose` has no member meaning
 * "packet content", because since 2026-07-26 the packet contains no document,
 * no copy of one and nothing derived from one. It is a README, a blind-label
 * template and a list of PDF filenames the labeler is sent to read in place.
 *
 * `data/cases/<case>/source_drafts/` — the drafts carrying the `[SNIPPET]`
 * answer key — is no longer read, no longer listed, and is now on the DENYLIST
 * below, so reintroducing the read fails closed instead of shipping quietly.
 * Why that is the fix rather than another round of redaction is recorded at the
 * top of `lib/label-packet.ts`: the packet used to ship a marker-stripped copy
 * of each draft, and a copy is a second ledger — `source_bytes − copy_bytes` is
 * a constant times that document's original event count, recoverable from a
 * directory listing, with no need to know what the markers say. Every observable
 * of a derived copy carries the same information, so removing observables one at
 * a time could not terminate; removing the copy does.
 *
 * Every read of repository source material goes through `readAllowed` /
 * `listAllowed`, which check an explicit ALLOWLIST built up-front and an
 * explicit DENYLIST. There are exactly two further readers, `readOwnPacketFile`
 * and `listOwnPacketDir`, which read the packet's OWN `blind_labels.json` for
 * the clobber guard and its OWN directory for the stale-artifact guard; neither
 * touches repository source material and neither emits. All four append to a
 * read ledger printed in full at the end of every run, so the printed ledger is
 * the complete list.
 *
 * That is checkable rather than asserted: grepping this file for
 * `readFileSync|readdirSync|readFile|createReadStream|openSync` returns six
 * lines — THIS sentence, which names the patterns and so matches itself; the
 * `node:fs` import; and exactly four call sites, one inside each of those four
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
 * write ledger (path, bytes, sha256) also printed in full, and refuses any
 * filename outside `PACKET_ARTIFACTS`. Reads in, writes out, both auditable from
 * one run's stdout.
 * ---------------------------------------------------------------------------
 *
 * Withheld, deliberately (see the packet README's "What was withheld"):
 *   - THE DOCUMENTS THEMSELVES, in any derived form. The labeler reads
 *     `data/cases/<case>/docs/*.pdf` in place. `pdftotext` extracts a clean text
 *     layer from all 13 dev PDFs (case1 7, case2 6) and finds ZERO `[SNIPPET]`
 *     marker lines in any of them, so the PDFs hand over nothing the drafts'
 *     markers would. Reading them in place is also what Case 3's labeler did,
 *     which makes the two labeling regimes differ in less, not more.
 *   - `[SNIPPET — DO NOT EDIT]` / `[/SNIPPET]` marker lines in the drafts.
 *     There is exactly ONE marked block per ORIGINAL GROUND-TRUTH EVENT, in
 *     every document of both cases, with zero mismatches. The markers are
 *     therefore a complete answer key to the original labels AND to their
 *     granularity, laid over the documents. They stay in `source_drafts/`, which
 *     is forbidden to the labeler and denied to this script.
 *
 *     They do NOT "map 1-1 onto `events.json` `source.snippet` anchors" — the
 *     claim this comment and the packet README both carried until 2026-07-26.
 *     Measured: several marked blocks have no prediction snippet, and rather
 *     more prediction snippets have no marked block. What the markers track is
 *     the ORIGINAL LABELS, which is the more damaging of the two.
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
  PACKET_ARTIFACTS,
  type ProtocolBlock,
  type PacketDoc,
  docOrder,
  templateJson,
  sittingState,
  packetReadme,
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
/**
 * THERE IS NO `packet-content` MEMBER, and its absence is the guarantee.
 *
 * Every purpose below is a read whose content is consumed and discarded inside
 * one function: a directory listing yields filenames, a fidelity check yields a
 * boolean, the clobber guard yields a comparison. None of them can put a byte
 * into a packet, and adding a purpose that could would mean adding a member
 * here.
 *
 * The ledger prints no BYTE SIZE for any of these, deliberately. A size printed
 * beside a path is a measurement of a file, and a measurement of a file that a
 * labeler can also measure — by `ls -l`, or `wc -c` — is a differential waiting
 * for a second term. That is precisely how the marker-stripped document copies
 * leaked: two sizes of the same document, one in the ledger and one on disk,
 * subtract to a multiple of the event count. Sizes of files the labeler HOLDS
 * are still printed, in the WRITE ledger, because they measure the labeler's own
 * artifacts against nothing.
 */
type ReadPurpose = "listing" | "fidelity-check" | "clobber-guard" | "artifact-guard";

interface ReadRecord {
  path: string; // repo-relative
  purpose: ReadPurpose;
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
  {
    re: /(^|\/)source_drafts(\/|$)/,
    why: "the drafts carry the [SNIPPET] answer key; nothing derived from them may reach a packet",
  },
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
  console.log("  Your packet holds no copy of any document, by design: a copy is a measurement of");
  console.log("  the original, and its size gave away how much had been removed from it. The");
  console.log("  packet is instructions; the PDFs are the documents. Read them in place.");
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
  READS.push({ path: rel, purpose });
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
  READS.push({ path: `${rel}/ (names only)`, purpose: "listing" });
  return names;
}

/** The one read that is NOT of repository source material: the packet's own
 * blind_labels.json, read by the clobber guard. Ledgered like everything else so
 * the printed ledger is the complete list. Its content never leaves the guard. */
function readOwnPacketFile(abs: string): string {
  const content = readFileSync(abs, "utf8");
  READS.push({ path: repoRel(abs), purpose: "clobber-guard" });
  return content;
}

/** The packet's OWN directory, listed by the stale-artifact guard. Ledgered for
 * the same reason as the reader above: the printed ledger is only "the complete
 * list" if nothing reads or lists outside these helpers. Names only, and no
 * repository source material is involved — the directory it lists is the one
 * this script is writing. */
function listOwnPacketDir(abs: string): string[] {
  const names = readdirSync(abs).sort();
  READS.push({ path: `${repoRel(abs)}/ (names only)`, purpose: "artifact-guard" });
  return names;
}

/** The only writer. Refuses any filename outside {@link PACKET_ARTIFACTS}.
 *
 * This is the mechanized form of the rule at the top of `lib/label-packet.ts`:
 * the packet is a README, a template, and nothing else. A derived document copy
 * — the artifact whose SIZE leaked every document's original event count — can
 * only come back by someone editing that array, which is a change a reviewer
 * sees. A guard on the write path catches it whatever route the content took to
 * get here. */
function writePacket(abs: string, content: string): void {
  const name = abs.split(sep).pop() ?? "";
  if (!(PACKET_ARTIFACTS as readonly string[]).includes(name)) {
    console.error(`${TAG} REFUSED write of "${repoRel(abs)}" — not one of ${PACKET_ARTIFACTS.join(", ")}`);
    console.error(`${TAG} The packet ships instructions only. Anything derived from a document`);
    console.error(`${TAG} stands in a fixed arithmetic relation to it; see lib/label-packet.ts.`);
    process.exit(1);
  }
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
// The reading-order manifest — FILENAMES ONLY.
//
// Everything the generator learns about the case documents comes from one
// directory listing of `data/cases/<case>/docs/`. No document is opened, here or
// anywhere else in this script: the labeler opens the PDFs themselves, in a PDF
// viewer, which is what Part A's protocol tells them to do and what Case 3's
// labeler did.
//
// `data/cases/<case>/source_drafts/` is not read, not listed, and is on
// DENY_PATTERNS. It used to be the packet's document source, with the `[SNIPPET]`
// markers stripped out on the way through — and the stripped copy's size, set
// against the draft's, was that document's original event count. See the rule at
// the top of `lib/label-packet.ts`.
// ---------------------------------------------------------------------------
interface CaseListing {
  pdfNames: string[]; // reading order
}

function collectDocs(caseId: CaseId, listing: CaseListing): PacketDoc[] {
  if (listing.pdfNames.length === 0) {
    console.error(`${TAG} ${caseId}: no PDFs in data/cases/${caseId}/docs/ — nothing to send the labeler to`);
    process.exit(1);
  }
  return listing.pdfNames.map((name, i) => ({ order: i + 1, sourceDocument: name }));
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

/**
 * Refuses to regenerate INTO a directory holding anything this generator would
 * not write.
 *
 * Rewriting is not the same as replacing. Packets generated before 2026-07-26
 * carried a `docs/` subdirectory of marker-stripped document copies, and those
 * copies are the artifact this round removed — a regeneration that only
 * overwrites the README and the template would leave every one of them sitting
 * in the labeler's packet, with the new README saying no such file exists. A
 * stale artifact from the shape being abandoned is the worst case a "just write
 * the new files" path produces.
 *
 * Same posture as the clobber guard above and for the same reason: it refuses
 * and names what to move, rather than deleting anything on the operator's
 * behalf. The packet directory is open to the labeler — notes may legitimately
 * be in there — and a generator that deletes files it did not write is a worse
 * failure than one that stops.
 */
function assertNoForeignArtifacts(caseId: CaseId, caseOut: string): void {
  if (!existsSync(caseOut)) return;
  const foreign = listOwnPacketDir(caseOut).filter(
    (n) => !(PACKET_ARTIFACTS as readonly string[]).includes(n),
  );
  if (foreign.length === 0) return;

  console.error(`${TAG} REFUSED — ${repoRel(caseOut)}/ holds ${foreign.length} entr(ies) this generator does not write:`);
  for (const n of foreign) console.error(`${TAG}   ${n}`);
  console.error(`${TAG} A packet is ${PACKET_ARTIFACTS.join(" + ")} and nothing else. Anything else in`);
  console.error(`${TAG} there is either stale — packets before 2026-07-26 shipped copies of the case`);
  console.error(`${TAG} documents, which is exactly what this shape removes — or yours, in which case`);
  console.error(`${TAG} this script must not touch it. Move it aside and re-run:`);
  console.error(`${TAG}   mv ${repoRel(caseOut)} ${repoRel(caseOut)}.kept`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
function buildAllowlist(cases: CaseId[]): Map<CaseId, CaseListing> {
  ALLOWED_FILES.add(resolve(process.cwd(), "docs/EVAL.md"));
  ALLOWED_FILES.add(resolve(process.cwd(), PROMPT_PATH));
  const out = new Map<CaseId, CaseListing>();

  for (const caseId of cases) {
    const pdfDir = resolve(process.cwd(), "data", "cases", caseId, "docs");
    if (!existsSync(pdfDir)) {
      console.error(`${TAG} ${caseId}: missing ${repoRel(pdfDir)}`);
      process.exit(1);
    }
    // The ONLY directory this script lists, and the only thing it takes from it
    // is filenames. Nothing under it is added to ALLOWED_FILES, so `readAllowed`
    // would refuse to open a PDF even if something asked it to.
    ALLOWED_DIRS.add(pdfDir);

    const pdfNames = listAllowed(pdfDir)
      .filter((n) => n.toLowerCase().endsWith(".pdf"))
      .sort((a, b) => docOrder(a) - docOrder(b) || a.localeCompare(b));
    out.set(caseId, { pdfNames });
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
    assertNoForeignArtifacts(caseId, caseOut);
    return { caseId, caseOut, labelsPath, template, docs: collectDocs(caseId, listing) };
  });

  for (const { caseId, caseOut, labelsPath, template, docs } of planned) {
    mkdirSync(caseOut, { recursive: true });
    writePacket(join(caseOut, "README.md"), packetReadme(caseId, docs));
    writePacket(labelsPath, template);

    // A count of PDFs in a directory the labeler is sent to and can `ls`. It is
    // not derived from the labels, and it is the only quantity this loop has.
    // The line under it used to say how many marker lines were stripped from
    // those documents, which halved straight into the case's original event
    // total — printed to the terminal at the moment the packet was handed over.
    // There is no stripping any more, so there is nothing left to count.
    console.log("");
    console.log(`  ${caseId}: packet written; the labeler is sent to ${docs.length} PDF(s)`);
    console.log(`  ${" ".repeat(caseId.length)}  in data/cases/${caseId}/docs/, read in place — no document is copied`);
  }

  // ---- IO ledger -----------------------------------------------------------
  console.log("");
  console.log("=".repeat(96));
  console.log(`${TAG} FILES READ (complete — every read in this script goes through readAllowed/listAllowed)`);
  console.log("=".repeat(96));
  for (const r of READS) {
    console.log(`  ${r.purpose.padEnd(15)}  ${r.path}`);
  }
  console.log("");
  // Not a promise — a property of ReadPurpose, which has no member meaning
  // "packet content". No byte of any file above can reach a packet, because
  // there is no code path that would carry one there.
  console.log(
    `  NONE of these reads emits into a packet: a listing yields filenames, a fidelity check`,
  );
  console.log(
    `  yields a boolean, the clobber guard yields a comparison. No size is printed for them`,
  );
  console.log(
    `  either — a size beside a path is one term of a differential, and the packet's stripped`,
  );
  console.log(`  document copies (now gone) were the other.`);
  console.log("");
  // THE TOTAL IS NOT PRINTED, and that is deliberate rather than an oversight.
  //
  // This block used to end with an "N read(s) total" line. The number has no
  // consumer — the ledger above enumerates every read, so anyone who wants a
  // total counts the lines — and it has now collided with an original event
  // total TWICE, under two different definitions of what the script reads. Both
  // collisions were arithmetic coincidences rather than causal leaks, and both
  // were handled by carving the line out of the audit's count scan, which is a
  // carve-out that has to be re-argued every time the arithmetic moves. It moved
  // again this round. A bookkeeping figure nobody needs is not worth a standing
  // exception in the check that exists to catch anchors.
  //
  // The ledger itself is unchanged in substance: it is still the complete list
  // of reads this script performs through readAllowed / listAllowed /
  // readOwnPacketFile / listOwnPacketDir. It structurally cannot include the
  // module loader's reads of this file and its imports — those are code, not
  // repository source material, and no byte of them can reach a packet — so a
  // syscall-level trace of the same run will always show more entries than this.
  console.log(
    `  The list above is complete for this script. It excludes the module loader's own reads`,
  );
  console.log(
    `  of this file and its imports (code, not source material), so a syscall-level trace of`,
  );
  console.log(`  the same run will always show more entries than it does.`);
  console.log(
    `  Not read, by explicit denylist: held_out/**, */source_drafts/**, */ground_truth.json,`,
  );
  console.log(
    `  */events.json, data/eval_reports/**, data/case3_eval_fallback.json, */metadata.json,`,
  );
  console.log(`  /case3/i.`);
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
  console.log("");
  console.log(`  Sizes appear here and not in the read ledger because these are the labeler's OWN`);
  console.log(`  files: they can measure them directly, and there is no second copy of anything to`);
  console.log(`  subtract them from. Every artifact above is authored — a README, a template — and`);
  console.log(`  none is derived from a case document.`);

  // Last thing printed, deliberately: the tooling is blind, the repo is not, and
  // this is the moment the packet is handed to a human.
  reportLeakSources(cases);

  console.log("");
  console.log(`${TAG} done — ${WRITES.length} file(s) written under ${outRel}/`);
  console.log(`${TAG} next: label, then npx tsx scripts/validate-blind-labels.ts <case>`);
}

main();

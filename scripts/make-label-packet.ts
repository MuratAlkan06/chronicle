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
import { EventTypeSchema, DateConfidenceSchema } from "../lib/schema";
import { leakSources, type LeakSource } from "../lib/label-leak-sources";

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
  console.log("  This generator cannot read any path below, and no byte of any of them is in your");
  console.log("  packet. It also cannot stop you opening one. Each carries the original");
  console.log("  ground-truth titles for these cases, the model's predicted titles, or the event");
  console.log("  count and segmentation the labels were written at — and title phrasing is the");
  console.log("  single quantity this experiment exists to measure. There is no partial");
  console.log("  contamination: one line read is the measurement gone.");
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
  console.log("  This list is lib/label-leak-sources.ts, the same array the packet README renders");
  console.log("  and `npx tsx scripts/check-label-leaks.ts` enforces — that gate greps every");
  console.log("  tracked file for verbatim original titles and fails on any hit not listed above.");
  console.log("  It cannot see paraphrase, and it cannot see count or granularity leaks, so if you");
  console.log("  catch yourself weighing whether some OTHER file is safe, apply the test directly:");
  console.log("  does it quote a title, a prediction, or an event count for one of these two");
  console.log("  cases? If you cannot answer that without opening it, do not open it.");
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

// ---------------------------------------------------------------------------
// PROTOCOL — inlined verbatim from docs/EVAL.md §5 ("step-by-step for Murat —
// writing Case 3 ground-truth labels").
//
// Items 4 and 5 of "Common mistakes" are reproduced in their ORIGINAL, FALSE
// form because reproducing the conditions Case 3's labels were authored under
// is the entire point of the experiment. They are not softened. §7's correction
// markers ride along (they are part of the line in docs/EVAL.md today) and
// CORRECTIONS below states the mechanism, so the labeler is marked-but-not-
// deceived, exactly as docs/EVAL.md handles it in place.
//
// `verifyProtocolFidelity` asserts at runtime that every block below appears
// verbatim in docs/EVAL.md, so this copy cannot drift from the source silently.
// ---------------------------------------------------------------------------
interface ProtocolBlock {
  label: string;
  text: string;
}

const PROTOCOL_BLOCKS: ProtocolBlock[] = [
  {
    label: "What to label",
    text: "**What to label.** Every clinically discrete event as defined by the system prompt's \"What counts as ONE event\" section. *Use the prompt as your labeling spec.* Read the prompt's event definition first, then label according to it. This sounds circular but it's actually correct: you are evaluating whether the model FOLLOWS the spec. If your labels don't follow the spec, you're testing the wrong thing.",
  },
  {
    label: "The labeling unit",
    text: "**The labeling unit.** ONE event per discrete clinical moment. If a single doctor's note encounter included a visit + a new diagnosis + a med change, that's THREE events with the same date and source_document.",
  },
  {
    label: "How to label without contamination",
    text: [
      "**How to label without contamination.**",
      "1. **Do NOT run the model first.** Do not extract Case 3 with any prompt. Do not even sanity-check. The first time the model touches Case 3 PDFs is at H11.",
      "2. **Open Case 3 PDFs in chronological order**, one at a time, in your PDF viewer. Read each cover-to-cover before labeling.",
      "3. For each PDF, write your labels in `ground_truth.json` directly. Use the schema above.",
      "4. Mark `in_scope: false` for events where you genuinely think two reasonable extractors would disagree on whether to include it. Be generous with this — false-positive scope is fine, missing scope is bad. (You'd rather exclude a borderline event from the FN denominator than punish the model for not matching your idiosyncratic call.)",
    ].join("\n"),
  },
  {
    label: "Handling ambiguous cases",
    text: [
      "**Handling ambiguous cases.**",
      "- *Doctor's note mentions a previous referral that already happened:* label it as a separate `referral` event with the previous date if the note states a date; mark `date_confidence` as approximate or inferred. If the note says \"previously referred to ortho\" with no date, do NOT label — there's no event to anchor.",
      "- *Doctor's note mentions a planned future MRI:* do NOT label. The system prompt explicitly excludes forward plans.",
      "- *Multiple labs on one panel:* ONE event for the panel, with the most-relevant analyte in `notes`. Do not emit per-analyte events. (Match the system prompt rule.)",
      "- *A med refill that's just continuing existing med at same dose:* do NOT label unless the document explicitly re-confirms the med on this date as a distinct decision.",
      "- *A prior diagnosis re-listed in the problem list:* do NOT label as a new diagnosis event.",
    ].join("\n"),
  },
  {
    label: "Common mistakes to actively avoid",
    text: [
      "**Common mistakes to actively avoid:**",
      "1. **Hindsight bias.** You will be tempted later to add events the model surfaced that you missed. **Do not.** If you added events post-hoc the metric is a self-fulfilling prophecy. Set the file as read-only after labeling: `chmod 444 held_out/case3/ground_truth.json`.",
      "2. **Label drift.** Stretching labeling across days lets your \"what counts as an event\" intuition shift. Do it in one sitting.",
      "3. **Pollution from running predictions in parallel.** Don't have the extraction code open in another window. Don't be tempted to \"just see what it does.\"",
      "4. **Title bias.** Don't write titles in the same phrasing the model would use. Write naturally — the matching algorithm uses token-overlap precisely so phrasing differences don't break matching. **[Corrected 2026-07-25 — the second sentence is false as stated. See the correction note below and §7.]**",
      "5. **Date over-precision.** If the document says \"March 2024\" don't pick a specific day to make matching easier; use `2024-03-01` and `date_confidence: approximate`. The matching algorithm is calibrated for this. **[Corrected 2026-07-25 — the last sentence is false as stated; the instruction itself stands. See the correction note below and §7.]**",
    ].join("\n"),
  },
];

// ---------------------------------------------------------------------------
// GRANULARITY SPEC — inlined from prompts/system_extract_v4.md.
//
// §5's protocol says "Use the prompt as your labeling spec", and granularity is
// the largest confound in this experiment after phrasing, so the labeler needs
// these rules. But the prompt FILE cannot be handed over: its v3-vs-v2
// versioning note quotes four original Case 1 ground-truth visit titles
// verbatim, and its "Title (≤ 70 chars)" section carries the per-type title
// templates the model was tuned on — either would destroy the measurement.
//
// So the leak-free rule blocks are inlined here and fidelity-checked against the
// prompt file exactly as the §5 protocol is. Two passages are NOT reproduced,
// because their originals use examples drawn from these very documents (a
// specific scheduled-biopsy date; specific lab values, imaging findings and
// medication doses). Their replacements are generator-authored, marked as such
// in the packet, and carry the same rule with the examples removed.
// ---------------------------------------------------------------------------
const PROMPT_BLOCKS: ProtocolBlock[] = [
  {
    label: "What counts as ONE event — inclusions",
    text: [
      "ONE event = one clinically discrete moment in the record:",
      "- a single lab order/result (one event per panel ordered on one date,",
      "  with the panel's notable values aggregated; do NOT emit one event per",
      "  analyte unless the document treats them as separate orders)",
      "- a single visit/encounter (one event per encounter date with one provider)",
      "- a single imaging study (CT, MRI, X-ray, mammogram — one per study)",
      "- a single diagnosis added to the problem list",
      "- a single medication started, stopped, or dose-changed",
      "- a single procedure performed",
      "- a single referral placed",
    ].join("\n"),
  },
  {
    label: "What counts as ONE event — exclusions (leading)",
    text: [
      "Do NOT emit:",
      "- patient demographics, insurance, header/footer text",
      '- "no change" or "continues" mentions of prior events (they are context,',
      "  not new events) UNLESS the document explicitly RE-CONFIRMS a finding on",
      "  a new date",
    ].join("\n"),
  },
  {
    label: "What counts as ONE event — exclusions (trailing)",
    text: [
      "- the document's own metadata (date faxed, date printed, signed by) unless",
      "  it IS the event date",
    ].join("\n"),
  },
  {
    label: "Primary-source rule — body",
    text: [
      "Emit an event ONLY when THIS document is the PRIMARY SOURCE of that event.",
      "A document is the primary source when it is the document that:",
      "- reports a lab/imaging result for the first time (the lab report itself,",
      "  not a later visit note that recaps it)",
      "- records a visit/encounter being conducted (the visit note for that",
      "  encounter, not a follow-up note that mentions it)",
      "- records a diagnosis being added to the active problem list (not a later",
      "  note that lists it as PMH)",
      "- records a medication being started, stopped, or dose-changed (not a",
      "  later note that lists it as a current medication unchanged)",
      "- records a procedure being performed (not the surgical consult that",
      "  scheduled it, not the follow-up note that recaps the pathology result)",
      "- records a referral being placed (not a later note that mentions the",
      "  patient was previously referred)",
    ].join("\n"),
  },
  {
    label: "Primary-source rule — closing test",
    text: [
      'When in doubt, ask: "is this document the one PERFORMING, DECIDING, or',
      'REPORTING this event for the first time?" If no, do not emit.',
    ].join("\n"),
  },
];

/** Generator-authored stand-ins for the two prompt passages whose originals use
 * examples taken from these documents. Marked as replacements in the packet. */
const REPLACED_FORWARD_PLANS =
  "- forward-looking plans (an intention recorded for a future date) — these\n  describe intentions, not occurrences";
const REPLACED_REFERENCE_PARAGRAPH =
  "If this document merely REFERENCES a prior event for context, do NOT emit a new\nevent for that reference. The event has been (or will be) captured from its own\nprimary source document, and emitting it again creates duplicates.";

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
// Corrections. Written here, not quoted from §7: §7's prose is interleaved with
// original GT titles and with dev-set aggregate figures (event counts, F1
// curves), all of which would anchor a blind labeler. These state the mechanism
// and nothing measured about Cases 1+2.
// ---------------------------------------------------------------------------
const CORRECTIONS = `> **READ THIS BEFORE THE PROTOCOL ABOVE TAKES EFFECT (docs/EVAL.md §7,
> issues #22 and #25).** Items 4 and 5 above are quoted in their original form
> on purpose — they are the instructions Case 3's ground truth was authored
> under, and this relabeling exists to reproduce those conditions. They are
> **not** softened here. But their closing assurances are false, and you are
> told so rather than deceived:
>
> **Item 4's second sentence is false.** \`matchesEvent\` scores
> \`|A ∩ B| / max(|A|, |B|)\` over token *sets* and requires ≥ 0.5, so the score
> is capped at \`min/max\` **before any word is compared**. A label whose token
> count is less than half its prediction's can never match, however clinically
> correct it is. Token overlap tolerates rephrasing only while the two titles
> stay within 2× on token count. Item 4's *first* sentence — don't copy the
> model's phrasing — is sound labeling practice on its own; the false part is
> the assurance that the metric makes it costless.
>
> **Item 5's closing sentence is false too, on narrower grounds.** "The matching
> algorithm is calibrated for this" describes behavior that does not exist:
> \`matchesEvent\` never reads \`date_confidence\` at all. There is no widening of
> date tolerance for an approximate date anywhere in \`lib/eval.ts\`. Strict
> requires an exact day; loose accepts ±3 days. **Item 5's actual instruction
> stands** — a month-only date recorded as the 1st with
> \`date_confidence: approximate\` is correct labeling, and inventing a specific
> day would be worse; only the closing assurance is wrong.
>
> **What to do with that.** Nothing. Label as the protocol says, in your own
> words, at the granularity the documents support. Do **not** try to write
> titles that will match — that is the co-phrasing this experiment measures, and
> steering toward it destroys the measurement. If your phrasing costs the model
> a match, that cost is the finding.`;

function granularitySection(): string {
  const b = (label: string): string => {
    const found = PROMPT_BLOCKS.find((x) => x.label === label);
    return found ? found.text : `!! missing block: ${label}`;
  };

  return `Part A tells you to use the system prompt as your labeling spec, and
granularity — how many events one encounter is worth — is the thing that spec
decides. **Do not open \`prompts/system_extract_v4.md\` for this sitting.** Its
versioning notes quote original ground-truth titles for these cases verbatim,
and its "Title" section carries the per-type title templates the model was tuned
to produce. Either one would destroy the measurement this relabeling exists to
take.

The rule blocks you need are reproduced below, verbatim from that file. Two
passages are **replaced** rather than quoted, because their originals illustrate
the rule with examples quoted out of these very documents (specific dates and
specific clinical values). Both replacements are marked \`[REPLACED]\` and carry
the same rule with the examples removed. Nothing else is altered.

**What counts as ONE event**

\`\`\`
${b("What counts as ONE event — inclusions")}

${b("What counts as ONE event — exclusions (leading)")}
${REPLACED_FORWARD_PLANS}   <-- [REPLACED]
${b("What counts as ONE event — exclusions (trailing)")}
\`\`\`

**Primary-source rule (NON-NEGOTIABLE)**

\`\`\`
${b("Primary-source rule — body")}

[REPLACED]
${REPLACED_REFERENCE_PARAGRAPH}

${b("Primary-source rule — closing test")}
\`\`\`

Two notes on using this, neither of which is a hint about these documents:

- The primary-source rule and §5's "Handling ambiguous cases" bullets overlap and
  agree. Where they seem to conflict, follow the primary-source rule — it is the
  spec the model was actually given.
- The prompt is the *model's* spec. You are not required to agree with it. If you
  think a rule produces the wrong label, label what you think is right and say so
  in \`labeler_notes\`. A documented disagreement is a finding; a silent one is
  noise.`;
}

// ---------------------------------------------------------------------------
// Blind-label template.
// ---------------------------------------------------------------------------
const STUB_KEY = "_comment_DELETE_THIS_BEFORE_LABELING";
const PLACEHOLDER_PATIENT = "REPLACE_WITH_PATIENT_NAME_AGE_SEX_FROM_DOCUMENTS";
const PLACEHOLDER_LABELED_AT = "REPLACE_WITH_ISO_TIMESTAMP_AT_END_OF_LABELING";
const PLACEHOLDER_NOTES = "REPLACE_WITH_FREE_TEXT_JUDGMENT_CALLS_MADE_WHILE_LABELING";

function templateJson(caseId: CaseId): string {
  const template = {
    case_id: caseId,
    patient: PLACEHOLDER_PATIENT,
    labeled_at: PLACEHOLDER_LABELED_AT,
    labeler_notes: PLACEHOLDER_NOTES,
    events: [
      {
        [STUB_KEY]:
          "Template stub. Delete this whole object, then add one object per event with these same keys. `notes` is the only optional key. scripts/validate-blind-labels.ts refuses the file while this key is present anywhere.",
        id: "gt_001",
        date: "REPLACE_YYYY-MM-DD",
        date_confidence: DateConfidenceSchema.options.join(" | "),
        event_type: EventTypeSchema.options.join(" | "),
        title: "REPLACE_WITH_YOUR_OWN_HEADLINE_IN_YOUR_OWN_WORDS",
        source_document: "REPLACE_WITH_EXACT_PDF_FILENAME_INCLUDING_THE_.pdf_SUFFIX",
        in_scope: true,
        notes: "optional free text; delete this key if unused",
      },
    ],
  };
  return JSON.stringify(template, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Source documents.
// ---------------------------------------------------------------------------
const SNIPPET_MARKER = /^\[\/?SNIPPET\b[^\]]*\]$/;

interface CaseListing {
  draftsDir: string;
  draftNames: string[]; // reading order
  pdfNames: Set<string>;
}

interface PacketDoc {
  order: number;
  draftFile: string; // e.g. d1_pcp_2023_01.md
  sourceDocument: string; // e.g. d1_pcp_2023_01.pdf — the value to write in labels
  body: string; // marker-stripped
  markersStripped: number;
}

/** Reading order is the `dN_` prefix, numerically. */
function docOrder(filename: string): number {
  const m = /^d(\d+)_/.exec(filename);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function stripSnippetMarkers(body: string): { body: string; stripped: number } {
  const lines = body.split("\n");
  const kept: string[] = [];
  let stripped = 0;
  for (const line of lines) {
    if (SNIPPET_MARKER.test(line.trim())) {
      stripped++;
      continue;
    }
    kept.push(line);
  }
  return { body: kept.join("\n"), stripped };
}

function collectDocs(caseId: CaseId, listing: CaseListing): PacketDoc[] {
  const { draftsDir, draftNames, pdfNames } = listing;

  return draftNames.map((name, i) => {
    const raw = readAllowed(join(draftsDir, name), "packet-content");
    const { body, stripped } = stripSnippetMarkers(raw);
    const pdfName = name.replace(/\.md$/, ".pdf");
    if (!pdfNames.has(pdfName)) {
      console.error(`${TAG} ${caseId}: draft "${name}" has no matching PDF "${pdfName}" in docs/`);
      process.exit(1);
    }
    return {
      order: i + 1,
      draftFile: name,
      sourceDocument: pdfName,
      body,
      markersStripped: stripped,
    };
  });
}

// ---------------------------------------------------------------------------
// Packet README.
// ---------------------------------------------------------------------------
function packetReadme(caseId: CaseId, docs: PacketDoc[]): string {
  const readingOrder = docs
    .map(
      (d) =>
        `| ${d.order} | \`docs/${d.draftFile}\` | \`"${d.sourceDocument}"\` | \`data/cases/${caseId}/docs/${d.sourceDocument}\` |`,
    )
    .join("\n");

  // Rendered from lib/label-leak-sources.ts rather than restated in prose, so
  // the README, the handover banner and scripts/check-label-leaks.ts cannot
  // disagree about what "forbidden" means. Only THIS case's data paths are
  // listed; the other dev case is not part of this packet's sitting.
  const forbidden = leakSources([caseId]);
  const forbiddenRules = forbidden
    .map((s, i) => `${i + 1}. \`${s.path}\` — ${s.why}`)
    .join("\n");

  return `# Blind labeling packet — ${caseId}

Generated by \`scripts/make-label-packet.ts\` (issue #24). Working material —
\`label_packet/\` is gitignored and is not a tracked artifact.

## What you are doing

You are writing ground-truth labels for ${caseId} **from scratch**, from the
documents in \`docs/\` and nothing else. Your labels will later be scored against
the model predictions that are already cached in this repo — predictions you
must not look at. The delta between the original labels and yours is the
measurement; if you see either the predictions or the original labels, there is
no measurement left to take.

## Rules of this sitting

**This packet is blind. The repository around it is not.** The generator that
wrote these files cannot read any of the paths below — they are off its
allowlist, several are on its denylist, and no byte of any of them is in this
packet. It cannot stop *you* opening them.

Every path in rules 1–${forbidden.length} is forbidden for one reason: it carries, **verbatim**,
the original ground-truth titles for these cases, the model's predicted titles,
or the event count and segmentation those labels were written at. Title phrasing
is the single quantity this experiment measures. There is no partial
contamination — one line read is the measurement gone, and the only honest thing
left to do would be to say so and abandon the sitting.

**Do not open any of these, for any reason, including to check something
unrelated.** They are ordered by how much damage each does.

${forbiddenRules}
${forbidden.length + 1}. One sitting, no splitting across days (protocol item 2 below).
${forbidden.length + 2}. Write into \`blind_labels.json\` in this directory. When you are done:
   \`npx tsx scripts/validate-blind-labels.ts ${caseId}\`.

Also: do **not** run the extractor.

**Where to get what those files would have given you.** The granularity spec is
reproduced in **Part D** below, with the leaking passages removed — that is why
\`prompts/\` is closed. The documents in this packet's \`docs/\` are the
\`source_drafts/\` documents with the \`[SNIPPET]\` marker lines stripped, so you
already have the text without the answer key; see "What was withheld", below.
Everything you need from \`docs/EVAL.md\` §5 and §7 is inlined in Parts A and B.

**This list is generated, not hand-maintained.** It comes from
\`lib/label-leak-sources.ts\`, the same array that
\`npx tsx scripts/check-label-leaks.ts\` enforces: that script greps every tracked
file for verbatim original titles and **fails if it finds one outside this list**.
It was written because the list was assembled by hand twice and each sweep missed
files the next one found.

That gate only sees **verbatim** titles. It cannot see paraphrase, and it cannot
see count or granularity leaks. So the list above is still the paths that leak
**today** — treat it as examples of a rule, not as the rule itself. The rule is:
**does this file quote a title, a prediction, or an event count for one of these
two cases?** If you cannot answer that without opening it, you do not get to open
it — pause and ask. A paused sitting can be resumed; a contaminated one cannot be
repaired, and cannot be detected afterwards either.

## Reading order

Read cover-to-cover, in this order, before labeling each one.

| # | read this | write this as \`source_document\` | equivalent PDF |
|---|-----------|----------------------------------|----------------|
${readingOrder}

The \`.md\` files here are the drafts the PDFs were exported from — same content,
readable in an editor. Open the PDFs instead if you prefer; they are identical
in substance.

**Write \`source_document\` exactly as shown, with the \`.pdf\` suffix.** This is
not cosmetic: the matcher's same-document tie-break compares that string, so a
different spelling changes scoring for a reason that has nothing to do with your
labels.

## The record shape

Each event in \`blind_labels.json\` is:

The values below are deliberately synthetic placeholders, not an example event —
a filled-in example would hand you a date, a type and a phrasing to anchor on.

\`\`\`jsonc
{
  "id": "gt_001",             // unique within this file; gt_NNN convention
  "date": "YYYY-MM-DD",       // ISO 8601, a real calendar date
  "date_confidence": "…",     // one of: ${DateConfidenceSchema.options.join(" | ")}
  "event_type": "…",          // one of: ${EventTypeSchema.options.join(" | ")}
  "title": "…",               // your own words — see the corrections below
  "source_document": "…",     // exactly as in the reading-order table above
  "in_scope": true,           // false → excluded from the FN denominator
  "notes": "…"                // optional; omit the key entirely if unused
}
\`\`\`

Also fill in \`patient\`, \`labeled_at\` (ISO 8601, set at the END of the sitting)
and \`labeler_notes\` at the top of the file. The validator refuses the file while
any placeholder is still in place.

---

## Part A — the protocol, as Case 3's labeler received it

Quoted **verbatim** from \`docs/EVAL.md\` §5. Two of these instructions are
wrong; they are reproduced unsoftened because reproducing the conditions Case
3's labels were written under is the point of this experiment. Part B says which
and why. Read Part B before you act on Part A.

${PROTOCOL_BLOCKS.map((b) => b.text).join("\n\n")}

---

## Part B — corrections

${CORRECTIONS}

---

## Part C — what is different for this relabeling

Part A is quoted unchanged, so it says "Case 3" and \`ground_truth.json\` and
"H11". Substitute:

- "Case 3" → **${caseId}**. Case 3 is not involved here at all.
- \`ground_truth.json\` → **\`blind_labels.json\`**, in this directory. Do not write
  to \`data/cases/${caseId}/ground_truth.json\`; the original labels are the
  baseline this experiment measures against and must not change.
- "Do NOT run the model first" → the model has **already** run on these
  documents; the predictions are cached in the repo. The instruction becomes:
  do not open them. The \`data/cases/${caseId}/\` rule above covers them.
- \`chmod 444\` / \`git hash-object\` / \`.gt_hash.lock\` → skip. Those lock a
  held-out artifact. This packet is untracked working material.
- "the system prompt" / "the schema above" → **Part D** and the record shape
  above. Do not go to the prompt file itself; see the \`prompts/\` rule and Part D.

### What was withheld from this packet, and why

- **Any target event count.** §5's labeling checklist names one. It is withheld
  here, and it is deliberately **not restated, paraphrased, or bounded anywhere
  in this packet** — not even to tell you which side of it the truth falls on.
  An expected count is an anchor: given one, you would label toward it, and the
  count you produce is itself one of the things being compared against the
  original labels. Label at the granularity the documents and the prompt spec
  support, and let the count fall where it falls. If that leaves you unsure
  whether you have "enough" events, that uncertainty is correct — keep it.
- **\`[SNIPPET]\` marker lines** present in the original drafts. These are not a
  subtle hint. There is **exactly one marked block per original ground-truth
  event, in every document of both cases, with zero mismatches** — so the
  markers are a complete answer key to the original labels *and* to the
  granularity those labels were written at, laid directly over the document
  text. (An earlier version of this packet described the markers as mapping 1-1
  onto the *predictions'* citation anchors. That was measured and is false:
  several marked blocks have no prediction snippet, and rather more prediction
  snippets have no marked block. What the markers actually track is the
  **original labels** — the more damaging of the two, which is why the wrong
  description is worth correcting rather than dropping.) The \`docs/\` copies
  here read exactly the way the PDF the model saw does — checked directly:
  \`pdftotext\` extracts a clean text layer from every dev PDF and finds **zero**
  marker lines in any of them. The snippet sentences themselves are untouched —
  they are part of the document. **This is what the \`source_drafts/\` rule is
  for:** stripping the markers from your copies achieves nothing if you go read
  the originals.
- **\`source_drafts/README.md\`**, which names a deliberate contradiction planted
  between two of the documents.
- **\`metadata.json\`**, which records how many events the model emitted.
- **The whole of \`prompts/\`**, whose versioning notes quote original
  ground-truth titles for these cases verbatim and whose Title section holds the
  per-type title templates the model was tuned on. Part D carries the rules from
  it, not the phrasing.

---

## Part D — the event-granularity spec

${granularitySection()}

## Checklist before you hand off

- [ ] Every \`source_document\` is one of the filenames in the reading-order table.
- [ ] Every \`date\` is a real calendar date in \`YYYY-MM-DD\` form.
- [ ] Every \`event_type\` is in the locked enum.
- [ ] \`id\`s are unique.
- [ ] \`patient\`, \`labeled_at\` and \`labeler_notes\` no longer hold placeholders.
- [ ] The template stub object is deleted.
- [ ] You used \`in_scope: false\` where two reasonable extractors would disagree.
- [ ] \`npx tsx scripts/validate-blind-labels.ts ${caseId}\` exits 0.
- [ ] You did not open the predictions or the original labels at any point.

Only after all packets are labeled and validated:
\`npx tsx scripts/compare-relabel.ts\`.
`;
}

function packetDocFile(caseId: CaseId, doc: PacketDoc, total: number): string {
  const header = [
    `<!-- ${caseId} · document ${doc.order} of ${total}`,
    `     source_document value to use in blind_labels.json: "${doc.sourceDocument}"`,
    `     equivalent PDF: data/cases/${caseId}/docs/${doc.sourceDocument}`,
    `     copied from data/cases/${caseId}/source_drafts/${doc.draftFile}`,
    `     ${doc.markersStripped} [SNIPPET] marker line(s) removed; document text is otherwise verbatim -->`,
    "",
  ].join("\n");
  return header + doc.body;
}

// ---------------------------------------------------------------------------
// Clobber guard.
// ---------------------------------------------------------------------------
/** Refuses to overwrite anything but a pristine template. Byte-equality against
 * the template this run would write is the test: a labeling sitting that has
 * begun differs from it in at least one byte, and a pristine template is a
 * harmless no-op rewrite. There is no --force; move the file aside instead. */
function assertNotClobbering(caseId: CaseId, labelsPath: string, template: string): void {
  if (!existsSync(labelsPath)) return;
  const existing = readOwnPacketFile(labelsPath);
  if (existing === template) {
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
    assertNotClobbering(caseId, labelsPath, template);
    return { caseId, caseOut, labelsPath, template, docs: collectDocs(caseId, listing) };
  });

  for (const { caseId, caseOut, labelsPath, template, docs } of planned) {
    mkdirSync(join(caseOut, "docs"), { recursive: true });
    writePacket(join(caseOut, "README.md"), packetReadme(caseId, docs));
    writePacket(labelsPath, template);
    for (const d of docs) {
      writePacket(join(caseOut, "docs", d.draftFile), packetDocFile(caseId, d, docs.length));
    }

    const stripped = docs.reduce((a, d) => a + d.markersStripped, 0);
    console.log("");
    console.log(
      `  ${caseId}: ${docs.length} document(s), ${stripped} [SNIPPET] marker line(s) stripped`,
    );
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

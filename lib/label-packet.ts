/**
 * lib/label-packet.ts — the RENDERING half of the issue #24 blind labeling
 * packet. Every byte a labeler reads is produced here; `scripts/make-label-
 * packet.ts` owns the IO around it (allowlist, denylist, read/write ledgers,
 * clobber guard) and calls in.
 *
 * WHY IT LIVES IN `lib/`. `npm test` runs `tsx --test lib/*.test.ts` and nothing
 * else, so until this split not one line of the packet generator was executed by
 * any test — the most safety-critical file in the toolkit was verified only by
 * being run by hand and eyeballed. It was eyeballed twice, through two
 * amendments, and still shipped the segmentation key it exists to withhold
 * (Amendment 3 §1). Logic that needs coverage has to be in `lib/`; this is the
 * same reasoning `lib/label-leak-sources.ts` and `lib/eval-gate.ts` record.
 *
 * ---------------------------------------------------------------------------
 * THE PACKET SHIPS NO ARTIFACT DERIVED FROM THE MARKED DRAFTS.
 *
 * That is the rule this module holds, and it replaced a weaker one that could
 * not be made to terminate.
 *
 * `[SNIPPET — DO NOT EDIT]` / `[/SNIPPET]` markers in
 * `data/cases/<case>/source_drafts/` are PAIRED, and there is exactly one marked
 * block per original ground-truth event in every document of both cases. Any
 * quantity that tracks how much marker text was removed from a draft therefore
 * IS that draft's original event count.
 *
 * The old rule was "emit no such quantity", and it was patched three times: a
 * stripped-marker count in every document header, then the same count in the
 * generator's closing summary, then whitespace and structural proxies for it.
 * Each fix removed one observable and the next audit found another. The
 * terminating observation is that the packet used to ship a marker-STRIPPED COPY
 * of every draft, and **a copy is a second ledger**. The marker pair is a
 * constant 37 bytes, so `source_bytes − copy_bytes` is 37 × that document's
 * event count — exact on all 13 dev documents, zero remainder — and the GCD of
 * those deltas across the corpus is 37, so an attacker never needs to know the
 * marker strings. `source_bytes` is available from a directory listing alone.
 * Byte size, line count, whitespace, structure, checksums: every observable of a
 * derived copy correlates with how much was removed from it. Enumerating
 * observables one at a time cannot close that class.
 *
 * So the derived copy is gone. The documents the labeler reads are
 * `data/cases/<case>/docs/*.pdf`, **read in place** — which the closed default
 * below already permits, which Case 3's labeler used (so it improves the
 * comparability this experiment exists to exploit), and which `pdftotext`
 * confirms carry no marker text in any of the 13. This module renders
 * INSTRUCTIONS ONLY: a README and a blind-label template. It never sees a
 * document, and `scripts/make-label-packet.ts` no longer has a read purpose that
 * emits into a packet.
 *
 * The invariant that survives, and now has almost nothing left to bind:
 * **no function in this module may emit any quantity from which a per-document
 * or aggregate original event count can be recovered.** A count of the PDFs the
 * labeler is sent to is not such a quantity — they can get it from `ls` — and
 * anything derived from the labels is.
 *
 * This is not a style rule. Amendment 2 §3 of docs/PREREG-24-blind-relabel.md
 * registered a protocol whose validity rests on the blind label count being free
 * to diverge from the original. A count in the packet anchors it, the divergence
 * never happens, and the safeguard that was supposed to catch the granularity
 * confound never fires. The leak does not just add error; it silently disables
 * the check that would have reported the error.
 * ---------------------------------------------------------------------------
 */
import { EventTypeSchema, DateConfidenceSchema } from "./schema";
import { leakSources, LABELED_CASES } from "./label-leak-sources";

export type PacketCaseId = "case1" | "case2";

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
// The generator's `verifyFidelity` asserts at runtime that every block below
// appears verbatim in docs/EVAL.md, so this copy cannot drift from the source
// silently.
// ---------------------------------------------------------------------------
export interface ProtocolBlock {
  label: string;
  text: string;
}

export const PROTOCOL_BLOCKS: ProtocolBlock[] = [
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
export const PROMPT_BLOCKS: ProtocolBlock[] = [
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
> date tolerance for an approximate date anywhere in the matcher. Strict
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

export function granularitySection(): string {
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

- The primary-source rule and Part A's "Handling ambiguous cases" bullets overlap
  and agree. Where they seem to conflict, follow the primary-source rule — it is
  the spec the model was actually given.
- The prompt is the *model's* spec. You are not required to agree with it. If you
  think a rule produces the wrong label, label what you think is right and say so
  in \`labeler_notes\`. A documented disagreement is a finding; a silent one is
  noise.`;
}

// ---------------------------------------------------------------------------
// Blind-label template.
// ---------------------------------------------------------------------------
export const STUB_KEY = "_comment_DELETE_THIS_BEFORE_LABELING";
export const PLACEHOLDER_PATIENT = "REPLACE_WITH_PATIENT_NAME_AGE_SEX_FROM_DOCUMENTS";
export const PLACEHOLDER_LABELED_AT = "REPLACE_WITH_ISO_TIMESTAMP_AT_END_OF_LABELING";
export const PLACEHOLDER_NOTES = "REPLACE_WITH_FREE_TEXT_JUDGMENT_CALLS_MADE_WHILE_LABELING";

export function templateJson(caseId: PacketCaseId): string {
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
// SITTING STATE — "has labeling started?", asked once and answered in one place.
//
// TWO guards need this question answered and they must not answer it differently:
//
//   - `scripts/make-label-packet.ts`'s clobber guard, which refuses to overwrite
//     anything but a pristine template, because regenerating over real labels
//     destroys a sitting that cannot be redone.
//   - `scripts/check-label-leaks.ts`'s sitting guard, which refuses to RUN at all
//     while a sitting is live. That script reads `ground_truth.json` and prints
//     per-file counts against the original labels, so it is answer-bearing by
//     construction — and the packet README names it to the labeler. A labeler who
//     runs it mid-sitting to "check themselves" is handed the answers by a side
//     door (Amendment 3 §2 of docs/PREREG-24-blind-relabel.md).
//
// Two implementations of one predicate is two things to drift, and drift here is
// silent: a clobber guard that thinks a file is edited while a leak gate thinks
// it is pristine leaves the gate open during exactly the window it exists to
// close. So the test lives here, once.
//
// The test is BYTE-EQUALITY against the template this repo would generate for
// that case. Not a JSON parse, not a stub-key probe: any edit at all — a deleted
// stub, a reordered key, a single typed character — is a sitting that has begun,
// and byte-equality is the only test that cannot be argued with. It is also
// conservative in the safe direction, since every failure mode reports "started"
// rather than "pristine".
// ---------------------------------------------------------------------------

/** What `label_packet/<case>/blind_labels.json` says about the sitting. */
export type SittingState =
  /** No such file — the packet has not been generated, or was moved aside. */
  | "absent"
  /** Byte-identical to the generated template: nothing has been labeled yet. */
  | "pristine"
  /** Differs from the template, or cannot be compared against one at all. */
  | "in-progress";

/**
 * `undefined` contents mean the file is not there. A `caseId` of `undefined`
 * means the file was found under a directory name this repo does not recognise
 * as a labeled case, so no template exists to compare it against — that is
 * reported as `in-progress`, because an unrecognised directory holding a
 * `blind_labels.json` is the one state we cannot clear, not a state we may
 * ignore.
 */
export function sittingState(
  contents: string | undefined,
  caseId: PacketCaseId | undefined,
): SittingState {
  if (contents === undefined) return "absent";
  if (caseId === undefined) return "in-progress";
  return contents === templateJson(caseId) ? "pristine" : "in-progress";
}

/** A packet subdirectory name, if it names a case this repo labels. Used to map
 * a directory found on disk back onto the template it should be compared with. */
export function asPacketCaseId(name: string): PacketCaseId | undefined {
  return (LABELED_CASES as readonly string[]).includes(name)
    ? (name as PacketCaseId)
    : undefined;
}

// ---------------------------------------------------------------------------
// THE READING-ORDER MANIFEST.
//
// This is the whole of what the packet knows about the case documents: their
// FILENAMES, and the order to read them in. Both come from a directory listing
// of `data/cases/<case>/docs/` — names only, no file opened — so everything here
// is available to the labeler from one `ls` of the directory they are sent to.
//
// There is no document body, no copy, no excerpt and no derived measurement of
// any document anywhere in this module. That is the point: see the rule at the
// top of the file. `stripSnippetMarkers` / `hasMarkerResidue` / `SNIPPET_MARKER`
// used to live here, to produce and to guard those copies; they were deleted
// with the copies rather than kept "in case", because a stripper in the tree is
// an invitation to ship a second ledger again.
// ---------------------------------------------------------------------------

/** One case document, as the packet refers to it: a position in the reading
 * order and the PDF filename the labeler opens and writes into their labels. */
export interface PacketDoc {
  order: number;
  sourceDocument: string; // e.g. d1_pcp_2023_01.pdf — the value to write in labels
}

/** Every file the packet is allowed to contain, and the complete list of them.
 * `scripts/make-label-packet.ts` refuses to write anything else; a derived
 * document copy could only come back by editing this array, which is the point
 * of having it. */
export const PACKET_ARTIFACTS = ["README.md", "blind_labels.json"] as const;

/** Reading order is the `dN_` prefix, numerically. */
export function docOrder(filename: string): number {
  const m = /^d(\d+)_/.exec(filename);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

// ---------------------------------------------------------------------------
// THE RULE OF THE SITTING — default-deny, in one place, in the exact words the
// labeler reads.
//
// Rendered by `packetReadme` below AND printed verbatim by
// `scripts/make-label-packet.ts`'s handover banner. One constant, two surfaces:
// a packet that contradicts its own banner is resolved by whoever happens to be
// reading one of them, which is the failure Amendment 3 §7 records.
//
// WHY A CLOSED DEFAULT RATHER THAN A LIST. This is not a tightening; it is the
// byte-locked original protocol's own first bullet — *label in one sitting,
// working **only** from `label_packet/`* — restored, with the single carve-out
// Amendment 3 §7 posted for the case PDFs. What drifted away from it was the
// INSTRUMENT: mechanizing the forbidden files into `lib/label-leak-sources.ts`
// turned an illustrative list into a rule block that reads as the definition of
// "forbidden", and a definition by enumeration permits by omission.
//
// It permitted by omission three times, each one level further out: the packet
// header (a stripped-marker count), then the list's own reason strings (an
// aggregate denominator), then the protocol document the packet pointed into. A
// fourth enumeration would have the same shape. A closed default does not: a
// file nobody thought to name is already closed.
//
// The rule is only liveable because the packet is SELF-CONTAINED — every binding
// instruction the labeler needs is inlined in it (Parts A–D), so "read nothing
// else" costs them nothing they need. If a packet ever fails to carry something
// the labeler genuinely requires, the fix is to inline it, never to reopen a
// path.
// ---------------------------------------------------------------------------

/** THE rule, pre-wrapped so the README and the terminal banner render the same
 * bytes. No markdown: `packetReadme` adds emphasis, the banner adds indent. */
export const SITTING_RULE_LINES: string[] = [
  "THE RULE. During this sitting you read this packet and the case PDFs it points",
  "you to. Nothing else in this repository — no file, no directory, no document,",
  "no script, no comment — without exception, and regardless of whether it looks",
  "harmless.",
];

// ---------------------------------------------------------------------------
// Packet README.
// ---------------------------------------------------------------------------
export function packetReadme(caseId: PacketCaseId, docs: PacketDoc[]): string {
  const readingOrder = docs
    .map(
      (d) =>
        `| ${d.order} | \`data/cases/${caseId}/docs/${d.sourceDocument}\` | \`"${d.sourceDocument}"\` |`,
    )
    .join("\n");

  // Rendered from lib/label-leak-sources.ts rather than restated in prose, so
  // the README, the handover banner and scripts/check-label-leaks.ts cannot
  // disagree about what the list holds. Only THIS case's data paths are listed;
  // the other dev case is not part of this packet's sitting.
  //
  // BULLETS, NOT A NUMBERED RULE BLOCK. The numbering was doing real damage: it
  // made the list read as the enumeration of what is forbidden, so a path it
  // omitted read as a path that was allowed. The rule is the closed default
  // above; this is evidence for it.
  const forbidden = leakSources([caseId]);
  const forbiddenRules = forbidden.map((s) => `- \`${s.path}\` — ${s.why}`).join("\n");
  const theRule = `> **${SITTING_RULE_LINES.join("\n> ")}**`;

  return `# Blind labeling packet — ${caseId}

Generated by \`scripts/make-label-packet.ts\` (issue #24). Working material —
\`label_packet/\` is gitignored and is not a tracked artifact.

## What you are doing

You are writing ground-truth labels for ${caseId} **from scratch**, from the case
PDFs the reading-order table below points you to — \`data/cases/${caseId}/docs/\`
— and nothing else. Your labels will later be scored against
the model predictions that are already cached in this repo — predictions you
must not look at. The delta between the original labels and yours is the
measurement; if you see either the predictions or the original labels, there is
no measurement left to take.

**This packet carries your instructions, not the documents.** It is a README, a
blind-label template, and the reading order — nothing else. Earlier packets also
shipped a copy of each document with the answer-key markers stripped out, and
that copy turned out to be a second ledger: subtract it from the original and the
difference is a fixed multiple of that document's original event count. So the
copies are gone, and you read the PDFs in place, which is also how the labeler of
the held-out case worked.

## Rules of this sitting

**This packet is blind. The repository around it is not.** The generator that
wrote these files cannot read the original labels, the cached predictions or the
answer keys — they are off its allowlist, several are on its denylist, and no
byte of any of them is in this packet. It cannot stop *you* opening them.

${theRule}

That is the protocol's own first line — *label in one sitting, working **only**
from the packet* — and it is stated as a closed default rather than as a list of
forbidden files **because the list has been wrong three times.** Each time it was
assembled, checked and posted; each time something nobody had thought to name
turned out to carry the answer. The most recent one was the protocol document
describing the leak, which had come to state the withheld figures in plain prose
in the course of describing them accurately. So you are not being asked to judge
whether some other file is safe. **A file nobody thought to name is already
closed, because everything is closed.**

**What is open — exhaustively:**

- **this directory**, every file in it, including this one;
- **\`data/cases/${caseId}/docs/*.pdf\` is permitted reading** — the PDFs named in
  the reading-order table below, and they are the documents themselves. Part A's
  protocol, quoted verbatim, tells you to open them in a PDF viewer and read each
  cover-to-cover; that is exactly what to do. Nothing else in
  \`data/cases/${caseId}/\` is open: its other members are the original labels,
  the cached predictions, the model's event count and the drafts with the answer
  key still in them, and they are one \`ls\` away from the PDFs you are sent to.
  Listing a directory is not opening a file in it, and seeing a filename is not
  reading it — but decide now that you are not going in there, rather than
  deciding it while you are in there.

**What you run — exhaustively:** \`npx tsx scripts/validate-blind-labels.ts
${caseId}\` when you have finished labeling, and \`npx tsx
scripts/compare-relabel.ts\` once **every** packet is labeled and validated. No
other command. In particular, do **not** run the extractor.

**One sitting**, no splitting across days (protocol item 2 in Part A). Write your
labels into \`blind_labels.json\` in this directory.

**Every instruction you need is in this packet, and that is what makes the rule
liveable.** The granularity spec is in **Part D**, with the leaking passages
removed. The labeling protocol you are working under is in **Part A**, quoted
verbatim, and its two false instructions are corrected in **Part B**. The
documents are the PDFs in the reading-order table, which the rule above opens to
you by name. **If you find yourself needing something this packet does not carry,
that is a defect in the packet — stop and report it. Do not go and look for
it.**

### Why the rule is not paranoia

The paths below are **examples, not the definition.** They are what is known
today to carry, **verbatim**, the original ground-truth titles for these cases,
the model's predicted titles, or the event count and segmentation those labels
were written at. Title phrasing is the single quantity this experiment measures.
There is no partial contamination — one line read is the measurement gone, and
the only honest thing left to do would be to say so and abandon the sitting.
Ordered by how much damage each does.

${forbiddenRules}

Read that as evidence of how ordinary a leak looks — the app's main page, a unit
test's fixtures, a file whose name invites exactly the reader who must not open
it — **not as the boundary.** The boundary is the rule above. Nothing is
permitted by being absent from this list, and this list is assumed incomplete.
If you catch yourself weighing whether some other file is safe, you have already
left the packet: the answer is no, and it is no without your having to work out
why. A paused sitting can be resumed; a contaminated one cannot be repaired, and
cannot be detected afterwards either.

## Reading order

Open each PDF in a PDF viewer and read it cover-to-cover, in this order, before
labeling it.

| # | open and read this | write this as \`source_document\` |
|---|--------------------|----------------------------------|
${readingOrder}

That table is the manifest: those files, that order, nothing else. Only \`.pdf\`
files under \`data/cases/${caseId}/docs/\` are open — everything else in that
directory is closed by the rules above.

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

**One pointer inside the quotation, and why it is not an exception to the rule.**
The two wrong instructions carry \`[Corrected …]\` markers that say *"see the
correction note below and §7"*. That citation is part of the quoted line and
cannot be edited out without falsifying the quotation — which is the one thing
this packet may not do. But §7 lives in \`docs/EVAL.md\`, it quotes original
labels and model predictions side by side, and it is closed to you like
everything else outside this packet. **Part B below IS that correction, in full.**
Do not go looking for §7.

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
  do not open them. They are \`data/cases/${caseId}/events.json\`, named in the
  list above, and they are why only the PDFs in that directory are open to you.
- \`chmod 444\` / \`git hash-object\` / \`.gt_hash.lock\` → skip. Those lock a
  held-out artifact. This packet is untracked working material.
- "the system prompt" / "the schema above" → **Part D** and the record shape
  above. Do not go to the prompt file itself; Part D carries its rules, and the
  file is closed for the reason Part D states.

### What was withheld from this packet, and why

- **Any target event count.** One exists in the material this packet was
  assembled from. Where it lives is not stated here either, because that would
  be a pointer at it. It is withheld, and it is deliberately **not restated,
  paraphrased, or bounded anywhere in this packet** — not even to tell you which
  side of it the truth falls on.
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
  description is worth correcting rather than dropping.) The PDFs you are sent to
  do not carry them — checked directly: \`pdftotext\` extracts a clean text layer
  from every dev PDF and finds **zero** marker lines in any of them. The snippet
  sentences themselves are untouched; they are part of the document. **This is
  what the \`source_drafts/\` entry in the list above is for:** the markers exist
  only there, and that is why it is closed.
- **Any copy of any document, and anything else derived from those drafts.**
  This packet contains none, and that is a change from earlier packets, which
  shipped a marker-stripped \`.md\` copy of each document. A copy is a **second
  ledger**: the marker pair is a fixed number of bytes, so the difference between
  a draft's size and its copy's size is that document's original event count
  times a constant — and the constant falls out of the sizes themselves without
  anyone knowing the marker text. The same is true of line counts, whitespace,
  structure and checksums; every observable of a derived copy tracks how much was
  removed from it. Withholding the count while shipping the copy was
  patch-by-patch, and each patch closed one observable. **So no artifact in this
  packet is derived from the drafts at all** — the packet is a README, a template
  and a list of filenames, and the documents are read in place.
  No count, no total, and no bound on either appears anywhere in this packet or
  in the generator's output. If you find one, the packet is defective — stop and
  report it rather than labeling against it.
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

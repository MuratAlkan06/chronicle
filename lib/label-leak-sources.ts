/**
 * lib/label-leak-sources.ts — THE forbidden-file list for the issue #24 blind
 * relabeling sitting, and the path-matching used to apply it.
 *
 * SINGLE SOURCE OF TRUTH. Two consumers import this module and neither keeps a
 * copy:
 *   - `scripts/make-label-packet.ts` renders it as the packet README's bulleted
 *     list of examples and as the runtime "DO NOT OPEN" banner printed at
 *     handover.
 *   - `scripts/check-label-leaks.ts` greps every tracked file for verbatim
 *     original ground-truth titles and FAILS if any hit falls outside this list.
 *
 * That second consumer is why the list lives here rather than inside the
 * generator. The list was assembled by hand twice — the original protocol in
 * `docs/PREREG-24-blind-relabel.md`, then Amendment 1 — and each sweep missed
 * files the next one found. A list that only a human checks is a list that
 * drifts. Wiring the same array into a grep that exits non-zero on an unlisted
 * hit converts the sweep into a gate, and keeping it in one module is what stops
 * the gate and the packet from disagreeing about what "forbidden" means.
 *
 * It lives in `lib/` rather than `scripts/` for the reason `lib/eval-gate.ts`
 * documents: `npm test` runs `lib/*.test.ts` and nothing else, so pure logic
 * that needs unit coverage has to be here to get any.
 *
 * THIS LIST IS NOT THE DEFINITION OF WHAT A LABELER MAY NOT OPEN.
 *
 * That definition is DEFAULT-DENY, and it is the byte-locked original protocol's
 * own first bullet: *label in one sitting, working **only** from
 * `label_packet/`* — plus the one carve-out Amendment 3 §7 posted, for
 * `data/cases/<case>/docs/*.pdf`. Read the packet and the case PDFs; nothing
 * else in this repository, without exception. `lib/label-packet.ts` renders that
 * sentence into the packet README and the generator's handover banner from one
 * constant, and it is the whole rule.
 *
 * This array is the ILLUSTRATIVE half of it — the files known TODAY to carry
 * original ground-truth titles, model predictions, or the event-count and
 * segmentation of Cases 1+2. It has two jobs, and neither is "define forbidden":
 *   - DETERRENCE. A labeler who reads it sees how ordinary a leak looks — the
 *     app's main page, a unit-test fixture, a file called `docs/CASES.md` — and
 *     stops treating the rule as paranoia. That is why every `why` has to RANK
 *     its leak rather than merely report one: "contains some titles" is the kind
 *     of reason that invites a labeler to decide an item looks harmless.
 *   - MECHANIZATION. `check-label-leaks.ts` enforces that this list is a
 *     SUPERSET of the measured verbatim-title hit set, so a new title fixture
 *     landing in a new file fails a gate instead of waiting for a reader.
 *
 * WHY IT IS NOT THE DEFINITION: it has been wrong three times. The original
 * protocol named the smaller of the two leaking prompt files. Amendment 1 fixed
 * that and missed eight more. Amendment 3 §2 then found the leak inside the
 * list's OWN reason strings, and the round after that found it in the protocol
 * document the packet pointed at — each time in a file nobody had thought to
 * name, each time discovered by a person rather than by the enumeration. An
 * enumeration cannot terminate that regress; a closed default already has.
 * Count and granularity leaks (`[SNIPPET]` markers, `eventCount`, per-document
 * event tables) are the half `check-label-leaks.ts` structurally cannot see —
 * they carry no title, and they move the `in_scope` FN denominator, which is
 * confound (a) in `scripts/compare-relabel.ts`.
 *
 * `why` IS RENDERED INTO THE PACKET, SO IT MAY NOT CARRY A COUNT.
 *
 * Until 2026-07-26 every `why` quantified its leak as `N/21` — a numerator of
 * titles leaked over a denominator that IS the aggregate original in-scope
 * ground-truth event count for the two cases being relabeled, and this doc
 * comment spelled out the per-case split as well. `scripts/make-label-packet.ts`
 * renders these strings verbatim as the packet README's rule block and prints
 * them again as the runtime `DO NOT OPEN` banner, so rule 1 of the labeler's
 * mandatory reading stated the aggregate answer in words, and the file this
 * comment is in — which the README names to the labeler — stated the per-case
 * split. Amendment 2 §4 introduced the quantification for a good reason
 * ("Contains some titles" invites a labeler to decide an item looks harmless)
 * and did not notice it was shipping the anchor. See Amendment 3 §2 of
 * docs/PREREG-24-blind-relabel.md.
 *
 * The deterrent force is kept and the number is not: each `why` still says what
 * KIND of leak it is and ranks it, using a fixed vocabulary — COMPLETE ANSWER
 * KEY > MOST > MANY > SEVERAL > A FEW — so the list still front-loads the worst
 * entries. Nothing is lost for the maintainer either, because the counts were
 * always redundant here: `check-label-leaks.ts` measures and prints the live
 * count beside every entry on every run, which is the copy that cannot go stale.
 * That script reads `ground_truth.json` to do it, so it is answer-bearing by
 * construction and must not be run during a sitting.
 *
 * The rule for anyone editing a `why`: file counts and directory counts are
 * fine (a labeler can `ls`), and so are categorical severities. Any integer
 * derived from the labels — event totals, per-document counts, title counts,
 * prediction counts — is not.
 */

export type LabeledCaseId = "case1" | "case2";

/** The two dev cases this experiment relabels. Case 3 is held out and is never
 * part of this list — it is refused by name everywhere in the toolkit. */
export const LABELED_CASES: LabeledCaseId[] = ["case1", "case2"];

export interface LeakSource {
  /**
   * Repo-relative path, `/`-separated. Three spellings, applied by
   * {@link coversPath}:
   *   - trailing `/`  → the whole directory subtree, including files added later
   *   - containing `*` → a single path-segment wildcard (`lib/*.test.ts`)
   *   - otherwise      → one exact file
   */
  path: string;
  /**
   * Why it is forbidden, ranked by severity so the packet's rule block
   * front-loads the worst entries.
   *
   * RENDERED INTO THE PACKET AND PRINTED AT HANDOVER, so it may carry no
   * label-derived integer — no event total, per-document count, title count or
   * prediction count. File and directory counts are fine. See the count rule in
   * this module's header; `lib/label-leak-sources.test.ts` enforces it.
   */
  why: string;
}

/**
 * Path predicate for one list entry. Kept deliberately small — a directory
 * prefix, a single-segment `*`, or an exact match — because a labeler has to be
 * able to read an entry and know whether a file is covered without running
 * anything.
 *
 * `*` matches within one path segment only, so `lib/*.test.ts` covers
 * `lib/eval.test.ts` but not a hypothetical `lib/sub/eval.test.ts`. That is the
 * conservative direction: a file the pattern misses becomes an unlisted hit and
 * fails the gate, rather than being silently absorbed.
 */
export function coversPath(entry: string, repoRelPath: string): boolean {
  if (entry.endsWith("/")) {
    const dir = entry.slice(0, -1);
    return repoRelPath === dir || repoRelPath.startsWith(entry);
  }
  if (entry.includes("*")) {
    const re = new RegExp(
      "^" +
        entry
          .split("*")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("[^/]*") +
        "$",
    );
    return re.test(repoRelPath);
  }
  return entry === repoRelPath;
}

/** The first list entry covering `repoRelPath`, or `undefined` if none does —
 * i.e. `undefined` means "a labeler is not told to stay out of this file". */
export function firstCovering(
  repoRelPath: string,
  sources: LeakSource[],
): LeakSource | undefined {
  return sources.find((s) => coversPath(s.path, repoRelPath));
}

/**
 * The list. Ordered roughly by how badly a labeler is hurt by opening the file,
 * because that is the order the packet README renders it in and a rule block
 * nobody reads to the end should front-load the complete answer keys.
 *
 * Entries added 2026-07-26 (Amendment 2, docs/PREREG-24-blind-relabel.md):
 * `app/page.tsx`, `docs/CASES.md`, `scripts/verify-extract-route.ts`,
 * `lib/*.test.ts`, plus `held_out/`, `data/eval_reports/` and
 * `data/case3_eval_fallback.json`, which the original protocol named in prose
 * but the generator's runtime banner did not print.
 *
 * Entry SPLIT 2026-07-26 (Amendment 3 §7): the blanket `data/cases/<case>/`
 * subtree rule became four named paths, so that `data/cases/<case>/docs/*.pdf`
 * — which the packet's reading-order table sends the labeler to — is permitted.
 * See the comment on the group itself for why that is a restoration rather than
 * a relaxation.
 *
 * Entries added 2026-07-26 (this round): `docs/PREREG-24-blind-relabel.md` and
 * `docs/RESOLVED-DECISIONS.md`. Both were previously asserted, in a unit test,
 * NOT to be forbidden, on the ground that they quote zero ground-truth titles —
 * which is exactly the test #14 of the decision log exists to call insufficient.
 * See the comment on the pair below.
 *
 * NOTHING IS PERMITTED BY OMISSION, and under default-deny that is structural
 * rather than a warning. A path absent from this array is not a path anyone was
 * cleared for; it is a path this array happens not to illustrate. The two things
 * that ARE open — this packet, and `data/cases/<case>/docs/*.pdf` — are stated
 * positively in the packet README and in the generator's handover banner, beside
 * the rule that closes everything else, rather than being left to inference from
 * a gap in a list.
 */
export function leakSources(cases: LabeledCaseId[] = LABELED_CASES): LeakSource[] {
  return [
    {
      path: "MOCK_DATA.md",
      why: 'COMPLETE ANSWER KEY — EVERY original ground-truth event for both cases, verbatim, in `"title": "…"` JSON form. Its own header states it is the basis for those labels, and it sits at the repository root.',
    },
    {
      path: "lib/fixtures.ts",
      why: "COMPLETE ANSWER KEY, again — the same events mirrored verbatim into code (its header says it mirrors MOCK_DATA.md).",
    },
    // The labeled case's own data directory, named FILE BY FILE rather than as
    // one subtree. Amendment 3 §7 of docs/PREREG-24-blind-relabel.md permits
    // `data/cases/<case>/docs/*.pdf` — the equivalent PDFs the packet's
    // reading-order table sends the labeler to — and forbids everything else in
    // there by name.
    //
    // This RESTORES the posted protocol rather than narrowing it. The
    // byte-locked original names `data/cases/*/events.json` and
    // `data/cases/*/ground_truth.json` individually; Amendment 1's table adds
    // `data/cases/*/source_drafts/` and `data/cases/*/metadata.json`
    // individually. No posted text ever forbade the subtree. The blanket entry
    // was introduced HERE, by Amendment 2 §4's mechanization, when those four
    // named paths were coalesced into one directory rule — and it then
    // contradicted the packet's own reading-order table, which is the kind of
    // contradiction a reader resolves in the convenient direction.
    //
    // The narrowing also puts `scripts/check-label-leaks.ts` to work inside this
    // directory instead of blanketing it: under the subtree entry a verbatim
    // title anywhere in `data/cases/<case>/docs/` was absorbed as "forbidden
    // anyway"; now it is an UNLISTED hit and fails the gate.
    //
    // That is a BACKSTOP, not the check, and the difference matters. The gate
    // greps raw file bytes, and a PDF's text lives in a compressed stream — it
    // is demonstrably blind to PDF text today, since the one dev PDF whose
    // rendered text does carry an in-scope title raises no hit. What the gate
    // would catch is a title left in an UNCOMPRESSED stream. The premise itself
    // — that the PDFs hand the labeler nothing their packet does not already
    // contain — was checked by extracting all 13 dev PDFs with `pdftotext` and
    // diffing the title occurrences against the packet .md files: one occurrence
    // in each, the same one, and NOTHING present only in the PDFs. See
    // Amendment 3 §7 of docs/PREREG-24-blind-relabel.md.
    //
    // Ordered here, ahead of STATE.md and the prompts, because these are the
    // answer key FOR THE CASE BEING LABELED and they now sit one `ls` from a
    // directory the protocol opens. Under the blanket entry they ranked below
    // files that leak strictly less, which the ordering rule above does not
    // support.
    ...cases.flatMap((c) => [
      {
        path: `data/cases/${c}/ground_truth.json`,
        why: "COMPLETE ANSWER KEY for the case you are labeling — the original labels themselves, every title verbatim. It is a sibling of the docs/ directory you ARE sent to for the PDFs, so it is the one file an `ls` there puts within reach.",
      },
      {
        path: `data/cases/${c}/source_drafts/`,
        why: "the case documents WITH the [SNIPPET] answer key still in them — exactly one marked block per original ground-truth event, zero mismatches — plus README.md, which names the planted cross-document contradiction. Your packet ships no copy of any document precisely so that nothing in it can be set against these.",
      },
      {
        path: `data/cases/${c}/events.json`,
        why: "MANY model-PREDICTED titles verbatim, plus several original ones. The cached predictions are the other half of what this experiment compares; they are the single thing the packet exists to keep you from reading.",
      },
      {
        path: `data/cases/${c}/metadata.json`,
        why: "the model's event count for this case. It quotes no title, so the leak gate cannot see it, and the number is an anchor on the one quantity the packet refuses to restate in any form.",
      },
    ]),
    {
      path: "STATE.md",
      why: "MOST of the original titles, plus a further set of model-PREDICTED titles. Session log: quotes both in passing, scattered through a very large file. No section of it is safe to skim.",
    },
    {
      path: "lib/claude.ts",
      why: "MANY of the original titles — carries the per-type Title templates the model was tuned to produce, with worked examples drawn from these very cases, in code.",
    },
    {
      path: "prompts/",
      why: "WHOLE DIRECTORY, every file, including any added later. few_shot.md leaks MANY original titles — more than system_extract_v4.md, which is the only prompt the original protocol named; the per-type Title templates ARE the phrasing the model was tuned to produce.",
    },
    {
      path: "docs/EVAL.md",
      why: "SEVERAL original titles, plus predicted titles — one of its sections sets original labels and model predictions side by side, verbatim. Everything you need from it is inlined in your packet, so there is no reason to open it at all.",
    },
    {
      path: "app/page.tsx",
      why: "A FEW original titles, in `title: \"…\"` form, in the app's MAIN PAGE — the file a labeler in this checkout opens reflexively, which is exactly why naming it explicitly matters more than its size of leak suggests.",
    },
    {
      path: "docs/CASES.md",
      why: "A FEW original titles AND a fuller granularity key than the [SNIPPET] markers: its per-document tables give the event count and TYPE breakdown, and they agree with the real labels on all but one of the dev documents; it also names both planted cross-doc contradictions and an expected total event count. Its filename actively invites a labeler seeking case background.",
    },
    // The two documents that describe this experiment's own controls. They quote
    // no ground-truth TITLE, which is the ground on which both were cleared —
    // and clearing them on that ground is the defect #14 of the decision log
    // records, applied one level out from where #14 fixes it. They are grouped
    // here with `docs/CASES.md` because what they leak is the same KIND: counts
    // and granularity, in prose, with no decoding step.
    //
    // Neither `why` names a section. A reason that told the labeler WHERE in a
    // forbidden document the figures are would be a pointer wearing a warning's
    // clothes — the shape this whole round exists to remove.
    {
      path: "docs/PREREG-24-blind-relabel.md",
      why: "the protocol document for this experiment, and the reason the rule is now a closed default rather than a list: its amendments state the aggregate original event count for these two cases, the per-case split, and a per-document figure — in plain prose, because describing a count leak accurately meant naming the count. Append-only, so none of it can be edited out.",
    },
    {
      path: "docs/RESOLVED-DECISIONS.md",
      why: "the decision log. Its append-only convention deliberately PRESERVES, verbatim, the superseded entry that quantified every leak as a ratio whose denominator is the aggregate original event count — the anchor was removed from the labeler-facing artifacts and left here on purpose, for the audit trail.",
    },
    {
      path: "scripts/verify-extract-route.ts",
      why: "A FEW original titles, in `title: \"…\"` form — original ground-truth titles used as route-verification fixtures.",
    },
    {
      path: "lib/*.test.ts",
      why: "WHOLE CLASS, including tests added later. 5 of the 9 files matching this pattern leak today (claude, eval, gemini, measure, normalize): this repo's unit tests use real Case 1 titles as fixtures, so a new test file is likely to as well.",
    },
    {
      path: "data/eval_reports/",
      why: "scored reports derived from the predictions and the original labels. No titles, but every count in them is an anchor.",
    },
    {
      path: "data/case3_eval_fallback.json",
      why: "cached Case 3 scores. Case 3 is not part of this experiment and its numbers are not yours to see mid-sitting.",
    },
    {
      path: "held_out/",
      // The `docs/RESOLVED-DECISIONS.md #10` citation this reason used to carry
      // was dropped when that file went onto the list above: a `why` is rendered
      // into the packet, and a citation into a forbidden document is a pointer
      // however it is framed. The decision itself is unchanged and the scripts
      // still cite it by number in their refusal paths, which are not
      // labeler-facing.
      why: "WHOLE DIRECTORY — the terminal held-out budget of this project, spendable once. This experiment exists specifically so that budget does not have to be spent.",
    },
  ];
}

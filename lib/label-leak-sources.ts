/**
 * lib/label-leak-sources.ts — THE forbidden-file list for the issue #24 blind
 * relabeling sitting, and the path-matching used to apply it.
 *
 * SINGLE SOURCE OF TRUTH. Two consumers import this module and neither keeps a
 * copy:
 *   - `scripts/make-label-packet.ts` renders it as the packet README's numbered
 *     rule block and as the runtime "DO NOT OPEN" banner printed at handover.
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
 * WHAT BELONGS ON THE LIST. The rule is *not* "files containing a ground-truth
 * title" — that is only the largest class. It is: **any file a labeler could
 * open during the sitting that carries original ground-truth titles, model
 * predictions, or the event-count/segmentation of Cases 1+2.** Count and
 * granularity leaks (`[SNIPPET]` markers, `eventCount`, per-document event
 * tables) matter because they move the `in_scope` FN denominator, which is
 * confound (a) in `scripts/compare-relabel.ts`. `check-label-leaks.ts` can only
 * mechanize the title half; the rest is still judgement, which is why `why` is
 * quantified wherever it can be. "Contains some titles" is the kind of reason
 * that invites a labeler to decide an item looks harmless.
 *
 * Title counts in `why` are out of the 21 original in-scope ground-truth events
 * for Cases 1+2 (13 in case1, 8 in case2), each appearing verbatim, measured
 * 2026-07-26. `check-label-leaks.ts` prints the live count beside each entry, so
 * drift in these numbers is visible on every run.
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
  /** Why it is forbidden. Quantified wherever a count exists. */
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
 */
export function leakSources(cases: LabeledCaseId[] = LABELED_CASES): LeakSource[] {
  return [
    {
      path: "MOCK_DATA.md",
      why: 'COMPLETE ANSWER KEY — 21/21 original ground-truth events for both cases, verbatim, in `"title": "…"` JSON form. Its own header states it is the basis for those labels, and it sits at the repository root.',
    },
    {
      path: "lib/fixtures.ts",
      why: "21/21 — the same complete answer key, mirrored verbatim into code (its header says so).",
    },
    {
      path: "STATE.md",
      why: "12/21, plus 7 further model-PREDICTED titles. Session log: quotes both in passing, scattered through a very large file. No section of it is safe to skim.",
    },
    {
      path: "lib/claude.ts",
      why: "11/21 — carries the per-type Title templates the model was tuned to produce, with worked examples drawn from these very cases, in code.",
    },
    {
      path: "prompts/",
      why: "WHOLE DIRECTORY, every file, including any added later. few_shot.md 9/21, system_extract_v4.md 4/21, system_extract_v3.md 4/21; the per-type Title templates ARE the phrasing the model was tuned to produce.",
    },
    {
      path: "docs/EVAL.md",
      why: "6/21, plus 5 predicted titles — §7 quotes original labels and predictions verbatim. Everything you need from it is inlined in the packet, so there is no reason to open it at all.",
    },
    {
      path: "app/page.tsx",
      why: "3/21, in `title: \"…\"` form, in the app's MAIN PAGE — the file a labeler in this checkout opens reflexively, which is exactly why naming it explicitly matters more than its count suggests.",
    },
    {
      path: "docs/CASES.md",
      why: "2/21 AND a fuller granularity key than the [SNIPPET] markers: its per-document tables give the event count and TYPE breakdown, matching the real labels on 12 of 13 dev documents, plus both planted cross-doc contradictions and an expected total event count. Its filename actively invites a labeler seeking case background.",
    },
    {
      path: "scripts/verify-extract-route.ts",
      why: "2/21, in `title: \"…\"` form — original ground-truth titles used as route-verification fixtures.",
    },
    {
      path: "lib/*.test.ts",
      why: "WHOLE CLASS, including tests added later. 5 of 9 leak today (claude, eval, gemini, measure, normalize — 1/21 each): this repo's unit tests use real Case 1 titles as fixtures, so a new test file is likely to as well.",
    },
    ...cases.map((c) => ({
      path: `data/cases/${c}/source_drafts/`,
      why: "your packet documents WITH the [SNIPPET] answer key still in them — exactly one marked block per original ground-truth event, zero mismatches — plus README.md, which names the planted cross-document contradiction.",
    })),
    ...cases.map((c) => ({
      path: `data/cases/${c}/`,
      why: "events.json (cached predictions, 5/21 titles verbatim each), ground_truth.json (the original labels themselves), metadata.json (the model's event count).",
    })),
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
      why: "WHOLE DIRECTORY — the terminal held-out budget (docs/RESOLVED-DECISIONS.md #10). This experiment exists specifically so that budget does not have to be spent.",
    },
  ];
}

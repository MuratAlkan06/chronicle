# Pre-registration — blind re-labeling of Cases 1+2 (issue #24)

**Status: registered, not yet run.** Written and posted **before any blind label
exists**. This document contains **zero results**: every number in it is either a
figure already published in docs/EVAL.md §7 (v0.3.5) or a prediction committed
here in advance.

**Why it is posted as a GitHub comment.** The value of a pre-registration is
entirely in its timestamp. A file in the repo can be amended and force-pushed;
a comment on issue #24 carries a server-assigned `created_at` that cannot be
backdated, and GitHub marks any subsequent edit. This document is therefore
posted **verbatim** to issue #24 before labeling begins, and the repo copy is
the same text. If the two ever diverge, **the comment is the record.**

The instrument this registers is the three-script toolkit in
`scripts/make-label-packet.ts`, `scripts/validate-blind-labels.ts`, and
`scripts/compare-relabel.ts`. **The toolkit is not the experiment** — see
*What this does not close*, below.

---

## Hypothesis

The dev↔held-out F1 gap is substantially an artifact of **labeling phrasing**,
not of extraction quality.

Cases 1+2's ground truth shares title phrasing with the model's own output:
**36.8%** of matched pairs are byte-identical strings, **57.9%** share token
sets exactly, and the best same-type candidate's overlap has median **1.000**
over the in-scope GT events (docs/EVAL.md §7). Case 3's ground truth was
authored independently, under a docs/EVAL.md §5 instruction — item 4, **now
known false** — that explicitly told the labeler token overlap was chosen
"precisely so phrasing differences don't break matching."

Two label sets, two phrasing regimes, one metric. The hypothesis is that the
metric, not the model, is what moved.

## Mechanism under test

`lib/eval.ts`'s `matchesEvent` requires title token overlap **≥ 0.5**, computed

```
overlap(A, B) = |A ∩ B| / max(|A|, |B|)
```

over token **sets**. Because the denominator is `max` — not `|A ∪ B|`, not
`min` — overlap is capped at `min/max` **before any word is compared**. A terse
label against a verbose prediction is penalized regardless of semantic
correctness, and a label whose token count is less than half its prediction's
can never match at all.

v0.3.5 established that this gate is **latent on dev**: of the 24 (prediction,
in-scope GT) pairs that clear `event_type` and the date tier, the gate rejects
**4**, and none of those rejections is outcome-relevant — the correct GT stayed
available to the correct prediction, so removing the gate entirely leaves
`tp`/`fp`/`fn` bit-identical.

**This experiment tests whether naturally-phrased labels make the gate
binding.**

## Predictions — committed before any labeling

1. **Direction.** Macro-mean strict F1 **decreases** from the current **0.825**.

2. **Point estimate: ~0.60.** Pre-registered interval **0.50 – 0.70**.

3. **Per-type ordering.** `medication` drops **most**; `visit` drops **least**
   among multi-instance types; `lab` is **intermediate**. Rationale: v0.3.5
   established that collapse order tracks **prediction** length, not label
   length, because the denominator is `max()`. Medication carries the longest
   predicted titles (median **7** tokens) against lab's **3**.

4. **The loss mechanism will be the overlap gate**, not `event_type` and not
   date. In `compare-relabel.ts`'s failure-cause attribution split
   (`type` / `date` / `overlap` / `contention`), **`overlap` should account for
   the large majority of newly-lost matches.**

## Decision rule — committed before any labeling

Read against the **macro-mean strict F1** on the blind labels:

| outcome | reading |
|---------|---------|
| **< 0.60** | **Large effect.** Labeling phrasing accounts for a substantial share of the dev↔held-out gap. This materially strengthens the case for retiring Case 3's final measurement unmeasured. |
| **0.60 – 0.75** | **Ambiguous.** **Must not be used to justify retirement in either direction.** |
| **> 0.75** | **Small measured effect.** But see limitation 1: this outcome is **inconclusive, not a refutation.** |

The point estimate sits on the boundary of the first two bands. The **band
governs**, not the point estimate: an outcome of exactly 0.60 is ambiguous.

## Limitations — stated before, not discovered after

1. **The labeler is contaminated.** Murat has seen the original titles
   repeatedly. Perfect blindness is impossible. The bias direction is favorable
   but asymmetric: exposure makes him *more* likely to reproduce the original
   phrasing → higher overlap → a **smaller** measured drop. The experiment is
   therefore biased **against its own hypothesis**. A large drop is trustworthy;
   a null result is weak and **must be reported as inconclusive**.

2. **n = 21 in-scope GT events** across both cases. Per-type `n_gt` is **1** for
   imaging and diagnosis and **2** for procedure and referral. Only the
   aggregate and `medication` / `visit` / `lab` (**3 / 7 / 5**) carry any width.
   **Per-type claims are directional only** — including prediction 3.

3. **Two confounds the tooling reports but cannot remove.**
   - **`in_scope` convention.** The FN denominator is the in-scope GT count. The
     dev GT has **zero** out-of-scope events, while §5 tells labelers to be
     generous with the mechanism. If the blind labeler uses it differently,
     recall moves for reasons unrelated to phrasing.
   - **`source_document` spelling.** `evaluate()`'s same-document tie-break
     compares `gt.source_document` to the prediction's `source.document_id`,
     which carries no `.pdf`. The dev GT uses the `.pdf` suffix throughout, so
     the tie-break is currently **inert**. A blind file spelled without the
     suffix would **activate** it and change results for reasons unrelated to
     phrasing. **The blind labels must use the same `.pdf` convention.**

4. **Scope of the claim.** This measures **the metric's sensitivity to phrasing
   on Cases 1+2. It does not measure Case 3**, and no result here licenses a
   causal claim about Case 3's recorded numbers.

## Protocol — binding

- Label in **one sitting**, working **only** from `label_packet/`.
- Do **not** open `data/cases/*/events.json`, `data/cases/*/ground_truth.json`,
  `data/eval_reports/`, `data/case3_eval_fallback.json`, or
  `prompts/system_extract_v4.md` — that last one quotes **four original Case 1
  GT titles verbatim**.
- The original ground truth is **preserved unmodified**. The delta between the
  two label sets **is** the measurement.
- **`lib/eval.ts` is not modified** (sha256 `4540d12b…a09333`, 4900 bytes at
  registration). Changing the ruler while measuring with it is the error v0.3.5
  documented.
- `scripts/compare-relabel.ts` is run **once**, after
  `scripts/validate-blind-labels.ts` passes. **Its first output is the result** —
  no iterating toward a preferred number.
- This document is posted to issue #24 **before labeling begins**.

Command sequence:

```bash
npx tsx scripts/make-label-packet.ts        # before labeling
npx tsx scripts/validate-blind-labels.ts    # after labeling, structural only
npx tsx scripts/compare-relabel.ts          # once — first output is the result
```

## What this does not close

**Issue #24 stays open after this slice merges.** The slice ships the
toolkit — packet generator, validator, comparison instrument. **The toolkit is
not the experiment.** #24 closes when the labeling sitting has happened, the
comparison has been run once, and the result has been recorded against the
decision rule above.

---

## Provenance of every number above

| number | source |
|--------|--------|
| 0.825 macro-mean strict F1 | docs/EVAL.md §7, published dev headline (v0.3.5) |
| 36.8% byte-identical, 57.9% identical token sets, median overlap 1.000 | docs/EVAL.md §7, emitted by `scripts/analyze-title-overlap.ts` |
| 4 of 24 qualifying pairs rejected | docs/EVAL.md §7, section [6] of the same diagnostic |
| median 7 tokens (medication) vs 3 (lab) | docs/EVAL.md §7, *Collapse order is set by prediction length* |
| ≥ 0.5 threshold, `max()` denominator | `lib/eval.ts` |
| n = 21; per-type n_gt 1/1/2/2/3/7/5 | `data/cases/case{1,2}/ground_truth.json`, in-scope counts |
| ~0.60, 0.50–0.70, 0.60, 0.75 | **predictions and decision thresholds registered here** |

Nothing above is a measurement of a blind label. No blind label exists yet.

---
---

## Amendment 1 (2026-07-26)

**Everything above this delimiter is the original pre-registration, unchanged.**
It was posted to issue #24 as comment `5082307494`, before any blind label
existed, and **that comment has not been edited** — GitHub marks edited comments,
and it carries no such mark. The text above is byte-identical to it (sha256
`5628ef79…5416a`, 8464 bytes).

**This amendment is posted as a separate, later-timestamped comment on the same
issue.** It is deliberately *not* an edit of comment `5082307494`. A
pre-registration whose entire value is its timestamp cannot be revised in place
without destroying the property that made it worth writing. The honest record is
two comments in sequence — the original still readable exactly as first posted,
the amendment visibly later — and not one rewritten comment that reads as though
it always said this. Read them in that order.

**What this amendment does: it adds one restriction to the binding protocol. It
changes no hypothesis, no prediction, no point estimate, no interval, no
threshold, and no decision rule.** The predictions above (direction; ~0.60 with
interval 0.50–0.70; the per-type ordering; overlap as the loss mechanism) and the
decision bands (< 0.60 / 0.60–0.75 / > 0.75) stand exactly as registered.
Nothing below makes a favorable outcome easier to reach or an unfavorable one
easier to discount — the restriction cuts against the hypothesis if anything,
since every file it closes is one that would have pushed the labeler back toward
the original phrasing. That asymmetry is what distinguishes an amendment from a
retro-fit, and it is the only ground on which this one should be accepted.

### Why it is needed

The binding protocol above forbids `data/cases/*/events.json`,
`data/cases/*/ground_truth.json`, `data/eval_reports/`,
`data/case3_eval_fallback.json` and `prompts/system_extract_v4.md`. **That list is
incomplete.** It was drawn from the files the *tooling* must not read, and the
tooling is blind by construction — explicit allowlist, explicit denylist, printed
read ledger. The labeler is not the tooling. A human labeling inside this
checkout can open, in one keystroke, several tracked files that carry the
original ground-truth titles verbatim, and the protocol names none of them.

The largest is not a corner case. **`MOCK_DATA.md` sits at the repository root and
contains all 21 original ground-truth events for Cases 1+2, verbatim, in
`"title": "…"` JSON form.** Its own header states it is "the basis for the Cases
1+2 gold labels". It is a complete answer key, in plain sight, and the original
protocol does not mention it.

### Added to the binding protocol

For the duration of the labeling sitting, the labeler must not open any of the
following. Counts are of the 21 original ground-truth titles for Cases 1+2
(13 in case1, 8 in case2; all in scope), each appearing verbatim:

| path | leaks | why it matters |
|------|-------|----------------|
| `MOCK_DATA.md` | **21 / 21**, in `"title": "…"` JSON form | Complete answer key, at the repo root, self-described as the basis for these labels. |
| `lib/fixtures.ts` | **21 / 21** | The same complete answer key mirrored into code; its header says it "Mirrors MOCK_DATA.md verbatim". |
| `STATE.md` | 12 / 21, plus 7 further model-predicted titles | Session log. Quotes original labels and model predictions in passing across a very large file; no part of it is safe to skim. |
| `prompts/**` — the **whole directory** | `few_shot.md` 9 / 21; `system_extract_v4.md` 4 / 21; `system_extract_v3.md` 4 / 21 | The protocol above named only `system_extract_v4.md`. **`prompts/few_shot.md` leaks more than the file that was named, and was not named.** The rule now covers the directory as a whole, including files added after this date. |
| `lib/claude.ts` | 11 / 21 | Carries the per-type Title templates, with worked examples drawn from these very cases, in code. |
| `docs/EVAL.md` | 6 / 21, plus 5 predicted titles | §7 quotes original labels and predictions verbatim. Everything the labeler needs from §5 and §7 is inlined into the packet. |
| `data/cases/*/source_drafts/` | the granularity key | The packet documents with their `[SNIPPET]` markers still in place — **exactly one marked block per original ground-truth event, in every document of both cases, zero mismatches.** |
| `data/cases/*/metadata.json` | the model's event count | Records how many events the model emitted (`eventCount`). |

Of these, only `data/cases/*/metadata.json` was already refused by the packet
generator's denylist; the rest were reachable by the labeler and unmentioned by
the protocol. `data/cases/*/source_drafts/` is a special case in the other
direction — the generator **does** read it, because that is where the documents
come from, and strips the `[SNIPPET]` marker lines on the way into the packet.
The originals keep them.

The table is today's instance of the rule, not the rule. **The rule is: do not
open any file that quotes an event title for Case 1 or Case 2.** Where that
cannot be determined without opening the file, the file is not opened.

### Status at the time of this amendment

Registered **before any blind label exists**, exactly as the original was.
`blind_labels.json` is still the pristine generated template for both cases, and
`scripts/compare-relabel.ts` has not been run. Like the text above, this
amendment contains **zero results**.

`lib/eval.ts` remains unmodified — sha256 `4540d12b…a09333`, 4900 bytes,
re-verified at the time of writing and unchanged from registration.

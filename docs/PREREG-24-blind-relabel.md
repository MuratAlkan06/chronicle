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

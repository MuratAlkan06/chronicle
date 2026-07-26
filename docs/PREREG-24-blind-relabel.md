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

---
---

## Amendment 2 (2026-07-26)

**Everything above this delimiter is unchanged.** The original pre-registration
(sha256 `5628ef79…5416a`, 8464 bytes) is comment `5082307494`; Amendment 1 is
comment `5082472776`. Neither has been edited. This is a third comment, later
again. The repo copy is append-only: `git diff --numstat` on this file for this
change shows **zero deletions**.

**Amendment 1 got the direction of its own bias argument backwards.** It is
wrong, and it is wrong *in its own favor* — it claimed a conservatism the
restriction does not have. That is the worst direction for an error in an
amendment to a pre-registration to run, so it is corrected here first, before
anything else this amendment does.

### 1. The correction

Amendment 1 said:

> the restriction cuts against the hypothesis if anything, since every file it
> closes is one that would have pushed the labeler back toward the original
> phrasing. That asymmetry is what distinguishes an amendment from a retro-fit,
> and it is the only ground on which this one should be accepted.

The subordinate clause is true. **The conclusion drawn from it has the wrong
sign.**

Limitation 1 above is byte-locked and governs. It establishes this chain:

> exposure → *more* likely to reproduce the original phrasing → **higher**
> overlap → a **smaller** measured drop → biased **against** the hypothesis.

Amendment 1 **reduces** exposure. Run the locked chain backwards, which is the
only thing you are allowed to do with it:

> less exposure → less reproduction of the original phrasing → **lower** overlap
> → a **larger** measured drop → biased **toward** the hypothesis.

The hypothesis predicts a drop from 0.825 to ~0.60, and the `< 0.60` band is
"Large effect". **A restriction that lowers overlap therefore makes the
favorable outcome easier to reach, not harder.** Amendment 1 asserted the
opposite and offered it as the sole ground for accepting itself.

Worked against the `max()` denominator, on the actual dev data rather than a
hypothetical. Take the case1 medication event for the initial prescription. Its
original ground-truth title and the model's cached prediction for it are
**byte-identical**: 7 tokens each under `lib/eval.ts`'s tokenizer, overlap
**1.000**. (`b.i.d.` is three tokens, not one — the tokenizer is
`/[a-z0-9]+/g` over the lowercased string — so any hand-count that treats a
dotted abbreviation as one token will be wrong, and wrong low, on exactly the
titles where this experiment bites.) A labeler with the answer key open lands at
or near that string and the pair is a TP. A labeler without it writes the
natural two-token form — verb plus drug name — and scores `2/7 = 0.286`, below
the 0.5 gate, turning one TP into **one FN and one FP**. Closing the leak moves
every such pair from the first outcome toward the second. That is a larger drop,
which is the hypothesis's own prediction.

### 2. The restriction stays, on the correct grounds

**Amendment 1's act was right and its justification was wrong.** The restriction
is not withdrawn and is not weakened. An experiment whose stated purpose is to
measure a labeler's sensitivity to phrasing is worthless if the labeler can read
the answers; the files Amendment 1 closed are files that hand over the answers.
That is mandatory, not optional, and it would be mandatory even if it moved the
result the other way.

The legitimate grounds are these three, and Amendment 1 should have rested on
them instead of on a bias-direction claim it had not checked:

1. **No data exists.** `blind_labels.json` is still the pristine generated
   template for both cases. `scripts/compare-relabel.ts` has never been run.
   Nothing here is chosen against a number anyone has seen, because there is no
   number.
2. **Nothing predictive changes.** See §5 below: not one prediction, interval,
   threshold or decision band moves.
3. **It removes a bias source; it does not add a conservative one.** These are
   different claims and Amendment 1 conflated them. Removing a bias that was
   *suppressing* the predicted effect is a legitimate improvement in validity —
   it makes the measurement more able to see what it is looking for. What is
   *not* legitimate is to describe that as caution. A restriction that widens
   your predicted effect has to be **declared as such and registered before the
   data exists**, which is what this amendment does. Declared, it is an
   amendment. Disguised as conservatism, it would be a retro-fit wearing an
   amendment's clothes.

The practical consequence for reading the result is stated in §5.

### 3. A second channel Amendment 1 did not separate

Amendment 1's table forbids eight sources under one heading. Six of them leak
**phrasing**. Two do not:

- **`data/cases/*/source_drafts/`** — the `[SNIPPET]` markers. Verified again for
  this amendment: **13 marked blocks against 13 case1 ground-truth events, 8
  against 8 in case2, zero mismatches.** That is a *segmentation* key.
- **`data/cases/*/metadata.json`** — `eventCount`, the number of events the
  model emitted (18 for case1, 8 for case2). That is a *count* anchor.

Neither carries a title. Closing them does not lower title overlap at all. What
it does is remove the labeler's anchor on **how many events each document is
worth**, which is precisely the quantity the packet already withholds
deliberately, and it lets the blind label count diverge from 13 and 8.

The in-scope GT count is the FN denominator. **Limitation 3 above already names
this as a confound the tooling reports but cannot remove.** Closing these two
sources therefore enlarges the measured drop through that confound, on a channel
that has nothing to do with phrasing. Amendment 1 filed them alongside the six
phrasing leaks and said nothing about the difference.

**Consequence, and it belongs with the decision rule: a measured drop must not
be read as a pure phrasing effect.** Some part of it may be granularity
divergence. `scripts/compare-relabel.ts` section [0] prints the in-scope counts
for both label sets and section [4] reports the alignment residue (`orig-only` /
`blind-only`) rather than absorbing it. **Read those two before reading the F1
delta.** If the blind in-scope count differs materially from 13 and 8, the
aggregate F1 delta is an upper bound on the phrasing effect, not an estimate of
it.

### 4. Eight more files, and the reason the sweep kept missing them

Amendment 1's own thesis is that **naming matters**: it faulted the original
protocol for naming `prompts/system_extract_v4.md` (4/21) while omitting
`prompts/few_shot.md` (9/21) — for naming the smaller leak and missing the
bigger one. **The identical failure happened one level down, in Amendment 1
itself.** Eight further tracked files carry original ground-truth titles
verbatim and were named nowhere. Counts re-derived for this amendment by
matching all 21 titles against every `git ls-files` entry:

| path | leaks | why it matters |
|------|-------|----------------|
| `app/page.tsx` | **3 / 21**, in `title: "…"` form | The **main page of the app**. A labeler working in this checkout opens it reflexively; the catch-all rule never fires because they never pause long enough to weigh it. Counting alone understates this one. |
| `docs/CASES.md` | 2 / 21 **plus a granularity key that is worse than the `[SNIPPET]` markers in one respect** | Its per-document tables give the event count **and the event-type breakdown** for every document in both cases. Checked against the real labels: they agree on **12 of the 13 dev documents** (all 6 of case2; 6 of case1's 7 — case1's d5 is listed as 1 event where the labels have 2). The markers give segmentation but not type; this gives both. It also names **both planted cross-document contradictions** — the thing `source_drafts/README.md` was withheld for — and an **expected total event count**, which is the anchor the packet refuses to restate in any form. Its filename actively invites a labeler looking for case background. |
| `scripts/verify-extract-route.ts` | 2 / 21, in `title: "…"` form | Original titles used as route-verification fixtures. |
| `lib/measure.test.ts`, `lib/eval.test.ts`, `lib/claude.test.ts`, `lib/gemini.test.ts`, `lib/normalize.test.ts` | 1 / 21 each, in `title: "…"` form | 5 of the 9 files matching `lib/*.test.ts`. This repo's unit tests use real Case 1 titles as fixtures by convention, so this is a **class**, not five incidents. The rule is written as `lib/*.test.ts` and covers tests added later — the same generalization Amendment 1 applied to `prompts/`. |

One precision note against Amendment 1's habit of rounding in its own favor:
seven of the eight are in `title: "…"` form. **`docs/CASES.md`'s two are not** —
they are cells in a markdown table. They are still verbatim, and that file is
still the second most damaging entry in this table for the reasons above, but
the form claim does not hold for all eight and is not asserted here as though it
did.

**All of the above are added to the binding protocol**, on the same terms as
Amendment 1's list. Also added, because the original protocol named them in
prose but the generator's handover banner did not print them: `held_out/` (whole
directory), `data/eval_reports/`, and `data/case3_eval_fallback.json`.

#### The sweep is now mechanical

Two hand sweeps, two sets of misses. That is a property of hand sweeps, not of
the people doing them, so the third fix is not a third sweep:

- The forbidden list moves to **`lib/label-leak-sources.ts`** — one array, imported
  by both `scripts/make-label-packet.ts` (which renders it as the packet README's
  rule block and as the runtime `DO NOT OPEN` banner) and by the new checker.
  The packet and the gate can no longer disagree about what "forbidden" means.
- **`scripts/check-label-leaks.ts`** reads the 21 titles from
  `data/cases/*/ground_truth.json`, greps every tracked file for verbatim
  occurrences, and **exits non-zero if any hit is outside that list.** It skips
  `held_out/**` without opening it; since `held_out/` is itself on the list, a
  hit there would be classified as forbidden anyway, so the skip cannot produce a
  false pass.
- Run at the time of writing: **22 tracked files carry at least one verbatim
  original title, and all 22 are on the forbidden list. No ninth unnamed file
  exists.** The gate passes.

**It is deliberately not wired into CI in this slice.** The reasoning is recorded
at the bottom of the script: it gates a protocol rather than the product, it only
binds while the sitting is pending, and a red required check whose meaning is
"a documentation list needs a line" degrades the signal of the checks that mean
"the product is broken". Its place is the pre-sitting step, run in the same
breath as `make-label-packet.ts`, where a failure is on point and a human is
present.

**What the gate does not cover, stated so it is not over-trusted.** It matches
titles **verbatim**. It cannot see paraphrase, and — directly relevant to §3 — it
cannot see count or granularity leaks at all, because those carry no title.
`docs/CASES.md` would have been caught by it for its 2 titles; its per-document
event tables, which are the more damaging half, are invisible to it. A pass means
"no unlisted verbatim title leak", never "no leak".

### 5. What this amendment does not change

**No prediction, no threshold, no interval and no decision band is changed by
this amendment.** Explicitly, and all as originally registered:

- Direction: macro-mean strict F1 **decreases** from **0.825** — re-derived for
  this amendment from the cached reports: case1 0.774, case2 0.875, mean
  **0.825**. Unchanged.
- Point estimate **~0.60**, interval **0.50 – 0.70**. Unchanged.
- Per-type ordering (`medication` most, `visit` least, `lab` intermediate),
  directional only per Limitation 2. Unchanged.
- Loss mechanism: `overlap` should dominate the attribution split. Unchanged.
- Decision bands **< 0.60** / **0.60 – 0.75** / **> 0.75**, band governs over
  point estimate. Unchanged.

What §1 and §3 change is **how a result is to be read**, and both readings make
the experiment harder on itself, not easier:

- Because the restriction is now correctly declared as biasing **toward** the
  hypothesis rather than against it, **a large drop is weaker evidence than
  Amendment 1's framing implied.** Limitation 1's closing sentence — "a large
  drop is trustworthy; a null result is weak" — was written about the
  *contaminated* labeler and remains true for the residual contamination that
  cannot be removed. It does not license treating the restriction's effect as
  free. A `< 0.60` outcome still reads as "Large effect" per the registered band,
  and the band still governs; but the write-up must state that part of the drop
  is attributable to the amendment's own restriction and not only to natural
  phrasing divergence.
- Because two of the newly-forbidden sources leak count rather than phrasing,
  **the F1 delta is an upper bound on the phrasing effect**, not a point estimate
  of it, whenever the blind in-scope count diverges from 13 / 8.
- A **null result remains inconclusive**, exactly as registered, and for a
  stronger reason than before: if a restriction that should widen the effect
  still yields no drop, the residual contamination in Limitation 1 is the first
  explanation to rule out, not the last.

### Status at the time of this amendment

Registered **before any blind label exists**, exactly as the original and
Amendment 1 were. `blind_labels.json` is still the pristine generated template
for both cases, `scripts/compare-relabel.ts` has not been run, and this
amendment — like both texts above it — contains **zero results**. Every number in
it is either a figure already published in docs/EVAL.md §7, a count of files or
markers in the repository, or a prediction restated unchanged from above.

`lib/eval.ts` remains unmodified — sha256 `4540d12b…a09333`, 4900 bytes,
re-verified at the time of writing and unchanged from registration and from
Amendment 1.

**This document still quotes no ground-truth title.** That is deliberate and is
now enforced: `scripts/check-label-leaks.ts` would fail if it did, because
`docs/PREREG-24-blind-relabel.md` is not on the forbidden list and must never
need to be. The worked example in §1 is stated in token counts for that reason.

---
---

## Amendment 3 (2026-07-26)

**Everything above this delimiter is unchanged.** The original pre-registration
(sha256 `5628ef79…5416a`, 8464 bytes) is comment `5082307494`; Amendment 1 is
comment `5082472776`; Amendment 2 is the comment after it. None has been edited.
This is a fourth comment, later again. The repo copy is append-only:
`git diff --numstat` on this file for this change shows **zero deletions**.

**This amendment records a defect in the instrument, not a change to the
experiment.** Three things are wrong above and are corrected here: the packet
generator shipped the segmentation key that Amendment 2 §3 asserts it withholds;
Amendment 2 §5's "upper bound" claim is stronger than the protocol supports; and
the forbidden-file list contradicted the packet's own reading order, so the
protocol did not in fact say what the labeler may read. The first invalidates a
factual claim made in a posted amendment. The second is a reasoning error. The
third was introduced by the instrument rather than by any posted text, and §7
resolves it by restoring what the posted texts actually say. None of the three
moves a prediction, an interval, a threshold or a decision band, and **no blind
label exists yet**, which is the only reason this can be repaired rather than
merely disclosed.

### 1. The packet restated the anchor. Amendment 2 §3's claim was false when it was posted.

Amendment 2 §3 rests on closing `source_drafts/` and `metadata.json` so that the
blind in-scope count is **free to diverge** from the original. The `docs/CASES.md`
row in §4's table calls the expected total *"the anchor the packet refuses to
restate in any form."*

**The packet restated it, per document, in exactly invertible form.**

`scripts/make-label-packet.ts` emitted a provenance header on every packet
document whose last line gave the number of `[SNIPPET]` marker lines removed
from that document. The markers are **paired**, and §3 above states the decoding
rule itself — one marked block per original ground-truth event, zero mismatches
— so that number halved straight into the document's original event count. The
same figure was printed again, summed per case, in the generator's closing
summary at the moment the packet is handed over.

Generating a packet from the pre-fix code and inverting it recovers **every one
of the 13 dev documents' original event counts, with no errors**. The aggregate
fell out of the terminal summary the same way.

Three things make this worse than a stray number:

- **It was in mandatory reading.** The `source_document` value the labeler must
  copy into `blind_labels.json` sat four lines above the count, in the same
  comment block. There is no path through the packet that avoids it.
- **The packet promised the opposite, four paragraphs earlier.** Its "What was
  withheld" section says the target count is *"not restated, paraphrased, or
  bounded anywhere in this packet"* and tells the labeler to *"let the count fall
  where it falls."*
- **It falsified a posted pre-registration.** Amendment 2 §3 was true of the
  generator's *reads* — the denylist does refuse `metadata.json` — and false of
  its *writes*. Tooling blindness was checked; tooling output was not.

**Fixed.** The count is gone from the per-document header and from the handover
summary. The provenance claim that remains is categorical — markers were removed,
the text is otherwise verbatim — and states no quantity.

### 2. A second count channel, in the forbidden list itself

The sweep for siblings found one, and it is not a decoding puzzle. Amendment 2 §4
moved the forbidden list into `lib/label-leak-sources.ts` and quantified every
entry's leak as **`N/21`**. `scripts/make-label-packet.ts` renders those strings
verbatim as the packet README's numbered rule block and prints them again as the
runtime `DO NOT OPEN` banner.

**21 is the aggregate original in-scope ground-truth event count for the two
cases being relabeled.** Rule 1 of the labeler's mandatory reading therefore
stated the two-case total in plain words. The module's own doc comment gave the
per-case split as well, and the packet README names that file to the labeler.

Amendment 2 §4 introduced the quantification for a defensible reason — "Contains
some titles" invites a labeler to decide an item looks harmless — and did not
notice that a denominator is a number too. This is the same failure as §1 above,
one level up: the *content* of the warning was audited and the *arithmetic* of it
was not.

**Fixed.** Every entry now ranks its leak categorically — COMPLETE ANSWER KEY >
MOST > MANY > SEVERAL > A FEW — which preserves the deterrent ordering the
packet renders and discloses no count. Nothing is lost for the maintainer:
`scripts/check-label-leaks.ts` measures and prints the live count beside every
entry on every run, and that copy cannot go stale. That script reads
`ground_truth.json` to do it and prints per-file counts against the original
labels, so it is answer-bearing by construction; the packet now says plainly that
it must not be run during a sitting.

**And the script now refuses to run during one**, which the packet's warning
alone could not accomplish. It exits non-zero, before reading a single title, if
any `label_packet/<case>/blind_labels.json` differs from the pristine generated
template — using the same pristine test as the generator's clobber guard, in one
shared function, because two implementations of "has labeling started?" are two
things to drift and the drift would be silent. A written warning about a tool
that has no opinion of its own is half a control, and the packet README names
this script to the labeler in the course of telling them the list is enforced,
which is exactly the path by which a reflexive mid-sitting run happens.
`--sitting-over` reopens it for the legitimate run after
`scripts/compare-relabel.ts`; that flag is an assertion by the operator rather
than a fact the script can detect, and it says so rather than implying it
checked.

### 3. "Upper bound on the phrasing effect" is withdrawn

Amendment 2 §5 says the F1 delta is **an upper bound on the phrasing effect**
whenever the blind in-scope count diverges from 13 / 8. **That is too strong, for
two reasons, and the second is the one that bites.**

**(a) The granularity channel is not sign-definite.** An upper bound needs every
non-phrasing contribution to push the drop *up*. Over-segmentation does: a blind
count above 13 / 8 enlarges the FN denominator and recall falls. **But
under-segmentation moves it the other way** — a labeler who merges events
produces fewer in-scope GT events, and recall can *rise*. Amendment 2 §3
conditions its caveat on the count "diverging from 13 / 8" and treats the two
directions as equivalent. They are not.

**(b) Residual contamination pushes the opposite way.** Limitation 1 above is
byte-locked and governs: residual exposure makes the labeler reproduce the
original phrasing, which *suppresses* the measured drop. So

> measured Δ = phrasing + granularity(±) − contamination(+)

That is not a bound on anything without a sign assumption on two separate
channels, only one of which is observable.

**The accurate statement, which replaces the one in Amendment 2 §5:** the
aggregate F1 delta is confounded by a granularity channel whose sign the protocol
does not determine. It is **neither an unbiased estimate of the phrasing effect
nor a guaranteed bound on it.** It bounds the phrasing effect from above **only
where the blind in-scope count exceeds 13 / 8**; where it falls below, the delta
may **understate** the phrasing effect.

`scripts/compare-relabel.ts` section [0] prints the in-scope counts for both
label sets and section [4] reports the alignment residue rather than absorbing
it. Read those two, **and the direction of the count difference**, before reading
the F1 delta. The direction is now load-bearing, where Amendment 2 treated only
the magnitude as load-bearing.

### 4. The two defects interact, and the interaction is the reason this is blocking

Amendment 2 §5's caveat is conditional: it fires only when the blind in-scope
count diverges from 13 / 8. **A labeler holding the per-document counts anchors
to 13 / 8. The count does not diverge. The caveat never triggers.**

So the leak in §1 does not merely add error to the measurement. It **silently
disables the safeguard that was registered to detect that error**, and it does so
in the direction that makes the experiment look better behaved than it is — a
blind count that lands on 13 / 8 would have read as reassuring convergence rather
than as the artifact of an anchor. This is why the leak had to be closed before
the sitting rather than disclosed alongside the result.

### 5. Three corrections to figures stated above

- **Amendment 2 §4 says "seven of the eight are in `title: "…"` form". It is
  six of eight.** `lib/normalize.test.ts` carries its title inside a `normalize(…)`
  call and again as an expected-value literal, not as a `title:` assignment —
  so it joins `docs/CASES.md` as the second exception, not the first. The claim
  is non-load-bearing (`scripts/check-label-leaks.ts` matches verbatim regardless
  of form), which is exactly the argument for stating it correctly rather than
  letting it stand.
- **Amendment 2 §4's sweep counts were stale.** The live figures are **176
  tracked files, 157 scanned, 19 skipped** under `held_out/` — not 173 / 154. The
  invariants it drew from them are unaffected: **22 files carry at least one
  verbatim original title, all 22 are on the forbidden list, and no ninth unnamed
  file exists.**
- **Some titles cannot diverge, and that caps the achievable effect.** One case2
  referral document lists the earlier encounter it refers back to using the same
  words the original label for that encounter uses, in its own body text. The
  packet cannot strip it — it is the document, and the labeler is meant to read
  it. Any labeler working from that document is likely to reuse those words. This
  is a **floor on measurable phrasing divergence** and therefore a ceiling on the
  measurable effect, and it is a property of the source material that no protocol
  change can remove. It is registered here so that a smaller-than-predicted drop
  is not read as evidence against the hypothesis without accounting for it.

### 6. What this amendment does not change

**No prediction, no threshold, no interval and no decision band is changed.** As
originally registered and restated unchanged by Amendment 2: direction
(macro-mean strict F1 decreases from **0.825**); point estimate **~0.60**,
interval **0.50 – 0.70**; per-type ordering (`medication` most, `visit` least,
`lab` intermediate), directional only per Limitation 2; `overlap` as the dominant
loss mechanism; bands **< 0.60** / **0.60 – 0.75** / **> 0.75**, band governs over
point estimate.

What changes is **how the result may be described** (§3), **what the labeler
holds when producing it** (§1, §2), and **what the labeler may read** (§7). The
first two make the experiment harder on itself: §3 withdraws a claim that would
have let a confounded number be reported as a bound, and §1–2 remove anchors that
were pulling the blind count toward the original. §7 does neither — it restores
the reading permissions the posted texts always granted, after an implementation
detail had widened them into a rule that contradicted the packet's own reading
order. No path any posted text ever closed is opened by it.

One further change is to the instrument's verification rather than to the
protocol. `npm test` runs `lib/*.test.ts` and nothing else, so **not one line of
the packet generator was executed by any test** — it was verified by being run by
hand and read over, twice, across two amendments, and the defect in §1 survived
both. The rendering logic now lives in `lib/label-packet.ts` with an end-to-end
test that generates a packet into a temporary root and asserts the emitted tree
and the generator's own stdout carry no verbatim original title, no `[SNIPPET]`
marker, and no recoverable per-document or aggregate event count. The test was
confirmed to fail against each of the three defects it is meant to catch before
being accepted. The same file now also covers the §7 rule shape — the packet must
state the PDF carve-out positively and must contain no rule closing the directory
its own reading-order table sends the labeler into — and the sitting guard
described in §2, by running the real gate against a simulated in-progress sitting
and asserting that it exits non-zero **and that no original title reached its
output**.

### 7. The rule inside `data/cases/<case>/` is narrowed, and the PDFs stay open

The packet's generated rule block forbade `data/cases/<case>/` as a whole subtree
while its own reading-order table pointed the labeler at
`data/cases/<case>/docs/*.pdf` as the "equivalent PDF" — and Part A of the
packet, which is §5's protocol quoted verbatim, instructs the labeler to open
those PDFs in a PDF viewer and read each cover-to-cover. **A protocol that
contradicts itself is resolved by the reader, in the convenient direction**, and
the convenient direction here lands in the directory that also holds
`ground_truth.json` and `events.json`. This changes what the labeler may read, so
it is a protocol decision rather than something to settle inside a fix.

**Where the subtree rule came from, since it matters to the resolution: not from
any posted text.** The byte-locked original protocol names
`data/cases/*/events.json` and `data/cases/*/ground_truth.json` **individually**.
Amendment 1's table adds `data/cases/*/source_drafts/` and
`data/cases/*/metadata.json`, also **individually**. No posted text has ever
closed that directory as a whole. The blanket rule was introduced by §4 of
Amendment 2 — the mechanization that moved the list into
`lib/label-leak-sources.ts` — which coalesced those four separately named paths
into one directory entry, and thereby widened the protocol while appearing only
to restructure it. An earlier draft of this section attributed the subtree rule
to Amendment 1's table; that attribution was wrong and is corrected here.

**Decision: narrow the rule, and keep the PDF option.** Within
`data/cases/<case>/`, `docs/*.pdf` is **permitted**, and `ground_truth.json`,
`events.json`, `metadata.json` and `source_drafts/` are **forbidden, named
individually**. Every path any posted text has ever closed stays closed, by name.

Three reasons, in the order they carry weight:

- **Comparability is the point of the experiment.** Case 3's labeler worked from
  PDFs under the §5 protocol, and this packet reproduces that protocol verbatim
  precisely so that the two labeling regimes differ in as little as possible.
  Routing this sitting onto markdown instead would introduce a second difference
  between them, in an experiment that exists to isolate one — phrasing.
  Preserving the reading mode keeps the comparison closer to like-for-like.
- **The PDFs are verified clean, and verified to add nothing.** `pdftotext`
  extracts a clean text layer from all 13 dev PDFs (case1 7, case2 6) and finds
  **zero `[SNIPPET]` markers** in any of them; the markers exist only in
  `source_drafts/`, which stays forbidden. Re-verified for this amendment, and
  extended to the question that actually governs: the extracted text of every
  dev PDF was compared against the packet `.md` document the labeler already
  holds for it. **Exactly one verbatim in-scope title occurs in either — the same
  one, in the same case2 referral document — and nothing occurs in a PDF that is
  not already in the labeler's own copy.** That occurrence is the irreducible one
  registered in §5's third bullet above. Opening the PDFs therefore hands the
  labeler nothing their packet does not already contain.
- **Seeing a sibling filename is not reading it.** The leak is in opening
  `ground_truth.json`, `events.json` or `metadata.json`, and each of those stays
  forbidden by name. A directory listing is not an answer key.

**What changed in the instrument.** `lib/label-leak-sources.ts` now names the
four paths individually, so the packet README's rule block and the generator's
runtime `DO NOT OPEN` banner — both rendered from that one array — moved with it.
Both surfaces additionally state the carve-out **positively**: the PDFs are
permitted reading. Deleting the subtree rule silently would have left the labeler
inferring a permission from a gap in a list, which is the same defect in the
other direction. The README's reading-order section says it again at the point
where the question actually occurs to a labeler, and no longer describes the PDFs
as merely an alternative "if you prefer".

**One limit on that verification, stated so the gate is not over-trusted.**
`scripts/check-label-leaks.ts` now treats an unlisted verbatim title inside
`data/cases/<case>/docs/` as a failure rather than absorbing it under a subtree
rule, which is a real improvement — but it is a backstop, not the check. It greps
raw file bytes, and a PDF's text lives in a compressed stream: it is demonstrably
blind to PDF text today, since the one dev PDF whose rendered text does carry an
in-scope title raises no hit in it. What it would catch is a title left in an
uncompressed stream. The premise this decision rests on is established by the
`pdftotext` comparison above, not by the gate.

### Status at the time of this amendment

Registered **before any blind label exists**, exactly as the original and
Amendments 1 and 2 were. `blind_labels.json` is still the pristine generated
template for both cases, `scripts/compare-relabel.ts` has never been run, and
this amendment — like the three texts above it — contains **zero results**. Every
number in it is a count of files, markers or documents in the repository, a count
of title occurrences in the source documents themselves (§5's third bullet and
§7's second reason, neither of which reproduces the title it counts), or a figure
restated unchanged from above.

**The amendment window closes at the sitting, not at the merge.** Any further
correction to this protocol is legitimate only while `blind_labels.json` remains
a pristine template. Once the first label is written the instrument is frozen,
and anything found after that is a limitation to be reported with the result, not
an amendment.

`lib/eval.ts` remains unmodified — sha256 `4540d12b…a09333`, 4900 bytes,
re-verified at the time of writing and unchanged from registration, from
Amendment 1 and from Amendment 2.

**This document still quotes no ground-truth title.** §5's third bullet and §7's
second reason both describe the same one without reproducing it, for that reason.

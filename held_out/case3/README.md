# Case 3 — HELD-OUT

> **STATUS (updated 2026-07-22): LABELED, LOCKED, EVALUATED.** Path A was taken
> (see `docs/RESOLVED-DECISIONS.md` §9 for the original two-path reasoning). Case
> 3's 8 PDFs and ground-truth labels were authored (GT `labeled_at`
> 2026-05-10T15:33:19Z), then hash-locked in commit `59ca076` before the prompt
> was ever run against Case 3. Case 3 was never used in prompt iteration. The
> held-out evaluation then ran twice under frozen prompt v4 (first recorded
> measurement 2026-05-10T18:33:16Z); the results and the dev→held-out gap
> analysis live in the repo README ("Held-out Case 3 results"). Phase A (issue
> #7) now works that gap.
>
> The held-out discipline is NOT retired — it binds every future session. Do not
> re-open the PDFs, do not read `ground_truth.json`, and do not use Case 3 in any
> prompt iteration. The rules below still stand.

**STOP. Do NOT open the PDFs in this directory.**
**STOP. Do NOT read `ground_truth.json`.**

## Why this directory is special

Case 3 (David Park, 38M, chronic low back pain) is the held-out evaluation
case for Chronicle. The credibility story for the demo is:

> "We labeled this case BEFORE we ever ran the model on it. The metrics are
> the model's first contact with these documents — no backward-tuning, no
> data leakage."

That story is true only if Case 3 stays untouched by:
- the extraction prompt iteration loop (H8–H9)
- the few-shot examples (must come from Cases 1+2 only)
- any sanity-check / "let's just see what it does" extraction
- any model — including Claude in this very session

## When Case 3 is allowed to be opened

- **By Murat:** ONCE, during pre-H0 Block 2, to write `ground_truth.json` labels. Then locked, hashed, and chmod 444. Not opened again until H11.
- **By the model:** ONCE, at H11, when `/api/eval?mode=live` runs the held-out evaluation. The model's extraction is compared to `ground_truth.json` to compute strict + loose precision/recall.

That's it. Two openings ever.

## File inventory in this directory

| File | Status | Owner |
|---|---|---|
| `docs/d*_*.pdf` | Murat drops them in (~8 PDFs) | Murat |
| `ground_truth.json` | Currently a TEMPLATE; Murat replaces with real labels per [docs/EVAL.md](../../docs/EVAL.md) protocol | Murat |
| `.gt_hash.lock` | Created at end of Block 2 via `git hash-object ground_truth.json > .gt_hash.lock` | Murat (one command) |
| `prompt_hash.txt` | Created at runtime by `scripts/eval-case3.ts` (not pre-committed) | Tool, runtime |
| `eval_runs/` | Created at runtime, gitignored, audit log of each run | Tool, runtime |

## Anti-temptation reminders for future sessions

If you (Claude or any future tool/script) find yourself about to:
- read a PDF in `docs/` for "context" → STOP. Use Cases 1+2 instead.
- look at `ground_truth.json` to "validate" something → STOP. The hash check
  in `scripts/eval-case3.ts` is the only validation needed.
- "just peek" at one event for prompt iteration → STOP. That's exactly the
  contamination this directory is designed to prevent.

If you (Murat) are tempted to add or edit labels in `ground_truth.json`
AFTER initial labeling because the model surfaced an event you missed:
- STOP. That's hindsight bias. The chmod 444 is your friend.
- The whole point of held-out is the metric reflects YOUR judgment of what
  belongs on the timeline, made BEFORE you saw the model's answer.

## Pointer to the canonical labeling protocol

See [docs/EVAL.md](../../docs/EVAL.md) section "step-by-step for Murat —
writing Case 3 ground-truth labels" for the full procedure. ~1.5–2 hr of
focused work, do in ONE sitting (label drift across days corrupts the
metric).

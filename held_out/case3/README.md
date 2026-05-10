# Case 3 — HELD-OUT

> **STATUS (2026-05-10): DEFERRED.** Pre-H0 Block 1 (PDFs) and Block 2 (GT labels)
> are consciously deferred per Murat. Deadline: **before H8 of the build clock**
> (the prompt-iteration hour). At H8, two paths:
> - **Path A** — labeling done by then → lock it (hash + chmod + commit), proceed
>   with normal H8–H9 prompt iteration, demo beat 3 works at H11.
> - **Path B** — labeling NOT done → freeze the prompt where it is, skip H8–H9
>   prompt iteration entirely (iterating with Case 3 still unlabeled would
>   contaminate the held-out story if labels are added later), use freed time
>   for polish, demo becomes 3-beat (drop beat 3).
>
> See `docs/RESOLVED-DECISIONS.md` §9 for the full reasoning. The folder scaffold
> below stands; future sessions should still treat any future Case 3 content as
> held-out per the rules below.

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

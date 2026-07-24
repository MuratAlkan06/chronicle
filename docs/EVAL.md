# Chronicle — Evaluation Methodology

## 5. Eval methodology — operational

### Ground-truth file shape (`held_out/case3/ground_truth.json`)

```ts
{
  "case_id": "case3",
  "patient": "David Park, 38M",
  "labeled_at": "2026-05-08T14:00:00-07:00",
  "labeler_notes": "free-text; document any judgment calls made during labeling",
  "events": [
    {
      "id": "gt_001",                           // gt_ prefix distinguishes from predicted
      "date": "2024-01-15",
      "date_confidence": "exact",
      "event_type": "visit",
      "title": "PCP visit — low back pain",     // labeler's headline; matching is token-overlap
      "source_document": "d1_pcp_2024_01.pdf",  // which doc this event came from
      "in_scope": true,                          // false → excluded from FN denominator
      "notes": "Initial presentation; 6-week duration per patient report"
    },
    // ...
  ]
}
```

**`in_scope: false`** is the OOS exclusion mechanism (Q17). When labeling, mark events where reasonable extractors might disagree (e.g., a billing-only line item, an off-handed mention of a remote past condition). These are still labeled for completeness but excluded from the FN denominator.

### Matching algorithm pseudocode (TS, in `lib/eval.ts`)

```ts
type Tier = "strict" | "loose";

function matches(pred: Event, gt: GtEvent, tier: Tier): boolean {
  if (pred.event_type !== gt.event_type) return false;

  const titleTokens = (s: string) =>
    new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const overlap = (a: Set<string>, b: Set<string>) => {
    const inter = [...a].filter(x => b.has(x)).length;
    const denom = Math.max(a.size, b.size);
    return denom === 0 ? 0 : inter / denom;
  };
  if (overlap(titleTokens(pred.title), titleTokens(gt.title)) < 0.5) return false;

  const dPred = new Date(pred.date).getTime();
  const dGt = new Date(gt.date).getTime();
  const dayMs = 86400000;
  const diffDays = Math.abs(dPred - dGt) / dayMs;

  if (tier === "strict") return diffDays === 0;
  if (tier === "loose")  return diffDays <= 3;
  return false;
}

function evaluate(predicted: Event[], gt: GtEvent[], tier: Tier) {
  const inScopeGt = gt.filter(g => g.in_scope);
  const matchedGt = new Set<string>();
  const matchedPred = new Set<string>();

  // greedy 1-1 matching, prefer same-source-document if available
  for (const p of predicted) {
    const candidates = inScopeGt.filter(g =>
      !matchedGt.has(g.id) && matches(p, g, tier));
    // prefer same-document candidate
    candidates.sort((a, b) => {
      const aSame = a.source_document === p.source.document_id ? 0 : 1;
      const bSame = b.source_document === p.source.document_id ? 0 : 1;
      return aSame - bSame;
    });
    if (candidates.length > 0) {
      matchedGt.add(candidates[0].id);
      matchedPred.add(p.id);
    }
  }

  // exclude predictions that pinpoint-failed (snippet not located on page)
  // from the precision NUMERATOR per Q14
  const validPred = predicted.filter(p => p.source._pinpointed !== false);
  const tp = matchedPred.size;
  const fp = validPred.length - matchedPred.size;
  const fn = inScopeGt.length - matchedGt.size;

  const precision = tp / (tp + fp || 1);
  const recall    = tp / (tp + fn || 1);
  const f1 = 2 * precision * recall / (precision + recall || 1);

  return { tier, tp, fp, fn, precision, recall, f1, n_gt: inScopeGt.length };
}
```

Per-event-type breakdown: run `evaluate` filtered to each `event_type`. Display as a small table in the UI.

### `/api/eval` route handler — what runs and in what order

**Mode = `cached`:** read precomputed report JSON for Cases 1+2 from `data/eval_reports/<case>.json`, return as `application/json`. Reports are written by `scripts/eval-train.ts` during prompt iteration.

**Mode = `live` (Case 3):** SSE stream:
1. Open stream, send `{type:"started"}`.
2. **GT integrity check (resolved decision #7):** read `held_out/case3/.gt_hash.lock`, compute `git hash-object held_out/case3/ground_truth.json`, compare. If mismatch: send `{type:"error", code:"gt_hash_mismatch", message:"Case 3 ground truth has been modified since H0 lock — eval refused"}` and close the stream. This is the artifact behind the "how do you know you didn't tune to Case 3?" judge question.
3. **Prompt hash log (Q19):** read current `prompts/system_extract_v*.md` git hash → write to `held_out/case3/prompt_hash.txt`. Fail loudly if `prompts/` has uncommitted changes (the prompt that produced this eval must be reproducible from git).
4. List `held_out/case3/docs/*.pdf`.
5. For each doc in parallel (`Promise.all` with progressive enqueue):
   - Send `{type:"doc_started", docId, filename}`.
   - Call Claude extractor (same code path as `/api/extract`).
   - For each event returned, send `{type:"event", docId, event}`.
   - Send `{type:"doc_complete", docId}`.
6. After all docs complete, load `held_out/case3/ground_truth.json`.
7. Run `evaluate(predicted, gt, "strict")` → send `{type:"metric", tier:"strict", value}`.
8. Run `evaluate(predicted, gt, "loose")` → send `{type:"metric", tier:"loose", value}`.
9. Run per-event-type breakdown for both tiers → send `{type:"breakdown", value}`.
10. Append predicted events + metrics to `held_out/case3/eval_runs/<timestamp>.json` (audit log).
11. Send `{type:"done"}`, close stream.

### `/eval` page

Renders:
- **Header:** "Evaluation — held-out Case 3 (David Park)"
- **Methodology blurb (collapsible):** strict/loose definitions, OOS rule, the held-out claim ("Case 3 was never used in prompt iteration; its ground truth was authored independently of model output on Case 3, hash-locked in commit 59ca076 before the prompt was ever run against Case 3 — first recorded measurement 2026-05-10T18:33:16Z"), prompt-version git hash.
- **Live extraction strip:** docs animating in as they complete (small badges).
- **Two big metric cards:** Strict precision/recall/F1, Loose precision/recall/F1.
- **Per-event-type table:** rows = event_type, cols = strict P/R, loose P/R.
- **Footer note:** "Last run: <ISO timestamp> · Prompt: system_extract_v<N>.md (<git hash short>)"

**Live trigger choice: explicit two-step confirm gate (not auto on route entry).**
The `/eval` live tab opens on the cached fallback and never auto-runs — a real
held-out run spends the final scored Case 3 measurement event (§6), so it fires
only after the user clicks "Run live extraction…" and confirms the inline gate
(`lib/eval-gate.ts`, rendered in `app/eval/page.tsx`). This closed the auto-run
peek hazard flagged in STATE cycle 17 (issue #9). Cmd+Shift+L reloads the cached
fallback.

### CRITICAL: step-by-step for Murat — writing Case 3 ground-truth labels

You have NOT done held-out NLP eval before. Read this fully before you start. Allotted time: **1.5-2 hr**. Do this in ONE sitting — splitting across days causes drift.

**What to label.** Every clinically discrete event as defined by the system prompt's "What counts as ONE event" section. *Use the prompt as your labeling spec.* Read the prompt's event definition first, then label according to it. This sounds circular but it's actually correct: you are evaluating whether the model FOLLOWS the spec. If your labels don't follow the spec, you're testing the wrong thing.

**The labeling unit.** ONE event per discrete clinical moment. If a single doctor's note encounter included a visit + a new diagnosis + a med change, that's THREE events with the same date and source_document.

**How to label without contamination.**
1. **Do NOT run the model first.** Do not extract Case 3 with any prompt. Do not even sanity-check. The first time the model touches Case 3 PDFs is at H11.
2. **Open Case 3 PDFs in chronological order**, one at a time, in your PDF viewer. Read each cover-to-cover before labeling.
3. For each PDF, write your labels in `ground_truth.json` directly. Use the schema above.
4. Mark `in_scope: false` for events where you genuinely think two reasonable extractors would disagree on whether to include it. Be generous with this — false-positive scope is fine, missing scope is bad. (You'd rather exclude a borderline event from the FN denominator than punish the model for not matching your idiosyncratic call.)

**Handling ambiguous cases.**
- *Doctor's note mentions a previous referral that already happened:* label it as a separate `referral` event with the previous date if the note states a date; mark `date_confidence` as approximate or inferred. If the note says "previously referred to ortho" with no date, do NOT label — there's no event to anchor.
- *Doctor's note mentions a planned future MRI:* do NOT label. The system prompt explicitly excludes forward plans.
- *Multiple labs on one panel:* ONE event for the panel, with the most-relevant analyte in `notes`. Do not emit per-analyte events. (Match the system prompt rule.)
- *A med refill that's just continuing existing med at same dose:* do NOT label unless the document explicitly re-confirms the med on this date as a distinct decision.
- *A prior diagnosis re-listed in the problem list:* do NOT label as a new diagnosis event.

**The labeling artifact.** File: `held_out/case3/ground_truth.json`. Schema as shown. After writing, run a quick validation: `tsx scripts/validate-gt.ts held_out/case3/ground_truth.json` (you'll write a 20-line zod-validator script as part of `scripts/eval-case3.ts` setup at H0).

**Common mistakes to actively avoid:**
1. **Hindsight bias.** You will be tempted later to add events the model surfaced that you missed. **Do not.** If you added events post-hoc the metric is a self-fulfilling prophecy. Set the file as read-only after labeling: `chmod 444 held_out/case3/ground_truth.json`.
2. **Label drift.** Stretching labeling across days lets your "what counts as an event" intuition shift. Do it in one sitting.
3. **Pollution from running predictions in parallel.** Don't have the extraction code open in another window. Don't be tempted to "just see what it does."
4. **Title bias.** Don't write titles in the same phrasing the model would use. Write naturally — the matching algorithm uses token-overlap precisely so phrasing differences don't break matching.
5. **Date over-precision.** If the document says "March 2024" don't pick a specific day to make matching easier; use `2024-03-01` and `date_confidence: approximate`. The matching algorithm is calibrated for this.

**Quality checklist before locking the file:**
- [ ] Every event has a `source_document` that exists in `held_out/case3/docs/`.
- [ ] Every `date` is valid ISO 8601.
- [ ] Every `event_type` is in the locked enum.
- [ ] Total event count is in 15-30 range (Case 3 is ~8 docs; <15 likely under-labeling, >30 likely over-labeling).
- [ ] At least 2-3 events marked `in_scope: false` (if zero, you're being too permissive with what counts).
- [ ] No two events share the exact same `(date, event_type, source_document)` triple unless they're genuinely distinct (e.g., two different labs on one panel — but per the rule above, those should be ONE event).
- [ ] Re-read 3 random PDFs and check you didn't miss anything obvious.
- [ ] `git hash-object held_out/case3/ground_truth.json > held_out/case3/.gt_hash.lock` (resolved decision #7 — `scripts/eval-case3.ts` will refuse to run if this hash mismatches the GT file at runtime).
- [ ] `chmod 444 held_out/case3/ground_truth.json` (layered secondary signal — soft tamper-evidence on top of the hash check).
- [ ] `git add held_out/case3/ground_truth.json held_out/case3/.gt_hash.lock && git commit -m "lock case3 GT + hash"` — the commit hash is your timestamp of record. The `.gt_hash.lock` file in git history is the tamper-evidence artifact.

### CRITICAL: step-by-step for Murat — prompt iteration discipline

You will iterate the prompt against Cases 1+2 ONLY. Process:

1. **Version filename, not git-only.** Each meaningful prompt change → bump filename: `prompts/system_extract_v1.md` → `v2.md` → `v3.md`. The active version is symlinked or referenced in `lib/claude.ts` via `import { ACTIVE_PROMPT } from "./prompt-config"`.
2. **One change per version.** Don't change three things at once or you can't attribute metric movement.
3. **Per-version eval log.** After each version, run `tsx scripts/eval-train.ts` which extracts Cases 1+2 with the active prompt and computes strict/loose metrics. Append to `prompts/CHANGELOG.md`:
   ```
   v3 | 2026-05-09T03:14 | abc1234 | added severity-mapping few-shot | C1: P=0.82 R=0.91 | C2: P=0.75 R=0.83
   ```
4. **Metrics on Cases 1+2 only.** Never touch Case 3 during iteration. Not even casually. Not even to "see if it's in the right ballpark."
5. **Stop conditions (any one fires → freeze):**
   - 3 consecutive versions with <2pt absolute movement on either tier → diminishing returns.
   - Total iteration time hits 90 min → time-box.
   - Strict P or R on Cases 1+2 ≥ 0.85 on both → good enough.
6. **Prompt freeze moment.** When you stop iterating: tag the active version as the eval candidate. The git hash of `prompts/system_extract_vN.md` at this commit is what gets logged when Case 3 runs at H11.

---

## 6. Held-out measurement protocol (Phase A — measurement rigor)

Phase A (issue #7) hardens *how* Case 3 is measured. Three rules: pin
`temperature: 0` where the model accepts it, report a **mean±range over 3 runs**,
and spend the peek budget deliberately.

### Temperature (model-aware)

Extraction pins `temperature: 0` for the default model (`claude-sonnet-4-6`) to
minimize run-to-run variance from sampling. It does **not** guarantee bit-exact
determinism (the model can still vary), which is exactly why the N-run
mean±range below — not a single run — is the reported number.

Whether `temperature` may be sent **at all is model-dependent**, decided by
`supportsTemperaturePin(model)` in `lib/claude.ts`:

- **Opus 4.6 wave and earlier** (incl. `claude-sonnet-4-6`, the active model)
  accept `temperature` → the request sends `0`. Verified live 2026-07-23: a case1
  extraction with `temperature: 0` on `claude-sonnet-4-6` returns 200.
- **Released after Opus 4.6** (`claude-opus-4-7`+, Sonnet 5, Fable 5, …) reject any
  non-default `temperature` with HTTP 400 — the Anthropic SDK marks the field
  `@deprecated` and only `1.0` is accepted for backwards-compat. For these the
  request **omits** `temperature` and the model runs at its default; the artifact
  records `temperature: null` (an honest "model default", never a false `0`).

The predicate is a version threshold, not a lookup table (generation ≥ 5, or
generation 4 minor ≥ 7 → omit; unrecognized ids default to the safe "omit" side),
so an unknown model can never 400 the extraction path. This is what lets the Case 3
escape hatch (`--model claude-opus-4-7`, below) run without any code change.
- **Historical numbers predate this.** Every row in `prompts/CHANGELOG.md` and
  the two recorded Case 3 runs (`2026-05-10T18:33:16Z` strict F1 0.41,
  `2026-05-10T20:15:09Z` strict F1 0.45) were produced at the **Anthropic API
  default temperature (≈1.0), no seed**. They are *not* directly comparable to
  any temperature-0 measurement taken from this point forward.

**Tool-payload encodings (normalized parser-side).** The same post-Opus-4.6
models that reject temperature pinning also vary how they serialize the
`emit_events` tool call run-to-run (observed 2026-07-23: `claude-opus-4-7`
returned `input.events` as a JSON *string* re-encoding the whole
`{ events: [...] }` payload on some case1 docs while emitting the canonical array
on others). `normalizeEmittedEvents` in `lib/claude.ts` accepts the documented
array plus these mechanically-equivalent encodings — JSON-string → parse, nested
`{ events }` wrapper → unwrap, numeric-keyed object → values, single bare event →
wrap — as pure *shape* transforms that never invent or alter event content. The
prompt and tool schema are unchanged (`promptHash f32ebd0` holds), so the
Opus-vs-Sonnet comparison stays clean. Any unrecognized or ambiguous shape fails
that document **loudly** (`code=extraction_failed`, recorded as a `docFailure`)
rather than silently degrading to zero events — so an Opus escape-hatch run
measures extraction quality, not tool-serialization variance.

### What counts as one "measurement event"

**One measurement event = one invocation of `scripts/eval-case3.ts`, which runs
`--runs N` (default 3) extraction+eval passes and reports the mean, min, and max
of strict/loose P/R/F1 plus per-run tp/fp/fn.** A single run is never reported on
its own — at `n_gt = 20`, one event ≈ 5 F1 points, so the range is the honest
signal.

### Peek budget (held-out hygiene)

- **Scored measurements to date: 3** — two on 2026-05-10 (`claude-sonnet-4-6`,
  prompt v4, default temperature) and one on 2026-07-23 (the pre-registered
  escape-hatch run, `claude-opus-4-7`, `--runs 3`, prompt v4, model-default
  temperature; 3-run mean strict P/R 0.48/0.42 — did not clear the 0.5 bar, so
  Sonnet stays the active model).
- **Remaining budget: ≤1 measurement event** (one event = up to 3 runs, reported
  as mean±range).
- **No per-event error analysis of Case 3.** Only aggregate P/R/F1 + tp/fp/fn and
  the per-event-type breakdown may be read. Do not open Case 3 PDFs, the ground
  truth, or the per-event `predicted`/matched lists in `eval_runs/*.json`.
- **Owner decision (2026-07-23): no further hand-labeled held-out cases.** Case 3
  is the last independently-labeled held-out case; the remaining ≤1 scored
  measurement event is the **final** confirmatory budget on Chronicle, ever. With
  no replacement case, spending it accidentally is unrecoverable — so the `/eval`
  live tab no longer auto-runs on route entry. It opens on the cached fallback and
  fires a scored run only behind an explicit two-step confirm gate
  (`lib/eval-gate.ts`, `app/eval/page.tsx`), closing the auto-run peek hazard
  flagged in STATE cycle 17 (with a valid key, every `/eval` visit was one Case 3
  run). See docs/RESOLVED-DECISIONS.md §10.

### Degenerate runs are not measurements (never persisted)

A run in which **zero documents produced a successful extraction** — every per-doc
call threw (an auth/transport failure, e.g. an invalid `ANTHROPIC_API_KEY`
returning 401) — carries no information about model performance. It is **not a
measurement**, is not billed, and does **not** count against the peek budget. The
harness refuses to persist one: `isDegenerateRun(outcomes)` in `lib/measure.ts` is
enforced in both persist paths — the live `/api/eval` route emits an
`all_docs_failed` error frame instead of writing, and `scripts/eval-case3.ts`
aborts non-zero *before* writing any run file (and, in a multi-run sequence,
before writing the summary). A run with **≥1** successful doc may persist but must
record the failed docs explicitly (`docFailures` in the artifact).

**One pre-guard artifact existed and was removed.** Before this guard,
`held_out/case3/eval_runs/2026-07-23T06-21-47-086Z.json` was written by the
pre-existing `/api/eval` live auto-run during a slice-1 fallback-render check: the
dev server had a dummy `ANTHROPIC_API_KEY`, so every per-doc extraction threw, the
route caught the errors and scored `predicted: []` against the real ground truth
(`tp=0`, `fn=20`, real prompt hash `f32ebd0`) and persisted it anyway. Its
structure confirms the forensics — empty `predicted`, `usage`/`perDocUsage` absent
(the pre-slice-2 run shape), no `summary-*.json` sibling. Zero successful model
calls → zero information → **not a held-out measurement** (it did not increment the
scored-measurement count). It was identified, forensically explained, and deleted;
the guard above prevents any recurrence.

### `scripts/eval-case3.ts` — the measurement CLI

```bash
npx tsx scripts/eval-case3.ts                          # case3, 3 runs (the deliverable)
npx tsx scripts/eval-case3.ts --runs 5                 # case3, 5 runs
npx tsx scripts/eval-case3.ts --model claude-opus-4-7  # case3 escape hatch (Opus)
npx tsx scripts/eval-case3.ts --dry-run                # list docs + config, no API calls
```

Before extracting, it enforces the held-out hygiene gates (per
BACKEND-STANDARDS §J.5): `.gt_hash.lock` must equal `git hash-object
held_out/case3/ground_truth.json`, `prompts/` must be git-clean, and the active
prompt hash is written to `held_out/case3/prompt_hash.txt`. Each run is persisted
to `held_out/case3/eval_runs/<timestamp>.json` (same shape the live `/api/eval`
route writes) — including the `model` id used and the `temperature` actually sent
(`0`, or `null` when the model ran at its default) — and a
`summary-<timestamp>.json` records the mean±range plus that same `model` and
`temperature`.

`--model <id>` overrides the extraction model (default: `lib/claude`'s
`ACTIVE_MODEL` = `claude-sonnet-4-6`). It exists for the Case 3 escape hatch
(BUILD.md: if Case 3 strict P or R < 0.5, try `claude-opus-4-7`): the run records
whichever model was used, and `temperature` is pinned or omitted for that model
automatically (see *Temperature*, above). It does **not** relax the held-out
hygiene gates — an `--model` Case 3 run is still a scored measurement event.

A dev-case mode (`eval-case3.ts case1 …`, reading `data/cases/<id>`) runs the
identical N-run machinery **without** the hygiene gates so the pipeline can be
exercised without spending Case 3 budget — dev cases are not measurement events.

### Usage-field persistence

Every extraction path now persists the four Anthropic token-usage fields
(`input_tokens`, `output_tokens`, `cache_read_input_tokens`,
`cache_creation_input_tokens`):

- **Case extractions** → `data/cases/<id>/metadata.json` (`usageTotals` +
  per-doc `perDoc[].usage`).
- **Measurement runs** → `held_out/case3/eval_runs/*.json` and the live
  `/api/eval` run log (`usage` aggregate + `perDocUsage`).

Old artifacts without usage fields stay readable everywhere (missing fields
normalize to 0). `scripts/cache-report.ts` scans these artifacts and reports
total tokens, the % of input tokens served from cache, and the net $ saved vs a
no-caching counterfactual (including the 1.25× cache-write premium), using the
dated pricing table in `lib/pricing.ts`.

### Model + temperature persistence

Every run artifact records the `model` id actually used and the `temperature`
actually sent — `0` for models that accept it, `null` when the model ran at its
default (see *Temperature*, above) — so a persisted measurement is attributable to
a specific model and honestly states whether it was pinned or ran at default. This
covers `scripts/eval-case3.ts` run files + summaries and the live `/api/eval` run
log; case extractions stamp `metadata.json`'s `modelVersion` from the same
`ACTIVE_MODEL` source so it can't drift from the request. Old artifacts predating
this omit `model` (and carry no `temperature`); every reader treats both as
optional.

---


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
- **Methodology blurb (collapsible):** strict/loose definitions, OOS rule, "labels written before prompt iteration began" sentence, prompt-version git hash.
- **Live extraction strip:** docs animating in as they complete (small badges).
- **Two big metric cards:** Strict precision/recall/F1, Loose precision/recall/F1.
- **Per-event-type table:** rows = event_type, cols = strict P/R, loose P/R.
- **Footer note:** "Last run: <ISO timestamp> · Prompt: system_extract_v<N>.md (<git hash short>)"

**Live trigger choice: auto on route entry**, justified above.

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


# Chronicle — Resolved Decisions (paper trail)

**Status: all 7 items locked pre-H0.** This file is the resolved version of `OPEN-DECISIONS.md`, kept for the audit trail. PLAN.md links here for the reasoning behind decisions referenced elsewhere in the docs.

---

### 1. Hotkey for Case 3 fallback: Cmd+Shift+L

LOCKED. Mnemonic "Load cached." Unbound in Chrome and Arc on Mac. No conflict with Cmd+L (URL bar).

Implementation: bind globally on the `/eval` route only. Triggers swap from live Case 3 extraction to precomputed `events.json` fallback if API stalls > 15s.

---

### 2. Lucide icons per event type

LOCKED.

| event_type | icon |
|---|---|
| lab | `FlaskConical` |
| imaging | `ScanLine` |
| visit | `Stethoscope` |
| diagnosis | `ClipboardList` |
| medication | `Pill` |
| procedure | `Activity` (consider `Syringe` swap if it reads cleaner at 16-20px in Figma — eyeball during component setup, do not bikeshed) |
| referral | `ArrowRightLeft` |

Icons render in the colored circle on the timeline axis (event-type color, not severity color — severity is the dot + card bar only per Q10).

---

### 3. Severity color tokens: Option A (lightness gap) + H10 verification step — **SUPERSEDED**

> **SUPERSEDED by [docs/FRONTEND-STANDARDS.md](FRONTEND-STANDARDS.md) §H.1.** The new severity palette (info `#6B7280` slate, monitor `#D97706` amber, concerning `#DC2626` red, urgent `#991B1B` dark red) is the current source of truth. The earlier stone-400 / amber-400 / orange-600 / red-600 palette below is no longer current. The H10 colorblind sim check still applies, but the failure mode shifted — see below.

**Original (no longer current):**

| severity | token |
|---|---|
| info | `stone-400` |
| monitor | `amber-400` |
| concerning | `orange-600` |
| urgent | `red-600` |

**Why superseded:** the new "calm clinical" aesthetic direction (Section H of PLAN.md / FRONTEND-STANDARDS.md) is more conservative — concerning and urgent are both reds (deeper darkness gap rather than orange→red hue shift). Better fits the medical-tool tone but introduces a new colorblind concern.

**H10 polish verification (still required, retargeted):** Chrome DevTools → Rendering panel → Emulate vision deficiencies → Deuteranopia, then Protanopia. Verify that **concerning `#DC2626` and urgent `#991B1B` (both reds) remain distinguishable** under both simulations. If they collapse, **adjust the urgent token only** (e.g., `#7F1D1D` for more lightness gap) — do not touch the other three. (Wired into BUILD.md H10 polish task.)

---

### 4. Few-shot count: 2 multi-event mini-documents (7/7 type coverage)

LOCKED with structural refinement and biopsy inclusion.

Do NOT write the 2 few-shots as single-event extractions. Each is a multi-event mini-document maximizing event-type diversity:

- **Few-shot 1 (Sarah-style):** lab + visit + diagnosis + medication
- **Few-shot 2 (Maria-style):** imaging + visit + referral + **procedure (biopsy)**

This covers **7 of 7** event types in 2 cached examples. The biopsy in Maria's case (suspicious mammogram → benign biopsy) is the natural procedure example, and demonstrates how the model should distinguish a procedure event (biopsy + result) from an imaging event (mammogram report) when both appear in the same encounter chain.

Strictly better than burning a 3rd few-shot slot — same prompt-cache cost, complete schema coverage, and teaches the model the multi-event-per-document pattern that matches real clinical notes. (Wired into extraction-prompt-v1.md few-shot placeholders.)

---

### 5. SSE throttle: leaky-bucket at 150ms

LOCKED with implementation note.

NOT a fixed delay. Implement as "minimum interval between UI updates":

- If events arrive faster than 150ms apart (cached Cases 1+2 served from disk): queue and dequeue at 150ms intervals.
- If events arrive slower than 150ms apart (Case 3 live extraction, ~4s per doc): pass through immediately.

**Rationale:** a fixed delay would artificially slow the Case 3 demo that's already running ~10s wall time. Leaky-bucket smooths the cached-cases animation without penalizing the live run. The implementation naturally handles "first event after a long gap" (passes through immediately), so no special-case needed.

Tune the interval at H10 polish if it feels off — 150ms is the starting point, not a requirement.

---

### 6. `prompts/CHANGELOG.md` format: pipe-delimited

LOCKED.

Format per EVAL.md prompt-iteration discipline section — single line per version, pipe-delimited fields. Fast to grep, low overhead, right for a 12-hr build's eval log.

If the log grows past ~10 entries post-hackathon, migrate to YAML. Not an H0 concern.

---

### 7. Held-out GT integrity: hash check + chmod 444 (layered)

LOCKED. Hash check over chmod alone.

`chmod 444` is a soft signal — one keystroke to bypass, zero tamper-evidence in run logs. The hash check is ~15 minutes of work and gives a defensible answer to the likely judge question "how do I know you didn't tune to Case 3?"

**Implementation:**

At H0, after Case 3 ground truth is written and locked:

    git hash-object held_out/case3/ground_truth.json > held_out/case3/.gt_hash.lock
    chmod 444 held_out/case3/ground_truth.json
    git add held_out/case3/ground_truth.json held_out/case3/.gt_hash.lock
    git commit -m "lock case3 GT + hash"

`scripts/eval-case3.ts` (and the `/api/eval?mode=live` route handler) behavior:

1. Read `held_out/case3/.gt_hash.lock` at startup.
2. Compute `git hash-object held_out/case3/ground_truth.json` at runtime.
3. If hashes mismatch: refuse to run, exit non-zero (or send a single SSE error frame `{type:'error', code:'gt_hash_mismatch'}` and close) with a clear error message naming the file and hash mismatch.
4. If hashes match: proceed with eval.

**Defensible answer if asked:** "The eval script verifies the GT blob hash against a committed lock file before it runs. The lock file is in git history. Modifying the GT after H0 is tamper-evident — you can verify by running `git log .gt_hash.lock` and checking the lock commit predates any prompt iteration."

`chmod 444` stays as a layered secondary signal. Belt and suspenders, ~10 seconds of additional work. (Wired into EVAL.md quality checklist + BUILD.md Block 2 + BUILD.md H7 prompt to Claude Code.)

---

### 8. Citations API dropped — Block 5b verification (added 2026-05-09, backend cycle 1)

LOCKED. PLAN.md Q1 amended to match. This is the BUILD.md Risk 1 worst-case fallback path (line 313), pre-authorized.

**Empirical evidence** (two real Anthropic API calls against `data/cases/case1/docs/d1_pcp_2023_01.pdf`, ~$0.12 total, repro at `scripts/verify-citations.py`):

| Test | tool_choice | Text blocks | Citations attached | Tool call returned events |
|------|---|---|---|---|
| 1 | `{type: "tool"}` (forced) | 0 | 0 | 6 |
| 2 | `{type: "auto"}` | 1 (multi-event narrative) | 0 | 6 |

The hybrid text-block + tool_use pattern documented in `docs/extraction-prompt-v1.md` does NOT yield citations — forced `tool_choice` suppresses text generation entirely; `auto` mode produces a narrative text block but the Citations API does not attach citations to it.

**Decision:** drop the Citations API and the hybrid text-block requirement. Force the tool. `source.snippet` is the model's verbatim claim, validated downstream by `lib/match.ts` (H3) sliding-window match against the normalized PDF text-layer. Q14's "source not pinpointed" badge stays as the graceful-degrade UI for snippet misses. Wedge feature (click-to-source highlight) preserved — it depends on substring match in normalized text, not on Anthropic's `cited_text`.

**Implementation:** `prompts/system_extract_v1.md` (as-built, supersedes `docs/extraction-prompt-v1.md` — historical), `lib/claude.ts` (no `citations: { enabled: true }` on the document block), `app/api/extract/route.ts`. Cache breakpoints unchanged — system + (empty for now) few-shot block remains cached.

**Two unresolved findings deferred to H8–H9 prompt iteration:**

1. **Weak snippet selection.** Model picked `"Date of Service: 01/12/2023    Visit type: Annual physical"` for the visit event instead of the HPI sentence (`"Pt presents today for routine annual physical. Reports fatigue × 3 months..."`). The chosen snippet is technically verbatim but is the document header, not the clinically discrete moment. Fix: few-shot examples in Block 4 must demonstrate "shortest contiguous span that supports the event" against the HPI/Plan/Assessment sections, not the header.
2. **`values` field schema violation.** Model returned `{"BP": "132/84", "HR": 78, "Wt": ...}` (free-form key-value map) instead of the locked single-analyte `{key, value, unit, ref_range, flag}` shape. The visit event is a non-lab event with multiple vitals — the locked schema is rigid for this shape. Three fixable paths:
   - tighten the tool definition description (now done in `prompts/system_extract_v1.md`: "For non-lab events with multiple measurements, leave `values` as null. Per-event values is single-analyte ONLY")
   - let `lib/schema.ts` zod-validate-and-drop (currently happens — drops the event with a warning rather than crashing the doc; safe interim)
   - redesign `values` to permit a free-form map for non-labs (rejected — would break `/eval` matching algorithm)

   The interim is the prompt-tightening + zod-drop combination. If H8–H9 iteration shows the model still violates after the explicit guidance, escalate to schema redesign discussion.

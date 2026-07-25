# Chronicle — Resolved Decisions (paper trail)

**Status: a living decision log — items 1-7 were locked pre-H0; items 8 and up were appended later, each as its decision was resolved.** This file is the resolved version of `OPEN-DECISIONS.md`, kept for the audit trail. PLAN.md links here for the reasoning behind decisions referenced elsewhere in the docs.

---

### 1. Hotkey for Case 3 fallback: Cmd+Shift+L

LOCKED. Mnemonic "Load cached." Unbound in Chrome and Arc on Mac. No conflict with Cmd+L (URL bar).

Implementation: bind globally on the `/eval` route only. Reloads the precomputed Case 3 cached fallback (`data/case3_eval_fallback.json`, served via `GET /api/eval/fallback`) — the presenter's escape back to the recorded run. (Since cycle 20 / §10 the live tab opens on this fallback and never auto-runs; a scored live run fires only behind the explicit confirm gate, so the hotkey is a fallback *reload*, not the old "swap on a >15s API stall".)

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

**Defensible answer if asked:** "The eval script verifies the GT blob hash against a committed lock file before it runs. The lock file is in git history. Modifying the GT after H0 is tamper-evident — you can verify by running `git log .gt_hash.lock` and checking that the lock commit (`59ca076`) predates the first recorded Case 3 measurement. Case 3 was never referenced during prompt iteration — the CHANGELOG prompt-scoring rows cite Cases 1 and 2 only."

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

---

### 9. Case 3 (Block 1 PDFs + Block 2 GT labels) deferred to H8 deadline (added 2026-05-10)

LOCKED. Pre-H0 Blocks 1 + 2 are consciously deferred. Murat may complete the labeling between now and the H8 fork, or may not. Either outcome is planned-for.

**Why deferred:** Murat is time-constrained for the focused 1.5–2 hr labeling sitting that EVAL.md "step-by-step for Murat" requires. Doing it under-resourced (split across days, half-attention) produces label drift that corrupts the metric — worse than not having it at all. Scaffolding deferred without contaminating any other work.

**Why ChatGPT-drafted labels were rejected:** considered and declined. Held-out evaluation is model-vs-human ground truth, not model-vs-model. Different model family (GPT vs Claude) doesn't fix the deeper issue — both share systematic biases about what counts as a clinical event, both miss the same kinds of subtle events, both pick weird snippet choices. A judge with NLP background will recognize that machine-vs-machine eval inflates the metric. Pure-human labeling stays the standard; if there's no time for it, deferring is more honest than substituting.

**Hard deadline:** **before H8 of the build clock.** H8 is the prompt-iteration hour. Iterating against Cases 1+2 metrics IS allowed without Case 3 locked, BUT if Case 3 is added later, the iteration was contaminated (the prompt was tuned in a world where Case 3 might have been peeked at — even if it wasn't). The honest-narration version requires Case 3 locked before any measurement is run against it, and never used in prompt iteration.

**Two paths at the H8 fork:**

- **Path A (labeling done by H8):** lock it (`git hash-object` + `chmod 444` + commit per §7), proceed with normal H8–H9 prompt iteration, demo beat 3 (`/eval` Case 3 live tab) works at H11.
- **Path B (labeling NOT done by H8):** freeze the prompt where it is. Skip H8–H9 prompt iteration entirely. Use freed time for polish. Demo becomes 3-beat (drop beat 3 — the Case 3 live narration). The `/eval` page still works, just with the Cases 1+2 cached tab only. Honest framing: *"We measured ourselves on the cases we built — here's the precision/recall."* Less compelling than the held-out story, but not dishonest.

**Code-side impact (small, deferred to H7→H8 cycle):**

`app/api/eval/route.ts` `mode=live` path needs a 5-line graceful-degrade conditional: if `held_out/case3/.gt_hash.lock` does not exist, send SSE error frame `{type:"error", code:"gt_not_present", message:"Held-out evaluation pending — Case 3 ground truth not yet locked", retryable:false}` and close the stream. Frontend renders a friendly inline message on the live tab. Add a new error code `gt_not_present` to BACKEND-STANDARDS J.1 alongside `gt_hash_mismatch` and `prompt_dirty`. This is the only code change deferral causes.

**Folder scaffold landed in this cycle:** `held_out/case3/README.md` (with deferred-status banner pointing here), `held_out/case3/ground_truth.json` (shape-stub template), `held_out/case3/docs/.gitkeep` (PDFs go here when Murat is ready).

**No other doc/code surfaces changed.** The held-out architecture was already designed for "GT might not exist yet" — this just exercises that path explicitly.

---

### 10. No further hand-labeled held-out cases — `/eval` live run gated behind explicit confirm (added 2026-07-23)

LOCKED. Owner decision (Murat): Case 3 is the **last** independently hand-labeled held-out case — there will be no Case 4. The reasoning that made Case 3 the standard (§9: held-out eval is model-vs-human, not model-vs-model; honest labeling needs a focused, drift-free sitting) also makes new held-out cases expensive to author correctly, and the methodology story is already carried by the three scored Case 3 measurements (two Sonnet 2026-05-10, one Opus 2026-07-23 — see EVAL.md §6 + README).

**The peek budget is now terminal.** The remaining **≤1 scored measurement event** on Case 3 (one event = up to 3 runs, mean±range) is the **final** confirmatory budget on Chronicle, ever. With no replacement case, an accidental scored run is unrecoverable — it permanently consumes the last held-out signal.

**Hazard closed (STATE cycle 17, issue #9).** The pre-existing `/eval` live tab **auto-ran** the Case 3 SSE extraction on route entry (`useEffect(() => start(), [])`). With a valid `ANTHROPIC_API_KEY`, **every visit to `/eval` was one Case 3 run** — a demo or casual page load could silently spend the terminal budget. (The degenerate-run guard in EVAL.md §6 only stops *empty*-key runs from persisting; a valid-key auto-run is a real measurement.)

**Resolution.** `/eval` no longer auto-runs. The live tab opens on the cached fallback (`data/case3_eval_fallback.json` via `GET /api/eval/fallback`); a scored held-out run fires only behind an explicit **two-step inline confirm gate** — step 1 "Run live extraction…", step 2 an inline confirm that states plainly it spends the final scored Case 3 measurement, with a cancel escape and no native `window.confirm`. The gate is hidden while a run streams so it cannot double-fire. Pure state logic lives in `lib/eval-gate.ts` (`nextGatePhase` + `shouldStartRun`, unit-tested in `lib/eval-gate.test.ts`), rendered by `app/eval/page.tsx`; `scripts/eval-case3.ts` remains the deliberate CLI path for a measured run. Cross-reference: **docs/EVAL.md §6** (peek budget + owner-decision note).

---

### 11. Never run blanket `npm audit fix` on this repo — targeted in-range updates only (added 2026-07-25, STATE cycle 21)

LOCKED. Derived from the issue #11 dependency audit (STATE.md cycle 21), which cut `npm audit` from 13 advisories (2 low / 4 moderate / 7 high) to **7 (0 low / 3 moderate / 4 high)** using lockfile-only bumps — `package.json` came out byte-identical.

**(a) `npm audit fix` is measured net-negative here. Do not run it.**

A blanket `npm audit fix` was tried and rejected: it takes the tree from **7 → 15 vulnerabilities (4 → 12 high)**. Bisected to a single package — `npm update brace-expansion` alone reproduces the same 7 → 15 / 4 → 12 regression by dragging eslint's minimatch chain (`@eslint/config-array`, `@eslint/eslintrc`, `eslint`, `eslint-config-next`, `eslint-plugin-{import,jsx-a11y,react}`, `minimatch`) into advisory range, while `npm update minimatch` alone is a no-op. Confirmed as **tree restructuring, not advisory-database drift**, by a clean-room control: re-auditing the *original* lockfile against the same-day advisory DB still returned exactly 13.

**Remediation procedure instead:** targeted, in-range `npm update <pkg>` only — every bump must stay inside its dependents' declared ranges, so `package.json` never needs an edit and the diff is confined to `package-lock.json`. Verify each pass with a fresh `npm audit` **and** `npm ls --all` (expect exit 0 / 0 invalid), then `npx tsc --noEmit`, `npm test`, `npm run build`. The advisory count alone is not sufficient evidence: a bump that looks in-range can still restructure shared transitive chains, which is exactly how the blanket fix regressed the tree — so re-resolve and re-audit the whole tree after every pass rather than trusting the targeted package in isolation.

**Fresh independent reinforcement (added 2026-07-25, STATE cycle 22 / issue #13).** On the bumped 16.2.11 tree, `npm audit` reports `fixAvailable: {"name":"next","version":"9.3.3","isSemVerMajor":true}` for all three next-gated advisories — npm's proposed "fix" is a **downgrade to Next 9**, seven majors back. Independent confirmation that this tool's remediation advice is not trustworthy on this repo: `npm audit` is a *reporting* surface here, never a *remediation* one.

**(b) The remaining 4 high + 3 moderate advisories are externally gated, not oversights.**

> **REFUTED IN PART (2026-07-25, STATE cycle 22 / issue #13).** The first bullet's closing claim — **"All three clear together when next moves."** — is **factually wrong**, refuted by an independent security review against the npm registry packument. `next` moved to 16.2.11 and cleared on its own; `postcss` and `sharp` did **not** move with it. The bullet is preserved verbatim below for the audit trail. **Read (b.1) at the end of this item for the corrected, registry-verified reasoning** before acting on anything in that bullet.

- **3 of the 4 highs are gated on the exact `next@16.2.6` pin.** `package.json` pins next **exactly** (`"next": "16.2.6"`, no caret), so the only fix — 16.2.11 — is outside the stated range; the surviving nested `postcss@8.4.31` lives at `node_modules/next/node_modules/postcss`, which next declares as an **exact** pin (an `overrides` entry would violate the consumer range); and `sharp` needs ≥0.35.0 while next's `optionalDependencies.sharp` is `^0.34.5` (= `>=0.34.5 <0.35.0`). **All three clear together when next moves.** The next 16.2.11 bump is therefore **its own future slice** with a real regression pass — the single highest-value dependency follow-up, and not something to smuggle into an unrelated cycle.
- **The 4th high is `brace-expansion`,** deliberately left per (a) — fixing it in isolation *is* the net-negative case above.
- **The 3 moderates (`shadcn` + `@hono/node-server` + `@modelcontextprotocol/sdk`) would need a semver-major downgrade — rejected.** The offered fix is `shadcn@3.8.3`, down from `^4.7.0`. Rejected because it is a major-version regression of a **build-time CLI**, not shipped runtime code, so the advisory exposure never reaches users of the deployed app.

Cross-reference: **STATE.md cycle 21** (per-package bump table, full deferral reasons, and verification evidence) and issue #11.

**(b.1) CORRECTION to (b), first bullet — appended 2026-07-25, STATE cycle 22, issue #13.**

The refuted claim is *"All three clear together when next moves."* **Only the first clears when next moves.**

Verified against the registry (issue #13): every stable Next.js 16.x release — all of 16.0.x, 16.1.x and 16.2.0 through `latest` = 16.2.11 — declares `dependencies.postcss` as the **exact pin `8.4.31`** (advisory range `<=8.5.17`) and `optionalDependencies.sharp` as `^0.34.x` (fix needs `>=0.35.0`). Bumping to 16.2.11 clears the 9 first-party Next.js advisories but leaves `postcss` and `sharp` untouched, so `npm audit` stays at **7 total / 4 high**. The unreleased 16.3 line clears `sharp` at `16.3.0-preview.8` (`^0.35.3`) but still ships `postcss@8.5.10`, which remains inside GHSA-6g55-p6wh-862q (`<=8.5.11`) and GHSA-r28c-9q8g-f849 (`<=8.5.17`). **`postcss` therefore has no upstream remediation path at any published `next` version and must be tracked as accepted risk, not as a pending bump.**

Two further findings from the same review, both load-bearing:

- **This is a vendored-copy problem, not a repo hygiene problem.** The repo's OWN top-level `node_modules/postcss` is already **8.5.23** — fully patched, from the cycle-21 in-range bump. The only vulnerable copy anywhere in the tree is next's private nested `node_modules/next/node_modules/postcss@8.4.31`. Nothing about our direct dependency declarations can reach it, and an `overrides` entry would violate next's exact declared pin (as (b) already noted).
- **npm's proposed fix is a downgrade to Next 9.** `npm audit` reports `fixAvailable: {"name":"next","version":"9.3.3","isSemVerMajor":true}` for all three advisories — recorded in (a) above as fresh, independent reinforcement of the never-run-`npm audit fix` rule.

**Accepted risks and their reachability basis.** Both remaining next-gated highs are accepted, not pending:

- **`postcss` (high ×2) — build-time only.** Both advisories require attacker-controlled `sourceMappingURL` comments in CSS input. The entire CSS input set of this app is one first-party file (`app/globals.css`) plus the Tailwind plugin. No postcss executes per-request in production.
- **`sharp` / libvips (high) — unreachable by CONFIGURATION.** `next.config.ts` sets no `images` config, so `remotePatterns`/`domains` are empty and `/_next/image` rejects all remote URLs; `public/` holds only SVGs, which Next does not pass to sharp (`dangerouslyAllowSVG` defaults false); and the sole upload path (`app/api/extract/route.ts`) takes PDFs and writes nothing to disk. **This acceptance rests on configuration, NOT on the absence of a `next/image` import** — the `/_next/image` endpoint is served by default regardless of whether any component imports `next/image`. **Re-evaluate if `next/image` is adopted or any raster asset lands in `public/`.** A tripwire for exactly that is wired into `scripts/screenshot-app.ts`, whose default `OUT` is `public/hero-app.png` and whose end-of-run instructions point at `next/image`.

Cross-reference: **STATE.md cycle 22** (measurement, verification evidence, and the falsified-hypothesis record), issue #13, and issue #14 (the `@emnapi` lockfile-drift recurrence risk surfaced by the same slice).

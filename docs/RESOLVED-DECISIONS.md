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

### 11. Never run blanket `npm audit fix` on this repo — targeted in-range updates only (added 2026-07-25, STATE cycle 21) — **PARTIALLY REFUTED**

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

---

### 12. A pre-registration is append-only — the original comment is never edited, amendments are new comments in sequence (added 2026-07-26, STATE cycle 25)

LOCKED. Applies to `docs/PREREG-24-blind-relabel.md` (issue #24) and to any pre-registration Chronicle writes afterwards.

**The rule.** The pre-registered text is posted as a GitHub issue comment and **is never edited after posting**. Corrections, added restrictions and scope changes are posted as **new, later-timestamped comments** on the same issue, in sequence, and appended below a `---`/`---` delimiter in the repo copy. The repo copy is verified append-only on every change: `git diff --numstat` on the file must show **zero deletions**, and the byte prefix covering all previously-posted text must still hash to its recorded value. If the comment and the repo copy ever diverge, **the comment is the record.**

**Why.** The entire value of a pre-registration is its server-assigned `created_at`. A file in the repo can be amended and force-pushed; a comment cannot be backdated, and GitHub marks edited comments. Revising in place destroys the one property that made writing it worthwhile, and it produces a document that reads as though it always said the current thing. The honest artifact is the sequence: the original still readable exactly as first posted, each amendment visibly later.

**The cost is real and is accepted.** Issue #24 now carries an original (comment `5082307494`), Amendment 1 (`5082472776`), and Amendment 2 — and **Amendment 1's bias-direction argument is wrong**, inverted in its own favor, corrected only in Amendment 2. Under this rule it stays posted uncorrected. A reader who stops at Amendment 1 gets the inverted argument. That is the price of the timestamp guarantee; the mitigation is a read-them-in-order note at the top of each amendment, and it is a weaker mitigation than an edit would be. We take that trade deliberately rather than pretending it does not exist.

**Verification recorded per amendment:** the prefix sha256 and byte count of everything already posted, the fact that `numstat` shows zero deletions, and — for #24 specifically — that `lib/eval.ts` is still `4540d12b…a09333` / 4900 bytes, because changing the ruler mid-measurement is the error docs/EVAL.md §7 documents.

---

### 13. Blind labeling has an explicit forbidden-file list, and it lives in code with a gate (added 2026-07-26, STATE cycle 25) — **MITIGATION SUPERSEDED IN PART**

LOCKED. **Tooling blindness is not protocol blindness.** `scripts/make-label-packet.ts` is blind by construction — explicit allowlist, explicit denylist, printed read ledger — and none of that stops a human labeling inside the checkout from opening the answer key in one keystroke. The protocol therefore carries its own list, aimed at the labeler rather than the generator.

**Single source of truth: `lib/label-leak-sources.ts`.** One array. Imported by `scripts/make-label-packet.ts`, which *renders* it as the packet README's numbered rule block and as the runtime `DO NOT OPEN` banner, and by `scripts/check-label-leaks.ts`, which enforces it. Nothing restates it in prose. It lives in `lib/` rather than `scripts/` for the reason `lib/eval-gate.ts` documents: `npm test` globs `lib/*.test.ts` and nothing else, so pure logic that needs unit coverage has to be there to get any (`lib/label-leak-sources.test.ts`).

**The gate: `npx tsx scripts/check-label-leaks.ts`.** Reads the 21 original Cases 1+2 ground-truth titles, greps every `git ls-files` entry for verbatim occurrences, and **exits non-zero if any hit is outside the list** — i.e. it enforces that the forbidden list is a **superset** of the hit set. It skips `held_out/**` without opening it, which is sound because `held_out/` is itself on the list, so a hit there would classify as forbidden regardless.

**Why a gate rather than a third careful reading.** The list was assembled by hand twice and each sweep missed files the next one found — the original protocol named `prompts/system_extract_v4.md` (4/21) and missed `prompts/few_shot.md` (9/21), naming the smaller leak; Amendment 1 fixed that and then missed eight more files including `app/page.tsx` (3/21, the app's main page) and `docs/CASES.md` (2/21 plus a per-document event-count and type breakdown). Two hand sweeps, two sets of misses. That is a property of hand sweeps.

**Not wired into CI, deliberately.** It gates a **protocol**, not the product; it only binds while a labeling sitting is pending; and a red required check whose meaning is "a documentation list needs a line" degrades the signal of the checks that mean "the product is broken". Its place is the pre-sitting step, run beside `make-label-packet.ts` where a failure is on point and a human is present. Revisit if the experiment is repeated on new cases — a non-blocking annotating job would carry most of the value.

> **MITIGATION SUPERSEDED IN PART (2026-07-26, STATE cycle 26 / issue #24).** The closing clause of the next paragraph — **"which is why every entry's `why` is quantified"** — describes a control that **no longer exists**. It was withdrawn the same day it was recorded: the denominator those `why` strings divided by was itself the aggregate the packet exists to withhold, and the strings are rendered into the labeler's mandatory reading. The paragraph is preserved **verbatim** below for the audit trail. **Read #14 before relying on its last sentence.** Everything else in this item — the list, its location, the gate, the not-in-CI decision, and the verbatim-only limit that same paragraph states — stands unchanged.

**Known limit, and it must not be over-claimed.** The gate matches titles **verbatim**. It cannot see paraphrase, and it cannot see **count or granularity** leaks — `[SNIPPET]` markers, `metadata.json`'s `eventCount`, `docs/CASES.md`'s per-document event tables — because those carry no title. Those leaks move the `in_scope` FN denominator, which is a confound the tooling reports but cannot remove. **A pass means "no unlisted verbatim title leak", never "no leak".** The rest is still judgement, which is why every entry's `why` is quantified: "contains some titles" is the kind of reason that invites a labeler to decide an item looks harmless.

Cross-reference: **docs/PREREG-24-blind-relabel.md** Amendment 2 §3–§4, and **#10** (held-out budget), which every script in this toolkit cites by number in its refusal path — so entry numbering in this file is load-bearing at runtime and must not be renumbered.

---

### 14. A control's arithmetic is part of its disclosure surface — #13's quantified `why` strings are withdrawn (added 2026-07-26, STATE cycle 26)

LOCKED. Supersedes the **closing clause of #13** and nothing else in it. The forbidden-file list, its single-source-of-truth location in `lib/label-leak-sources.ts`, the gate, the deliberate not-in-CI decision and the verbatim-only limit all stand exactly as #13 records them.

**The superseded claim.** #13 closes by saying the residual judgement is bounded because *"every entry's `why` is quantified"*. It is not, any more. Each `why` was written as an `N/…` title count, and **the denominator was the aggregate in-scope original event count for the two cases being relabeled** — the one quantity the packet is built to withhold.

**Why that is a leak and not a lint nit.** `scripts/make-label-packet.ts` renders those strings **verbatim** into two places a labeler cannot route around: the packet README's numbered rule block, and the `DO NOT OPEN` banner printed at handover. Rule 1 of mandatory reading therefore stated the two-case total in plain words, **with no decoding step** — and the module's own doc comment gave the per-case split, in a file the README names to the labeler. The quantification had been introduced for a good reason, one #13 states in the same sentence: *"contains some titles"* is the kind of reason that invites a labeler to decide an item looks harmless. Both things are true at once. **The warning about leaks was itself a leak.**

**What replaced it.** Every entry now ranks its leak **categorically** — COMPLETE ANSWER KEY > MOST > MANY > SEVERAL > A FEW. That keeps the entire deterrent property #13 was buying (the list still front-loads the worst entries, and no entry can degrade into a shrug) while disclosing nothing. Nothing is lost for the maintainer either, because the hand-written numbers were redundant where they sat: `scripts/check-label-leaks.ts` measures and prints the live count beside every entry on **every run**, and that copy **cannot go stale** — the hand-written one could, and silently. The editing rule that follows from this: file counts and directory counts stay permitted in a `why` (a labeler can `ls`), and **any integer derived from the labels** — event totals, per-document counts, title counts, prediction counts — does not. `lib/label-leak-sources.test.ts` enforces it rather than leaving it to the next reader's attention.

**The general lesson, which is the durable part of this entry.** The *content* of the control was audited and its *arithmetic* was not. **Any figure rendered into an artifact a blind labeler reads is part of that artifact's disclosure surface** — denominators, ratios and counts included, especially the ones that arrive as incidental scaffolding around the thing actually being checked. A denominator is a number too. The same defect appeared one level down in the same slice, where the packet's per-document provenance header printed a stripped-marker count and the markers are paired — which is what makes this a pattern worth locking rather than a one-off worth fixing.

**The gate is answer-bearing by construction, and now says so in code rather than in prose.** `scripts/check-label-leaks.ts` reads `data/cases/<case>/ground_truth.json` and prints, per file, how much of the answer key that file carries — so a mid-sitting run hands the labeler a ranked map of exactly where the answers are, through a script the packet README names to them in the course of explaining that the list is enforced. A README saying "do not run this" is half a control, because the tool it warns about had no opinion of its own. The script now **refuses to run while a sitting is in progress**, exiting non-zero **before a single title is read**, and it answers "has labeling started?" with `sittingState` in `lib/label-packet.ts` — **the same predicate as the generator's clobber guard, shared rather than reimplemented**, because two implementations of that question are two things to drift and the drift would be silent in the unsafe direction. `--sitting-over` reopens it for the legitimate run after `scripts/compare-relabel.ts`, and is declared as an operator assertion rather than a fact the script can detect.

> **COST (b) BELOW IS CLOSED (2026-07-26, later in the same cycle).** The paragraph is preserved verbatim; its closing clause — *"not fixed here, because the fix is a change to the list and to the packet"* — was right about where the fix belonged and wrong about its size. **Read the ADDENDUM under it.** Cost (a) stands unchanged.

**Two costs, recorded rather than smoothed.** (a) Under **#12**'s append-only discipline and this file's mark-never-rewrite convention, **#13's text is preserved above with its figures intact** — so the fix removed the anchor from the labeler-facing artifacts and deliberately left it in the audit trail. That is the trade those conventions exist to make, and it is only tolerable while the audit trail is not itself labeler-facing. (b) **This file is not on the forbidden list, and neither is the pre-registration** — which the packet README cites by section. Both were cleared on the ground that they quote no ground-truth *title*, and that test is precisely the one this entry exists to call insufficient. Recorded as open in **STATE.md cycle 26**; not fixed here, because the fix is a change to the list and to the packet, not to a decision record.

**ADDENDUM — cost (b) is closed, and closing it meant abandoning the SHAPE of the control, not extending it (2026-07-26, later in the same cycle).** Cost (b) files the omission as a missing line on a list. It is not. It is the third instance of one regress, each found one level further out than the last: the packet's own document header (a stripped-marker count), then the forbidden list's reason strings (an aggregate denominator — the defect this entry records), then the protocol document the packet pointed a labeler into. Every time, the enumeration was assembled, checked and posted; every time, the next reader found a file nobody had thought to name. **Adding two paths would have bought one more round.** An enumeration cannot terminate this, because absence from an enumeration reads as permission.

> **THE RULE QUOTED BELOW IS THE PRE-WIDENING TEXT (2026-07-26, STATE cycle 29 / issue #24).** The paragraph is preserved **verbatim**; what it quotes, in the present tense, is the closed default as it stood before the rule gained its published-copies clause. The pre-registration governing this sitting is posted publicly and says in prose what the packet withholds, and a list of paths cannot forbid a URL — so the default was rescoped to the DOCUMENT rather than to its location. **The current text is deliberately not restated here, because a hand copy is the thing that drifted:** it lives in `SITTING_RULE_LINES` in `lib/label-packet.ts`, still one constant rendered into both the packet README and the handover banner. That mechanism holds; the quotation below sits outside it, which is how it can claim the two *"cannot drift apart"* and be stale anyway. See **STATE.md cycle 29** for what the clause added and why. Everything else in this ADDENDUM stands unchanged — the regress it records, default-deny as the fixed point, and the demotion of the forbidden list to illustrative instances of a closed default.

**The fixed point is default-deny, and a self-contained packet is what makes it liveable rather than merely strict.** The rule the labeler now reads — one constant in `lib/label-packet.ts`, rendered into both the packet README and the generator's handover banner so the two cannot drift apart: *"During this sitting you read this packet and the case PDFs it points you to. Nothing else in this repository — no file, no directory, no document, no script, no comment — without exception, and regardless of whether it looks harmless."* The forbidden list is kept in full, ranking intact — it is a real deterrent, and it shows a labeler how ordinary a leak looks — but **demoted to illustrative instances of a closed default**: bulleted rather than numbered, stated to be incomplete, and stated not to permit anything by omitting it. **That is what terminates the regress — a document nobody thought to name is already forbidden.** It is liveable because every binding instruction is inlined in the packet, and because the packet now says that anything missing is a defect to report rather than a reason to go looking.

**This registers nothing new, which is why the pre-registration needed no amendment and received none.** The byte-locked original protocol's first bullet already reads *label in one sitting, working **only** from the packet*. Default-deny is that bullet restored, plus the one carve-out Amendment 3 §7 posted for the case PDFs. What had drifted was the **instrument**: Amendment 2 §4's mechanization turned an illustrative list into a rendered rule block that reads as the definition of "forbidden" — the same mechanization, and the same class of defect, that Amendment 3 §7 caught moving a boundary in the opposite direction.

**What that cost, recorded rather than smoothed.** Both files are now on `leakSources()` and the unit test asserting the opposite is reversed **with its reasoning replaced**, not deleted — its stated ground, *"quotes zero ground-truth titles"*, is the exact test this entry exists to call insufficient. Every pointer out of the packet is gone: the two into the pre-registration, the naming of the answer-bearing gate (which now refuses mid-sitting on its own account, so naming it to forbid it bought nothing), the list's own source module, and two pointers carrying **no path at all** — one of which told the labeler which section of a closed document holds the withheld target event count. **One pointer is irreducible and is closed in place instead:** Part A quotes the labeling protocol verbatim, that quotation carries a `[Corrected …]` marker citing a section of `docs/EVAL.md`, and editing a quotation this experiment exists to reproduce is not an option — so the packet states that the section is closed and that its own Part B is that correction in full.

Cross-reference: **docs/PREREG-24-blind-relabel.md** Amendment 3 §1–§2 (the posted, server-timestamped version of both defects) and its byte-locked Protocol section (the first bullet default-deny restores), **#12** (append-only — the reason #13 is marked rather than corrected), and **#13** itself, whose number, like every number in this file, is cited by scripts at runtime and must not change.

---

### 15. The blind packet ships no artifact derived from the marked drafts — the derived document copies are removed, not redacted further (added 2026-07-26, STATE cycle 27)

LOCKED. Supersedes the packet SHAPE assumed by **#14**'s addendum and by Amendment 3 §7 of the pre-registration — that a packet contains marker-stripped `.md` copies of the case documents alongside the permitted PDFs. It supersedes nothing else: default-deny, the single-source-of-truth forbidden list, the sitting guard, the clobber guard and the categorical `why` rule all stand exactly as #13 and #14 record them.

**The defect, in one line.** Each packet document was `authored header + marker-stripped body`. The `[SNIPPET — DO NOT EDIT]` / `[/SNIPPET]` pair is a constant **37 bytes**, and there is exactly one marked block per original ground-truth event, so `source_bytes − packet_body_bytes` is 37 × that document's original event count. Measured against the real labels: **13 of 13 documents exact, zero remainder, no near-misses.** The attacker does not need to know what the markers say — the **GCD of the 13 deltas is 37**, so the constant falls out of the deltas themselves. `source_bytes` needs no forbidden file to be opened: it is in the generator's own printed read ledger, and it is in `ls -l data/cases/<case>/source_drafts/`, which the runtime banner explicitly declined to forbid on the ground that *"listing it is not opening a file in it"*. That is true and it was not sufficient.

**Why the fix is structural rather than another redaction.** This was the **sixth** finding in one class, and rounds four, five and six are one defect: *a quantity recoverable from an artifact derived from the marked source.* The header count was removed; the closing-summary count was removed; whitespace scars were removed; byte-size rank order was checked. Each fix closed one observable and the next audit found another, because **every** observable of a derived copy — size, line count, whitespace, structure, checksum — correlates with how much was removed to make it. An enumeration of observables cannot terminate any more than an enumeration of forbidden files could, and for the same reason: the next one is always the one nobody thought to measure.

**What replaced it.** The generator no longer reads `data/cases/<case>/source_drafts/` at all — not for content, not for a listing, not for a filename. That path is now on the generator's own `DENY_PATTERNS`, so reintroducing the read exits non-zero instead of shipping quietly. There is no strip step, no document body, no per-document header and no per-document artifact of any kind. **A packet is `README.md` + `blind_labels.json`**, enumerated in `PACKET_ARTIFACTS` in `lib/label-packet.ts`; the sole writer refuses any other filename, and a stale-artifact guard refuses to regenerate into a directory that holds anything else — which is what stops an in-place regeneration from leaving a pre-2026-07-26 `docs/` of copies sitting beside a README that says no such file exists. The read ledger prints **no byte size** for any read, because a size beside a path is one term of a differential; the write ledger still does, because those artifacts are the labeler's own and there is no second copy to subtract them from. `ReadPurpose` no longer has a `packet-content` member, so "no read emits into a packet" is a property of the type rather than a promise in a comment.

**The labeler reads `data/cases/<case>/docs/*.pdf` in place, and that is a restoration.** The carve-out was already posted; what changes is that the PDFs stop being the *alternative* to a packet-local copy and become the documents. This **improves** the experiment rather than costing it: Case 3's labeler worked from PDFs under the same §5 protocol, so removing the markdown removes a second difference between the two labeling regimes in an experiment that exists to isolate one — phrasing. The premise is verified rather than assumed: `pdftotext` extracts a clean text layer from all 13 dev PDFs and finds **zero** marker lines in any of them.

**Nothing the labeler needs was lost, and the packet says so where the question arises.** The `.md` copies carried no instruction — every binding instruction is inlined in Parts A–D of the README, which is what makes default-deny liveable. What they carried was convenience (readable in an editor), and convenience is what was traded. The README now states plainly why there is no copy, so the absence reads as a decision rather than as a gap; the packet's own defect criterion — *no count, no total and no bound appears anywhere in this packet or in the generator's output; if you find one, the packet is defective* — is restated for the new shape and now holds against a differential as well as against a printed integer.

**The test family changed shape with it, which is the durable part of this entry.** The count checks that inspected a derived artifact — the per-document header integer scan, the whitespace-scar scan, and the byte-size-versus-event-count rank-order check — are **deleted, not extended.** They are replaced by a structural assertion that **no artifact in the packet is derived from `source_drafts/` at all**, checked three ways because "derived" has three failure modes: the artifact SET is closed, no artifact reproduces a line of any draft, and no artifact is named after a document (so there is no per-document pairing for a differential to be computed over in the first place). Each was verified to fail under a faithful mutation — a reintroduced copy, a copy smuggled inside a permitted artifact, and a printed marker count — rather than being assumed to work. **The general lesson: a check on a derived artifact inherits the artifact's whole disclosure surface, so the cheaper control is usually to stop deriving.**

**One consequence for the gate.** `scripts/check-label-leaks.ts` ranked every hit as `N/M`, and M is the aggregate in-scope original event count for the two cases being relabeled — the same defect #14 records about the `why` strings, one level out, in the script that *measures* the anchor. Its output is now categorical in the list's own vocabulary (COMPLETE > MOST > MANY > SEVERAL > A FEW) on both the pass and the fail path, and the aggregate is not printed anywhere. `--verbose` still prints line numbers, whose *length* is a lower bound on a per-file count; that is stated in the code rather than glossed, and it is bounded by the sitting guard, by the flag being opt-in, and by the packet not naming the script.

**Two costs, recorded rather than smoothed.** (a) **The pre-registration is owed an amendment and has not received one.** Amendment 3 §7 posted an arrangement in which the packet's `.md` copies and the PDFs are both available; this removes one of them. That is a change to a posted protocol and belongs in the append-only prereg, which this slice was scoped not to touch. **It is outstanding, not waived.** (b) The generator's read-ledger TOTAL line is gone rather than fixed: it had no consumer, and it collided with an original event total under two successive definitions of what the script reads, each time handled by carving the line out of the audit's count scan. A bookkeeping figure nobody needs is not worth a standing exception in the check that exists to catch anchors, so the ledger enumerates its reads and states no total.

Cross-reference: **#14** (a control's arithmetic is part of its disclosure surface — this is the same lesson applied to an artifact's *size* rather than to its text), **#13**, **#12** (append-only, which is why #14's figures stand above), and **docs/PREREG-24-blind-relabel.md** Amendment 3 §7, whose PDF carve-out this decision keeps and whose markdown half it withdraws.

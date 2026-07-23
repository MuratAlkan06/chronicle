# Chronicle — Build Guide

## 6. Demo flow

Refining the locked 4-beat flow with timing, narration, and the Case 3 fallback.

**Total demo length target: 3:30-4:00.** Hackathon judges have short attention; hit the wow within the first 60 seconds.

**Beat 1 — Main app, Cases 1+2 (0:00 – 1:30, ~90s)**
- Click "Load Sarah Chen, 47F — Type 2 Diabetes" preset button.
- *Narrate:* "Sarah has 18 months of records across 7 documents from 3 providers. Watch."
- Drag-drop walkthrough is *visual* — let the streaming insert play. Don't talk over the first 5 seconds of animation.
- *Narrate after first 3 events appear:* "Each card cites a specific page. Click any of them."
- Click one event card → side panel opens, PDF renders, snippet highlighted.
- *Narrate:* "Highlighted text is the verbatim source. No paraphrasing, no summarization without attribution."
- Close panel (ESC), scroll to a `concerning`-severity event, hover the axis dot to show the tooltip label.
- *Optional second case:* if pacing allows, click Maria Rodriguez preset, let it stream for ~10s. Skip if running long.

**Beat 2 — Transition (1:30 – 1:45, ~15s)**
- *Narrate:* "Patient cases are easy to organize. Holding ourselves accountable on a case we haven't seen — that's harder. Here's how we know it works."
- Click footer link "View evaluation metrics."

**Beat 3 — /eval page, Case 3 LIVE (1:45 – 3:30, ~105s)**
- Page mounts on Case 3 tab. Extraction starts immediately on route entry.
- *Narrate while doc badges stream in:* "David Park, 38M — chronic low back pain, 5 providers, 8 documents. The model is seeing these PDFs for the first time. Case 3 was never used in prompt iteration — its ground-truth labels were authored and hash-locked before the model was ever run against it."
- Numbers populate. Don't read every number — point at the strict precision card.
- *Narrate:* "Strict tier: exact event type, exact date. Loose tier: ±3 days, same event type. We measure both because patient timelines aren't medical-record timelines — patients describe dates fuzzily."
- *Narrate at the breakdown table:* "Per-event-type: labs and imaging are easy because they have explicit dates. Visits and referrals are where ambiguity lives — that's where the loose tier matters."
- Expand the methodology `<details>` for ~5 seconds, just to show the prompt-hash + the held-out claim line (Case 3 never used in iteration; GT locked before any Case 3 measurement).

**Beat 4 — Close (3:30 – 4:00, ~30s)**
- Click browser back to `/app`. Sarah's timeline still visible.
- *Narrate:* "30 documents, 5 doctors, no throughline. Chronicle is the throughline."
- Pause. Stop talking. Let the timeline be the last image.

**Hotkey for Case 3 fallback:** `Cmd+Shift+L` (mnemonic: "Load cached"). Listener mounted on the `/eval` page only. Pressing it during beat 3 swaps the live stream out and renders the precomputed `data/case3_eval_fallback.json` with the same animation. Trigger condition: if the doc badge counter hasn't incremented for 15 seconds, or if you see a red error toast. Practice this hotkey twice during H11.

**Narrative pivot at beat 4.** "Throughline" is the close because it inverts the framing: the demo opened with cards (the noun), it closes with the line connecting them (the verb). Don't over-explain. Judges who got it got it; judges who didn't won't be convinced by another sentence.

---

## 7. Hour-by-hour plan

**Markers:**
- `[CLAUDE CODE]` — Claude Code does this autonomously. The actual prompt to give it is in quotes.
- `[MURAT]` — You do this. Step-by-step instructions follow.
- `[CHECKPOINT]` — Stop. Review output. Decide proceed / fallback / cut.

---

### Hour H-N (Pre-build, before clock starts) — ~6-8 hr of Murat work, do BEFORE H0

Critical: Case 3 PDFs and ground truth come FIRST. Cases 1+2 PDFs come SECOND. Few-shot examples come from Cases 1+2 only. Order matters for held-out hygiene.

**[MURAT] Block 1 (~2 hr): Write Case 3 PDFs.**
- David Park, 38M, chronic low back pain across 5 providers, ~8 docs, 6 months.
- Document mix: 1 PCP initial visit, 1 ortho referral, 1 ortho consult, 1 MRI report, 1 PT note, 1 pain mgmt referral, 1 pain mgmt consult, 1 PCP follow-up.
- Per-doc requirements (Q22): ≥2 medical abbreviations, 1 date format inconsistency (mix MM/DD/YYYY, DD-MMM-YYYY, "March 15, 2024"), 1 cross-doc contradiction (e.g., MRI report mentions L4-L5; ortho note refers to L5-S1 disc).
- Save as PDFs in `held_out/case3/docs/`. Use realistic templates — Word + export to PDF is fine.

**[MURAT] Block 2 (~1.5-2 hr): Write Case 3 ground-truth labels.**
- Open `held_out/case3/ground_truth.json` in your editor.
- Follow the step-by-step in [EVAL.md](EVAL.md) ("step-by-step for Murat — writing Case 3 ground-truth labels"). Read it fully first.
- After labeling: hash-lock + chmod 444 + commit (3 commands; see EVAL.md "Quality checklist" for exact incantation per resolved decision #7). Do not look at it again until H11.

**[MURAT] Block 3 (~2 hr): Write Case 1 + Case 2 PDFs.**
- Sarah Chen, 47F, T2D progression, 18 mo, 7 docs.
- Maria Rodriguez, 52F, mammogram → biopsy benign, 3 mo, 6 docs.
- Same per-doc requirements as Case 3.
- Save under `data/cases/case1/docs/` and `data/cases/case2/docs/`.

**[MURAT] Block 4 (~1 hr): Few-shot examples.**
- Open `prompts/few_shot.md`.
- Build 2-3 examples per the placeholder structure in [extraction-prompt-v1.md](extraction-prompt-v1.md). Cases 1+2 ONLY. Never Case 3.

**[MURAT] Block 5 (~30 min): API keys + verification.**
- Get Anthropic API key (you have credits).
- Get Voyage AI API key (or stage OpenAI fallback key).
- Get Gemini API key (free tier ok for hackathon).
- Verify Anthropic Citations + PDF API surface against docs.claude.com (5-min check, three URLs in [extraction-prompt-v1.md](extraction-prompt-v1.md)).
- Run a single curl test against Sonnet 4.6 with one real Case 1 PDF — verify response shape includes citations attached to text blocks. **This is the single highest-risk verification.** If the response shape differs from what [extraction-prompt-v1.md](extraction-prompt-v1.md) assumes, adjust `lib/claude.ts` parsing accordingly — but do this fix before H0, not during.

**[MURAT] Block 6 (~30 min): Repo init + lockfiles.**
- `npx create-next-app@latest . --typescript --tailwind --eslint --app --no-src-dir --no-turbopack --use-npm --import-alias "@/*"` (installs in current dir — the project root IS chronicle). (As-built: Next 16.2.6, React 19.2.4, Tailwind v4, ESLint 9.)
- Install: `npm i @anthropic-ai/sdk react-pdf react-dropzone framer-motion zod lucide-react`.
- `npx shadcn@latest init` then `npx shadcn add button card dialog sheet badge separator scroll-area`.
- Copy `pdf.worker.min.mjs` from `node_modules/pdfjs-dist/build/` to `public/` (pdfjs-dist 5.x ships the worker as ESM).
- Commit. This is your H0 starting point.

**[MURAT] Block 7 (~30 min): Color tokens (Tailwind v4 — CSS-based config).**
- Severity colors per the locked palette in [docs/FRONTEND-STANDARDS.md](FRONTEND-STANDARDS.md) §H.1 are installed in `app/globals.css` under the `@theme inline` block as `--color-sev-info: #6B7280;`, `--color-sev-monitor: #D97706;`, `--color-sev-concerning: #DC2626;`, `--color-sev-urgent: #991B1B;` (Tailwind v4 has no JS/TS config file; tokens live in CSS). Colorblind fallback: if concerning and urgent collapse under deuteranopia/protanopia simulation, swap urgent only to `#7F1D1D`. The earlier stone/amber/orange/red Tailwind-keyword palette is superseded — see [docs/RESOLVED-DECISIONS.md](RESOLVED-DECISIONS.md) #3 for history.
- Decide event-type icons (Lucide): lab=FlaskConical, imaging=ScanLine, visit=Stethoscope, diagnosis=ClipboardList, medication=Pill, procedure=Activity, referral=ArrowRightLeft.

---

### H0 → H1 — Foundation + extraction route skeleton (1 hr)

**[CLAUDE CODE] (~40 min)** — Prompt to give Claude Code:
> "Read `prompts/system_extract_v1.md`, `prompts/few_shot.md`, and the locked schema in `lib/schema.ts` (which I'll create now per the JSON schema in the build plan). Implement: (1) `lib/schema.ts` with zod schemas + TS types for Event, Citation, SSE event shapes; (2) `lib/claude.ts` with `extractDoc(pdfBuffer, docId, filename): Promise<Event[]>` — uses Anthropic SDK, sends document block + Citations enabled + emit_events tool, parses tool_use input + matches text-block citations to events by id-prefix in the snippet text block; (3) `lib/sse.ts` with `sseEvent(type, payload)` and `createSseStream()` helpers; (4) `app/api/extract/route.ts` that accepts FormData, calls extractDoc per file in Promise.all, enqueues SSE frames as each completes. No UI yet."

**[MURAT] (~15 min)** — Create `lib/schema.ts` skeleton with the Event type from the locked schema (give it as input to Claude Code above). Add `.env.local` with API keys. Run `next dev` to confirm it boots.

**[CHECKPOINT H1]** — Send a single Case 1 PDF via curl multipart to `/api/extract`, watch SSE frames in terminal. Acceptance: at least one event with a non-empty snippet returns. If extraction returns 0 events, debug prompt — this is the only place where verifying citations attach correctly to text blocks matters. Fail mode: if API surface differs from assumption, fix `lib/claude.ts` parser only — prompt is fine.

**Shipped at H1:** working `/api/extract` endpoint, schema lib, SSE plumbing. No UI.

---

### H1 → H2 — shadcn + Tailwind shell + dropzone (1 hr)

**[MURAT] (~20 min)** — shadcn first per the learning sequence in [ARCHITECTURE.md](ARCHITECTURE.md).
- Open the shadcn-installed components in `components/ui/`. Read `button.tsx`, `card.tsx`, `sheet.tsx`. The Tailwind classes ARE your tutorial.
- Skim shadcn docs for `Sheet` (the side panel) and `Card` (event cards).

**[CLAUDE CODE] (~30 min)**:
> "Build `app/app/page.tsx` and `components/dropzone.tsx`. Layout: a centered max-w-4xl column with a header (logo + 'Chronicle' wordmark + persistent disclaimer footer text), three preset buttons ('Sarah Chen', 'Maria Rodriguez', 'David Park'), and a dropzone underneath. The dropzone uses react-dropzone, accepts only application/pdf, multiple files. On drop or preset click, call `/api/extract` (FormData for drop, JSON for preset) and pipe the SSE response through `useExtractionStream()` (a useReducer hook to be created in `lib/use-extraction-stream.ts`). For now, render the events as a plain bullet list — no timeline yet. Mount `components/disclaimer-footer.tsx` and `components/splash-disclaimer.tsx` (one-time on first case load via localStorage flag). Note: `app/page.tsx` (landing at `/`) is built by the frontend session in parallel per docs/FRONTEND-STANDARDS.md §I — do not touch it from this hour."

**[CHECKPOINT H2]** — Drop a Case 1 PDF → events appear as a bullet list, streaming. If streaming shows all events at once instead of incrementally, the SSE reader isn't flushing; fix `useExtractionStream` to use `getReader().read()` loop with `TextDecoder` per chunk.

**Shipped at H2:** end-to-end live extraction visible in browser as a list. shadcn shell up. Disclaimer footer + splash mounted.

---

### H2 → H3 — Click-to-source spike (PDF viewer, static event) (1 hr)

**[MURAT] (~10 min)** — Pick ONE event from a Case 1 extraction at H2, copy its `source` field. Hardcode it for the spike.

**[CLAUDE CODE] (~50 min)**:
> "Build `components/pdf-viewer.tsx` and `lib/normalize.ts` and `lib/match.ts` and `components/side-panel.tsx`. Wire `app/app/page.tsx` to open the side panel on click of a (still-bullet) event. PdfViewer takes `{file, page, highlightSnippet}`. Use react-pdf with text-layer enabled. On `onRenderTextLayerSuccess`, run the sliding-window snippet-match algorithm against normalized text: collect text-layer spans, for each consecutive sequence of N spans (N from 5 to 30), check if normalize(joined) contains normalize(snippet). If match: wrap matched spans in <mark> with bg-yellow-200 and scrollIntoView. If no match after exhausting windows: render top-of-page yellow banner with snippet text and scrollTo(0)."

**[CHECKPOINT H3 — HARD KILL GATE coming at H4, prep for it]** — Click the spike event. Side panel opens, PDF renders, snippet highlighted (or banner shown). Accept either outcome — both code paths are required behavior. Fail mode: if react-pdf doesn't render at all (worker path issue), fix immediately — this is the wedge feature; without it, the demo loses the wow moment.

**Shipped at H3:** click-to-source works on hardcoded event. PDF viewer + highlight overlay + fallback banner all functional.

---

### H3 → H4 — Timeline shell + spike Framer Motion on static fixture (1 hr)

**[MURAT] (~10 min)** — Spend 10 min on Framer Motion docs, ONLY the `<AnimatePresence>` and `layout` pages. Bound the surface.

**[CLAUDE CODE] (~50 min)**:
> "Build `components/timeline.tsx` and `components/event-card.tsx`. Timeline: vertical center axis (a 2px stone-300 line with 12px circular dots positioned by event date), cards alternate left/right of axis (even index left, odd right), card width ~360px with 4px left-edge severity-color bar and event-type icon. AnimatePresence wraps the card list; each motion.div has `layout`, `initial={{opacity:0, x: side==='left'?-12:12}}`, `animate={{opacity:1, x:0}}`, `transition={{duration:0.4, ease:'easeOut'}}`. Use a STATIC events fixture for now — load `data/cases/case1/events.json.fixture` (a hand-crafted JSON file Murat will provide with 5 events). Don't wire SSE yet. Card click → side panel with PDF viewer."

**[MURAT] (provide fixture, ~5 min during the above)** — Hand-write a 5-event fixture from Case 1 just for the spike. Save as `data/cases/case1/events.json.fixture` (`.fixture` suffix so it doesn't collide with the precomputed file later).

**[CHECKPOINT H4 — HARD KILL GATE]** — Per Murat's gate: **timeline doesn't render real API output → cut multi-doc.** What "render real API output" means here: connect SSE events to the timeline (next hour), but BEFORE leaving H4 confirm the static fixture renders correctly with alternating sides, severity bars, and at least 3 cards visible without overlap. If timeline rendering itself is broken at H4 (cards overlapping, axis misaligned), simplify to a single-column non-alternating layout — that's still presentable.

**Shipped at H4:** static timeline renders. Animation works on initial mount. Click → side panel. Multi-doc decision deferred to H5.

---

### H4 → H5 — Wire SSE to timeline (real-time stream-in) (1 hr)

**[CLAUDE CODE] (~45 min)**:
> "Replace the static fixture in `app/app/page.tsx` with the live SSE stream from H2. The reducer in `useExtractionStream` upserts events into a date-sorted array; the timeline re-renders. Because the events array changes between renders, AnimatePresence + layout will animate the insertion of each new card into its chronological position. Add the per-doc-error inline UI: when an SSE `doc_error` arrives, render a small red ✗ row at the top of the timeline with the filename and 'skipped — see details' link (the link opens a tiny shadcn Dialog with the error message)."

**[MURAT] (~15 min)** — Drop a real Case 1 batch (all 7 PDFs). Watch the stream-in. Take a screen recording (you'll want this for the demo even if rehearsal doesn't show issues).

**[CHECKPOINT H5]** — Multi-doc parallel extraction visible as cards stream into chronological position. If the layout animation is causing flicker or mid-position jumps, this is the hour to detect. If broken: prepare for H6 fallback ("snap-in with fade"). Acceptance: at least 4-5 events from 2+ docs render with visible animation.

**Shipped at H5:** end-to-end live demo of Case 1 from drop to fully-rendered animated timeline.

---

### H5 → H6 — Side panel polish + severity colors + click-to-source on real events (1 hr)

**[CLAUDE CODE] (~40 min)**:
> "Polish the side panel: header shows severity badge with TEXT label (e.g., 'Severity: Monitor — discuss with provider'), event title, date with confidence-aware formatting (`Mar 15, 2024` exact, `~Mar 2024` italic for approximate, `Mar 2024 (inferred)` italic stone-500 for inferred), provider line if present, summary, then PDF viewer below. Apply the four severity colors to axis dots and 4px card-edge bars. Add hover tooltip on axis dot showing severity text label (Radix tooltip ships with shadcn). Wire ESC and click-outside to close."

**[MURAT] (~15 min)** — Test click-to-source on 8-10 different real events across both Cases 1 and 2. Track snippet-pinpoint success rate by hand. Target: ≥80% pinpoint success.

**[CHECKPOINT H6 — HARD KILL GATE]** — Per Murat's gate: **click-to-source broken → fallback to inline event expansion.** "Broken" means: PDF viewer crashes, OR pinpoint success <40% AND the fallback banner doesn't render either. If both code paths fail, cut the side panel entirely and replace card click with inline accordion expansion showing the snippet text only (no PDF). This is a real loss but preserves the demo. Decide and execute the cut WITHIN this hour if needed, not later.

**Shipped at H6:** demo-quality side panel + severity styling + real click-to-source. Wedge feature complete.

---

### H6 → H7 — Patient explainer (Gemini Flash) + pre-extract Cases 1+2 (1 hr)

**[CLAUDE CODE] parallel track A (~30 min)**:
> "Build `lib/gemini.ts` with a streaming explainer: `explainEvent(event): AsyncIterable<string>`. System prompt: 'You are explaining a single medical timeline event to a patient. 2-3 sentences, define abbreviations, no recommendations, no use of the word should.' Build `app/api/explain/route.ts` to stream tokens via SSE. Add an 'Explain in plain language' button to the side panel; on click, append streamed text to a card below the summary."

**[CLAUDE CODE] parallel track B (~25 min)**:
> "Build `scripts/extract-case.ts` (CLI, tsx-runnable). Usage: `tsx scripts/extract-case.ts case1` reads `data/cases/case1/docs/*.pdf`, runs `extractDoc` against each, writes `data/cases/case1/events.json` and `data/cases/case1/metadata.json`. Build `app/api/cases/[id]/events/route.ts` that returns the precomputed events.json. Modify `app/app/page.tsx` so preset buttons hit `/api/cases/case1/events` (mode=cached) and replay the events into the timeline with a 1.5s artificial delay per simulated 'doc complete' batch (group events by document_id, emit one batch per doc on a 1.5s interval)."

**[MURAT] (~5 min)** — Run `tsx scripts/extract-case.ts case1` and `case2`. Verify the resulting `events.json` files look reasonable.

**[CHECKPOINT H7 — Q26 fallback decision]** — If Gemini integration is fighting (auth issue, streaming format mismatch, content filtering on medical content), swap to Haiku 4.5 immediately. Add a one-line README footnote explaining the substitution. **Time-box this decision to 10 min** — do not burn an hour on Gemini.

**Shipped at H7:** patient explainer working. Cases 1+2 served from precomputed events.json with feel delay. Demo-side flow now functions for the entire `/app` surface.

---

### H7 → H8 — /eval page + eval matching algorithm (1 hr)

**[CLAUDE CODE] (~50 min)**:
> "Build `lib/eval.ts` with the `evaluate(predicted, gt, tier)` function exactly as specified in the [EVAL.md](EVAL.md) pseudocode. Build `app/api/eval/route.ts` supporting both `mode=cached` (returns JSON for Cases 1+2 from precomputed reports) and `mode=live` (SSE-streams Case 3 extraction + metrics). For mode=live: FIRST verify the GT integrity hash-lock — read `held_out/case3/.gt_hash.lock`, compute `git hash-object held_out/case3/ground_truth.json`, compare; on mismatch send a single SSE error frame `{type:'error', code:'gt_hash_mismatch'}` and close. THEN write `held_out/case3/prompt_hash.txt` from current git hash of the active prompt file, fail loudly if `prompts/` has uncommitted changes. Build `app/eval/page.tsx` with two tabs (Cases 1+2 cached / Case 3 live), the live tab is default. Render: doc-streaming strip, two metric cards (strict + loose), per-event-type breakdown table, methodology `<details>`, footer with prompt version + timestamp. Add a Cmd+Shift+L hotkey listener that swaps to `data/case3_eval_fallback.json`. Build `app/components/disclaimer-footer.tsx` to include a 'View evaluation metrics' link to /eval."

**[MURAT] (~10 min)** — Run `tsx scripts/eval-train.ts case1` and `case2` to generate the cached reports for tab 1. (This script needs to be created — give it to Claude Code as part of the above.)

**[CHECKPOINT H8 — HARD KILL GATE]** — Per Murat's gate: **animations buggy → strip animation library, CSS only.** This gate applies broadly, not just to /eval. If at H8 you see any of: layout-thrashing during stream-in, cards mid-position-jumping during animation, axis misalignment when cards animate — strip Framer Motion. Replace `motion.div` + `<AnimatePresence>` with plain `<div>` and a CSS `@keyframes fade-slide-in` on `.card-enter` className applied for the first 400ms after mount. Loss: layout transitions disappear (cards just appear in place). Demo still works.

**Shipped at H8:** /eval page renders cached Cases 1+2 metrics + can run Case 3 live (but you do NOT actually run Case 3 yet — Case 3 stays untouched until H11).

---

### H8 → H9 — Prompt iteration on Cases 1+2 (1 hr)

**[MURAT]** — This is YOUR hour. No Claude Code on the prompt itself. Follow the discipline in [EVAL.md](EVAL.md) ("step-by-step for Murat — prompt iteration discipline").

**Step-by-step:**
1. Open `prompts/system_extract_v1.md` and `data/eval_reports/case1.json`, `case2.json` (from H8).
2. Look at the lowest metric. If strict precision low → model is hallucinating events. If strict recall low → model is missing events. If loose-vs-strict gap large → date assignment is the issue.
3. Identify ONE category of failure (e.g., "model is collapsing two distinct visits into one event because they share a date"). Make ONE targeted prompt change.
4. Save as `prompts/system_extract_v2.md`. Update `lib/prompt-config.ts` to point to v2.
5. `tsx scripts/eval-train.ts case1 case2`. Append result to `prompts/CHANGELOG.md`.
6. Repeat. Stop conditions per [EVAL.md](EVAL.md): 3 versions <2pt movement, 60 min elapsed, OR P/R both ≥0.85.
7. **At end of hour: prompt freeze.** Note the active version. Commit. Do NOT touch the prompt file again until post-demo.

**[CHECKPOINT H9]** — Active prompt frozen. Cases 1+2 metrics meet target (strict P/R both ≥0.7 minimum; ≥0.85 ideal). Prompt git hash logged.

**Shipped at H9:** locked prompt + per-version CHANGELOG.

---

### H9 → H10 — Related events (Voyage embeddings) + animation polish (1 hr)

**[CLAUDE CODE] (~45 min)**:
> "Build `lib/voyage.ts` with `embed(texts: string[]): Promise<number[][]>` calling Voyage voyage-3 via HTTP. Add OpenAI `text-embedding-3-small` fallback if Voyage returns 401/429. Build `app/api/related/route.ts`: takes an event + candidate list, embeds title+summary for each, computes cosine, returns top-3 with score ≥0.55. In the side panel, when an event is opened, fire `/api/related` and render a 'Related events' section with up-to-3 small clickable mini-cards. Click → switches the side-panel content to the related event."

**[MURAT] (~10 min)** — Visual polish pass on Cases 1+2 demo flow. Run through end-to-end. Take notes on any glitches. **Includes 30-sec colorblind sim check** (per [FRONTEND-STANDARDS.md](FRONTEND-STANDARDS.md) §H.1, supersedes resolved decision #3): Chrome DevTools → Rendering panel → Emulate vision deficiencies → Deuteranopia, then Protanopia. **Verify that concerning `#DC2626` (red) and urgent `#991B1B` (dark red) remain distinguishable** — both are reds in the new palette, so this is the failure mode to watch for. If they collapse, **adjust urgent only** (e.g., `#7F1D1D` for more lightness gap). Do not touch info, monitor, or concerning.

**[CHECKPOINT H10 — HARD KILL GATE — Tier 1 cut order]** — Per Q23, the cut order from FIRST-to-drop is:
1. **related-events embeddings** — if not working at H10, cut entirely. Remove the Related section from side panel. ~5 min cut.
2. **filter chips** — were never built, no cut needed (drop from any leftover plans).
3. **color-coding refinement** — if severity colors look ugly but functional, leave as-is.
4. **Gemini patient explainer** — if buggy, hide the button. Demo still works.
5. **animation polish** — if any timing feels off, leave as-is. Don't tune further.

If Tier 1 (related) is broken: cut and move on. If Tier 1 works but other items are broken: cut from the order above. The remaining 60-90 min from H10-H11 is **freeze features, polish only.**

**Shipped at H10:** demo-complete app or demo-complete-minus-related app. NO new features after this hour.

---

### H10 → H11 — Polish + run Case 3 live (the moment of truth) (1 hr)

**[MURAT] (~20 min)** — Polish pass:
- Disclaimer footer text exact and visible.
- Splash disclaimer one-time on first case load works.
- Hotkey Cmd+Shift+L tested twice on /eval page.
- All preset buttons load.
- 1.5s feel delay reads as "thinking" not as "lag" (tweak between 1.0-2.0s if needed).

**[MURAT] (~30 min) — RUN CASE 3 LIVE for the first time.**
- Start the dev server. Navigate to `/eval`.
- Watch the live extraction. Watch the metrics populate.
- **Whatever the numbers are, they are the numbers.** Do not tune the prompt now. The held-out integrity is the artifact.
- If strict P or R is below 0.5: **escape hatch decision.** Swap `lib/claude.ts` to use Opus 4.7 instead of Sonnet 4.6 (one-line model string change). Re-run. The $100 reserved budget covers ~1500 doc extractions; one re-run is trivial. If Opus also disappoints, that's the metric you ship — be honest in narration ("strict matching is conservative; loose tier shows real coverage").
- Save the final live result to `data/case3_eval_fallback.json` as the hotkey backup.
- Commit everything.

**[CHECKPOINT H11 — HARD KILL GATE]** — Per Murat's gate: **end-to-end demo testing only, no new code.** This is enforced.

**[MURAT] (~10 min)** — End-to-end demo rehearsal. Time it. Target 3:30-4:00. Practice the narration in the Demo flow section above.

**Demo rehearsal checklist (run through each):**
- [ ] Dev server starts cleanly with no console errors visible to anyone screen-sharing
- [ ] Browser tab title reads "Chronicle" (not the create-next-app default)
- [ ] All 3 preset buttons load when clicked
- [ ] First-load splash disclaimer appears once, dismisses cleanly, doesn't re-appear on subsequent case loads
- [ ] Disclaimer footer text is visible and readable on every screen including `/eval`
- [ ] Drag-drop works for at least one ad-hoc PDF (the judge's-PDF moment, optional but de-risks)
- [ ] Streaming insertion animation plays smoothly for Cases 1 + 2 (no flicker, no mid-position jumps, no card overlap during animation)
- [ ] Click 3 random event cards → side panel opens, PDF page-jumps to the right page, snippet highlighted with `<mark>` (or top-of-page banner fallback rendered visibly)
- [ ] Side panel closes on X, ESC, and click-outside
- [ ] Severity colors visually distinct under Chrome DevTools → Rendering → Emulate vision deficiencies → Deuteranopia, then Protanopia (verifies the locked palette in [FRONTEND-STANDARDS.md](FRONTEND-STANDARDS.md) §H.1; specifically that concerning `#DC2626` and urgent `#991B1B` — both reds — remain distinguishable; swap urgent only to `#7F1D1D` if they collapse)
- [ ] Footer "View evaluation metrics" link navigates to `/eval`
- [ ] On `/eval`: GT integrity hash check passes silently (no error frame), prompt-hash log writes, extraction starts automatically on route entry, doc badges stream in, metrics populate, breakdown table renders
- [ ] Cmd+Shift+L hotkey triggers cached fallback on `/eval` (test deliberately, then refresh to confirm live mode also works)
- [ ] Methodology `<details>` section expands and shows prompt-version git hash
- [ ] Total demo time is in the 3:30-4:00 window
- [ ] Practice the narration aloud (not just in your head — saying it surfaces awkward phrasing)
- [ ] Landing page at `/` loads cleanly when typed manually (not part of the demo flow, but the Devpost/portfolio audience will hit it — verify hero renders, sections 2-5 scroll, "Get started" CTA routes to `/app`, footer attribution shows correct GitHub handle)
- [ ] Real `/app` screenshot has been swapped into the landing hero (per FRONTEND-STANDARDS.md §I — no `placeholder-hero.png` left in production)
- [ ] Yellow snippet-highlight pulse on the landing hero plays on a smooth loop (or is correctly suppressed under `prefers-reduced-motion`)

**Shipped at H11:** demo-ready build, Case 3 live result captured, fallback file saved, rehearsed once.

---

### H11 → H12 — Buffer + 2nd rehearsal + sleep cushion (1 hr)

**[MURAT]** — Buffer hour. Use for:
- 2nd full rehearsal (1× with hotkey practice).
- Final disclaimer text review.
- README write: "Demo instructions, model swap notes per Q26, eval methodology summary."
- If everything works: stop early. Sleep cushion is more valuable than additional polish.

**Shipped at H12:** demo-ready. Sleep.

---

## 8. Risk register — top 5

Hard-kill criteria at H4/H6/H8/H10/H11 are already mitigated. These are **new** risks not covered by those gates.

**Risk 1: Citations API doesn't return cited_text in the shape we expect for medical PDFs.**
- *Trigger:* H0 first extraction returns events but `source.snippet` is empty / wrong / unattachable to events.
- *Likelihood:* Medium. The hybrid text-block + tool_use pattern is robust on paper but Anthropic's citation behavior can be sensitive to model temperature, content type, and exact prompting.
- *Blast radius:* Wedge feature (click-to-source highlight) is dead. Demo collapses to "look at this nice list."
- *Mitigation:* (a) **Pre-H0 verification** with one real Case 1 PDF via curl — single highest-priority pre-build task (Block 5 of pre-H0). (b) If verification reveals citations attach differently than assumed, the fix is in `lib/claude.ts` parsing, not the prompt — bound the fix to ≤30 min. (c) Worst-case fallback: ask the model to emit the snippet INSIDE the tool_use input (no citation API at all), and trust the model's verbatim claim — verifier pinpoint match in `lib/match.ts` becomes the only enforcement. Loss: less credibility, but still functional.

**Risk 2: Streaming SSE + Framer layout animation jank when 15+ events arrive in a 5-second window.**
- *Trigger:* H5 with full Case 1 batch — observable as cards mid-position-jumping or layout-thrashing.
- *Likelihood:* Medium-high. `layout` animation re-measures DOM on every list mutation; with rapid SSE arrivals, React batches updates and layout calculations can collide.
- *Blast radius:* Demo's hero animation looks broken in the most-watched moment.
- *Mitigation:* (a) **Throttle SSE consumer** in `useExtractionStream` to flush at most 1 event per 150ms via a setTimeout-debounced reducer dispatch. Smooths the visual flow regardless of how fast events arrive. (b) The H8 hard-kill gate strips Framer entirely if needed — that's the floor. (c) Pre-stage: in `next.config.ts` enable `reactStrictMode: false` for the demo (StrictMode double-renders amplify Framer measurement issues; the trade-off is acceptable for a demo).

**Risk 3: Sonnet 4.6 strict-match precision on Case 3 is below 0.5 AND Opus 4.7 also disappoints.**
- *Trigger:* H11 live run shows poor numbers, escape hatch model swap doesn't recover them.
- *Likelihood:* Low-medium. The strict tier is genuinely strict (exact date + 0.5 token-overlap); the loose tier is your safety net.
- *Blast radius:* Eval page's headline number undermines the credibility narrative.
- *Mitigation:* (a) **Lead the narration with loose tier** at beat 3 if strict is poor — "Strict is precision-conservative; loose tier is the realistic patient-facing measure." This is honest framing, not spin. (b) Make sure per-event-type breakdown is rendered prominently — labs and imaging tend to be precise; the average gets dragged down by visit/referral ambiguity. Show the breakdown so judges see where the conservatism comes from. (c) **The methodology blurb is the real artifact.** "We labeled Case 3 independently and locked it before the model ever ran on it" is what wins; the exact P/R number matters less than the discipline. Double-down on the methodology framing in the demo if numbers underperform.

**Risk 4: Prompt caching cache_control misplaced → cost blowout during H8-H9 iteration.**
- *Trigger:* You iterate the prompt 20+ times during H9 and notice the API spend climbing fast.
- *Likelihood:* Medium. The cache_control marker placement is finicky — putting it inside the document block, or after the user template, silently disables caching.
- *Blast radius:* You burn through credits faster than expected. Unlikely to derail demo (you have $750 of $50 budgeted), but it's a teaching moment risk.
- *Mitigation:* (a) **Verify cache hits in API response.** Anthropic responses include `usage.cache_read_input_tokens` and `usage.cache_creation_input_tokens`. Log these in `lib/claude.ts` on every call, surface to console. After your 2nd or 3rd extraction, cache_read should be 80%+ of system+few-shot tokens. If it's 0, your cache_control is wrong. (b) Place the cache_control marker EXACTLY where [extraction-prompt-v1.md](extraction-prompt-v1.md) says: on the last element of the `system` array, on the few-shot block. Do not put one on the document block. (c) Worst case: caching just doesn't save cost. You're still well within budget at $750.

**Risk 5: Voyage / Gemini API key procurement friction at H7.**
- *Trigger:* You sit down at H7 and discover you need to verify a phone number, top up a balance, wait for email confirmation.
- *Likelihood:* Medium. Voyage AI and Google Cloud both have onboarding friction.
- *Blast radius:* H7 hour wasted. Patient explainer + related events both depend on these. Per cut order (Q23), related is first to cut and explainer is fourth — so this risk is partially absorbed.
- *Mitigation:* (a) **Get keys pre-H0** during Block 5 of the pre-build phase. If a key isn't in hand at H0, plan around its absence — don't bet on getting it during the build. (b) For Voyage, OpenAI `text-embedding-3-small` is the locked fallback (Q3) — keep an OpenAI key staged. (c) For Gemini, Haiku 4.5 fallback is locked (Q26) — Haiku uses the same Anthropic key you already have. Defaulting to Haiku is a 5-min change.

---


# Chronicle — Plan

Solo hackathon, ~12 hr focused build, Mac M4 Pro, local-only demo. Single Next.js TS app. Claude Sonnet 4.6 + Citations API + Voyage embeddings + Haiku/Gemini explainer. **Wedge:** UX fidelity (animated streaming timeline + click-to-source highlight) is the wow-moment; `/eval` is the supporting credibility surface, not the headline.

This file is the index + the canonical locked decision register. Operational deliverables are split into `docs/`.

---

## Where to look

| When you need... | Open |
|---|---|
| Project orientation, file map, "what is this" summary, local dev one-liner | [README.md](README.md) |
| Short project framing (read at session start) | [BRIEF.md](BRIEF.md) |
| Locked event JSON shape + tool definition + zod/TS types | [schema.md](schema.md) |
| API endpoint signatures (request / response / SSE event shapes) | [API.md](API.md) |
| Mock fixtures (Cases 1+2 full, Case 3 shape-mock) for frontend session | [MOCK_DATA.md](MOCK_DATA.md) |
| Cross-session sync log (read at cycle start, append at cycle end) | [STATE.md](STATE.md) |
| Frontend standards (aesthetic, tooling, animation, landing spec) | [docs/FRONTEND-STANDARDS.md](docs/FRONTEND-STANDARDS.md) |
| Backend standards (response shape, error envelope, streaming protocol) | [docs/BACKEND-STANDARDS.md](docs/BACKEND-STANDARDS.md) |
| The 3 patient cases — narrative arcs, doc mix, abbreviation list, contradiction examples, file naming, sanity-check questions | [docs/CASES.md](docs/CASES.md) |
| Stack rationale, data flows (upload+SSE / click-to-source / `/eval`), API endpoint signatures, full annotated repo tree, files manifest | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| The Claude system prompt, tool schema, few-shot strategy, prompt-caching breakpoints | [prompts/system_extract_v1.md](prompts/system_extract_v1.md) (as-built; supersedes [docs/extraction-prompt-v1.md](docs/extraction-prompt-v1.md) which is preserved as historical) |
| Case 3 labeling protocol, matching algorithm pseudocode, `/api/eval` flow, prompt iteration discipline | [docs/EVAL.md](docs/EVAL.md) |
| Demo flow (4 beats with timing + narration), hour-by-hour build plan (pre-H0 + H0→H12), top-5 risk register | [docs/BUILD.md](docs/BUILD.md) |
| The 7 small decisions, locked with rationale + refinements (paper trail) | [docs/RESOLVED-DECISIONS.md](docs/RESOLVED-DECISIONS.md) |

---

## Hard kill criteria (you enforce)

| Gate | Trigger | Action |
|---|---|---|
| **H4** | timeline doesn't render real API output | cut multi-doc |
| **H6** | click-to-source broken | fallback to inline event expansion |
| **H8** | animations buggy | strip animation library, CSS only |
| **H10** | any Tier 1 incomplete | freeze features, polish only |
| **H11** | — | end-to-end demo testing only, no new code |

## Tier 1 cut order at H10 (pre-committed; first → last to drop)

1. **landing page (`/`) Sections 2-5** (Section I — Section 1 hero is the must-ship portion; if hero is still on placeholder image at H10, accept it)
2. related-events embeddings
3. filter chips
4. color-coding refinement
5. Gemini patient explainer
6. animation polish

## Tier 0 acceptance criteria (must ship — what "done" looks like)

| Item | "Done" means |
|---|---|
| Drag-drop multi-file PDF upload | Drop 7 PDFs at once → all 7 trigger extraction; non-PDFs rejected with toast |
| Extraction → typed JSON with verbatim snippets | Each event has `source.snippet` that matches the PDF text after `normalize()`; non-matches render with "source not pinpointed" badge per Q14 |
| Timeline renders chronologically | Events sorted by `date`, axis dots aligned, no card overlap, alternating sides per Q8 |
| Click event → side panel with PDF + highlighted snippet | Panel opens at 480px, PDF page-jumps, snippet wrapped in `<mark>` (or top-of-page banner fallback per Q5) |
| 3 sample cases as quick-start buttons | All 3 buttons load; Cases 1+2 from precomputed JSON, Case 3 visible only via the `/eval` route |
| Eval harness on `/eval` | Strict + loose precision/recall/F1 visible, per-event-type breakdown table renders, methodology blurb expandable |

## Out of scope (do NOT build, even if tempted)

Auth · user accounts · mobile responsive · sharing/collaboration · settings/themes · deployment beyond local · image OCR · real-time audio · PDF download/export · case management UI · multi-tenant · undo/redo · dark mode toggle · keyboard shortcuts beyond Cmd+Shift+L · drag-to-reorder events · event editing or deletion · search · pagination.

If a feature isn't in the locked register's Tier 0/1/2 lists or the BUILD.md hour-by-hour, it is out. The temptation to "just add a small thing" is the single most common way 12-hr builds become 16-hr builds.

## Cross-session execution model

The build runs as **two concurrent Claude Code sessions**, each in its own terminal window:

- **Frontend session:** `/`, `/app`, `/eval` surfaces. Reads [MOCK_DATA.md](MOCK_DATA.md) fixtures until backend integration. Standards in [docs/FRONTEND-STANDARDS.md](docs/FRONTEND-STANDARDS.md).
- **Backend session:** PDF parsing, Claude extraction with verbatim attribution, streaming endpoint, embeddings, Gemini explainer, eval harness with held-out Case 3. Standards in [docs/BACKEND-STANDARDS.md](docs/BACKEND-STANDARDS.md).

Both sessions read these files at the start of every cycle: [PLAN.md](PLAN.md), [BRIEF.md](BRIEF.md), [schema.md](schema.md), [API.md](API.md), [MOCK_DATA.md](MOCK_DATA.md), [STATE.md](STATE.md), and the relevant standards file (frontend or backend).

Each cycle ends by appending a 2-line summary to [STATE.md](STATE.md):

> `Cycle N — [session]: [what was built], [issues if any]`

**Integration cycle every 3-4 work cycles:** stop both sessions, verify the API contract in [API.md](API.md) still holds (frontend's expected response shape == backend's actual response shape), fix mismatches, resume. Append integration entry to STATE.md.

**Verification Lead prompt addition:** "Does this slice maintain or improve the end-to-end demo flow described in BUILD.md?" Slices that pass functional verification but hurt the demo (broken visual moment, lost feature, increased latency on the demo path) get flagged before Release Gate.

---

# Locked Decision Register

*Pre-H0 architectural decisions, finalized. Source of truth — Figma must conform to these decisions, not the other way around. If anything in the Figma contradicts this document, this document wins and the design gets updated.*

## Project framing

Chronicle is a drag-and-drop tool for medical document timelines. Patients drop PDFs (lab results, doctor's notes, imaging reports). Backend extracts structured timeline events using Claude with verbatim source attribution. Frontend renders an animated chronological timeline. Click any event → side panel with the source PDF scrolled to the relevant page, supporting paragraph highlighted.

**Wedge:** UX fidelity (animated streaming timeline + click-to-source highlight) is the wow-moment. The `/eval` route is the supporting credibility surface, not the headline.

**Constraints:** Solo developer, ~12 hr focused build, Mac M4 Pro local demo, $750 Anthropic API credits.

---

## A. Architecture & stack

| Q | Decision |
|---|----------|
| Q1 | **AMENDED post Block 5b verification (2026-05-09):** Claude native PDF document blocks — YES. Citations API — DROPPED. Empirical test on `data/cases/case1/docs/d1_pcp_2023_01.pdf` (Sonnet 4.6, both `tool_choice: tool` and `auto`) showed citations do NOT attach when the model is forced to a tool, and `auto` mode produces a narrative text block without citations either. Taking BUILD.md Risk 1 worst-case fallback (line 313, pre-authorized): model emits `source.snippet` inside the `emit_events` tool input, and `lib/match.ts` sliding-window-validates against the PDF text-layer. Wedge feature (click-to-source highlight) preserved. Repro script: `scripts/verify-citations.py`. See [docs/RESOLVED-DECISIONS.md §8](docs/RESOLVED-DECISIONS.md). |
| Q2 | **Single Next.js (TypeScript)** full-stack. App Router route handlers for `/api/extract`, `/api/explain`, `/api/related`, `/api/eval`. No FastAPI. |
| Q3 | **Voyage `voyage-3`** embeddings over HTTP from Next.js. No Python. Fallback: OpenAI `text-embedding-3-small`. |
| Q4 | **Stream** via SSE / `ReadableStream`. Per-document parallel calls with `Promise.all` on the backend; events streamed to the UI as each doc completes. |
| Q5 | **react-pdf with text-layer + custom highlight overlay.** On snippet-match failure, fall back to scrolling to the page + flashing a top-of-page banner with the snippet text. Spike H2–H3, not H10. |
| Q6 | **JSON fixtures** under `/data/cases/<case_id>/{events.json, docs/*.pdf}`. Ad-hoc demo uploads in-memory only (lost on reload). No DB. |
| Q7 | **Sonnet 4.6** for extraction with prompt caching on system prompt + few-shot. **Haiku 4.5** for patient explainer (or Gemini Flash, see Q26). Preloaded cases pre-extracted at build time. **Opus 4.7 reserved as escape hatch** if Case 3 strict-match precision is poor — keep ~$100 budget earmarked for the swap. |

---

## B. UX surface

| Q | Decision |
|---|----------|
| Q8 | **Vertical scroll**, center axis, alternating cards left/right. Locked. |
| Q9 | **Overlay, 480px, right-side slide-in** with soft backdrop scrim dimming the timeline behind. Timeline does **not** reflow when the panel opens. Single-open (clicking another event swaps content). Close on X / ESC / click-outside. |
| Q10 | **Severity = color only.** Colored dot on the timeline axis line + 4px colored left-edge bar on the event card. **No severity icon.** Icons reserved for event-type (lab, imaging, visit, diagnosis, medication, procedure, referral). |
| Q11 | **Dedicated `/eval` route.** Linked from a "View evaluation metrics" footer link on `/app`. Not a drawer. Main timeline stays visually clean. |
| Q12 | **Per-document stream-in.** Each doc's events animate into chronological position as extraction completes. Per-doc failure shows red ✗ inline with "skipped — see details" link; processing continues for the others. |
| Q13 | Date confidence on card: **exact** = `Mar 15, 2024` normal weight; **approximate** = `~Mar 2024` italic; **inferred** = `Mar 2024 (inferred)` italic + stone-500 color. Most events are exact → most cards stay clean. |

---

## C. Schema & API contract

| Q | Decision |
|---|----------|
| Q14 | API normalizes both sides (NFKC + dehyphenation + whitespace collapse) and accepts any normalized substring match. On failure: render the event with a **"source not pinpointed"** badge — never drop silently, never auto-retry. Eval accounting: counts as extraction error, excluded from precision numerator. |
| Q15 | **Both `Case` and `Document` first-class.** URL shape `/api/cases/:id/...`. Preloaded cases as JSON fixtures. |
| Q16 | Add `date_text: string?` (raw text Claude saw); keep single `date` for sorting; no `date_range_end` for v1; conflicting cross-doc dates → two events linked via `related_ids`. |

### JSON schema (v1, locked)

    {
      "id": "uuid",
      "date": "ISO 8601",
      "date_text": "string | null",
      "date_confidence": "exact | approximate | inferred",
      "event_type": "lab | imaging | visit | diagnosis | medication | procedure | referral",
      "title": "string",
      "summary": "string (1-2 sentences, patient-readable)",
      "severity": "info | monitor | concerning | urgent",
      "values": {
        "key": "string",
        "value": "string",
        "unit": "string",
        "ref_range": "string",
        "flag": "string"
      },
      "provider": "string | null",
      "source": {
        "document_id": "string",
        "page": "int",
        "snippet": "string (verbatim from PDF, post-normalization match)"
      },
      "related_ids": ["uuid"]
    }

**Hard constraint:** every event must have a `source.snippet` that appears verbatim in the source document (after normalization). This enables click-to-source via highlight overlay and is the project's core value claim. Locked into the extraction prompt — see [docs/extraction-prompt-v1.md](docs/extraction-prompt-v1.md).

---

## D. Eval methodology

| Q | Decision |
|---|----------|
| Q17 | **Two-tier display** in `/eval`. **Strict** = event_type + date exact + title token-overlap ≥ 0.5. **Loose** = event_type + date ±3 days + title token-overlap ≥ 0.5. Out-of-scope events excluded from FN denominator, listed separately as "out-of-scope." Both numbers shown. |
| Q18 | Ground-truth labels for Case 3 written **pre-H0**, in the same sitting as writing the Case 3 PDFs, before any extraction prompt iteration. Locked to a versioned JSON file, not reopened until H11. **[Superseded — actual ordering: the Case 3 GT was authored *after* prompt iteration finished, not before it — iteration on Cases 1+2 ended 2026-05-10T13:49:58Z, GT labeled 15:33:19Z, hash-locked in commit `59ca076` at 15:50:30Z, first Case 3 measurement 18:33:16Z. The provable claim (L2): Case 3 was never used in prompt iteration and its lock predates any Case 3 measurement. See docs/EVAL.md §6.]** |
| Q19 | `held_out/case3/` folder with do-not-open README. Separate eval script committed at H0, not edited. Prompt file's git hash logged before first Case 3 run. |

Operational details (matching algorithm, /api/eval flow, labeling step-by-step): [docs/EVAL.md](docs/EVAL.md).

---

## E. Demo strategy

| Q | Decision |
|---|----------|
| Q20 | **Hybrid.** Cases 1+2 served from precomputed `events.json` with 1.5s artificial delay for "feel." Case 3 runs **live** when the judge navigates to `/eval` — the routing transition is the dramatic beat; numbers populate as extraction completes. Precomputed Case 3 fallback hidden behind a hotkey if API stalls > 15s. |

### Demo flow (4 beats — high-level)

1. **Main app, Cases 1+2** — drag-and-drop walkthrough. Precomputed, 1.5s "feel" delay. Streaming insertion is the visual hook.
2. **Transition** — "And here's how we know it works." Click footer "View evaluation metrics" link.
3. **`/eval`** — strict + loose precision/recall, per-event-type breakdown, methodology blurb. Case 3 extraction runs **live**; numbers populate as documents stream in. Credibility moment.
4. **Close** — return to `/app`. Patient-narrative close: "30 documents, 5 doctors, no throughline. Chronicle is the throughline."

Timed narration, hotkey, fallback details: [docs/BUILD.md](docs/BUILD.md) (Demo flow section).

---

## F. Framing & data discipline

| Q | Decision |
|---|----------|
| Q21 | Disclaimer in **all three** surfaces: persistent footer + one-time splash on first case load + side-panel header above severity badge. Footer copy: *"Chronicle organizes your records for conversations with your doctor. Not medical advice. Severity reflects suggested discussion priority, not clinical urgency."* |
| Q22 | All 3 cases written **pre-H0** (before build clock). Each PDF: ≥2 medical abbreviations, 1 date format inconsistency, 1 cross-document contradiction. **Case 3 written FIRST and locked** before Cases 1+2 to prevent backward-tuning. |
| Q23 | Pre-committed Tier 1 cut order at H10 freeze (first → last to drop): (1) related-events embeddings, (2) filter chips, (3) color-coding refinement, (4) Gemini patient explainer, (5) animation polish. |

---

## G. Demo audience & wedge

| Q | Decision |
|---|----------|
| Q24 | **Hackathon judges (audience may be mixed/non-technical — landing page at `/` added as lay-friendly entry for async viewing: Devpost, recruiters, post-event portfolio).** Demo flow itself opens on `/app` and is a narrated single-track walkthrough using preloaded cases. Drag-and-drop must work for the live moment but the judge's own PDF is not a hard requirement. |
| Q25 | **Wedge = UX fidelity.** Animated streaming timeline + click-to-source highlight is the wow. `/eval` is supporting credibility, not the headline. |
| Q26 | **Gemini Flash** as patient-explainer per the brief. Haiku 4.5 fallback permitted at H7 if Gemini integration is fighting; README footnote explains the substitution. |

---

## H. Frontend execution standards (binding for `/`, `/app`, `/eval`)

**Lifted to [docs/FRONTEND-STANDARDS.md](docs/FRONTEND-STANDARDS.md).** Aesthetic direction (calm clinical, locked tokens, anti-references), tooling strategy (Magic MCP → shadcn/ui → hand-written; Context7 first for non-trivial APIs; Magic budget 10 ceiling / 8 soft target), animation budget (reduced-motion respect, scroll-triggered entrance, hero cascade, ONE looping highlight, hover states only — explicit forbidden list).

**Note: severity color tokens in Section H supersede [RESOLVED-DECISIONS.md #3](docs/RESOLVED-DECISIONS.md). The earlier stone-400 / amber-400 / orange-600 / red-600 palette is no longer current.** The H10 colorblind sim check still applies but to the new palette — concerning `#DC2626` vs urgent `#991B1B` (both reds) — adjust urgent only if they collapse.

## I. Landing page spec (`/`)

**Lifted to [docs/FRONTEND-STANDARDS.md](docs/FRONTEND-STANDARDS.md) §I.** Five-section scrollable single-page landing at `/`. For non-demo audiences (Devpost, post-event portfolio). Demo flow itself opens on `/app`, not `/`. Hero product preview is a real screenshot of `/app` captured at H10/H11 polish (placeholder image until then). One looping yellow snippet-highlight pulse on the hero, scoped via positioned CSS overlay.

---

## Cascading implications

### Severity is color-only on the timeline (WCAG note)

Q10 makes severity a color-only signal on the timeline (axis dot + card bar, no icon). For a colorblind judge, severity collapses to a single visual variable.

**Mitigation:**
- Render severity as a **text label** in the side-panel header (e.g., "Severity: Monitor — discuss with provider"). Timeline stays color-only for visual cleanliness; click-through gets the labeled signal.
- Add a hover tooltip on the axis dot showing the severity label. ~10 min of work.
- The Q21 disclaimer ("severity = discussion priority, not clinical urgency") covers the framing if challenged.

### `/eval` is its own design surface

Q11 routing means `/eval` needs at minimum:
- Strict + loose precision/recall numbers (Cases 1, 2, 3 stacked)
- Per-event-type breakdown table (precision/recall per type)
- Methodology blurb (1 paragraph: what counts as a match, held-out discipline, label provenance)
- Case 3 "Run live" trigger button (or auto-run on route entry)

Budget **~1.5 hr** for `/eval`. Not on the cut list today, but at H10 triage: ugly-but-correct table is acceptable; only the Case 3 live-run is essential.

### Streaming insertion is the highest-learning frontend task

Per-doc stream-in (Q12) + SSE (Q4) requires the timeline component to support **optimistic insertion of events into a date-sorted list mid-stream**, with each new event animating into its chronological position. Tools: Framer Motion `AnimatePresence` + `layout` animations on event card components.

I haven't used Framer Motion much. **Spike this on a static fixture H4–H5 before wiring up the real SSE stream.** If the layout animation is fighting at H6, fall back to "snap-in with fade" (no layout animation) — significantly easier and still visually acceptable for the demo.

### Tailwind responsive-collapse work is off the table

Q9 (panel doesn't reflow timeline) + Q11 (no drawer) + Q24 (desktop-only demo) means no responsive collapse behavior is required. **Save ~1–2 hr** that the original brief budgeted for this.

---

## Open items / verify before H0

- [x] Verify Citations API surface — DONE (Block 5b, 2026-05-09). Result: citations do NOT attach to text blocks when forced-tool flow is used; `auto` mode also did not attach. Took BUILD.md Risk 1 worst-case fallback (no Citations API). See PLAN.md Q1 (amended) + scripts/verify-citations.py + prompts/system_extract_v1.md preamble + docs/RESOLVED-DECISIONS.md §8.
- [x] Voyage API key procured (in `.env.local`, 2026-05-09).
- [x] Gemini API key procured (in `.env.local`, 2026-05-09).
- [ ] Case 3 PDFs written and locked. Case 3 ground-truth labels written and committed to `held_out/case3/` (protocol in [docs/EVAL.md](docs/EVAL.md)). **DEFERRED to before-H8 deadline (2026-05-10) per [docs/RESOLVED-DECISIONS.md](docs/RESOLVED-DECISIONS.md) §9.** Folder scaffold landed at `held_out/case3/` (README + ground_truth.json template stub + docs/.gitkeep). Path A/B fork at H8 documented in §9.
- [x] Cases 1+2 PDFs written. (PR #2, 2026-05-09 — 13 PDFs in `data/cases/case[12]/docs/`, all snippets verified verbatim.)
- [ ] Cases 1+2 pre-extracted to `events.json` and committed (cached for demo speed). **Deferred to H7 Block 7 — that's where `scripts/extract-case.ts` runs them.**
- [ ] Color palette + severity color mapping locked in Figma (info / monitor / concerning / urgent).
- [ ] Typography pair locked (recommend Inter + Source Serif).
- [ ] Figma updated to match these decisions: vertical scroll; overlay 480px with scrim, no reflow; no severity icon; no eval drawer; per-doc stream-in processing screen; refined date treatment.
- [x] The 7 small decisions locked — see [docs/RESOLVED-DECISIONS.md](docs/RESOLVED-DECISIONS.md) for rationale + refinements (#3 colorblind sim wired into BUILD.md H10, #4 expanded to 7/7 event-type coverage in extraction-prompt-v1.md, #7 hash-lock wired into EVAL.md and BUILD.md H7).

---

## Working agreement

- No code until plan approved.
- Hour-block summaries during build: **shipped / broken / next / blockers** (4 bullets).
- Default to scope cuts over scope creep. Propose cutting before adding hours.
- Surface judgment calls (medical accuracy, UX, eval methodology) — do not assume.
- When a step requires my domain knowledge or ML methodology execution, write step-by-step instructions for the human.

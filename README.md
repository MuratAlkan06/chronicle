# Chronicle

A drag-and-drop tool that turns scattered medical PDFs into a chronological timeline with verbatim source attribution.

> Patients have 30 documents from 5 doctors and no one ties them together. Chronicle is the throughline.

## What it does

Drop lab results, doctor's notes, imaging reports onto the canvas. The backend extracts structured timeline events using Claude (Sonnet 4.6 + native PDF, tool-forced extraction). Each event ships with a verbatim source quote that is **validated by sliding-window match against the PDF text-layer** (`lib/match.ts`) — so the click-to-source highlight is grounded, not trusted. The frontend renders an animated chronological timeline. Click any event → side panel opens with the source PDF scrolled to the relevant page, the supporting paragraph wrapped in `<mark>`.

Built solo for HackDavis 2026 in ~12 focused hours on a Mac M4 Pro.

## Stack

Single Next.js (TypeScript) full-stack app · Anthropic Claude Sonnet 4.6 (extraction) + Haiku 4.5 / Gemini Flash (patient explainer) · Voyage `voyage-3` embeddings · react-pdf · Framer Motion · Tailwind + shadcn/ui · in-memory state with JSON fixtures (no database).

## Documentation

Open [PLAN.md](PLAN.md) first. It is the index + the locked decision register.

```
.
├── PLAN.md                          ← start here: orientation + locked decisions
├── README.md                        ← this file
├── BRIEF.md                         ← short project framing (read at session start)
├── schema.md                        ← locked event JSON shape + tool definition + zod/TS types
├── API.md                           ← API endpoint signatures (request / response / SSE event shapes)
├── MOCK_DATA.md                     ← Cases 1+2 fixtures + Case 3 shape-mock for /eval scaffolding
├── STATE.md                         ← cross-session sync log
└── docs/
    ├── ARCHITECTURE.md              ← stack rationale, data flows, repo tree, files manifest
    ├── FRONTEND-STANDARDS.md        ← aesthetic, tooling, animation budget, landing page spec (§I)
    ├── BACKEND-STANDARDS.md         ← response shape, error envelope, streaming protocol
    ├── extraction-prompt-v1.md      ← Claude system prompt + tool schema + few-shot strategy + caching
    ├── EVAL.md                      ← Case 3 labeling protocol, matching algorithm, iteration discipline
    ├── BUILD.md                     ← demo flow (4 beats), hour-by-hour H0→H12, risk register, rehearsal checklist
    ├── CASES.md                     ← the 3 patient case profiles + PDF authoring guide
    └── RESOLVED-DECISIONS.md        ← the 7 small decisions, locked with rationale (#3 superseded by FRONTEND-STANDARDS.md)
```

## Routes

- `/` — public landing page (Devpost / portfolio audience). See [docs/FRONTEND-STANDARDS.md](docs/FRONTEND-STANDARDS.md) §I.
- `/app` — the product (drag-and-drop, timeline, side panel). Demo opens here.
- `/eval` — metrics page with strict + loose precision/recall on the held-out case.

The active extraction prompt is [`prompts/system_extract_v4.md`](prompts/system_extract_v4.md). The full v1→v4 iteration trail with per-version metrics on Cases 1+2 lives in [`prompts/CHANGELOG.md`](prompts/CHANGELOG.md).

## Quick start

```bash
npm install
npm run dev    # http://localhost:3000
```

Required env vars in `.env.local` (root):
- `ANTHROPIC_API_KEY` — extraction (Sonnet 4.6) + patient-explainer fallback (Haiku 4.5)
- `GEMINI_API_KEY` — patient explainer (Gemini Flash); on absence, falls back to Haiku 4.5 per Q26 (one-line change in `lib/gemini.ts` + `app/api/explain/route.ts`)
- `VOYAGE_API_KEY` — embeddings for "find related events" (Voyage `voyage-3`)
- `OPENAI_API_KEY` — embeddings fallback only (`text-embedding-3-small`); used automatically on Voyage 401/429

Routes live at `/`, `/app`, `/eval`. Demo opens on `/app`.

## Scripts

```bash
# Re-extract Cases 1+2 against the active prompt; writes events.json + metadata.json
npx tsx scripts/extract-case.ts case1
npx tsx scripts/extract-case.ts case2

# Evaluate cached predictions vs ground truth; writes data/eval_reports/<case>.json
# and appends a row to prompts/CHANGELOG.md
npx tsx scripts/eval-train.ts case1 case2

# Validate held_out/case3/ground_truth.json structurally before locking
# (does NOT call any model — preserves held-out hygiene)
npx tsx scripts/validate-gt.ts
```

## Evaluation methodology

The headline credibility surface is `/eval`. The discipline behind it:

- **Two-tier matching** (per [docs/EVAL.md](docs/EVAL.md)): _strict_ requires same `event_type` + exact date + ≥0.5 title token-overlap; _loose_ requires same `event_type` + date within ±3 days + ≥0.5 token-overlap. Both numbers are shown — strict is conservative, loose accounts for the date-fuzziness real patients describe.
- **Held-out Case 3.** PDFs and ground-truth labels were authored by hand before any prompt iteration began. The GT file is hash-locked: `held_out/case3/.gt_hash.lock` records `git hash-object` of the GT file at H0; `/api/eval?mode=live` recomputes the hash at request time and refuses to run on mismatch. The active prompt's git hash is logged to `held_out/case3/prompt_hash.txt` before each Case 3 run, and `prompts/` must have no uncommitted changes — the prompt that produced any reported metric is reproducible from a single git commit.
- **Prompt iteration on Cases 1+2 only.** Per-version log in [`prompts/CHANGELOG.md`](prompts/CHANGELOG.md). Iteration ran v1→v4, one targeted change per version (cross-doc reference rule → terse visit-title format → full per-type Title spec inlined). Average strict F1 across Cases 1+2 moved 0.555 → 0.825 (+27pt). Stop conditions per [docs/EVAL.md](docs/EVAL.md): C2 hit ≥0.85 P/R at v2; C1 hit R=0.92 at v4 with P capped by GT-labeling judgments on referrals not in GT and one doc-author dose-discrepancy edge case.
- **Verbatim-snippet enforcement.** Every event ships with a `source.snippet` that downstream code (`lib/match.ts` + `lib/normalize.ts`) sliding-window-matches against the PDF text-layer after NFKC + dehyphenation + whitespace collapse. On match failure the event renders with a "source not pinpointed" badge — never silently dropped, never auto-retried (Q14).

## Demo flow

Local-only. Single narrated walkthrough, ~3:30–4:00 total. 4 beats:

1. **Main app, Cases 1+2** — drag-and-drop walkthrough with streaming insertion. Precomputed events served with a 1.5s feel-delay per doc (Q20).
2. **Transition** — footer "View evaluation metrics" link.
3. **`/eval` page, Case 3 live** — extraction runs on route entry, metrics populate as docs stream in. The credibility moment.
4. **Close** — back to `/app`. Patient-narrative close.

Hotkey **Cmd+Shift+L** on `/eval` swaps the live extraction for `data/case3_eval_fallback.json` (populated at H11 from the live run). Trigger condition: doc badge counter hasn't incremented for 15s, or red error toast.

See [docs/BUILD.md](docs/BUILD.md) §6 for the full narration script and §H11 for the rehearsal checklist.

## Model swap notes (per Q26)

- **Extraction:** `claude-sonnet-4-6` (model id in `lib/claude.ts`). Escape hatch is `claude-opus-4-7` — one-line model-string swap if Case 3 strict P or R falls below 0.5 at H11; reserved ~$100 budget covers the re-run trivially.
- **Patient explainer:** Gemini Flash 2.5 primary, Haiku 4.5 inline fallback. The fallback fires if `GEMINI_API_KEY` is missing OR if Gemini errors before its first chunk is streamed; if Gemini already streamed text and then failed mid-flight, the route closes the SSE rather than restart Haiku and risk a duplicated answer (`app/api/explain/route.ts`). Both providers failing emits a single SSE error frame with `code: "upstream_unavailable"`.
- **Embeddings:** Voyage `voyage-3` primary, OpenAI `text-embedding-3-small` fallback on 401/429/network-error/malformed-response (`lib/voyage.ts`). Both-providers-fail emits 502 + `code: "upstream_unavailable"`.

## In-app disclaimer (footer + splash + side-panel header)

> Chronicle organizes your records for conversations with your doctor. Not medical advice. Severity reflects suggested discussion priority, not clinical urgency.

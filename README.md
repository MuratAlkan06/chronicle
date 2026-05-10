# Chronicle

A drag-and-drop tool that turns scattered medical PDFs into a chronological timeline with verbatim source attribution.

> Patients have 30 documents from 5 doctors and no one ties them together. Chronicle is the throughline.

## What it does

Drop lab results, doctor's notes, imaging reports onto the canvas. The backend extracts structured timeline events using Claude (Sonnet 4.6 + native PDF + Citations API) with verbatim source attribution. The frontend renders an animated chronological timeline. Click any event → side panel opens with the source PDF scrolled to the relevant page, the supporting paragraph highlighted.

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

After H0 Block 6 (repo init), the Next.js app source lives at the project root alongside the planning docs, and `prompts/system_extract_v1.md` becomes the active prompt artifact (currently a draft in `docs/extraction-prompt-v1.md`).

## Local dev (after H0 init)

```
npm install         # installed during H0 Block 6
npm run dev         # serves at http://localhost:3000
```

Required env vars in `.env.local`:
- `ANTHROPIC_API_KEY` — extraction (Sonnet 4.6) + patient explainer fallback (Haiku 4.5)
- `VOYAGE_API_KEY` — embeddings for "find related events" (or `OPENAI_API_KEY` as fallback per resolved decision in ARCHITECTURE.md)
- `GEMINI_API_KEY` — patient explainer (or skip and use Haiku per Q26)

## Pre-H0 status

Planning complete. Architectural decisions locked ([PLAN.md](PLAN.md) "Locked Decision Register"). Build clock starts after the pre-build prelude blocks in [docs/BUILD.md](docs/BUILD.md) (~6-8 hr): write the 3 sample patient cases as PDFs ([docs/CASES.md](docs/CASES.md)), write Case 3 ground-truth labels ([docs/EVAL.md](docs/EVAL.md) protocol), procure API keys, init the repo, lock Tailwind color tokens.

## Demo

Local-only. Single narrated walkthrough, ~3:30-4:00 total, hackathon judges (audience may be mixed/non-technical — landing at `/` exists for async viewing; live demo opens on `/app`). 4 beats — `/app` with Cases 1+2 → transition → `/eval` page with Case 3 running live → patient-narrative close back at `/app`. See [docs/BUILD.md](docs/BUILD.md) "Demo flow" section for narration script and timing, and the "Demo rehearsal checklist" in H11 for what to verify before showtime.

## In-app disclaimer (footer + splash + side-panel header)

> Chronicle organizes your records for conversations with your doctor. Not medical advice. Severity reflects suggested discussion priority, not clinical urgency.

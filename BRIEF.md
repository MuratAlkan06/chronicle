# Chronicle — Project Brief

**A drag-and-drop tool that turns scattered medical PDFs into a chronological timeline with verbatim source attribution.**

This file is the short version of the project — read it once at session start, then move on to the relevant contract files. Both Claude Code sessions (frontend, backend) read this at cycle start.

---

## The wedge

Patients managing chronic conditions often have 30+ documents from multiple providers — labs, doctor's notes, imaging reports, referrals, prescriptions. No one ties them together. Chronicle is the throughline.

## What it does

1. Patient drops PDFs onto the canvas at `/app`.
2. Backend extracts structured timeline events using Claude (Sonnet 4.6 + native PDF). Every event has a verbatim source quote, validated by sliding-window match against the PDF text-layer in `lib/match.ts`. (Citations API was dropped post Block 5b verification — see PLAN.md Q1.)
3. Frontend renders an animated chronological timeline with per-doc streaming insertion.
4. Click any event → side panel opens with the source PDF scrolled to the relevant page, supporting paragraph highlighted.
5. `/eval` route shows precision/recall metrics on a held-out case, with the eval running live for the credibility moment.

## Surfaces

| Route | Purpose | Read-by-judges |
|---|---|---|
| `/` | Public landing — Devpost screenshots, post-event portfolio | Async |
| `/app` | The product — dropzone, timeline, side panel. Demo opens here. | Live demo |
| `/eval` | Metrics page — Cases 1+2 cached, Case 3 live | Live demo (beat 3) |

## Constraints

- **Solo developer** — Murat (2nd-year SJSU SE, biomedical ML internship background)
- **~12 hr focused build** + sleep, on Mac M4 Pro
- **$750 Anthropic API credits**
- **Local-only demo** (no cloud deploy)
- **UI/UX is non-negotiable** — wedge is UX fidelity, not just extraction quality

## Audience

- **Demo (live):** Hackathon judges (assume mixed background — lay-friendly framing in /app and landing).
- **Async (after event):** Devpost, recruiters, portfolio reviewers — landing page is for them.

## Wedge moments

1. Streaming insertion of events into a chronological timeline as multi-doc extraction completes (animated)
2. Click event → side panel renders source PDF + highlighted snippet
3. `/eval` page shows held-out Case 3 running live with precision/recall populating in real time

## Stack (one-line)

Single Next.js (TS) full-stack app · Anthropic Claude Sonnet 4.6 (native PDF, tool-forced extraction) · Haiku 4.5 / Gemini Flash (patient explainer) · Voyage `voyage-3` embeddings · react-pdf · Framer Motion · Tailwind + shadcn/ui · in-memory state with JSON fixtures.

## Sample patient cases

- **Case 1:** Sarah Chen, 47F — Type 2 Diabetes progression, 18 mo, ~7 docs
- **Case 2:** Maria Rodriguez, 52F — Suspicious mammogram → benign biopsy, 3 mo, ~6 docs
- **Case 3:** David Park, 38M — Chronic low back pain across 5 providers, 6 mo, ~8 docs — **HELD-OUT**, prompt MUST NOT be tuned against this case

See [docs/CASES.md](docs/CASES.md) for full case profiles, document mix, and PDF authoring guide.

## Cross-session deliverables (read at every cycle start)

| File | Owns |
|---|---|
| [PLAN.md](PLAN.md) | Orientation index + locked decision register |
| [BRIEF.md](BRIEF.md) | This file — short project framing |
| [schema.md](schema.md) | The locked event JSON shape + tool definition |
| [API.md](API.md) | API endpoint signatures (request/response/SSE) |
| [MOCK_DATA.md](MOCK_DATA.md) | Cases 1+2 fixtures + Case 3 shape-mock for /eval |
| [STATE.md](STATE.md) | Cross-session sync log |
| [docs/FRONTEND-STANDARDS.md](docs/FRONTEND-STANDARDS.md) | Frontend session: aesthetic, tooling, animation, landing spec |
| [docs/BACKEND-STANDARDS.md](docs/BACKEND-STANDARDS.md) | Backend session: response shape, error envelope, streaming protocol |

## Next steps

Open [PLAN.md](PLAN.md) for the orientation index and locked decision register.

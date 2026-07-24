# Chronicle

[![CI](https://github.com/MuratAlkan06/chronicle/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/MuratAlkan06/chronicle/actions/workflows/ci.yml)

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

# Held-out Case 3 measurement (the deliverable). Runs extraction+eval N times
# (default 3), persists each run to held_out/case3/eval_runs/ + a mean/min/max
# summary. Enforces the .gt_hash.lock + prompt-clean gates first. Each
# invocation is ONE measurement event for peek-budget accounting.
npx tsx scripts/eval-case3.ts --runs 3
npx tsx scripts/eval-case3.ts --dry-run          # list docs, no API calls

# Prompt-caching savings report: scans persisted usage fields → tokens, %
# served from cache, and net $ saved vs no-caching (incl. 1.25x write premium).
npx tsx scripts/cache-report.ts
```

Extraction runs at `temperature: 0` (`lib/claude.ts`) for run-to-run stability; the N-run mean±range from `scripts/eval-case3.ts` is the primary rigor mechanism (temperature alone does not guarantee bit-exact determinism). All per-call token usage is persisted (`metadata.json` for case extractions, `eval_runs/*.json` for measurement runs) so `scripts/cache-report.ts` can account for cache hits and cost.

## Evaluation methodology

The headline credibility surface is `/eval`. The discipline behind it:

- **Two-tier matching** (per [docs/EVAL.md](docs/EVAL.md)): _strict_ requires same `event_type` + exact date + ≥0.5 title token-overlap; _loose_ requires same `event_type` + date within ±3 days + ≥0.5 token-overlap. Both numbers are shown — strict is conservative, loose accounts for the date-fuzziness real patients describe.
- **Held-out Case 3.** Case 3 was never used in prompt iteration; its ground truth was authored independently of model output on Case 3, hash-locked in commit `59ca076` before the prompt was ever run against Case 3 (first recorded measurement `2026-05-10T18:33:16Z`). The GT file is hash-locked: `held_out/case3/.gt_hash.lock` records `git hash-object` of the GT file; `/api/eval?mode=live` recomputes the hash at request time and refuses to run on mismatch. The active prompt's git hash is logged to `held_out/case3/prompt_hash.txt` before each Case 3 run, and `prompts/` must have no uncommitted changes — the prompt that produced any reported metric is reproducible from a single git commit.
- **Prompt iteration on Cases 1+2 only.** Per-version log in [`prompts/CHANGELOG.md`](prompts/CHANGELOG.md). Iteration ran v1→v4, one targeted change per version (cross-doc reference rule → terse visit-title format → full per-type Title spec inlined). Average strict F1 across Cases 1+2 moved 0.555 → 0.825 (+27pt). Stop conditions per [docs/EVAL.md](docs/EVAL.md): C2 hit ≥0.85 P/R at v2; C1 hit R=0.92 at v4 with P capped by GT-labeling judgments on referrals not in GT and one doc-author dose-discrepancy edge case.
- **Verbatim-snippet enforcement.** Every event ships with a `source.snippet` that downstream code (`lib/match.ts` + `lib/normalize.ts`) sliding-window-matches against the PDF text-layer after NFKC + dehyphenation + whitespace collapse. On match failure the event renders with a "source not pinpointed" badge — never silently dropped, never auto-retried (Q14).

## Held-out Case 3 results

The 0.825 average strict F1 above is a **dev-set** number (Cases 1+2). The held-out number is lower, and that gap is what Phase A works on.

Prompt v4 (hash `f32ebd0`, Sonnet 4.6, API default temperature, no seed) was run twice against Case 3 (`n_gt = 20` in-scope ground-truth events):

| Run (UTC) | Tier | P | R | F1 | tp / fp / fn |
|---|---|---|---|---|---|
| 2026-05-10T18:33:16Z | strict | 0.42 | 0.40 | 0.41 | 8 / 11 / 12 |
| 2026-05-10T18:33:16Z | loose | 0.42 | 0.40 | 0.41 | 8 / 11 / 12 |
| 2026-05-10T20:15:09Z | strict | 0.45 | 0.45 | 0.45 | 9 / 11 / 11 |
| 2026-05-10T20:15:09Z | loose | 0.45 | 0.45 | 0.45 | 9 / 11 / 11 |

The same frozen prompt scored 0.41 and 0.45 across the two runs. At API default temperature with no seed, single-run deltas under ~±5 F1 points are within run-to-run noise (at `n_gt = 20`, one event ≈ 5 F1 points), so 0.41 and 0.45 are the same measurement. The loose tier scored identically to strict on both runs — no date-fuzz events were recovered.

> **Note (Phase A, slice 2):** both runs above predate the measurement-rigor change and were taken at the **Anthropic API default temperature (≈1.0), no seed**. Extraction is now pinned to `temperature: 0` and future measurement events report the **mean±range over 3 runs** (`scripts/eval-case3.ts`), so new numbers are not directly comparable to these two single-run, default-temperature measurements. See [docs/EVAL.md](docs/EVAL.md) "Held-out measurement protocol".

**Why the dev→held-out gap (0.825 → 0.45) is expected.** Cases 1+2 are semi-synthetic: their gold labels were *derived from* AI-generated MOCK_DATA fixtures (STATE.md cycle 0 + cycle 7), and their case PDFs were drafted from that same source material, so the dev score partly measures round-trip fidelity of documents the pipeline's own source material produced. Case 3 is the only **organically-authored, independently-labeled** case in the set. Under that asymmetry a large gap is the expected outcome rather than a regression, and closing it is the work of Phase A. The escape-hatch rule (Case 3 strict P or R < 0.5) fired on both runs.

### Escape-hatch measurement — Opus 4.7 (pre-registered event #3, 2026-07-23)

The escape-hatch rule that fired on both Sonnet runs was **pre-registered before it was exercised** (STATE.md cycle 18): declared command `npx tsx scripts/eval-case3.ts case3 --runs 3 --model claude-opus-4-7`, with the success bar fixed *in advance* as **strict P and strict R both ≥ 0.5 on the 3-run mean**. The prompt was frozen at v4 (`f32ebd0`, unchanged); `claude-opus-4-7` rejects a pinned `temperature` so it ran at its model default, which is exactly why the **3-run mean±range** — not a single run — is the reported number. All 8 docs extracted cleanly on all 3 runs (0 doc failures).

| Run (UTC) | Tier | P | R | F1 | tp / fp / fn |
|---|---|---|---|---|---|
| 2026-07-23T17:51:41Z | strict | 0.44 | 0.40 | 0.42 | 8 / 10 / 12 |
| 2026-07-23T17:51:58Z | strict | 0.53 | 0.45 | 0.49 | 9 / 8 / 11 |
| 2026-07-23T17:52:17Z | strict | 0.47 | 0.40 | 0.43 | 8 / 9 / 12 |
| **3-run mean** | **strict** | **0.48** | **0.42** | **0.45** | — |

Loose scored identically to strict on every run (no date-fuzz events recovered), same as the Sonnet runs. Across the 3 runs strict P ranged 0.44–0.53 and R 0.40–0.45 — inside the ±5 F1-point single-run noise band at `n_gt = 20`.

**Outcome: the bar was not cleared.** Mean strict P = 0.48 and R = 0.42 are both below 0.5, and Opus 4.7 lands in essentially the same band as Sonnet 4.6 (0.41–0.45 strict F1). **Decision, applied exactly as pre-registered: `claude-sonnet-4-6` stays the active extraction model — no code change.** The measurement cost ≈ **$1.58** at `claude-opus-4-7` rates (127K uncached input / 16.7K output / 72K cache-write / 144K cache-read over the 3 runs; 42% of input served from cache) against the reserved ~$100 budget.

## Demo flow

Local-only. Single narrated walkthrough, ~3:30–4:00 total. 4 beats:

1. **Main app, Cases 1+2** — drag-and-drop walkthrough with streaming insertion. Precomputed events served with a 1.5s feel-delay per doc (Q20).
2. **Transition** — footer "View evaluation metrics" link.
3. **`/eval` page, Case 3 live** — extraction runs on route entry, metrics populate as docs stream in. The credibility moment.
4. **Close** — back to `/app`. Patient-narrative close.

Hotkey **Cmd+Shift+L** on `/eval` swaps the live extraction for `data/case3_eval_fallback.json` (populated at H11 from the live run). Trigger condition: doc badge counter hasn't incremented for 15s, or red error toast.

See [docs/BUILD.md](docs/BUILD.md) §6 for the full narration script and §H11 for the rehearsal checklist.

## Model swap notes (per Q26)

- **Extraction:** `claude-sonnet-4-6` (`ACTIVE_MODEL` in `lib/claude.ts`). Escape hatch is `claude-opus-4-7`, run via the `scripts/eval-case3.ts --model` flag (no code edit — the flag overrides the model and auto-omits `temperature` for models that reject it) if Case 3 strict P or R falls below 0.5. That condition **fired on both recorded Sonnet runs** (strict P/R 0.42/0.40 and 0.45/0.45, all below 0.5), so it was pre-registered and **exercised as scored measurement event #3 on 2026-07-23** (`--runs 3 --model claude-opus-4-7`). **Outcome: Opus 4.7 did not clear the ≥0.5 bar** (3-run mean strict P/R 0.48/0.42 — the same band as Sonnet), so **`claude-sonnet-4-6` remains the active model** (see *Held-out Case 3 results* above). Cost ≈ $1.58 against the reserved ~$100 budget.
- **Patient explainer:** Gemini Flash 2.5 primary, Haiku 4.5 inline fallback. The fallback fires if `GEMINI_API_KEY` is missing OR if Gemini errors before its first chunk is streamed; if Gemini already streamed text and then failed mid-flight, the route closes the SSE rather than restart Haiku and risk a duplicated answer (`app/api/explain/route.ts`). Both providers failing emits a single SSE error frame with `code: "upstream_unavailable"`.
- **Embeddings:** Voyage `voyage-3` primary, OpenAI `text-embedding-3-small` fallback on 401/429/network-error/malformed-response (`lib/voyage.ts`). Both-providers-fail emits 502 + `code: "upstream_unavailable"`.

## In-app disclaimer (footer + splash + side-panel header)

> Chronicle organizes your records for conversations with your doctor. Not medical advice. Severity reflects suggested discussion priority, not clinical urgency.

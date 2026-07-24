# Chronicle — Architecture

## 1. Stack with justification

**Locked stack:** Next.js 16 (App Router, TypeScript) full-stack · Anthropic Claude Sonnet 4.6 (extraction, native PDF + Citations API) · Haiku 4.5 or Gemini 2.5 Flash (patient explainer) · Voyage `voyage-3` embeddings (related-events) · Tailwind CSS · shadcn/ui · Framer Motion · react-pdf · in-memory state (no DB) · JSON fixtures under `/data/cases/`.

**Why this stack survives 12 hr solo:**

The dominant constraint is *not* compute — it's context-switching. A single Next.js TS app eliminates the FastAPI/Next dual-runtime tax (no CORS, no two `package.json` worlds, no Docker for the demo). App Router route handlers give you Node-runtime SSE (`ReadableStream`) on the same process that serves the React tree. This collapses what would otherwise be 4-6 hr of plumbing into ~1 hr.

**Skipping a separate text-extraction layer (Q1) is the single largest win.** Claude's native PDF document blocks accept the binary directly; the Citations API returns `cited_text` chunks with page numbers — that *is* `source.snippet` and `source.page` in the locked schema. Without this, you'd burn 2-3 hr on PyMuPDF/pdfplumber + a snippet-locator that has to fight columnar layouts and ligatures. Instead, Claude does layout-aware extraction and gives you the verbatim string back. Your normalize+match step becomes an *insurance policy* for the highlight overlay, not a hard dependency.

**Cost envelope** (Sonnet 4.6 at extraction-time pricing): with prompt-caching on system prompt + few-shot (~3K cached tokens), the marginal cost is the per-doc PDF + the JSON output. Three cases × ~7 docs × ~$0.04/doc ≈ $0.85 per full re-run. You can iterate the prompt 50+ times against Cases 1+2 well under $50, leaving the $100 Opus 4.7 escape hatch comfortably reserved and ~$600 untouched.

**The three-new-tool problem (Framer Motion + Tailwind + shadcn).** This is the real risk in the stack, not infra. Recommended learning sequence:

1. **shadcn first (H2, ~20 min).** `npx shadcn@latest init` then `npx shadcn add button card dialog sheet badge separator scroll-area`. shadcn components ship with Tailwind classes baked in — copying their `className` strings is your Tailwind tutorial. You learn Tailwind by *modifying* working components rather than from a blank `<div>`.
2. **Tailwind exposure as needed (H2-H6).** Bound it: only `flex`, `grid`, spacing (`p-`, `m-`, `gap-`), color tokens, and `text-*`/`font-*`. Resist arbitrary values until polish (H10).
3. **Framer Motion last (H4 spike, H5 wire-up).** Bound the surface area to **two APIs only**: `<AnimatePresence>` and `layout`. The streaming-insert pattern is a `motion.div` with `layout`, `initial={{opacity:0, y:8}}`, `animate={{opacity:1, y:0}}`, wrapped in `<AnimatePresence>`. Do not touch `useAnimate`, `useMotionValue`, variants, or scroll-linked anything. If `layout` fights at H6, the locked fallback is "snap-in with fade" — drop `layout`, keep `AnimatePresence`. Cost of fallback: ~10 min, visual loss: ~20%.

**No responsive collapse, no auth, no DB, no FastAPI** — each of these is 1-3 hr you don't spend. Total saved: ~6-8 hr, which is exactly what makes a solo 12 hr build viable.

---

## 2. Architecture diagram + data flows

### (a) Upload + extraction with SSE streaming

```
Browser (React)                Next.js Route Handler             Anthropic API
─────────────────              ─────────────────────             ──────────────
Dropzone (react-dropzone)
  │
  │ FormData(files[])
  ▼
POST /api/extract ───────────► route.ts
                                 │
                                 │  validate, build docId per file
                                 │  open ReadableStream → controller
                                 │
                                 │  await Promise.all(files.map(f =>
                                 │     extractDoc(f).then(events => {
                                 │        controller.enqueue(sseEvent(...))
                                 │     }).catch(err => enqueue(errEvent))
                                 │  ))
                                 │            │
                                 │            ▼
                                 │      messages.create({
                                 │        model: "claude-sonnet-4-6",
                                 │        system: [{type:"text", text:SYS,
                                 │                  cache_control:{type:"ephemeral"}}],
                                 │        messages: [{role:"user", content:[
                                 │          {type:"document", source:{
                                 │             type:"base64", media_type:"application/pdf",
                                 │             data: pdfB64
                                 │          }, citations:{enabled:true}},
                                 │          {type:"text", text: USER_TPL}
                                 │        ]}],
                                 │        tools: [EXTRACT_EVENTS_TOOL],
                                 │        tool_choice: {type:"tool", name:"emit_events"}
                                 │      })
                                 │            │
                                 │            ▼  (response: tool_use block + citations)
                                 │      parse tool_use.input.events[]
                                 │      walk content blocks: for each event,
                                 │      attach matching citation by index/marker
                                 │      → normalize snippet, sanity-check page
                                 │
                                 ▼
                          enqueue SSE frames →
EventSource/                  ◄──── data: {"type":"doc_started", "docId":"d1", "filename":"..."}
fetch(...).body.getReader()   ◄──── data: {"type":"event", "docId":"d1", "event":{...}}
                              ◄──── data: {"type":"event", "docId":"d1", "event":{...}}
                              ◄──── data: {"type":"doc_complete", "docId":"d1"}
                              ◄──── data: {"type":"doc_error", "docId":"d2", "msg":"..."}
                              ◄──── data: {"type":"done"}
  │
  ▼
useExtractionStream() reducer:
  - upsert event into sorted-by-date list
  - <AnimatePresence> + layout = card slides into chronological position
  - on doc_error: render red ✗ banner inline, continue stream
```

**State location.** In-memory React state on the timeline page (Zustand store or `useReducer` — recommend `useReducer` to avoid one more dependency). Server-side the route handler holds nothing across requests; per-doc results are forwarded then dropped. PDF binary is held only in the request closure for the duration of the Anthropic call; never written to disk in the demo.

**Per-doc parallelism.** `Promise.all` fires all PDFs concurrently (Anthropic accepts concurrent requests; rate limits are far above what a 7-doc burst will hit). Each promise's `.then` enqueues SSE frames as it resolves — the *order events arrive* is the order the model finishes them, which produces the staggered "stream-in" feel for free, no artificial throttling needed for live cases. (For Cases 1+2 served from precomputed JSON, the 1.5s delay per doc is added in the SSE wrapper, not the extractor — see Q20.)

**SSE framing.** Standard `data: <json>\n\n` per event, `event: <type>` optional. Use a small helper `sseEvent(type, payload)` in `lib/sse.ts`. Heartbeat every 15s (`: ping\n\n`) to defeat any aggressive proxy timeout — local-only demo so this is paranoia, but cheap.

### API contracts

```
POST /api/extract
  Request:  multipart/form-data, files[]: File[]
            (or JSON {caseId: "case1"} to replay precomputed)
  Response: text/event-stream
    Events:
      {type:"doc_started", docId, filename, totalDocs}
      {type:"event", docId, event: <Event JSON>}
      {type:"doc_complete", docId, eventCount}
      {type:"doc_error", docId, message, retryable: false}
      {type:"done"}

GET  /api/cases/:id/events
  Response: 200 application/json
            { caseId, events: Event[], generatedAt: ISO8601, modelVersion: string }
            404 if case not found

POST /api/explain
  Request:  {eventId: string, event: Event}
  Response: text/event-stream  (token-stream from Haiku/Gemini)
    Events: {type:"token", text} ... {type:"done"}
  (Haiku 4.5 fallback per Q26 if Gemini integration fights at H7)

POST /api/related
  Request:  {eventId: string, candidates: Event[]}
  Response: 200 {related: [{eventId, score: number}], cached: boolean}
            (voyage-3 cosine over event titles + summaries; top-3, threshold 0.55)

GET  /api/eval?case=case3&mode=live|cached
  Response: text/event-stream when mode=live (mirrors /api/extract events plus
            {type:"metric", tier:"strict"|"loose", value:{precision, recall, f1, n}}
            and {type:"breakdown", byEventType:{...}})
            200 application/json when mode=cached (full report payload)

Error shape (all routes):
  {error: {code: string, message: string, retryable: boolean}}
```

### (b) Click-to-source

```
Event card click
  │
  │ onClick(event) → setSelectedEvent(event); openSheet(true)
  ▼
<Sheet side="right" width=480>
  Header: Severity badge + text label + disclaimer line
  Body:   <PdfViewer
            file={`/data/cases/${caseId}/docs/${event.source.document_id}`}
            page={event.source.page}
            highlightSnippet={event.source.snippet}
          />

PdfViewer mount:
  1. react-pdf <Document> + <Page> at event.source.page
  2. onRenderTextLayerSuccess:
       - read all text spans on the page
       - normalize(spanText) for each (NFKC + dehyphenate + collapse ws)
       - normalize(snippet) once
       - sliding-window match: find contiguous span sequence whose
         joined normalized text contains normalized snippet
       - if match: wrap matched spans in <mark> with yellow-200 bg
                   scrollIntoView({block:"center"})
       - if NO match: render top-of-page banner
                   "Source: «{snippet}» — could not pinpoint on page,
                    showing page only"
                   scroll to top of page
  3. ESC / X / scrim click → setSelectedEvent(null); openSheet(false)
```

**The normalize() function** (in `lib/normalize.ts`) is the single point of reconciliation. NFKC handles ligatures (ﬁ → fi) and full-width punctuation. Dehyphenation strips `-\n` joins (PDF line wraps). Whitespace collapse normalizes newlines/tabs/multiple-spaces to single space. This same function runs on both the PDF text-layer extraction *and* the citation snippet before substring match — that's the contract in Q14.

### (c) /eval flow

```
Footer "View evaluation metrics" link → router.push("/eval")
  │
  ▼
/eval page mounts:
  - Tab 1: "Cases 1+2 (training)" — static report from /api/eval?mode=cached
  - Tab 2: "Case 3 (held-out)" — DEFAULT TAB
      On mount:
        GET /api/eval/fallback → open on the cached fallback
          (no auto live-run: zero /api/eval?...mode=live requests on mount)
        Render metric cards + per-event-type table from the cached result
      Two-step confirm gate (LiveRunGate, shown when not running):
        "Run live extraction…" → inline confirm (spends the final scored
          Case 3 measurement, EVAL.md §6) → on Confirm, start():
        EventSource('/api/eval?case=case3&mode=live')
        Render skeleton table: docs streaming in (left col),
          strict metrics (top-right), loose metrics (bottom-right),
          per-event-type breakdown (bottom)
      On {type:"event"}: append predicted event to live list
      On {type:"metric"}: animate number with framer-motion useSpring
      On {type:"done"}: lock numbers, show "Last run: <timestamp>"
  - Methodology blurb (collapsible <details>): strict vs loose definition,
      OOS exclusion rule, ground-truth labeling protocol summary
  - Hotkey listener: Cmd+Shift+L → reload cached Case 3 fallback
      (GET /api/eval/fallback)
```

**Live-trigger choice: explicit two-step confirm gate (not auto on route entry).** The original call was auto-run on mount: the *transition itself* is the dramatic beat (Q20 beat 2→3), a button adds an extra click, and the hotkey covered the "API stalled >15s" failure mode without the judge ever knowing. **That tradeoff was reversed** once Case 3 became the *final* remaining scored held-out measurement event ([RESOLVED-DECISIONS.md](RESOLVED-DECISIONS.md) #10, [EVAL.md](EVAL.md) §6): with no replacement case, a valid `ANTHROPIC_API_KEY` turned every casual `/eval` visit into one irreversible spend of that terminal budget — and an unrecoverable measurement outweighs the demo beat. So the live tab now **opens on the cached fallback** (`GET /api/eval/fallback`) and fires a scored run only behind a two-step gate (`lib/eval-gate.ts`, rendered in `app/eval/page.tsx`): step 1 "Run live extraction…", step 2 an inline confirm that states it spends the final Case 3 measurement, with a cancel escape. `Cmd+Shift+L` now *reloads* that cached fallback rather than swapping on a stall.

**Matching computation.** Runs server-side in the route handler after extraction completes for Case 3, OR client-side after `done` if you want to render predicted events live and metrics-after. Recommend **server-side, streamed** — sends a `metric` SSE frame per tier as soon as the count is computable. Algorithm in [EVAL.md](EVAL.md).

---

## 3. Repo structure

```
.   (project root — also home to PLAN.md, README.md, BRIEF.md, schema.md, API.md, MOCK_DATA.md, STATE.md, docs/)
├── app/
│   ├── layout.tsx                  # root, fonts, disclaimer footer mount
│   ├── page.tsx                    # / (landing) — see docs/FRONTEND-STANDARDS.md §I
│   ├── globals.css                 # Tailwind directives + CSS vars
│   ├── app/
│   │   └── page.tsx                # /app (product) — Cases 1+2 + dropzone + timeline + side panel
│   ├── eval/
│   │   └── page.tsx                # /eval — tabs, live Case 3 stream, methodology
│   └── api/
│       ├── extract/route.ts        # POST: SSE stream of per-doc events
│       ├── explain/route.ts        # POST: SSE token stream from Haiku/Gemini
│       ├── related/route.ts        # POST: voyage-3 cosine, top-3
│       ├── eval/route.ts           # GET: mode=live|cached, SSE for live
│       └── cases/[id]/events/route.ts   # GET: precomputed events.json
│
├── components/
│   ├── timeline.tsx                # axis + alternating cards + AnimatePresence
│   ├── event-card.tsx              # one card; props: event, side: "left"|"right"
│   ├── side-panel.tsx              # shadcn Sheet wrapper, severity header
│   ├── pdf-viewer.tsx              # react-pdf + highlight overlay
│   ├── eval-table.tsx              # strict/loose metrics + per-type breakdown
│   ├── dropzone.tsx                # react-dropzone wrapper, validates PDFs
│   ├── splash-disclaimer.tsx       # one-time on first case load (localStorage)
│   ├── disclaimer-footer.tsx       # persistent footer, View Eval link
│   └── ui/                         # shadcn-installed components
│       ├── button.tsx
│       ├── card.tsx
│       ├── sheet.tsx
│       ├── badge.tsx
│       ├── separator.tsx
│       └── scroll-area.tsx
│
├── lib/
│   ├── claude.ts                   # Anthropic SDK client + extractDoc()
│   ├── voyage.ts                   # voyage-3 embeddings client + fallback
│   ├── gemini.ts                   # Gemini Flash client (or haiku.ts)
│   ├── normalize.ts                # NFKC + dehyphenate + ws-collapse
│   ├── match.ts                    # snippet-in-textlayer sliding-window match
│   ├── snippet-locate.ts           # PDF text-layer span walker
│   ├── sse.ts                      # sseEvent() + heartbeat helpers
│   ├── eval.ts                     # strict + loose matching algorithm
│   ├── schema.ts                   # zod schemas + TS types for Event, Citation
│   └── case-store.ts               # in-memory upload state (server-side req-scope)
│
├── data/
│   ├── cases/
│   │   ├── case1/
│   │   │   ├── events.json         # PRECOMPUTED at H8 by scripts/extract-case.ts
│   │   │   ├── metadata.json       # patient name, dob, condition, doc count
│   │   │   └── docs/
│   │   │       ├── d1_a1c_2023_01.pdf      # H-N, by Murat
│   │   │       ├── d2_visit_2023_03.pdf
│   │   │       └── ...
│   │   └── case2/
│   │       ├── events.json
│   │       ├── metadata.json
│   │       └── docs/*.pdf
│   └── case3_eval_fallback.json    # precomputed Case 3 result, hotkey fallback
│
├── held_out/
│   └── case3/
│       ├── README.md               # "DO NOT OPEN UNTIL H11" warning
│       ├── docs/                   # Case 3 PDFs, written H-N FIRST
│       │   ├── d1_pcp_2024_01.pdf
│       │   └── ...
│       ├── ground_truth.json       # locked H-N, NOT touched H0-H10
│       └── prompt_hash.txt         # written by eval script before each Case 3 run
│
├── scripts/
│   ├── extract-case.ts             # CLI: tsx scripts/extract-case.ts case1
│   │                               # writes data/cases/<id>/events.json
│   ├── eval-case3.ts               # CLI: tsx scripts/eval-case3.ts
│   │                               # COMMITTED AT H0, NOT EDITED AFTER
│   └── eval-train.ts               # eval against Cases 1+2 during prompt iter
│
├── prompts/
│   ├── system_extract_v1.md        # versioned filename — bump on every change
│   ├── few_shot.md                 # 2-3 hand-built examples from Cases 1+2 only
│   └── CHANGELOG.md                # one line per version: hash, date, what changed
│
├── public/
│   └── pdf.worker.min.mjs          # react-pdf worker (copy from pdfjs-dist 5.x)
│
├── package.json
├── tsconfig.json
├── postcss.config.mjs              # Tailwind v4 PostCSS plugin (severity color tokens live in app/globals.css @theme inline block)
├── next.config.ts                  # serverExternalPackages: ['pdfjs-dist'] (Next 16: top-level, no longer experimental)
├── .env.example                    # ANTHROPIC_API_KEY, VOYAGE_API_KEY, GEMINI_API_KEY
├── .env.local                      # gitignored
└── README.md                       # demo instructions, model swap note (Q26)
```

**Pre-H0 artifacts (Murat must produce before clock starts):**
- `held_out/case3/docs/*.pdf` — written FIRST
- `held_out/case3/ground_truth.json` — labeled in same sitting, BEFORE Cases 1+2 PDFs are written
- `held_out/case3/README.md`
- `data/cases/case1/docs/*.pdf`, `data/cases/case2/docs/*.pdf`
- `prompts/system_extract_v1.md` (initial draft from [extraction-prompt-v1.md](extraction-prompt-v1.md))
- `prompts/few_shot.md` (2-3 manual examples from Cases 1+2 only)
- `scripts/eval-case3.ts` (committed at H0, **never edited** until post-demo)
- Tailwind color tokens decided (4 severity colors)
- API keys: Anthropic, Voyage, Gemini

**Built during H0-H11:** every other file.

---

## Files referenced (absolute paths)

All artifacts to be produced live under `/Users/muratalkan/chronicle/`:

- `/Users/muratalkan/chronicle/prompts/system_extract_v1.md`
- `/Users/muratalkan/chronicle/prompts/few_shot.md`
- `/Users/muratalkan/chronicle/prompts/CHANGELOG.md`
- `/Users/muratalkan/chronicle/lib/schema.ts`
- `/Users/muratalkan/chronicle/lib/claude.ts`
- `/Users/muratalkan/chronicle/lib/normalize.ts`
- `/Users/muratalkan/chronicle/lib/match.ts`
- `/Users/muratalkan/chronicle/lib/eval.ts`
- `/Users/muratalkan/chronicle/lib/sse.ts`
- `/Users/muratalkan/chronicle/lib/voyage.ts`
- `/Users/muratalkan/chronicle/lib/gemini.ts`
- `/Users/muratalkan/chronicle/lib/use-extraction-stream.ts`
- `/Users/muratalkan/chronicle/app/page.tsx` (landing — see docs/FRONTEND-STANDARDS.md §I)
- `/Users/muratalkan/chronicle/app/app/page.tsx` (product — Cases 1+2 + timeline + side panel)
- `/Users/muratalkan/chronicle/app/eval/page.tsx`
- `/Users/muratalkan/chronicle/app/api/extract/route.ts`
- `/Users/muratalkan/chronicle/app/api/explain/route.ts`
- `/Users/muratalkan/chronicle/app/api/related/route.ts`
- `/Users/muratalkan/chronicle/app/api/eval/route.ts`
- `/Users/muratalkan/chronicle/app/api/cases/[id]/events/route.ts`
- `/Users/muratalkan/chronicle/components/timeline.tsx`
- `/Users/muratalkan/chronicle/components/event-card.tsx`
- `/Users/muratalkan/chronicle/components/side-panel.tsx`
- `/Users/muratalkan/chronicle/components/pdf-viewer.tsx`
- `/Users/muratalkan/chronicle/components/dropzone.tsx`
- `/Users/muratalkan/chronicle/components/disclaimer-footer.tsx`
- `/Users/muratalkan/chronicle/components/splash-disclaimer.tsx`
- `/Users/muratalkan/chronicle/components/eval-table.tsx`
- `/Users/muratalkan/chronicle/scripts/extract-case.ts`
- `/Users/muratalkan/chronicle/scripts/eval-case3.ts`
- `/Users/muratalkan/chronicle/scripts/eval-train.ts`
- `/Users/muratalkan/chronicle/data/cases/case1/{events.json, metadata.json, docs/*.pdf}`
- `/Users/muratalkan/chronicle/data/cases/case2/{events.json, metadata.json, docs/*.pdf}`
- `/Users/muratalkan/chronicle/data/case3_eval_fallback.json`
- `/Users/muratalkan/chronicle/held_out/case3/{README.md, ground_truth.json, prompt_hash.txt, docs/*.pdf}`

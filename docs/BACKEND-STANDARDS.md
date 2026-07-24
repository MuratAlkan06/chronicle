# Chronicle — Backend Execution Standards (STUB FOR REVIEW)

**Status: STUB — Murat to review before dispatching the backend session.** Surface any disagreements, additions, or open-item answers below before the backend session starts. The "OPEN ITEMS" section at the bottom needs your decisions.

This file is read at the start of every backend session cycle. Binding for all backend surfaces (route handlers, lib functions, scripts).

---

## J.1 — Response shape (locked)

### Successful responses

- **JSON endpoints:** `application/json` body, no envelope wrapping (return the data directly).
- **SSE endpoints:** `text/event-stream`, one event per `data: <json>\n\n` frame. Optional `event: <type>` line.

### Error envelope (HTTP 4xx/5xx)

All routes return errors in this shape:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "retryable": false
  }
}
```

For SSE error frames mid-stream:

```json
{ "type": "error", "code": "string", "message": "string", "retryable": false }
```

Then close the stream.

### Error code conventions

| Code | When |
|---|---|
| `gt_hash_mismatch` | Case 3 ground truth modified since H0 lock (per resolved decision #7) |
| `prompt_dirty` | `prompts/` has uncommitted git changes when running Case 3 eval (per Q19) |
| `pdf_invalid` | Uploaded file isn't a parseable PDF |
| `extraction_failed` | Claude API returned malformed structured output |
| `snippet_unmatched` | Claude returned a snippet that doesn't match source PDF after normalization (per Q14, this is a per-event warning badge, not a hard error) |
| `rate_limit` | Claude / Voyage / Gemini rate limit hit |
| `upstream_unavailable` | Model API timeout or 5xx |

---

## J.2 — Streaming protocol (locked, per Q4)

`/api/extract` and `/api/eval?mode=live` are SSE streams. Event types:

| Type | Payload | When |
|---|---|---|
| `started` | `{}` | Stream opened |
| `doc_started` | `{ docId, filename, totalDocs }` | Per-doc extraction begins |
| `event` | `{ docId, event: <Event> }` | An event is extracted from a doc |
| `doc_complete` | `{ docId, eventCount }` | All events from one doc emitted |
| `doc_error` | `{ docId, message, retryable: false }` | One doc's extraction failed; others continue |
| `metric` | `{ tier, value }` | (eval only) precision/recall/F1 for one tier |
| `breakdown` | `{ byEventType }` | (eval only) per-event-type breakdown |
| `error` | `{ code, message, retryable }` | Stream-fatal error; close after |
| `done` | `{}` | Stream complete; close |

**Heartbeat:** send `: ping\n\n` every 15s to defeat any aggressive proxy timeout. Local-only demo so this is paranoia, but cheap.

---

## J.3 — Concurrency expectations (locked)

- Per-document extraction is fanned out via `Promise.all` (Q4). Anthropic accepts concurrent requests; rate limits are far above what a 7-doc burst will hit.
- Embeddings calls (Voyage `voyage-3`) are batched: one HTTP request with all event title+summary inputs per case, not per-event.
- No background jobs, no queues, no worker processes. Everything is request-scoped.

---

## J.4 — Token budget + prompt caching (locked, per Q7)

- **Sonnet 4.6** for extraction. Prompt caching enabled on `system` prompt + few-shot block (see [extraction-prompt-v1.md](extraction-prompt-v1.md) "Prompt-caching breakpoints" section).
- **Verify cache hits** in API response: log `usage.cache_read_input_tokens` and `usage.cache_creation_input_tokens` on every call, surface to console. After your 2nd or 3rd extraction, cache_read should be 80%+ of system+few-shot tokens. If it's 0, your `cache_control` is misplaced.
- **Opus 4.7 reserved as escape hatch** if Case 3 strict precision is poor (~$100 budget earmarked).

---

## J.5 — Held-out hygiene (locked, per resolved decision #7 + Q19)

- Case 3 PDFs and ground truth live ONLY under `held_out/case3/`.
- `scripts/eval-case3.ts` is committed at H0 and never edited until post-demo.
- Before any Case 3 extraction:
  1. Read `held_out/case3/.gt_hash.lock`
  2. Compute `git hash-object held_out/case3/ground_truth.json`
  3. If mismatch: refuse to run (CLI exits non-zero; SSE sends `error` frame and closes)
  4. Otherwise: write current `prompts/system_extract_v*.md` git hash to `held_out/case3/prompt_hash.txt`. Fail if `prompts/` has uncommitted changes.
- The few-shot examples in `prompts/few_shot.md` MUST come from Cases 1+2 only. Test-set leakage = invalid metric.

---

## J.6 — File structure (locked)

Backend code lives in:

- `app/api/*/route.ts` — Next.js Route Handlers (Node runtime)
- `lib/*.ts` — pure-function libraries (`claude`, `voyage`, `gemini`, `normalize`, `match`, `eval`, `sse`, `schema`)
- `scripts/*.ts` — CLI tools (`extract-case`, `eval-case3`, `eval-train`)

NO `pages/` directory (App Router only). NO `server/` directory. Co-locate route handlers with their routes.

---

## J.7 — External API keys (locked)

Env vars read from `.env.local` at project root:

| Var | Required | Purpose | Fallback |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Sonnet 4.6 extraction + Haiku 4.5 explainer fallback | — |
| `VOYAGE_API_KEY` | for related-events (Tier 1) | embeddings | `OPENAI_API_KEY` (text-embedding-3-small) |
| `OPENAI_API_KEY` | only as Voyage fallback | embeddings fallback | — |
| `GEMINI_API_KEY` | for patient explainer (Tier 1) | Gemini Flash | Skip Gemini, use Haiku via ANTHROPIC_API_KEY (per Q26) |

**Never log API keys. Never include them in error messages or SSE frames.**

---

## J.8 — Logging + observability (light, per hackathon scope)

`console.log` is fine. Format:

```
[<route>] <action> <details>
```

Examples:
- `[extract] doc_started d1_a1c_2023_01.pdf`
- `[claude] doc=d1_a1c_2023_01 input=8421 output=512 cache_read=2473 cache_create=0`
- `[eval] gt_hash_match (lock=abc1234)`

The `[claude]` line uses a fixed-field format (all four persisted usage fields,
greppable) — see §J.11. No external logging service, no Sentry. The dev server
console IS the log.

---

## J.9 — Validation + types (locked)

- All schema validation via **`zod`**. The single source of truth for shapes is `lib/schema.ts`, which mirrors [schema.md](../schema.md).
- Route handlers parse incoming JSON with zod, return 400 with the error envelope on parse failure.
- Tool input from Claude is parsed against the same zod schema as the response shape — if Claude returns malformed structured output, log as `extraction_failed` and skip that document, do not crash the request.

---

## J.10 — Body parser + abort handling (locked)

### Body parser (App Router)

Use App Router's native `request.formData()` for the multipart upload at `/api/extract`. It has no built-in size cap, so a 7-PDF × 1.5MB ≈ 10.5MB upload passes through without the legacy `pages/api` 1MB body limit biting. **Reject any individual file > 10 MB** (per the resolved PDF size cap below):

```ts
const formData = await request.formData();
const files = formData.getAll("files") as File[];
for (const file of files) {
  if (file.size > 10 * 1024 * 1024) {
    return Response.json(
      { error: { code: "pdf_invalid", message: `File ${file.name} exceeds 10MB limit`, retryable: false } },
      { status: 400 }
    );
  }
}
```

Do NOT use the legacy `pages/api/*` config syntax (`export const config = { api: { bodyParser: ... } }`) — App Router ignores it. `formData()` is the only correct path.

### AbortSignal propagation

When the SSE client disconnects (user closes the tab, navigates away, refreshes), the route handler's `request.signal` fires. **Pass that signal into every model call** so in-flight extractions cancel and stop spending tokens:

```ts
// In the route handler
const abortSignal = request.signal;

// In lib/claude.ts extractDoc(...)
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-6",
  // ... rest of config
}, { signal: abortSignal });
```

Same pattern for `fetch()` calls to Voyage (`fetch(url, { signal: abortSignal, ... })`) and `@google/generative-ai` SDK calls (the Gemini SDK accepts an `AbortSignal` in request options).

**Why it matters:** without this, a user closing the tab during a 7-doc extraction continues to bill against the API for the remaining ~30s of in-flight calls. Cheap to implement (~10 min), prevents silent waste.

---

## J.11 — Deterministic extraction + usage persistence (Phase A, issue #7)

> This section was added by reopening the "locked for the build" doc for Phase A
> measurement-rigor work (the commit message carries the rationale).

### Temperature 0

The extraction Messages call sets `temperature: 0` (`lib/claude.ts`) to minimize
run-to-run variance. `claude-sonnet-4-6` accepts `temperature`; the deprecation
that makes any non-default value return **HTTP 400** applies only to models
released *after* Claude Opus 4.6 (Opus 4.7+, Sonnet 5, …). If the model constant
is ever bumped past that line, remove the `temperature` field. Temperature 0 is
not bit-exact determinism — the reported held-out number is a 3-run mean±range
(see [EVAL.md](EVAL.md) "Held-out measurement protocol").

### Persisted usage fields (per extraction path)

Every extraction call surfaces the four Anthropic usage fields, normalized so
`null`/missing → `0` (`lib/measure.ts` `normalizeUsage`):

```
{ input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }
```

`extractDocWithUsage()` returns these alongside events; `extractDoc()` is a thin
wrapper for streaming callers that don't persist. They are written to:

| Path | Artifact | Fields |
|---|---|---|
| `scripts/extract-case.ts` | `data/cases/<id>/metadata.json` | `usageTotals` + `perDoc[].usage` |
| `scripts/eval-case3.ts` | `held_out/case3/eval_runs/<ts>.json` | `usage` + `perDocUsage` |
| `app/api/eval` (live) | `held_out/case3/eval_runs/<ts>.json` | `usage` + `perDocUsage` |

**Old artifacts without usage fields must remain readable** — all readers treat
usage as optional (the `metadata.json` consumer at `app/api/cases/[id]/events`
only reads `generatedAt`/`modelVersion`; `scripts/cache-report.ts` skips
artifacts with no usage). `cache-report.ts` aggregates usage → cache-hit % and $
saved vs no-caching, priced from the dated table in `lib/pricing.ts`.

---

## RESOLVED ITEMS (locked planner cycle 0.1)

- [x] **Voyage rate limit / pricing** — proceed as-is. ~9K tokens per full eval run = $0.0005. No retry/cache layer. On 429, fall back to OpenAI per existing fallback in J.7.
- [x] **Gemini Flash auth** — `@google/generative-ai` SDK. ~30 min to wire up vs ~90 min for raw REST.
- [x] **PDF size cap** — 10 MB per file, hard reject with `pdf_invalid` above that (per J.10 implementation snippet). Anthropic native PDF input limit is 32 MB so this is well within model bounds.
- [x] **Concurrent request cap** — `pLimit(8)`. Adds `p-limit` (~3KB dep). Prevents rate-limit storms on ad-hoc large uploads.
- [x] **Local-only telemetry** — confirmed. `console.log` only. No Sentry, PostHog, Plausible, anything.
- [x] **Anything to add** — added J.10 (body parser via `formData()` + AbortSignal propagation across Anthropic / Voyage / Gemini calls).

This file is now locked for the build. Future changes only via the parallel-session integration cycle (per [PLAN.md](../PLAN.md) "Cross-session execution model").

**Reopened once for Phase A (issue #7):** §J.8 console format updated and §J.11
added (temperature-0 extraction + usage persistence). Re-locked after that slice.

# Chronicle — API Contract

**Single source of truth for the API surface.** Both sessions read this. Any change requires updating this file + the route handler + [MOCK_DATA.md](MOCK_DATA.md) if response shape changes.

For response envelope conventions, error codes, and SSE event types, see [docs/BACKEND-STANDARDS.md](docs/BACKEND-STANDARDS.md).

For the event schema, see [schema.md](schema.md).

---

## `POST /api/extract`

Extract events from one or more PDFs. Streams events back as each doc completes.

**Request:**
- `multipart/form-data` with `files[]: File[]` (PDFs)
- OR `application/json` with `{ caseId: "case1" | "case2" | "case3" }` to replay precomputed events from `data/cases/<id>/events.json`

**Response:** `text/event-stream` (SSE)

Event types per [BACKEND-STANDARDS.md J.2](docs/BACKEND-STANDARDS.md):

```
data: {"type":"started"}\n\n
data: {"type":"doc_started","docId":"d1","filename":"d1_pcp_2023_01.pdf","totalDocs":7}\n\n
data: {"type":"event","docId":"d1","event":{<Event>}}\n\n
data: {"type":"event","docId":"d1","event":{<Event>}}\n\n
data: {"type":"doc_complete","docId":"d1","eventCount":4}\n\n
data: {"type":"doc_error","docId":"d2","message":"...","retryable":false}\n\n
data: {"type":"done"}\n\n
```

For cached replay (Cases 1+2), the SSE wrapper inserts a 1.5s artificial delay between docs for "feel" (per Q20). Per resolved decision #5: leaky-bucket on the consumer at 150ms — events arriving faster than 150ms apart get queued; slower passes through immediately.

---

## `GET /api/cases/:id/events`

Return precomputed events.json for a sample case.

**Request:** path param `id` ∈ `{ "case1", "case2", "case3" }`.

**Response:**
- 200 `application/json`:
  ```json
  {
    "caseId": "case1",
    "events": [<Event>, ...],
    "generatedAt": "2026-05-09T03:14:00-07:00",
    "modelVersion": "claude-sonnet-4-6"
  }
  ```
- 404 with [error envelope](docs/BACKEND-STANDARDS.md#j1--response-shape-locked) if case not found.

---

## `POST /api/explain`

Generate a patient-friendly explanation for one event. Streams the response token-by-token.

**Request:**
```json
{
  "eventId": "string",
  "event": {<Event>}
}
```

**Response:** `text/event-stream` (SSE)

```
data: {"type":"token","text":"This"}\n\n
data: {"type":"token","text":" lab"}\n\n
...
data: {"type":"done"}\n\n
```

**Provider:** Gemini Flash (or Haiku 4.5 fallback per Q26).

**System prompt:** "You are explaining a single medical timeline event to a patient. 2-3 sentences, define abbreviations, no recommendations, no use of the word should."

---

## `POST /api/related`

Find events related to a target event using Voyage embeddings cosine similarity.

**Request:**
```json
{
  "eventId": "string",
  "candidates": [<Event>, ...]
}
```

**Response:** 200 `application/json`:
```json
{
  "related": [
    { "eventId": "string", "score": 0.62 },
    { "eventId": "string", "score": 0.58 },
    { "eventId": "string", "score": 0.55 }
  ],
  "cached": false
}
```

Top-3 results with `score >= 0.55`. Embedding source: `voyage-3` over `title + " — " + summary` of each candidate. Fallback to OpenAI `text-embedding-3-small` on Voyage 401/429.

---

## `GET /api/eval`

Return precision/recall metrics for one of the cases.

**Request:** query params:
- `case` ∈ `{ "case1", "case2", "case3" }`
- `mode` ∈ `{ "live", "cached" }` (only Case 3 supports `live`)

### `mode=cached`

**Response:** 200 `application/json`:

```json
{
  "caseId": "case1",
  "tiers": {
    "strict": {
      "precision": 0.84, "recall": 0.79, "f1": 0.81,
      "tp": 12, "fp": 2, "fn": 3, "n_gt": 15
    },
    "loose": {
      "precision": 0.91, "recall": 0.88, "f1": 0.89,
      "tp": 13, "fp": 1, "fn": 2, "n_gt": 15
    }
  },
  "byEventType": {
    "lab": { "strict": {...}, "loose": {...}, "n_gt": 5 },
    "visit": { "strict": {...}, "loose": {...}, "n_gt": 4 },
    "diagnosis": { "strict": {...}, "loose": {...}, "n_gt": 1 },
    "medication": { "strict": {...}, "loose": {...}, "n_gt": 3 },
    "imaging": { "strict": {...}, "loose": {...}, "n_gt": 0 },
    "procedure": { "strict": {...}, "loose": {...}, "n_gt": 0 },
    "referral": { "strict": {...}, "loose": {...}, "n_gt": 2 }
  },
  "promptVersion": "system_extract_v3.md",
  "promptHash": "abc1234",
  "generatedAt": "2026-05-09T03:14:00-07:00"
}
```

Reports written by `scripts/eval-train.ts` during prompt iteration. Live in `data/eval_reports/<case>.json`.

### `mode=live` (Case 3 only)

**Response:** `text/event-stream` (SSE)

Per [BACKEND-STANDARDS.md J.2 + EVAL.md], streams in this order:

1. `{"type":"started"}`
2. **GT integrity check** (per resolved decision #7) — if `held_out/case3/.gt_hash.lock` mismatches `git hash-object held_out/case3/ground_truth.json`:
   ```
   data: {"type":"error","code":"gt_hash_mismatch","message":"Case 3 ground truth has been modified since H0 lock — eval refused","retryable":false}\n\n
   ```
   then close stream.
3. **Prompt hash log** — write current `prompts/system_extract_v*.md` git hash to `held_out/case3/prompt_hash.txt`. If `prompts/` has uncommitted changes:
   ```
   data: {"type":"error","code":"prompt_dirty",...}\n\n
   ```
4. For each Case 3 doc:
   - `{"type":"doc_started","docId":...}`
   - `{"type":"event","docId":...,"event":{...}}` (per extracted event)
   - `{"type":"doc_complete","docId":...}`
5. `{"type":"metric","tier":"strict","value":{precision, recall, f1, tp, fp, fn, n_gt}}`
6. `{"type":"metric","tier":"loose","value":{...}}`
7. `{"type":"breakdown","value":{byEventType: {...}}}`
8. Append predicted events + metrics to `held_out/case3/eval_runs/<timestamp>.json` (audit log)
9. `{"type":"done"}`

---

## Error response (all routes)

Per [BACKEND-STANDARDS.md J.1](docs/BACKEND-STANDARDS.md#j1--response-shape-locked):

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "retryable": false
  }
}
```

| HTTP status | Typical codes |
|---|---|
| 400 | `pdf_invalid`, schema validation failure |
| 422 | `extraction_failed` |
| 429 | `rate_limit` |
| 502 | `upstream_unavailable` |
| 500 | generic server error |

# Chronicle — Event Schema

**Single source of truth for the timeline event shape.** Both frontend and backend sessions read this. Any schema change requires updating this file + bumping `lib/schema.ts` + checking [MOCK_DATA.md](MOCK_DATA.md) still matches.

---

## Event JSON shape (locked, per PLAN.md §C)

```json
{
  "id": "uuid",
  "date": "ISO 8601 (YYYY-MM-DD)",
  "date_text": "string | null",
  "date_confidence": "exact | approximate | inferred",
  "event_type": "lab | imaging | visit | diagnosis | medication | procedure | referral",
  "title": "string (≤ 70 chars)",
  "summary": "string (1-2 sentences, patient-readable)",
  "severity": "info | monitor | concerning | urgent",
  "values": {
    "key": "string",
    "value": "string",
    "unit": "string",
    "ref_range": "string",
    "flag": "normal | high | low | critical-high | critical-low"
  } | null,
  "provider": "string | null",
  "source": {
    "document_id": "string",
    "page": "int (1-indexed)",
    "snippet": "string (verbatim from PDF, post-normalization match target)"
  },
  "related_ids": ["uuid", ...]
}
```

### Required fields

`id`, `date`, `date_confidence`, `event_type`, `title`, `summary`, `severity`, `source.document_id`, `source.page`, `source.snippet`.

### Optional fields

`date_text`, `values`, `provider`, `related_ids` (defaults to `[]`).

---

## Hard constraints

1. **Verbatim snippet rule (per Q14 + extraction prompt):** every event must have a `source.snippet` that appears in the source document EXACTLY as written, character-for-character (modulo OCR/PDF artifacts handled by `lib/normalize.ts` — NFKC + dehyphenation + whitespace collapse). On match failure, the event is rendered with a "source not pinpointed" badge — never dropped silently, never auto-retried.
2. **Severity err-toward-monitor (per extraction prompt):** when in doubt between two severity levels, pick the lower one. `urgent` should be rare. The product is "discussion priority," not clinical urgency.
3. **Date confidence honesty:**
   - `exact` — document states a full date for THIS event ("A1c collected on 03/15/2024")
   - `approximate` — partial date ("started metformin in March 2024", "early March 2024")
   - `inferred` — derived from context (document date + "two weeks ago", section header date with no event-specific date)
   - If genuinely unknown and uninferable, do NOT emit the event.

---

## Tool definition (`emit_events`) for Claude extraction

This is the `input_schema` for the `emit_events` tool that Claude calls per document. Source: [docs/extraction-prompt-v1.md](docs/extraction-prompt-v1.md).

```ts
const EXTRACT_EVENTS_TOOL = {
  name: "emit_events",
  description: "Emit the structured list of clinical events extracted from this document.",
  input_schema: {
    type: "object",
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "stable uuid v4" },
            date: { type: "string", description: "ISO 8601 date, YYYY-MM-DD" },
            date_text: { type: ["string", "null"], description: "raw date as written in document" },
            date_confidence: { type: "string", enum: ["exact", "approximate", "inferred"] },
            event_type: { type: "string", enum: ["lab", "imaging", "visit", "diagnosis", "medication", "procedure", "referral"] },
            title: { type: "string", maxLength: 70 },
            summary: { type: "string" },
            severity: { type: "string", enum: ["info", "monitor", "concerning", "urgent"] },
            values: {
              type: ["object", "null"],
              properties: {
                key: { type: "string" }, value: { type: "string" },
                unit: { type: "string" }, ref_range: { type: "string" },
                flag: { type: "string", enum: ["normal", "high", "low", "critical-high", "critical-low"] }
              }
            },
            provider: { type: ["string", "null"] },
            source: {
              type: "object",
              properties: {
                document_id: { type: "string" },
                page: { type: "integer", minimum: 1 },
                snippet: { type: "string", description: "verbatim quote from PDF, post-normalization match target" }
              },
              required: ["document_id", "page", "snippet"]
            },
            related_ids: { type: "array", items: { type: "string" }, default: [] }
          },
          required: ["id", "date", "date_confidence", "event_type", "title", "summary", "severity", "source"]
        }
      }
    },
    required: ["events"]
  }
};
```

---

## TypeScript types (for `lib/schema.ts`)

```ts
export type EventType =
  | "lab" | "imaging" | "visit" | "diagnosis"
  | "medication" | "procedure" | "referral";

export type Severity = "info" | "monitor" | "concerning" | "urgent";
export type DateConfidence = "exact" | "approximate" | "inferred";
export type LabFlag = "normal" | "high" | "low" | "critical-high" | "critical-low";

export interface EventValues {
  key: string;
  value: string;
  unit: string;
  ref_range: string;
  flag: LabFlag;
}

export interface EventSource {
  document_id: string;
  page: number;            // 1-indexed
  snippet: string;
}

export interface TimelineEvent {
  id: string;              // uuid v4
  date: string;            // ISO 8601 YYYY-MM-DD
  date_text: string | null;
  date_confidence: DateConfidence;
  event_type: EventType;
  title: string;           // ≤ 70 chars
  summary: string;         // 1-2 sentences
  severity: Severity;
  values: EventValues | null;
  provider: string | null;
  source: EventSource;
  related_ids: string[];
}

export interface CaseFixture {
  case_id: "case1" | "case2" | "case3";
  patient: string;
  condition: string;
  events: TimelineEvent[];
  // Case 3 mock fixture only:
  mock_only_not_eval_data?: true;
}
```

Use `zod` schemas as the source of truth, and derive these TS types via `z.infer<typeof Schema>`. Do not write the TS types by hand.

---

## Validation rules (zod)

- `date` must be valid ISO 8601 `YYYY-MM-DD`
- `title.length <= 70`
- `source.page >= 1`
- `id` matches uuid v4 format in production. Relaxed in fixtures (see [MOCK_DATA.md](MOCK_DATA.md) note).
- Enum fields strict to the listed values
- If `values` is present, all sub-fields required (no partial values objects)

---

## Notes for fixtures

[MOCK_DATA.md](MOCK_DATA.md) contains the Cases 1+2 fixtures — AI-generated during the planning session (STATE.md cycle 0) and consumed by the frontend session. Fixture event IDs use UUID-shaped strings with case-prefixed sequencing (e.g., `c1000001-0000-4000-8000-000000000001`) for human readability. These are valid UUID v4 format. Production extraction will use real `crypto.randomUUID()` outputs.

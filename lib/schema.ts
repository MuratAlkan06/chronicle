/**
 * Chronicle — zod schemas (single source of truth) + derived TS types.
 *
 * Mirrors /schema.md exactly. Any change here MUST also update schema.md.
 * Frontend and backend both import from this file. Do NOT hand-write the
 * TS types — they are derived via z.infer.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const EventTypeSchema = z.enum([
  "lab",
  "imaging",
  "visit",
  "diagnosis",
  "medication",
  "procedure",
  "referral",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const SeveritySchema = z.enum(["info", "monitor", "concerning", "urgent"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const DateConfidenceSchema = z.enum(["exact", "approximate", "inferred"]);
export type DateConfidence = z.infer<typeof DateConfidenceSchema>;

export const LabFlagSchema = z.enum([
  "normal",
  "high",
  "low",
  "critical-high",
  "critical-low",
]);
export type LabFlag = z.infer<typeof LabFlagSchema>;

// ---------------------------------------------------------------------------
// Composite shapes
// ---------------------------------------------------------------------------

/** All sub-fields required when values is non-null (per schema.md hard rule). */
export const EventValuesSchema = z.object({
  key: z.string(),
  value: z.string(),
  unit: z.string(),
  ref_range: z.string(),
  flag: LabFlagSchema,
});
export type EventValues = z.infer<typeof EventValuesSchema>;

export const EventSourceSchema = z.object({
  document_id: z.string(),
  page: z.number().int().min(1),
  snippet: z.string(),
});
export type EventSource = z.infer<typeof EventSourceSchema>;

/**
 * ISO 8601 date string YYYY-MM-DD. Lightweight regex; full calendar
 * validity is not enforced (Claude rarely emits 2024-02-30 and the
 * downstream sort is robust to it).
 */
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const TimelineEventSchema = z.object({
  id: z.string(),
  date: IsoDateSchema,
  date_text: z.string().nullable().default(null),
  date_confidence: DateConfidenceSchema,
  event_type: EventTypeSchema,
  title: z.string().max(70),
  summary: z.string(),
  severity: SeveritySchema,
  values: EventValuesSchema.nullable().default(null),
  provider: z.string().nullable().default(null),
  source: EventSourceSchema,
  related_ids: z.array(z.string()).default([]),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const CaseFixtureSchema = z.object({
  case_id: z.enum(["case1", "case2", "case3"]),
  patient: z.string(),
  condition: z.string(),
  events: z.array(TimelineEventSchema),
  mock_only_not_eval_data: z.literal(true).optional(),
});
export type CaseFixture = z.infer<typeof CaseFixtureSchema>;

// ---------------------------------------------------------------------------
// SSE frame discriminated union (per BACKEND-STANDARDS.md J.2)
// ---------------------------------------------------------------------------

export type SseFrame =
  | { type: "started" }
  | { type: "doc_started"; docId: string; filename: string; totalDocs: number }
  | { type: "event"; docId: string; event: TimelineEvent }
  | { type: "doc_complete"; docId: string; eventCount: number }
  | { type: "doc_error"; docId: string; message: string; retryable: false }
  | { type: "metric"; tier: "strict" | "loose"; value: Record<string, unknown> }
  | { type: "breakdown"; value: Record<string, unknown> }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "done" };

// ---------------------------------------------------------------------------
// Claude tool definition — copied verbatim from schema.md §"Tool definition"
// (kept in sync; any structural change requires updating both files + the
// extraction prompt).
// ---------------------------------------------------------------------------

export const EXTRACT_EVENTS_TOOL = {
  name: "emit_events",
  description:
    "Emit the structured list of clinical events extracted from this document.",
  input_schema: {
    type: "object" as const,
    properties: {
      events: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            id: { type: "string", description: "stable uuid v4" },
            date: { type: "string", description: "ISO 8601 date, YYYY-MM-DD" },
            date_text: {
              type: ["string", "null"],
              description: "raw date as written in document",
            },
            date_confidence: {
              type: "string",
              enum: ["exact", "approximate", "inferred"],
            },
            event_type: {
              type: "string",
              enum: [
                "lab",
                "imaging",
                "visit",
                "diagnosis",
                "medication",
                "procedure",
                "referral",
              ],
            },
            title: { type: "string", maxLength: 70 },
            summary: { type: "string" },
            severity: {
              type: "string",
              enum: ["info", "monitor", "concerning", "urgent"],
            },
            values: {
              type: ["object", "null"],
              properties: {
                key: { type: "string" },
                value: { type: "string" },
                unit: { type: "string" },
                ref_range: { type: "string" },
                flag: {
                  type: "string",
                  enum: ["normal", "high", "low", "critical-high", "critical-low"],
                },
              },
            },
            provider: { type: ["string", "null"] },
            source: {
              type: "object",
              properties: {
                document_id: { type: "string" },
                page: { type: "integer", minimum: 1 },
                snippet: {
                  type: "string",
                  description:
                    "verbatim quote from PDF, post-normalization match target",
                },
              },
              required: ["document_id", "page", "snippet"],
            },
            related_ids: {
              type: "array",
              items: { type: "string" },
              default: [],
            },
          },
          required: [
            "id",
            "date",
            "date_confidence",
            "event_type",
            "title",
            "summary",
            "severity",
            "source",
          ],
        },
      },
    },
    required: ["events"],
  },
} as const;

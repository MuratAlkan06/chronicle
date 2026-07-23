/**
 * Chronicle — Anthropic extraction client.
 *
 * Per docs/BACKEND-STANDARDS.md §J.4 + §J.10 and prompts/system_extract_v4.md
 * (active prompt; v1 retained in prompts/ for the iteration audit trail).
 *
 * As-built (post Block 5b verification): Citations API is NOT used. The model
 * is forced to the `emit_events` tool; `source.snippet` is the model's
 * verbatim claim, validated downstream by `lib/match.ts` against normalized
 * PDF text. See prompts/system_extract_v4.md preamble (carries the v1
 * Block 5b empirical evidence forward).
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXTRACT_EVENTS_TOOL,
  TimelineEventSchema,
  type TimelineEvent,
} from "./schema";
import { normalizeUsage, type ExtractUsage } from "./measure";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;

// Deterministic-as-possible extraction (Phase A rigor per docs/EVAL.md).
// claude-sonnet-4-6 ACCEPTS `temperature` — the sampling-parameter deprecation
// (any non-default value → HTTP 400) only applies to models released after
// Claude Opus 4.6 (Opus 4.7+, Sonnet 5, Fable 5, …). Verified against the
// Anthropic docs/SDK on 2026-07-22. IF THE MODEL IS EVER BUMPED past that line,
// this constant MUST be removed (omit the field) or every call will 400.
// temperature:0 minimizes run-to-run variance but does NOT guarantee bit-exact
// determinism; the N-run mean±range in scripts/eval-case3.ts is the primary
// rigor mechanism.
const TEMPERATURE = 0;

export type { ExtractUsage } from "./measure";

// Inline copy of the system prompt body. Source: prompts/system_extract_v4.md.
// Kept inline (not file-read at request time) so the prompt-cache key is
// stable across invocations and so a single zip of the lib/ folder is
// self-contained for Vercel-style bundling.
const SYSTEM_PROMPT = `You are a medical-records timeline extractor. You read one patient document at a time (lab result, doctor's note, imaging report, discharge summary, referral, prescription) and you emit a structured list of clinically discrete EVENTS that belong on a patient-facing chronological timeline.

Your output is consumed by a non-clinician patient who is preparing for a conversation with their doctor. The product explicitly says "not medical advice." You are organizing, not diagnosing.

## What counts as ONE event
ONE event = one clinically discrete moment in the record:
- a single lab order/result (one event per panel ordered on one date, with the panel's notable values aggregated; do NOT emit one event per analyte unless the document treats them as separate orders)
- a single visit/encounter (one event per encounter date with one provider)
- a single imaging study (CT, MRI, X-ray, mammogram — one per study)
- a single diagnosis added to the problem list
- a single medication started, stopped, or dose-changed
- a single procedure performed
- a single referral placed

Do NOT emit:
- patient demographics, insurance, header/footer text
- "no change" or "continues" mentions of prior events UNLESS the document explicitly RE-CONFIRMS a finding on a new date
- forward-looking plans ("will reassess in 3 months", "biopsy scheduled for 03/28") — these describe intentions, not occurrences
- the document's own metadata (date faxed, date printed, signed by) unless it IS the event date

## Primary-source rule (NON-NEGOTIABLE)
Emit an event ONLY when THIS document is the PRIMARY SOURCE of that event. A document is the primary source when it is the document that:
- reports a lab/imaging result for the first time (the lab report itself, not a later visit note that recaps it)
- records a visit/encounter being conducted (the visit note for that encounter, not a follow-up note that mentions it)
- records a diagnosis being added to the active problem list (not a later note that lists it as PMH)
- records a medication being started, stopped, or dose-changed (not a later note that lists it as a current medication unchanged)
- records a procedure being performed (not the surgical consult that scheduled it, not the follow-up note that recaps the pathology result)
- records a referral being placed (not a later note that mentions the patient was previously referred)

If this document merely REFERENCES a prior event for context — phrases like "prior A1c was 9.2%", "previously seen by ortho", "last mammogram showed 1.2 cm mass", "s/p core needle biopsy", "PMH notable for T2D", "current medications: metformin 500mg unchanged" — do NOT emit a new event for that reference. The event has been (or will be) captured from its own primary source document, and emitting it again creates duplicates.

When in doubt, ask: "is this document the one PERFORMING, DECIDING, or REPORTING this event for the first time?" If no, do not emit.

## The verbatim snippet rule (NON-NEGOTIABLE)
Every event you emit MUST be grounded in a verbatim quote from the source PDF. The snippet you cite:
- must appear in the document EXACTLY as written, character-for-character
- must be the SHORTEST contiguous span that supports the event (typically 10-40 words; never a full paragraph)
- must contain enough specificity that a human reading just the snippet would agree it supports the event
- must include the date if the date is the headline of the event, OR the value/finding if the value is the headline

If you cannot find a verbatim snippet that meets all four criteria, do NOT emit the event.

## Date confidence assignment
- exact: the document states a full date for THIS event
- approximate: the document states a partial date
- inferred: you derived the date from context

If the date is genuinely unknown and uninferable, do NOT emit the event.

## Severity assignment (PATIENT-FACING discussion priority)
- info: routine, expected, or normal finding
- monitor: abnormal but not acute
- concerning: clearly abnormal, the doctor is likely to address it proactively
- urgent: the document itself uses urgent/stat language

WHEN IN DOUBT, CHOOSE \`monitor\`, NOT \`urgent\`. \`urgent\` should be rare.

## Event type assignment
Use exactly one of: lab, imaging, visit, diagnosis, medication, procedure, referral. If a single document encounter contains multiple types, emit MULTIPLE events.

## Title (≤ 70 chars)
A short scannable headline. KEEP IT TERSE — the summary field is where clinical detail goes; title is for visual scanning.

Per-type format conventions:
- lab: "<test name> — <result> <unit>" e.g., "A1c — 9.2 %", "LDL — 145 mg/dL". Single-analyte focus per the "one event per panel" rule above; do not list multiple analytes in the title.
- imaging: "<modality> <body part> — <one-line finding>" e.g., "Mammogram — BI-RADS 4 (suspicious)", "MRI lumbar spine — L4-L5 disc herniation"
- diagnosis: "Dx added: <condition>" e.g., "Dx added: Type 2 Diabetes Mellitus". The "Dx added:" prefix is required and signals this is a NEW problem-list entry, not a workup impression or differential — if the document is recording a working impression rather than adding to the active problem list, do not emit a diagnosis event.
- medication: "<verb> <drug name> <dose>" with verb ∈ {Started, Stopped, Increased, Decreased} e.g., "Started metformin 500 mg b.i.d.", "Increased metformin to 1000 mg b.i.d."
- procedure: "<procedure name>" e.g., "Core needle biopsy — benign", "Colonoscopy"
- referral: "Referral to <specialty>" e.g., "Referral to breast surgery", "Referral to ophthalmology"

For VISIT events specifically, pick the SHORTEST template that fits, in this order:
- "<specialty> visit — <2-3 word purpose>" e.g., "PCP visit — initial workup"
- "<specialty> follow-up — <2-3 word purpose>" e.g., "PCP follow-up — A1c discussion", "PCP follow-up — lifestyle counseling"
- "<specialty> consult" e.g., "Breast surgery consult"
- "Annual physical exam" (when the encounter IS the patient's routine annual)

Specialty prefix is required (PCP / OB/GYN / Orthopedics / Pain Management / Breast Surgery / etc.) so the visit type and care setting are both visible at a glance. Do NOT pile on adjectives from the chief complaint paragraph — e.g., do NOT write "PCP annual physical — new symptoms reported, fatigue and increased thirst"; write "PCP visit — initial workup". The 2-3 word purpose phrase is a tag, not a sentence.

## Summary (1-2 sentences, patient-readable)
Plain language. Define abbreviations on first use. NEVER add a recommendation. NEVER use the word "should."

## Values (labs only)
For lab events, populate \`values\` with one analyte: {key, value, unit, ref_range, flag}. flag ∈ {"normal", "high", "low", "critical-high", "critical-low"}.

For non-lab events with multiple measurements (e.g., a visit with vitals), leave \`values\` as null. Per-event values is single-analyte ONLY; do NOT return a free-form key-value map.

## Refusal / uncertainty
- Non-medical document → emit ZERO events.
- Unreadable page → skip silently, continue.
- Entire document unreadable → emit ZERO events.

## Output format
Call the \`emit_events\` tool exactly once with the full events array. Do NOT emit any text blocks — the response should contain only the single tool_use block.
`;

// Few-shot block — loaded once at module init from prompts/few_shot.md.
// Two multi-event examples covering all 7 event_type values (per
// docs/RESOLVED-DECISIONS.md §4 and §8). Read at module load (not per
// call) so the prompt-cache key stays stable across invocations and a
// single bundled lib/ folder is self-contained at runtime.
const FEW_SHOT_BLOCK = readFileSync(
  join(process.cwd(), "prompts", "few_shot.md"),
  "utf8",
);

const USER_TPL = (filename: string, docId: string) =>
  `Document filename: ${filename}
Document ID: ${docId}
(Patient name, DOB, and document date will be visible inside the PDF. Use the date inside the PDF, not metadata.)

Extract all clinically discrete events from the attached PDF following the system instructions. Remember: verbatim snippets only, shortest supporting span, when in doubt skip.`;

export interface ExtractDocOptions {
  signal?: AbortSignal;
}

/** Events plus the per-call token usage, for callers that persist usage. */
export interface ExtractResult {
  events: TimelineEvent[];
  usage: ExtractUsage;
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY env var is required for extraction");
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

/**
 * Extract timeline events from a single PDF buffer, returning the validated
 * events. Thin wrapper over {@link extractDocWithUsage} for the many callers
 * that don't persist token usage (SSE streaming, prewarm, preflight).
 *
 * On per-event zod failure: log warning + drop the event (do not crash the
 * document). On no tool_use block: throw with code `extraction_failed`.
 */
export async function extractDoc(
  pdfBuffer: Buffer,
  docId: string,
  filename: string,
  options: ExtractDocOptions = {},
): Promise<TimelineEvent[]> {
  return (await extractDocWithUsage(pdfBuffer, docId, filename, options)).events;
}

/**
 * Extract timeline events AND surface the per-call token usage. Used by the
 * persistence paths (scripts/extract-case.ts metadata, scripts/eval-case3.ts +
 * app/api/eval measurement runs) so cache hits and cost are auditable after the
 * fact (docs/BACKEND-STANDARDS.md §J.4, §J.11).
 */
export async function extractDocWithUsage(
  pdfBuffer: Buffer,
  docId: string,
  filename: string,
  options: ExtractDocOptions = {},
): Promise<ExtractResult> {
  const client = getClient();

  const response = await client.messages.create(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: [
        { type: "text", text: SYSTEM_PROMPT },
        // Cache breakpoint stays here so few-shot drops in cleanly later.
        {
          type: "text",
          text: FEW_SHOT_BLOCK,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfBuffer.toString("base64"),
              },
              // NOTE: no `citations: { enabled: true }` — Block 5b proved
              // citations do not attach in the as-built tool-forced flow.
              // See prompts/system_extract_v4.md preamble for evidence
              // (carried forward from v1).
            },
            { type: "text", text: USER_TPL(filename, docId) },
          ],
        },
      ],
      tools: [EXTRACT_EVENTS_TOOL as unknown as Anthropic.Messages.Tool],
      tool_choice: { type: "tool", name: "emit_events" },
    },
    { signal: options.signal },
  );

  // Surface cache hits per BACKEND-STANDARDS J.4/J.8 — operator visibility.
  // Fixed-field format (matches J.8 example) so log lines are greppable and
  // the four persisted usage fields are visible at a glance.
  const usage = normalizeUsage(response.usage);
  console.log(
    "[claude] doc=%s input=%d output=%d cache_read=%d cache_create=%d",
    docId,
    usage.input_tokens,
    usage.output_tokens,
    usage.cache_read_input_tokens,
    usage.cache_creation_input_tokens,
  );

  const toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      block.type === "tool_use" && block.name === "emit_events",
  );
  if (!toolUse) {
    const err = new Error(`extraction_failed: no emit_events tool_use block for doc ${docId}`);
    (err as Error & { code?: string }).code = "extraction_failed";
    throw err;
  }

  const rawEvents = (toolUse.input as { events?: unknown[] })?.events ?? [];
  if (!Array.isArray(rawEvents)) {
    const err = new Error(`extraction_failed: tool_use.input.events is not an array for doc ${docId}`);
    (err as Error & { code?: string }).code = "extraction_failed";
    throw err;
  }

  const validated: TimelineEvent[] = [];
  for (const raw of rawEvents) {
    // Re-stamp `id` to a fresh UUID — the model emits colliding ids across docs
    // (observed: 26 events, 17 unique ids in cycle-6 case1 extraction). React
    // keys, Set-based dedup, related_ids cross-references, and the eval matcher
    // all assume globally unique ids; we don't, so we generate them server-side.
    // Stamp document_id / page defaults BEFORE validating so the schema's
    // required source fields are always present.
    const candidate = withSourceOverrides(raw, docId);
    const parsed = TimelineEventSchema.safeParse(candidate);
    if (parsed.success) {
      validated.push({ ...parsed.data, id: crypto.randomUUID() });
    } else {
      const id = (raw as { id?: unknown })?.id ?? "<unknown>";
      console.warn(
        "[claude] extraction_failed event_id=%s reason=%s",
        String(id),
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
  }

  return { events: validated, usage };
}

/**
 * Force `source.document_id = docId` and default `source.page = 1` if the
 * model omitted it. Other fields untouched so the zod schema can still
 * catch anything the model genuinely got wrong.
 */
function withSourceOverrides(raw: unknown, docId: string): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  const source = (obj.source as Record<string, unknown> | undefined) ?? {};
  return {
    ...obj,
    source: {
      ...source,
      document_id: docId,
      page: typeof source.page === "number" && source.page >= 1 ? source.page : 1,
    },
  };
}

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

/**
 * The model Chronicle extracts with by default. Exported so the persistence +
 * measurement paths (scripts/eval-case3.ts, app/api/eval, scripts/extract-case.ts)
 * default to and record the SAME id, and so the Case 3 escape-hatch experiment
 * (docs/BUILD.md) can override it per-run via `--model` without editing code.
 */
export const ACTIVE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;

// Deterministic-as-possible extraction (Phase A rigor per docs/EVAL.md).
// temperature:0 minimizes run-to-run variance but does NOT guarantee bit-exact
// determinism; the N-run mean±range in scripts/eval-case3.ts is the primary
// rigor mechanism. Whether the field may be sent AT ALL is model-dependent —
// see supportsTemperaturePin below; the request omits it for models that reject it.
const PINNED_TEMPERATURE = 0;

/**
 * Does `model` accept an explicit `temperature` on the Messages API?
 *
 * Anthropic deprecated non-default sampling parameters: every model released
 * *after* the Claude Opus 4.6 wave rejects a non-default `temperature` (also
 * top_p / top_k) with HTTP 400 — only the model default is allowed, so the field
 * must be OMITTED for those models. Verified against the @anthropic-ai/sdk
 * `temperature` `@deprecated` note ("Models released after Claude Opus 4.6 do
 * not support setting temperature … all other values will be rejected with a
 * 400 error") and the /v1/models catalog on 2026-07-23.
 *
 * The boundary is a release *wave*, encoded as a version threshold so it holds
 * for future ids without a lookup table:
 *   - generation ≥ 5          → reject  (Sonnet 5, Fable 5, …)
 *   - generation 4, minor ≥ 7 → reject  (Opus 4.7, Opus 4.8, …)
 *   - 4.6 and earlier         → accept  (Sonnet 4.6 = ACTIVE_MODEL, Opus 4.6,
 *                                        Sonnet/Haiku/Opus 4.5, Opus 4.1, …)
 * Unparseable ids default to the SAFE side (reject → omit temperature) so an
 * unrecognized model can never 400 the extraction path.
 */
export function supportsTemperaturePin(model: string): boolean {
  const m = /^claude-[a-z]+-(\d+)(?:-(\d+))?/.exec(model);
  if (!m) return false; // unknown id → safe side (omit temperature)
  const generation = Number(m[1]);
  const minor = m[2] === undefined ? 0 : Number(m[2]);
  if (generation >= 5) return false; // Sonnet 5, Fable 5, and later waves
  if (generation === 4 && minor >= 7) return false; // Opus 4.7+ wave
  return true; // Opus/Sonnet/Haiku 4.6 and earlier accept temperature
}

/**
 * Outcome of normalizing the `emit_events` tool payload: either the events
 * array (documented shape) or a loud, per-doc reason to fail on. Discriminated
 * so the pure normalizer never throws and every branch is unit-testable.
 */
export type EmittedEvents =
  | { events: unknown[] }
  | { error: string };

// Cap on how many wrapper/encoding layers we peel before giving up, so a
// pathological self-nesting payload can never loop.
const MAX_TOOL_UNWRAP = 4;

/**
 * Normalize the `emit_events` tool payload into the documented events array,
 * tolerating the mechanically-equivalent encodings emitted by post-Opus-4.6
 * models. Those models reject temperature pinning (run at their default) and
 * vary their tool-call serialization run-to-run — observed live 2026-07-23,
 * `claude-opus-4-7` on case1: on some docs `input.events` is a JSON *string*
 * that itself decodes to `{ events: [...] }` (the whole payload re-encoded),
 * while on others it is the canonical array. Accepted encodings (each a pure
 * SHAPE normalization — never invents or alters event CONTENT):
 *
 *   - canonical array                       → as-is (Sonnet + most Opus docs)
 *   - absent / null                         → `[]` (zero events; documented `?? []`)
 *   - JSON string of the payload/array      → JSON.parse, then re-normalize
 *   - nested `{ events: <array> }` wrapper  → unwrap `.events`
 *   - numeric-keyed object `{"0":..,"1":..}`→ values in index order (array-as-object)
 *   - a single bare event object            → wrap in a one-element array
 *
 * Anything else (a non-JSON string, an object that is neither a wrapper nor an
 * array-as-object nor a single event, over-deep nesting) resolves to
 * `{ error }` so the caller fails that document LOUDLY — we never silently
 * guess at an ambiguous shape.
 *
 * Takes the `events` field value (`toolUse.input.events`), NOT the whole input.
 */
export function normalizeEmittedEvents(field: unknown): EmittedEvents {
  return coerceNode(field, 0);
}

function coerceNode(node: unknown, depth: number): EmittedEvents {
  if (depth > MAX_TOOL_UNWRAP) {
    return { error: "events payload nested past the unwrap limit" };
  }
  // Absent → zero events. Preserves the documented `input.events ?? []` behavior
  // so a doc the model declines to emit events for is not a failure.
  if (node === undefined || node === null) return { events: [] };
  // Documented shape.
  if (Array.isArray(node)) return { events: node };
  // JSON-string encoding (opus-4-7): decode then re-normalize the result.
  if (typeof node === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(node);
    } catch {
      return { error: "events field is a string but not valid JSON" };
    }
    return coerceNode(parsed, depth + 1);
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    // Nested `{ events: ... }` wrapper (e.g. the decoded d2 string) → unwrap.
    if ("events" in obj) return coerceNode(obj.events, depth + 1);
    // Array serialized as an object with contiguous "0".."n-1" keys → values.
    if (isNumericKeyed(obj)) return { events: numericKeyedValues(obj) };
    // A single bare event object (no wrapper) → wrap it. `event_type` is the
    // discriminating field present on every event and on no wrapper.
    if (typeof obj.event_type === "string") return { events: [obj] };
  }
  return { error: "unrecognized events payload shape" };
}

/** True iff `obj`'s keys are exactly the contiguous integer strings 0..n-1. */
function isNumericKeyed(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  const nums: number[] = [];
  for (const k of keys) {
    if (!/^\d+$/.test(k)) return false;
    nums.push(Number(k));
  }
  nums.sort((a, b) => a - b);
  return nums.every((n, i) => n === i);
}

/** Values of a numeric-keyed object, ordered by ascending integer key. */
function numericKeyedValues(obj: Record<string, unknown>): unknown[] {
  return Object.keys(obj)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => obj[k]);
}

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
  /**
   * Override the extraction model for this call. Defaults to {@link ACTIVE_MODEL}.
   * Used by the Case 3 escape-hatch experiment (scripts/eval-case3.ts --model).
   * `temperature` is included or omitted automatically per
   * {@link supportsTemperaturePin} for whichever model is used.
   */
  model?: string;
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
  const model = options.model ?? ACTIVE_MODEL;

  const response = await client.messages.create(
    {
      model,
      max_tokens: MAX_TOKENS,
      // Send `temperature` only for models that accept it (4.6 wave and earlier);
      // post-Opus-4.6 models 400 on any non-default value (supportsTemperaturePin).
      // Spread so the key is ABSENT — not `undefined` — when unsupported.
      ...(supportsTemperaturePin(model) ? { temperature: PINNED_TEMPERATURE } : {}),
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

  // Normalize the tool payload to the documented events array, tolerating the
  // mechanically-equivalent encodings post-Opus-4.6 models emit at their default
  // temperature (JSON-string, nested wrapper, array-as-object, single object —
  // see normalizeEmittedEvents). An unrecognized/ambiguous shape fails THIS doc
  // loudly (code extraction_failed) so the eval harness records the docFailure
  // and continues; it never silently drops to zero events.
  const normalized = normalizeEmittedEvents((toolUse.input as { events?: unknown })?.events);
  if ("error" in normalized) {
    const err = new Error(
      `extraction_failed: ${normalized.error} (tool_use.input.events) for doc ${docId}`,
    );
    (err as Error & { code?: string }).code = "extraction_failed";
    throw err;
  }
  const rawEvents = normalized.events;

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

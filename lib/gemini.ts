/**
 * Chronicle — Gemini patient-explainer client.
 *
 * Per docs/BACKEND-STANDARDS.md §J.7 (env vars) + §J.10 (AbortSignal) and
 * PLAN.md Q26 (Gemini Flash primary, Haiku 4.5 fallback). Used by
 * app/api/explain/route.ts.
 *
 * One narrow surface: stream a 2-3 sentence patient-friendly explanation of
 * a single timeline event. The route catches any throw here and falls back
 * to Haiku 4.5 inline.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GenerativeModel } from "@google/generative-ai";
import type { TimelineEvent } from "./schema";

const MODEL = "gemini-2.5-flash";

// System prompt verbatim from API.md `POST /api/explain`. Both providers share
// this string so swap-on-failure produces identical guidance.
export const EXPLAIN_SYSTEM_PROMPT =
  "You are explaining a single medical timeline event to a patient. 2-3 sentences, define abbreviations, no recommendations, no use of the word should.";

let _client: GoogleGenerativeAI | null = null;
function getClient(): GoogleGenerativeAI {
  if (_client) return _client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY env var is required for /api/explain");
  }
  _client = new GoogleGenerativeAI(apiKey);
  return _client;
}

function getModel(): GenerativeModel {
  return getClient().getGenerativeModel({
    model: MODEL,
    systemInstruction: EXPLAIN_SYSTEM_PROMPT,
  });
}

export interface ExplainOptions {
  signal?: AbortSignal;
}

/**
 * Serialize a TimelineEvent into the compact, human-readable form fed to the
 * LLM as the user message. Skips empty/null fields. Canonical key order is
 * stable so prompt-cache keys do not drift across calls. Exported for tests
 * and so the Haiku fallback path in app/api/explain/route.ts produces the
 * identical user prompt as the Gemini path.
 */
export function serializeEvent(event: TimelineEvent): string {
  const lines: string[] = [];
  lines.push(`Event type: ${event.event_type}`);
  lines.push(`Date: ${event.date}`);
  if (event.date_text) lines.push(`Date as written: ${event.date_text}`);
  lines.push(`Date confidence: ${event.date_confidence}`);
  lines.push(`Severity: ${event.severity}`);
  lines.push(`Title: ${event.title}`);
  lines.push(`Summary (verbatim from extraction): ${event.summary}`);
  if (event.values) {
    const v = event.values;
    lines.push(
      `Lab values: ${v.key} = ${v.value} ${v.unit} (reference ${v.ref_range}, flag ${v.flag})`,
    );
  }
  if (event.provider) lines.push(`Provider: ${event.provider}`);
  lines.push(`Source snippet: "${event.source.snippet}"`);
  return lines.join("\n");
}

/**
 * Stream a 2-3 sentence patient-friendly explanation of one timeline event.
 * Yields incremental text chunks; consumer concatenates them.
 *
 * Throws on missing key / network / auth / content-filter so the route can
 * fall back to Haiku 4.5 per Q26. Honors `signal` per BACKEND-STANDARDS J.10.
 */
export async function* explainEventGemini(
  event: TimelineEvent,
  options: ExplainOptions = {},
): AsyncIterable<string> {
  const { signal } = options;
  if (signal?.aborted) return;

  const model = getModel();
  const userPrompt = serializeEvent(event);

  const result = await model.generateContentStream(
    {
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    },
    { signal },
  );

  let tokenCount = 0;
  for await (const chunk of result.stream) {
    if (signal?.aborted) return;
    const text = chunk.text();
    if (text) {
      tokenCount += 1;
      yield text;
    }
  }

  // [route] [action] [details] convention from J.8 — observable usage.
  console.log(
    "[gemini] event_id=%s tokens=%d",
    event.id,
    tokenCount,
  );
}

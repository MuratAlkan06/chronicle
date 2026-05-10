/**
 * POST /api/explain
 *
 * Per API.md + docs/BACKEND-STANDARDS.md §J.1, §J.2, §J.7, §J.10 and PLAN.md
 * Q21 (disclaimer is a frontend surface, server is content-only) + Q26
 * (Gemini Flash primary, Haiku 4.5 fallback).
 *
 * Tries Gemini first. On missing GEMINI_API_KEY OR any in-flight provider
 * error (auth, network, content-filter), falls back to Haiku 4.5 inline —
 * caller never has to know which provider produced the tokens. If both
 * providers fail, emits a single `error` frame with code `upstream_unavailable`
 * and closes the stream.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  EXPLAIN_SYSTEM_PROMPT,
  explainEventGemini,
  serializeEvent,
} from "@/lib/gemini";
import { TimelineEventSchema, type TimelineEvent } from "@/lib/schema";
import { createSseStream, sseEvent, sseResponse } from "@/lib/sse";

export const runtime = "nodejs";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const HAIKU_MAX_TOKENS = 400;

const RequestSchema = z.object({
  eventId: z.string(),
  event: TimelineEventSchema,
});

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json(
    { error: { code, message, retryable: false } },
    { status },
  );
}

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (_anthropic) return _anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY env var is required for Haiku fallback");
  }
  _anthropic = new Anthropic({ apiKey });
  return _anthropic;
}

/**
 * Stream Haiku 4.5 explanation tokens. Same system + user prompts as Gemini
 * path so the swap is content-equivalent. Yields one string per text delta.
 */
async function* explainEventHaiku(
  event: TimelineEvent,
  signal: AbortSignal,
): AsyncIterable<string> {
  if (signal.aborted) return;
  const client = getAnthropic();
  const stream = client.messages.stream(
    {
      model: HAIKU_MODEL,
      max_tokens: HAIKU_MAX_TOKENS,
      system: EXPLAIN_SYSTEM_PROMPT,
      messages: [{ role: "user", content: serializeEvent(event) }],
    },
    { signal },
  );

  let tokenCount = 0;
  for await (const ev of stream) {
    if (signal.aborted) return;
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      const text = ev.delta.text;
      if (text) {
        tokenCount += 1;
        yield text;
      }
    }
  }

  console.log("[haiku] event_id=%s tokens=%d", event.id, tokenCount);
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to parse JSON body";
    return errorResponse("pdf_invalid", message, 400);
  }

  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return errorResponse("pdf_invalid", `invalid request body: ${issues}`, 400);
  }
  const { eventId, event } = parsed.data;
  const signal = request.signal;

  const stream = createSseStream({
    signal,
    start: async (enqueue) => {
      // Try Gemini first if keyed; on first-chunk-or-later failure, fall back.
      const tryGemini = !!process.env.GEMINI_API_KEY;
      let geminiProduced = false;

      if (tryGemini) {
        try {
          for await (const text of explainEventGemini(event, { signal })) {
            if (signal.aborted) return;
            geminiProduced = true;
            enqueue(sseEvent("token", { text }));
          }
          if (!signal.aborted) enqueue(sseEvent("done"));
          return;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          console.warn(
            "[explain] gemini_failed event_id=%s produced=%d reason=%s",
            eventId,
            geminiProduced ? 1 : 0,
            reason,
          );
          // If Gemini already streamed text, the client has a partial answer.
          // Bail rather than restart with Haiku and risk a duplicated/jumbled
          // explanation — emit `done` so the client can render what it has.
          if (geminiProduced) {
            if (!signal.aborted) enqueue(sseEvent("done"));
            return;
          }
          // else fall through to Haiku
        }
      }

      try {
        for await (const text of explainEventHaiku(event, signal)) {
          if (signal.aborted) return;
          enqueue(sseEvent("token", { text }));
        }
        if (!signal.aborted) enqueue(sseEvent("done"));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(
          "[explain] haiku_failed event_id=%s reason=%s",
          eventId,
          reason,
        );
        if (!signal.aborted) {
          enqueue(
            sseEvent("error", {
              code: "upstream_unavailable",
              message: `both providers failed: ${reason}`,
              retryable: true,
            }),
          );
        }
      }
    },
  });

  return sseResponse(stream);
}

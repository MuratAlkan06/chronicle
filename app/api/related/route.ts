/**
 * POST /api/related
 *
 * Per API.md + docs/BACKEND-STANDARDS.md §J.1, §J.3 (single batched embed
 * call), §J.7 (env vars), §J.10 (AbortSignal). Synchronous JSON response —
 * NOT SSE.
 *
 * Returns top-3 candidates by cosine similarity to the target event,
 * filtered to score >= 0.55, scores rounded to 2dp.
 */
import { z } from "zod";
import { TimelineEventSchema, type TimelineEvent } from "@/lib/schema";
import { cosine, embed, eventEmbedText } from "@/lib/voyage";

export const runtime = "nodejs";

const SCORE_THRESHOLD = 0.55;
const TOP_K = 3;

const RequestSchema = z.object({
  eventId: z.string(),
  candidates: z.array(TimelineEventSchema).min(1),
});

interface RelatedItem {
  eventId: string;
  score: number;
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  retryable = false,
): Response {
  return Response.json(
    { error: { code, message, retryable } },
    { status },
  );
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
  const { eventId, candidates } = parsed.data;

  const target = candidates.find((c) => c.id === eventId);
  if (!target) {
    return errorResponse(
      "pdf_invalid",
      "eventId not present in candidates list",
      400,
    );
  }

  // Build embedding inputs: target first, then every other candidate in
  // original order. One HTTP call per J.3.
  const others: TimelineEvent[] = candidates.filter((c) => c.id !== eventId);
  if (others.length === 0) {
    console.log(
      "[related] target=%s candidates=0 top=0 provider=none",
      eventId,
    );
    return Response.json({ related: [], cached: false });
  }

  const texts: string[] = [eventEmbedText(target), ...others.map(eventEmbedText)];

  let result;
  try {
    result = await embed(texts, { signal: request.signal });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[related] embed_failed target=%s reason=%s", eventId, reason);
    return errorResponse(
      "upstream_unavailable",
      `embeddings provider failed: ${reason}`,
      502,
      true,
    );
  }

  const [targetVec, ...otherVecs] = result.vectors;
  const scored: RelatedItem[] = others.map((evt, i) => ({
    eventId: evt.id,
    score: cosine(targetVec, otherVecs[i]),
  }));

  const related = scored
    .filter((s) => s.score >= SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K)
    .map((s) => ({ eventId: s.eventId, score: Math.round(s.score * 100) / 100 }));

  console.log(
    "[related] target=%s candidates=%d top=%d provider=%s",
    eventId,
    others.length,
    related.length,
    result.provider,
  );

  return Response.json({ related, cached: false });
}

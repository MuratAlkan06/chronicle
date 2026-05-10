/**
 * Chronicle — Voyage embeddings client (with OpenAI fallback).
 *
 * Per PLAN.md Q3 (Voyage `voyage-3` over HTTP from Next.js, fallback to OpenAI
 * `text-embedding-3-small` on 401/429), docs/BACKEND-STANDARDS.md §J.3
 * (single HTTP request per batch — never per-event), §J.7 (env vars), §J.8
 * (logging shape), §J.10 (AbortSignal propagation).
 *
 * No SDKs by design — Node's built-in `fetch` is sufficient for both providers
 * and avoids adding ~100KB of dependencies for two POSTs.
 */
import type { TimelineEvent } from "./schema";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3";
const OPENAI_URL = "https://api.openai.com/v1/embeddings";
const OPENAI_MODEL = "text-embedding-3-small";

export interface EmbedOptions {
  signal?: AbortSignal;
}

export interface EmbedResult {
  /** Same length and order as the input `texts` array. */
  vectors: number[][];
  provider: "voyage" | "openai";
  model: string;
}

/**
 * Embed a batch of texts in a single HTTP request. Voyage primary; on 401,
 * 429, network error, or malformed response, falls back to OpenAI. Throws
 * only if both providers fail (or if both keys are missing).
 *
 * Empty input returns immediately with no HTTP call.
 */
export async function embed(
  texts: string[],
  options: EmbedOptions = {},
): Promise<EmbedResult> {
  if (texts.length === 0) {
    return { vectors: [], provider: "voyage", model: VOYAGE_MODEL };
  }

  const voyageKey = process.env.VOYAGE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!voyageKey && !openaiKey) {
    throw new Error(
      "VOYAGE_API_KEY or OPENAI_API_KEY env var is required for /api/related",
    );
  }

  const { signal } = options;

  // Try Voyage first if keyed.
  if (voyageKey) {
    try {
      const vectors = await callVoyage(texts, voyageKey, signal);
      console.log(
        "[voyage] count=%d provider=voyage model=%s",
        texts.length,
        VOYAGE_MODEL,
      );
      return { vectors, provider: "voyage", model: VOYAGE_MODEL };
    } catch (err) {
      // AbortError is a deliberate caller cancellation — never fall back.
      if (isAbortError(err)) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      if (!openaiKey) throw err;
      console.warn("[voyage] fallback_to_openai reason=%s", reason);
    }
  }

  // OpenAI fallback path. We only get here if Voyage failed (or key missing).
  if (!openaiKey) {
    // Unreachable if voyageKey was present and Voyage threw above without
    // openaiKey (we already threw). Defensive.
    throw new Error("OPENAI_API_KEY missing for embeddings fallback");
  }
  const vectors = await callOpenAI(texts, openaiKey, signal);
  console.log(
    "[voyage] count=%d provider=openai_fallback model=%s",
    texts.length,
    OPENAI_MODEL,
  );
  return { vectors, provider: "openai", model: OPENAI_MODEL };
}

/** Cosine similarity. Returns 0 if either vector is zero-length. */
export function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Build the embedding-input string for one event per API.md spec. */
export function eventEmbedText(event: TimelineEvent): string {
  return `${event.title} — ${event.summary}`;
}

// ---------------------------------------------------------------------------
// Provider HTTP calls
// ---------------------------------------------------------------------------

interface ProviderResponse {
  data?: Array<{ embedding: number[]; index: number }>;
  usage?: { total_tokens?: number };
}

async function callVoyage(
  texts: string[],
  apiKey: string,
  signal: AbortSignal | undefined,
): Promise<number[][]> {
  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: texts,
      input_type: "document",
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`voyage_http_${res.status}`);
  }
  const json = (await res.json()) as ProviderResponse;
  return extractVectors(json, texts.length);
}

async function callOpenAI(
  texts: string[],
  apiKey: string,
  signal: AbortSignal | undefined,
): Promise<number[][]> {
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: texts,
      encoding_format: "float",
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`openai_http_${res.status}`);
  }
  const json = (await res.json()) as ProviderResponse;
  return extractVectors(json, texts.length);
}

/**
 * Extract vectors from a provider response and re-order them to match the
 * original input ordering. Both Voyage and OpenAI use the OpenAI-shaped
 * response (`data: [{embedding, index}, ...]`); neither guarantees the
 * response array is in input order, so we sort by `index` defensively.
 */
function extractVectors(json: ProviderResponse, expected: number): number[][] {
  if (!json || !Array.isArray(json.data)) {
    throw new Error("malformed_response: missing data array");
  }
  if (json.data.length !== expected) {
    throw new Error(
      `malformed_response: expected ${expected} embeddings, got ${json.data.length}`,
    );
  }
  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  return name === "AbortError";
}

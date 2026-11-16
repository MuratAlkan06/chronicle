import { normalize } from "./normalize";

export interface MatchResult {
  matched: boolean;
  startSpan: number | null;
  endSpan: number | null;
  windowSize: number | null;
}

const MIN_WINDOW = 1;
const MAX_WINDOW = 30;

const NO_MATCH: MatchResult = {
  matched: false,
  startSpan: null,
  endSpan: null,
  windowSize: null,
};

/**
 * Sliding-window match. Given an ordered array of text-layer spans (one PDF
 * text node per element) and a target snippet (verbatim from Claude), find
 * the smallest contiguous run of spans whose joined-and-normalized text
 * contains the normalized snippet.
 *
 * Window sizes: 1..30 inclusive, smallest first, so the highlight covers only
 * the spans the snippet needs (a quote that fits in one span highlights that
 * span alone, not the lines before it). Because the first hit is minimal, the
 * run never starts or ends on a span that adds no text (empty or
 * whitespace-only). Case-insensitive containment.
 */
export function matchSnippet(spans: string[], snippet: string): MatchResult {
  const target = normalize(snippet).toLowerCase();
  if (target.length === 0 || spans.length === 0) return NO_MATCH;

  const upper = Math.min(MAX_WINDOW, spans.length);
  for (let win = MIN_WINDOW; win <= upper; win++) {
    for (let start = 0; start + win <= spans.length; start++) {
      const joined = spans.slice(start, start + win).join(" ");
      if (normalize(joined).toLowerCase().includes(target)) {
        return { matched: true, startSpan: start, endSpan: start + win, windowSize: win };
      }
    }
  }

  return NO_MATCH;
}

/**
 * Convenience for non-PDF callers (e.g. text dumps from `pdftotext`).
 * Normalizes first so soft line-break hyphens are healed, then splits on
 * whitespace to derive pseudo-spans, then delegates to matchSnippet.
 */
export function matchSnippetInText(text: string, snippet: string): MatchResult {
  const spans = normalize(text).split(" ").filter((token) => token.length > 0);
  return matchSnippet(spans, snippet);
}

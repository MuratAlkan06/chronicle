import { normalize } from "./normalize";

export interface MatchResult {
  matched: boolean;
  startSpan: number | null;
  endSpan: number | null;
  windowSize: number | null;
}

const MIN_WINDOW = 5;
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
 * Window sizes: 5..30 inclusive, smaller first so the highlight overlay is
 * tight. Case-insensitive containment. Degenerate small-doc fallback: if
 * `spans.length` is below MIN_WINDOW, also try the whole array as one window.
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

  if (spans.length < MIN_WINDOW) {
    const joined = spans.join(" ");
    if (normalize(joined).toLowerCase().includes(target)) {
      return { matched: true, startSpan: 0, endSpan: spans.length, windowSize: spans.length };
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

/**
 * Normalize a string for verbatim-snippet matching against PDF text-layer output.
 *
 * Pipeline: NFKC -> dehyphenate soft line-breaks -> strip soft hyphen
 * -> collapse whitespace runs -> trim.
 *
 * Intentionally does NOT lowercase: `lib/match.ts` performs case-folding at
 * containment-check time. Keeping case here lets callers (e.g. the highlight
 * overlay in `components/pdf-viewer.tsx`) reuse the normalized form for
 * presentation without losing the original capitalization.
 */
export function normalize(s: string): string {
  const nfkc = s.normalize("NFKC");
  const dehyphenated = nfkc
    .replace(/(\w+)-\s*\n\s*(\w+)/g, "$1$2")
    .replace(/­/g, "");
  return dehyphenated.replace(/\s+/g, " ").trim();
}

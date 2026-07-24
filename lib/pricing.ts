/**
 * Chronicle — Anthropic token pricing + cache-savings math (pure, no I/O).
 *
 * Used by scripts/cache-report.ts. Kept as a dated constants table so the
 * numbers are auditable and obviously go stale — re-verify against
 * https://platform.claude.com/docs/en/docs/about-claude/pricing when bumping.
 */
import type { ExtractUsage } from "./measure";

/** Date these constants were verified against Anthropic's pricing page. */
export const PRICING_AS_OF = "2026-07-23";

export interface ModelPricing {
  /** Base (uncached) input tokens, USD per million tokens. */
  inputPerMTok: number;
  /** Output tokens, USD per MTok. */
  outputPerMTok: number;
  /** 5-minute ephemeral cache WRITE, USD per MTok (= 1.25x base input). */
  cacheWrite5mPerMTok: number;
  /** Cache READ / hit, USD per MTok (= 0.10x base input). */
  cacheReadPerMTok: number;
}

/**
 * Per-MTok USD pricing, verified 2026-07-23 against
 * https://platform.claude.com/docs/en/docs/about-claude/pricing (all rows below
 * re-confirmed that day). Chronicle extracts with claude-sonnet-4-6 and a single
 * 5-minute ephemeral cache breakpoint, so that is the load-bearing row; the
 * Opus rows price the Case 3 escape-hatch experiment (--model claude-opus-4-7).
 * Cache multipliers relative to base input: 5m write 1.25x, 1h write 2x, read
 * 0.10x (general, all models).
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheWrite5mPerMTok: 3.75, // 1.25 x 3
    cacheReadPerMTok: 0.3, // 0.10 x 3
  },
  // Escape-hatch model (docs/BUILD.md: if Case 3 strict P or R < 0.5, try Opus).
  // Opus 4.5 through 4.8 all share the $5/$25 rate card (verified 2026-07-23).
  // CAVEAT for cost interpretation (not a rate change): Opus 4.7+ uses a newer
  // tokenizer that emits ~30% MORE tokens for the same text than Sonnet 4.6, so
  // an equal-quality Opus run costs more than the $5-vs-$3 rate ratio alone.
  "claude-opus-4-7": {
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheWrite5mPerMTok: 6.25, // 1.25 x 5
    cacheReadPerMTok: 0.5, // 0.10 x 5
  },
  "claude-opus-4-6": {
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheWrite5mPerMTok: 6.25,
    cacheReadPerMTok: 0.5,
  },
  // General reference rows (not used by extraction, handy for the report).
  "claude-sonnet-4-5": {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheWrite5mPerMTok: 3.75,
    cacheReadPerMTok: 0.3,
  },
  "claude-haiku-4-5": {
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheWrite5mPerMTok: 1.25,
    cacheReadPerMTok: 0.1,
  },
};

export const DEFAULT_MODEL = "claude-sonnet-4-6";

const MTOK = 1_000_000;

export interface CostBreakdown {
  model: string;
  /** Total input tokens processed = uncached + cache-read + cache-write. */
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Fraction of total input tokens served from cache (0..1). */
  cacheReadFraction: number;
  /** Actual cost given the cache read/write split, USD. */
  withCacheUSD: number;
  /** Hypothetical cost if every input token were billed at full input price. */
  noCacheUSD: number;
  /** noCacheUSD - withCacheUSD. Net of the 1.25x cache-write premium; can be
   *  negative if writes were never amortized by reads. */
  savedUSD: number;
}

/**
 * Estimate cost + cache savings for a set of aggregated token usages.
 *
 * `savedUSD` is the honest net: cache reads save 0.9x base input each, but the
 * cache WRITES that enabled them cost an extra 0.25x base input each (the 1.25x
 * write premium). Both are folded in by differencing withCache vs noCache.
 */
export function estimateCost(
  totals: ExtractUsage,
  model: string = DEFAULT_MODEL,
): CostBreakdown {
  const p = MODEL_PRICING[model];
  if (!p) {
    throw new Error(
      `no pricing table for model "${model}" (as of ${PRICING_AS_OF}); add it to MODEL_PRICING`,
    );
  }

  const uncached = totals.input_tokens;
  const read = totals.cache_read_input_tokens;
  const write = totals.cache_creation_input_tokens;
  const out = totals.output_tokens;
  const totalInput = uncached + read + write;

  const withCacheUSD =
    (uncached * p.inputPerMTok +
      read * p.cacheReadPerMTok +
      write * p.cacheWrite5mPerMTok +
      out * p.outputPerMTok) /
    MTOK;

  // No-caching counterfactual: the read + write tokens would each be billed as
  // full-price input. Output is unaffected by caching.
  const noCacheUSD =
    ((uncached + read + write) * p.inputPerMTok + out * p.outputPerMTok) / MTOK;

  return {
    model,
    totalInputTokens: totalInput,
    totalOutputTokens: out,
    cacheReadFraction: totalInput === 0 ? 0 : read / totalInput,
    withCacheUSD,
    noCacheUSD,
    savedUSD: noCacheUSD - withCacheUSD,
  };
}

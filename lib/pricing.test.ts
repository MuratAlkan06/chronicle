import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCost, MODEL_PRICING, DEFAULT_MODEL } from "./pricing";
import { ZERO_USAGE, type ExtractUsage } from "./measure";

// A representative measurement run: one uncached first call that writes the
// cache, subsequent calls served from cache.
const SAMPLE: ExtractUsage = {
  input_tokens: 1000,
  output_tokens: 500,
  cache_read_input_tokens: 8000,
  cache_creation_input_tokens: 6000,
};

test("estimateCost: with-cache vs no-cache math (sonnet-4-6, hand-computed)", () => {
  const c = estimateCost(SAMPLE, "claude-sonnet-4-6");

  // withCache = (1000*3 + 8000*0.30 + 6000*3.75 + 500*15) / 1e6
  //           = (3000 + 2400 + 22500 + 7500) / 1e6 = 35400 / 1e6
  assert.ok(Math.abs(c.withCacheUSD - 0.0354) < 1e-12);

  // noCache = ((1000+8000+6000)*3 + 500*15) / 1e6
  //         = (45000 + 7500) / 1e6 = 52500 / 1e6
  assert.ok(Math.abs(c.noCacheUSD - 0.0525) < 1e-12);

  // saved = 0.0525 - 0.0354 = 0.0171 (net of the 1.25x write premium)
  assert.ok(Math.abs(c.savedUSD - 0.0171) < 1e-12);

  assert.equal(c.totalInputTokens, 15000);
  assert.equal(c.totalOutputTokens, 500);
  // cacheReadFraction = 8000 / 15000
  assert.ok(Math.abs(c.cacheReadFraction - 8000 / 15000) < 1e-12);
  assert.equal(c.model, "claude-sonnet-4-6");
});

test("estimateCost: cache-write premium can make savings negative if never read", () => {
  // A single cold call: writes cache, no reads yet → pays the 1.25x premium
  // with nothing amortizing it, so no-cache would have been cheaper.
  const coldWrite: ExtractUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 6000,
  };
  const c = estimateCost(coldWrite);
  // withCache = 6000*3.75/1e6 = 0.0225 ; noCache = 6000*3/1e6 = 0.018
  assert.ok(c.savedUSD < 0);
  assert.ok(Math.abs(c.savedUSD - (0.018 - 0.0225)) < 1e-12);
});

test("estimateCost: zero usage → all zeros, no NaN", () => {
  const c = estimateCost(ZERO_USAGE);
  assert.equal(c.withCacheUSD, 0);
  assert.equal(c.noCacheUSD, 0);
  assert.equal(c.savedUSD, 0);
  assert.equal(c.cacheReadFraction, 0);
  assert.equal(Number.isFinite(c.cacheReadFraction), true);
});

test("estimateCost: default model is claude-sonnet-4-6 and is priced", () => {
  assert.ok(MODEL_PRICING[DEFAULT_MODEL], "default model must have a pricing row");
  const c = estimateCost(SAMPLE);
  assert.equal(c.model, DEFAULT_MODEL);
});

test("estimateCost: unknown model throws (fail loud, don't guess a price)", () => {
  assert.throws(() => estimateCost(SAMPLE, "claude-imaginary-9"), /no pricing table/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { cosine, embed } from "./voyage";

// No real API calls in this suite — every test stubs globalThis.fetch and
// asserts on the captured calls. Restoring fetch + env vars is per-test via
// the `withStubbedFetch` helper.

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type StubFetch = (
  input: FetchInput,
  init?: FetchInit,
) => Promise<Response> | Response;

interface StubCall {
  url: string;
  init: FetchInit | undefined;
}

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Replace globalThis.fetch with a per-call queue of responder functions.
 * Returns the captured-calls array + a restore function. Each responder is
 * consumed in sequence; running off the end throws so tests fail loudly.
 */
function stubFetchSequence(
  responders: StubFetch[],
): { calls: StubCall[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: StubCall[] = [];
  let i = 0;
  globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    calls.push({ url, init });
    const responder = responders[i++];
    if (!responder) {
      throw new Error(`stubFetchSequence: unexpected fetch call #${i} to ${url}`);
    }
    return await responder(input, init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function withEnv(updates: Record<string, string | undefined>, fn: () => Promise<void>) {
  const originals: Record<string, string | undefined> = {};
  for (const k of Object.keys(updates)) originals[k] = process.env[k];
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

// ---------------------------------------------------------------------------
// cosine
// ---------------------------------------------------------------------------

test("cosine: identical vectors return 1.0", () => {
  assert.equal(cosine([1, 2, 3], [1, 2, 3]), 1);
});

test("cosine: orthogonal vectors return 0", () => {
  assert.equal(cosine([1, 0], [0, 1]), 0);
});

test("cosine: opposite vectors return -1", () => {
  // Floating-point: sqrt(5)*sqrt(5) is not exactly 5, so allow epsilon.
  assert.ok(Math.abs(cosine([1, 2], [-1, -2]) - -1) < 1e-12);
});

test("cosine: zero-vector handling returns 0 (no NaN)", () => {
  assert.equal(cosine([0, 0, 0], [1, 2, 3]), 0);
  assert.equal(cosine([1, 2, 3], [0, 0, 0]), 0);
  assert.equal(cosine([0, 0], [0, 0]), 0);
});

// ---------------------------------------------------------------------------
// embed: empty input
// ---------------------------------------------------------------------------

test("embed([]) returns immediately without calling fetch", async () => {
  const { calls, restore } = stubFetchSequence([
    () => {
      throw new Error("fetch should not be called for empty input");
    },
  ]);
  try {
    await withEnv({ VOYAGE_API_KEY: "v-test", OPENAI_API_KEY: "o-test" }, async () => {
      const result = await embed([]);
      assert.deepEqual(result.vectors, []);
      assert.equal(result.provider, "voyage");
    });
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// embed: happy path with response-order shuffle
// ---------------------------------------------------------------------------

test("embed sorts response by index so vectors match input order", async () => {
  // Voyage returns a shuffled `data` array; we MUST sort by `index` before
  // returning vectors to the caller.
  const { calls, restore } = stubFetchSequence([
    () =>
      makeJsonResponse({
        data: [
          { embedding: [0.3, 0.3, 0.3], index: 2 },
          { embedding: [0.1, 0.1, 0.1], index: 0 },
          { embedding: [0.2, 0.2, 0.2], index: 1 },
        ],
      }),
  ]);
  try {
    await withEnv({ VOYAGE_API_KEY: "v-test", OPENAI_API_KEY: undefined }, async () => {
      const result = await embed(["a", "b", "c"]);
      assert.equal(result.provider, "voyage");
      assert.deepEqual(result.vectors, [
        [0.1, 0.1, 0.1],
        [0.2, 0.2, 0.2],
        [0.3, 0.3, 0.3],
      ]);
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /api\.voyageai\.com/);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// embed: fallback on Voyage 429
// ---------------------------------------------------------------------------

test("embed falls back to OpenAI on Voyage 429", async () => {
  const { calls, restore } = stubFetchSequence([
    () => new Response("rate limited", { status: 429 }),
    () =>
      makeJsonResponse({
        data: [
          { embedding: [0.5, 0.5], index: 0 },
          { embedding: [0.6, 0.6], index: 1 },
        ],
      }),
  ]);
  try {
    await withEnv({ VOYAGE_API_KEY: "v-test", OPENAI_API_KEY: "o-test" }, async () => {
      const result = await embed(["x", "y"]);
      assert.equal(result.provider, "openai");
      assert.equal(result.model, "text-embedding-3-small");
      assert.deepEqual(result.vectors, [
        [0.5, 0.5],
        [0.6, 0.6],
      ]);
    });
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /voyageai/);
    assert.match(calls[1].url, /api\.openai\.com/);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// embed: fallback on Voyage network error
// ---------------------------------------------------------------------------

test("embed falls back to OpenAI on Voyage network error", async () => {
  const { calls, restore } = stubFetchSequence([
    () => {
      throw new TypeError("fetch failed");
    },
    () => makeJsonResponse({ data: [{ embedding: [1, 2, 3], index: 0 }] }),
  ]);
  try {
    await withEnv({ VOYAGE_API_KEY: "v-test", OPENAI_API_KEY: "o-test" }, async () => {
      const result = await embed(["only"]);
      assert.equal(result.provider, "openai");
      assert.deepEqual(result.vectors, [[1, 2, 3]]);
    });
    assert.equal(calls.length, 2);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// embed: fallback on malformed Voyage response
// ---------------------------------------------------------------------------

test("embed falls back to OpenAI on malformed Voyage response", async () => {
  const { calls, restore } = stubFetchSequence([
    // Voyage returns 200 but no `data` array — must trigger fallback.
    () => makeJsonResponse({ result: "oops" }),
    () => makeJsonResponse({ data: [{ embedding: [9, 9], index: 0 }] }),
  ]);
  try {
    await withEnv({ VOYAGE_API_KEY: "v-test", OPENAI_API_KEY: "o-test" }, async () => {
      const result = await embed(["x"]);
      assert.equal(result.provider, "openai");
      assert.deepEqual(result.vectors, [[9, 9]]);
    });
    assert.equal(calls.length, 2);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// embed: both providers fail
// ---------------------------------------------------------------------------

test("embed throws when both providers return 5xx", async () => {
  const { calls, restore } = stubFetchSequence([
    () => new Response("err", { status: 500 }),
    () => new Response("err", { status: 500 }),
  ]);
  try {
    await withEnv({ VOYAGE_API_KEY: "v-test", OPENAI_API_KEY: "o-test" }, async () => {
      await assert.rejects(
        () => embed(["a"]),
        /openai_http_500|voyage_http_500/,
      );
    });
    assert.equal(calls.length, 2);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// embed: throws when both keys missing
// ---------------------------------------------------------------------------

test("embed throws when both VOYAGE_API_KEY and OPENAI_API_KEY are missing", async () => {
  const { restore } = stubFetchSequence([]);
  try {
    await withEnv({ VOYAGE_API_KEY: undefined, OPENAI_API_KEY: undefined }, async () => {
      await assert.rejects(() => embed(["a"]), /VOYAGE_API_KEY or OPENAI_API_KEY/);
    });
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// embed: AbortSignal pass-through
// ---------------------------------------------------------------------------

test("embed passes the AbortSignal to fetch verbatim", async () => {
  const controller = new AbortController();
  const { calls, restore } = stubFetchSequence([
    () => makeJsonResponse({ data: [{ embedding: [1], index: 0 }] }),
  ]);
  try {
    await withEnv({ VOYAGE_API_KEY: "v-test", OPENAI_API_KEY: undefined }, async () => {
      await embed(["only"], { signal: controller.signal });
    });
    assert.equal(calls.length, 1);
    // `init.signal` must be the exact AbortSignal we passed in (J.10).
    assert.equal(calls[0].init?.signal, controller.signal);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// embed: AbortError is not swallowed by fallback path
// ---------------------------------------------------------------------------

test("embed re-throws AbortError without falling back", async () => {
  const { calls, restore } = stubFetchSequence([
    () => {
      // Construct an AbortError equivalent to what fetch raises on signal abort.
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    },
    // Second responder must NEVER be called — fallback is forbidden on abort.
    () => {
      throw new Error("openai must not be called when the caller aborted");
    },
  ]);
  try {
    await withEnv({ VOYAGE_API_KEY: "v-test", OPENAI_API_KEY: "o-test" }, async () => {
      await assert.rejects(() => embed(["x"]), /aborted/);
    });
    assert.equal(calls.length, 1);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// embed: skips Voyage cleanly when only OPENAI_API_KEY is present
// ---------------------------------------------------------------------------

test("embed uses OpenAI directly when VOYAGE_API_KEY is missing", async () => {
  const { calls, restore } = stubFetchSequence([
    () => makeJsonResponse({ data: [{ embedding: [7, 7], index: 0 }] }),
  ]);
  try {
    await withEnv({ VOYAGE_API_KEY: undefined, OPENAI_API_KEY: "o-test" }, async () => {
      const result = await embed(["solo"]);
      assert.equal(result.provider, "openai");
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /api\.openai\.com/);
  } finally {
    restore();
  }
});

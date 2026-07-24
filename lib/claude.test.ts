import { test } from "node:test";
import assert from "node:assert/strict";
import {
  supportsTemperaturePin,
  ACTIVE_MODEL,
  normalizeEmittedEvents,
} from "./claude";

// ---------------------------------------------------------------------------
// supportsTemperaturePin — model-aware temperature gate (lib/claude).
//
// Anthropic rejects a non-default `temperature` (HTTP 400) for every model
// released *after* the Claude Opus 4.6 wave. The predicate decides whether the
// extraction request may include `temperature: 0` (true) or must OMIT it
// (false). The truth table is anchored on the two load-bearing ids: the active
// extraction model MUST accept it; the escape-hatch model MUST NOT.
// ---------------------------------------------------------------------------

test("supportsTemperaturePin: active extraction model accepts temperature", () => {
  // Documents the active model + guards it against a silent regression: the
  // extraction path pins temperature:0 on whatever ACTIVE_MODEL is.
  assert.equal(ACTIVE_MODEL, "claude-sonnet-4-6");
  assert.equal(supportsTemperaturePin("claude-sonnet-4-6"), true);
  assert.equal(supportsTemperaturePin(ACTIVE_MODEL), true);
});

test("supportsTemperaturePin: escape-hatch Opus 4.7 rejects temperature (must omit)", () => {
  assert.equal(supportsTemperaturePin("claude-opus-4-7"), false);
});

test("supportsTemperaturePin: 4.6 wave and earlier accept (real /v1/models ids)", () => {
  for (const id of [
    "claude-sonnet-4-6",
    "claude-opus-4-6",
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-5-20251101",
    "claude-opus-4-1-20250805",
  ]) {
    assert.equal(supportsTemperaturePin(id), true, `${id} should accept temperature`);
  }
});

test("supportsTemperaturePin: post-Opus-4.6 wave reject (real /v1/models ids)", () => {
  for (const id of [
    "claude-opus-4-7",
    "claude-opus-4-8",
    "claude-sonnet-5",
    "claude-fable-5",
  ]) {
    assert.equal(supportsTemperaturePin(id), false, `${id} should reject temperature`);
  }
});

test("supportsTemperaturePin: version-threshold generalizes to unseen ids (no lookup table)", () => {
  assert.equal(supportsTemperaturePin("claude-opus-4-9"), false); // 4.7+ wave
  assert.equal(supportsTemperaturePin("claude-sonnet-6"), false); // generation >= 5
  assert.equal(supportsTemperaturePin("claude-haiku-4-6"), true); // 4.6 wave
});

test("supportsTemperaturePin: unparseable / unknown ids default to the SAFE side (omit)", () => {
  // Never send temperature to something we cannot classify → never risk a 400.
  assert.equal(supportsTemperaturePin(""), false);
  assert.equal(supportsTemperaturePin("gpt-4o"), false);
  assert.equal(supportsTemperaturePin("claude-3-5-sonnet-20241022"), false); // old id order
  assert.equal(supportsTemperaturePin("garbage"), false);
});

// ---------------------------------------------------------------------------
// normalizeEmittedEvents — tool-payload shape normalization (lib/claude).
//
// The `emit_events` tool is documented to return `{ events: [...] }`. Post-
// Opus-4.6 models (which reject temperature pinning and run at their default)
// vary their tool serialization run-to-run: observed live 2026-07-23,
// `claude-opus-4-7` on case1 emitted `input.events` as a JSON *string* that
// itself decodes to `{ events: [...] }` on some docs while emitting the
// canonical array on others. This normalizer accepts the documented array plus
// the mechanically-equivalent encodings and fails loudly (per-doc) on anything
// ambiguous — it must NEVER silently invent or drop events.
// ---------------------------------------------------------------------------

// A minimal object with the discriminating `event_type` field. The normalizer
// is a SHAPE pass only (zod validates content downstream), so this suffices.
const EV = (id: string) => ({ id, event_type: "lab", title: `t-${id}` });

test("normalizeEmittedEvents: canonical array passes through unchanged (Sonnet + most Opus)", () => {
  const arr = [EV("a"), EV("b")];
  assert.deepEqual(normalizeEmittedEvents(arr), { events: arr });
});

test("normalizeEmittedEvents: absent / null / empty → zero events (documented `?? []`)", () => {
  assert.deepEqual(normalizeEmittedEvents(undefined), { events: [] });
  assert.deepEqual(normalizeEmittedEvents(null), { events: [] });
  assert.deepEqual(normalizeEmittedEvents([]), { events: [] });
});

test("normalizeEmittedEvents: JSON-string of a {events:[...]} wrapper → array (the observed opus-4-7 shape)", () => {
  // Exactly the d2_lab_2023_04 failure from smoke B: the events FIELD is a
  // JSON string re-encoding the whole payload.
  const field = JSON.stringify({ events: [EV("a"), EV("b")] });
  assert.equal(typeof field, "string");
  assert.deepEqual(normalizeEmittedEvents(field), { events: [EV("a"), EV("b")] });
});

test("normalizeEmittedEvents: JSON-string of a bare array → array", () => {
  const field = JSON.stringify([EV("a")]);
  assert.deepEqual(normalizeEmittedEvents(field), { events: [EV("a")] });
});

test("normalizeEmittedEvents: nested {events:[...]} object wrapper → unwrapped array", () => {
  // Same wrapper but as a live object (not string-encoded).
  const field = { events: [EV("a")] } as unknown;
  assert.deepEqual(normalizeEmittedEvents(field), { events: [EV("a")] });
});

test("normalizeEmittedEvents: numeric-keyed object (array-as-object) → values in index order", () => {
  // Out-of-insertion-order keys must still come out ordered 0,1,2.
  const field = { "1": EV("b"), "0": EV("a"), "2": EV("c") } as unknown;
  assert.deepEqual(normalizeEmittedEvents(field), {
    events: [EV("a"), EV("b"), EV("c")],
  });
});

test("normalizeEmittedEvents: single bare event object → wrapped in a one-element array", () => {
  const field = EV("solo") as unknown;
  assert.deepEqual(normalizeEmittedEvents(field), { events: [EV("solo")] });
});

test("normalizeEmittedEvents: content is passed through verbatim (never invented/altered)", () => {
  const rich = {
    id: "x",
    event_type: "medication",
    title: "Started metformin 500 mg b.i.d.",
    date: "2023-01-02",
    source: { document_id: "d", page: 1, snippet: "started metformin" },
  };
  const out = normalizeEmittedEvents([rich]);
  assert.ok("events" in out);
  assert.deepEqual(out.events, [rich]); // byte-identical, no mutation
});

test("normalizeEmittedEvents: rejects a non-JSON string (loud per-doc failure)", () => {
  const out = normalizeEmittedEvents("not json at all {");
  assert.ok("error" in out, "must fail, not guess");
  assert.match(out.error, /not valid JSON/);
});

test("normalizeEmittedEvents: rejects primitives and unknown objects (fail loud, don't guess)", () => {
  for (const bad of [42, true, { foo: 1 }, { events: 7 }] as unknown[]) {
    const out = normalizeEmittedEvents(bad);
    assert.ok("error" in out, `${JSON.stringify(bad)} should be rejected`);
  }
});

test("normalizeEmittedEvents: rejects a non-contiguous numeric-keyed object", () => {
  // Missing index 1 → not a serialized array → ambiguous → reject.
  const out = normalizeEmittedEvents({ "0": EV("a"), "2": EV("c") } as unknown);
  assert.ok("error" in out);
});

test("normalizeEmittedEvents: rejects over-deep nesting (bounded, no infinite unwrap)", () => {
  let field: unknown = { events: [] };
  for (let i = 0; i < 6; i++) field = { events: field };
  const out = normalizeEmittedEvents(field);
  assert.ok("error" in out);
  assert.match(out.error, /unwrap limit/);
});

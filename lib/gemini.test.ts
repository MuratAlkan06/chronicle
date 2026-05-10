import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPLAIN_SYSTEM_PROMPT,
  explainEventGemini,
  serializeEvent,
} from "./gemini";
import type { TimelineEvent } from "./schema";

// No real API calls in this suite — would burn credits and flake CI.
// Coverage targets: serializer behavior, generator shape, abort honoring.

const fullEvent: TimelineEvent = {
  id: "00000000-0000-4000-8000-000000000001",
  date: "2023-01-12",
  date_text: "01/12/2023",
  date_confidence: "exact",
  event_type: "lab",
  title: "HbA1c — 9.2%",
  summary:
    "Glycated hemoglobin (A1c) significantly elevated, consistent with new-onset diabetes. Reference range 4.0-5.6%.",
  severity: "concerning",
  values: {
    key: "HbA1c",
    value: "9.2",
    unit: "%",
    ref_range: "4.0-5.6",
    flag: "high",
  },
  provider: "Sarah Levy, MD",
  source: {
    document_id: "d1_pcp_2023_01",
    page: 1,
    snippet: 'HbA1c: 9.2% (H) — Reference range 4.0-5.6%.',
  },
  related_ids: [],
};

const sparseEvent: TimelineEvent = {
  id: "00000000-0000-4000-8000-000000000002",
  date: "2023-02-04",
  date_text: null,
  date_confidence: "approximate",
  event_type: "diagnosis",
  title: "Type 2 diabetes added to problem list",
  summary: "Provider recorded a new diabetes diagnosis based on the elevated A1c lab.",
  severity: "monitor",
  values: null,
  provider: null,
  source: {
    document_id: "d2_pcp_2023_02",
    page: 1,
    snippet: "Assessment: Type 2 diabetes mellitus, new diagnosis.",
  },
  related_ids: [],
};

test("EXPLAIN_SYSTEM_PROMPT matches API.md verbatim", () => {
  assert.equal(
    EXPLAIN_SYSTEM_PROMPT,
    "You are explaining a single medical timeline event to a patient. 2-3 sentences, define abbreviations, no recommendations, no use of the word should.",
  );
});

test("serializeEvent includes all populated fields with canonical keys", () => {
  const out = serializeEvent(fullEvent);
  assert.match(out, /^Event type: lab\n/);
  assert.match(out, /\nDate: 2023-01-12\n/);
  assert.match(out, /\nDate as written: 01\/12\/2023\n/);
  assert.match(out, /\nDate confidence: exact\n/);
  assert.match(out, /\nSeverity: concerning\n/);
  assert.match(out, /\nTitle: HbA1c — 9\.2%\n/);
  assert.match(out, /\nSummary \(verbatim from extraction\): Glycated/);
  assert.match(
    out,
    /\nLab values: HbA1c = 9\.2 % \(reference 4\.0-5\.6, flag high\)\n/,
  );
  assert.match(out, /\nProvider: Sarah Levy, MD\n/);
  assert.match(out, /\nSource snippet: "HbA1c: 9\.2% \(H\) — Reference range 4\.0-5\.6%\."$/);
});

test("serializeEvent skips null/empty optional fields", () => {
  const out = serializeEvent(sparseEvent);
  assert.doesNotMatch(out, /Date as written/);
  assert.doesNotMatch(out, /Lab values/);
  assert.doesNotMatch(out, /Provider:/);
  // But required fields still present.
  assert.match(out, /Event type: diagnosis/);
  assert.match(out, /Date: 2023-02-04/);
  assert.match(out, /Source snippet:/);
});

test("explainEventGemini returns an async iterable", () => {
  // Cannot await it without an API key + network; just verify the shape so a
  // future SDK rev that breaks the contract trips this test.
  const gen = explainEventGemini(fullEvent, {
    signal: AbortSignal.abort(),
  });
  assert.equal(typeof gen[Symbol.asyncIterator], "function");
});

test("explainEventGemini exits early on already-aborted signal (no client init)", async () => {
  // GEMINI_API_KEY may or may not be set in the test env; force the
  // pre-client abort branch and verify the generator yields nothing.
  const original = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const signal = AbortSignal.abort();
    const collected: string[] = [];
    for await (const chunk of explainEventGemini(fullEvent, { signal })) {
      collected.push(chunk);
    }
    assert.deepEqual(collected, []);
  } finally {
    if (original !== undefined) process.env.GEMINI_API_KEY = original;
  }
});

test("explainEventGemini throws when GEMINI_API_KEY missing and not aborted", async () => {
  const original = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await assert.rejects(
      (async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _chunk of explainEventGemini(fullEvent)) {
          // unreachable — getClient() should throw before any chunk.
        }
      })(),
      /GEMINI_API_KEY/,
    );
  } finally {
    if (original !== undefined) process.env.GEMINI_API_KEY = original;
  }
});

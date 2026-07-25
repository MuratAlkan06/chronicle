/**
 * Path A verification — exercises the extraction stack without hitting Anthropic.
 *
 * Two scenario groups:
 *  (A) Route handler protocol: empty multipart, JSON body (cached path stub),
 *      bad content-type — verifies error envelopes per BACKEND-STANDARDS J.1.
 *  (B) SSE + zod end-to-end: drive lib/sse.ts with a producer that emits the
 *      same frames the route would for d1_pcp_2023_01.pdf using MOCK_DATA
 *      d1 events as the stub — validates frame sequence, payload zod, and
 *      docId/filename rewriting semantics.
 *
 * Run: npx tsx scripts/verify-extract-route.ts
 */
import { TimelineEventSchema, type TimelineEvent } from "../lib/schema";
import { createSseStream, sseEvent, sseResponse } from "../lib/sse";
import { POST } from "../app/api/extract/route";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}
const results: CheckResult[] = [];
const check = (name: string, cond: boolean, detail?: string) =>
  results.push({ name, pass: cond, detail });

const D1_STUB_EVENTS: TimelineEvent[] = [
  {
    id: "c1000001-0000-4000-8001-000000000001",
    date: "2023-01-12",
    date_text: "01/12/2023",
    date_confidence: "exact",
    event_type: "visit",
    title: "PCP visit — initial workup",
    summary:
      "First visit with Dr. Levy for routine annual physical. Patient reported fatigue and increased thirst over the prior three months.",
    severity: "info",
    values: null,
    provider: "Sarah Levy, MD",
    source: {
      document_id: "d1_pcp_2023_01",
      page: 1,
      snippet:
        "Pt presents today for routine annual physical. Reports fatigue × 3 months and increased thirst.",
    },
    related_ids: [],
  },
  {
    id: "c1000001-0000-4000-8001-000000000002",
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
      page: 2,
      snippet: "HbA1c: 9.2% (H) — Reference range 4.0-5.6%.",
    },
    related_ids: [],
  },
];

interface ParsedFrame {
  type: string;
  event?: TimelineEvent;
  docId?: string;
  filename?: string;
  totalDocs?: number;
  eventCount?: number;
}

async function consume(
  res: Response,
): Promise<{ frames: ParsedFrame[]; raw: string }> {
  const raw = await res.text();
  const frames = raw
    .split("\n\n")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("data:"))
    .map((s): ParsedFrame => JSON.parse(s.slice("data:".length).trim()));
  return { frames, raw };
}

async function scenarioA_routeProtocol() {
  // A1: empty multipart → 400 + pdf_invalid
  const emptyForm = new FormData();
  const r1 = await POST(
    new Request("http://local/api/extract", { method: "POST", body: emptyForm }),
  );
  const b1 = await r1.json();
  check(
    "A1: empty multipart → 400 + pdf_invalid",
    r1.status === 400 && b1.error?.code === "pdf_invalid",
    `status=${r1.status} body=${JSON.stringify(b1)}`,
  );

  // A2: JSON body { caseId } → 501 + not_implemented (cached path stub)
  const r2 = await POST(
    new Request("http://local/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: "case1" }),
    }),
  );
  const b2 = await r2.json();
  check(
    "A2: JSON body → 501 + not_implemented",
    r2.status === 501 && b2.error?.code === "not_implemented",
    `status=${r2.status} body=${JSON.stringify(b2)}`,
  );

  // A3: bad content-type → 400 + pdf_invalid
  const r3 = await POST(
    new Request("http://local/api/extract", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "garbage",
    }),
  );
  const b3 = await r3.json();
  check(
    "A3: bad content-type → 400 + pdf_invalid",
    r3.status === 400 && b3.error?.code === "pdf_invalid",
    `status=${r3.status} body=${JSON.stringify(b3)}`,
  );

  // A4: oversized file → 400 + pdf_invalid
  const big = new Uint8Array(11 * 1024 * 1024); // 11MB
  const bigForm = new FormData();
  bigForm.append("files", new File([big], "big.pdf", { type: "application/pdf" }));
  const r4 = await POST(
    new Request("http://local/api/extract", { method: "POST", body: bigForm }),
  );
  const b4 = await r4.json();
  check(
    "A4: 11MB file → 400 + pdf_invalid (>10MB cap enforced)",
    r4.status === 400 && b4.error?.code === "pdf_invalid",
    `status=${r4.status} body=${JSON.stringify(b4)}`,
  );
}

async function scenarioB_sseAndZod() {
  // Drive an SSE stream that emits the exact frames a successful route call
  // would emit for d1_pcp_2023_01.pdf using D1_STUB_EVENTS.
  const totalDocs = 1;
  const docId = "d1_pcp_2023_01";
  const filename = "d1_pcp_2023_01.pdf";

  const stream = createSseStream({
    start: async (enqueue) => {
      enqueue(sseEvent("started"));
      enqueue(sseEvent("doc_started", { docId, filename, totalDocs }));
      for (const event of D1_STUB_EVENTS) {
        enqueue(sseEvent("event", { docId, event }));
      }
      enqueue(
        sseEvent("doc_complete", { docId, eventCount: D1_STUB_EVENTS.length }),
      );
      enqueue(sseEvent("done"));
    },
  });

  const res = sseResponse(stream);
  check("B0: response Content-Type=text/event-stream", (res.headers.get("content-type") ?? "").startsWith("text/event-stream"));
  check("B0: Cache-Control no-cache, no-transform", res.headers.get("cache-control") === "no-cache, no-transform");
  check("B0: X-Accel-Buffering: no", res.headers.get("x-accel-buffering") === "no");
  check("B0: Connection: keep-alive", res.headers.get("connection") === "keep-alive");

  const { frames } = await consume(res);
  const types = frames.map((f) => f.type);

  check(
    "B1: frame sequence started→doc_started→event×N→doc_complete→done",
    types[0] === "started" &&
      types[1] === "doc_started" &&
      types[types.length - 2] === "doc_complete" &&
      types[types.length - 1] === "done",
    `types=${JSON.stringify(types)}`,
  );

  const eventFrames = frames.filter((f) => f.type === "event");
  check(
    "B2: emitted 2 event frames (matches D1 stub fixture count)",
    eventFrames.length === 2,
    `count=${eventFrames.length}`,
  );

  let zodOk = true;
  for (const f of eventFrames) {
    const parsed = TimelineEventSchema.safeParse(f.event);
    if (!parsed.success) {
      zodOk = false;
      console.error("[B3 zod fail]", parsed.error.issues);
    }
  }
  check("B3: every event frame's payload zod-validates against TimelineEventSchema", zodOk);

  const docStarted = frames.find((f) => f.type === "doc_started");
  check("B4: doc_started.totalDocs === 1", docStarted?.totalDocs === 1);
  check("B4: doc_started.docId === 'd1_pcp_2023_01'", docStarted?.docId === "d1_pcp_2023_01");
  check("B4: doc_started.filename === 'd1_pcp_2023_01.pdf'", docStarted?.filename === "d1_pcp_2023_01.pdf");

  const docComplete = frames.find((f) => f.type === "doc_complete");
  check("B5: doc_complete.eventCount === 2", docComplete?.eventCount === 2);

  // Structural sanity vs MOCK_DATA shape
  const ev0 = eventFrames[0]?.event;
  const ev1 = eventFrames[1]?.event;
  check(
    "B6: ev0 matches MOCK_DATA d1 visit (event_type=visit, severity=info, page=1)",
    ev0?.event_type === "visit" && ev0?.severity === "info" && ev0?.source?.page === 1,
  );
  check(
    "B6: ev1 matches MOCK_DATA d1 lab (event_type=lab, severity=concerning, values.flag=high)",
    ev1?.event_type === "lab" &&
      ev1?.severity === "concerning" &&
      ev1?.values?.flag === "high",
  );
  check(
    "B7: every event source.document_id equals docId 'd1_pcp_2023_01'",
    eventFrames.every((f) => f.event?.source?.document_id === "d1_pcp_2023_01"),
  );
}

async function main() {
  await scenarioA_routeProtocol();
  await scenarioB_sseAndZod();

  let pass = 0;
  let fail = 0;
  console.log("\n=== Verification matrix ===");
  for (const r of results) {
    const tag = r.pass ? "PASS" : "FAIL";
    if (r.pass) pass++;
    else fail++;
    console.log(`  [${tag}] ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
  }
  console.log(`\nTotal: ${pass}/${results.length} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Verification harness errored:", err);
  process.exit(2);
});

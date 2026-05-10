/**
 * POST /api/extract
 *
 * Per API.md + docs/BACKEND-STANDARDS.md §J.1, §J.2, §J.7, §J.10 and
 * docs/BUILD.md H6→H7 track-B (cached replay branch).
 *
 * Two request shapes:
 *  - multipart/form-data with `files[]: File[]`  → live extraction
 *  - application/json with `{ caseId }`          → cached replay from
 *    `data/cases/<id>/events.json` (per PLAN.md Q20 hybrid demo strategy)
 *
 * Response: text/event-stream. The cached replay branch groups events by
 * `source.document_id` (first-appearance order) and emits one batch per doc on
 * a 1.5s cadence — Q20 "feel" delay: per-doc, including the first doc, so the
 * judge sees a beat of "thinking" before each batch lands.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import pLimit from "p-limit";
import { z } from "zod";
import { extractDoc } from "@/lib/claude";
import {
  CaseFixtureSchema,
  type TimelineEvent,
} from "@/lib/schema";
import { createSseStream, sseEvent, sseResponse } from "@/lib/sse";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per J.10
const CONCURRENCY = 8; // pLimit(8) per BACKEND-STANDARDS J.7 / resolved item
const REPLAY_DOC_DELAY_MS = 1500; // Q20 "feel" delay per simulated doc batch

const CachedReplayBodySchema = z.object({
  caseId: z.enum(["case1", "case2", "case3"]),
});

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json(
    { error: { code, message, retryable: false } },
    { status },
  );
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";

  // ---------- cached replay path ----------
  if (contentType.includes("application/json")) {
    return handleCachedReplay(request);
  }

  // ---------- live extraction path ----------
  if (!contentType.includes("multipart/form-data")) {
    return errorResponse(
      "pdf_invalid",
      "expected multipart/form-data with files[] or application/json with caseId",
      400,
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to parse multipart body";
    return errorResponse("pdf_invalid", message, 400);
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return errorResponse("pdf_invalid", "no files provided in multipart upload", 400);
  }
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return errorResponse(
        "pdf_invalid",
        `File ${file.name} exceeds 10MB limit`,
        400,
      );
    }
  }

  const totalDocs = files.length;
  const signal = request.signal;

  const stream = createSseStream({
    signal,
    start: async (enqueue) => {
      enqueue(sseEvent("started"));

      const limit = pLimit(CONCURRENCY);

      // Fan out per file. Each task is wrapped so a single failure can't
      // bubble up and abort the whole Promise.all.
      const tasks = files.map((file) =>
        limit(async () => {
          const docId = stripPdfExt(file.name);
          enqueue(
            sseEvent("doc_started", { docId, filename: file.name, totalDocs }),
          );

          let buffer: Buffer;
          try {
            const arrayBuf = await file.arrayBuffer();
            buffer = Buffer.from(arrayBuf);
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "failed to read file buffer";
            enqueue(
              sseEvent("doc_error", { docId, message, retryable: false }),
            );
            return;
          }

          try {
            const events = await extractDoc(buffer, docId, file.name, { signal });
            for (const event of events) {
              if (signal.aborted) return;
              enqueue(sseEvent("event", { docId, event }));
            }
            enqueue(
              sseEvent("doc_complete", { docId, eventCount: events.length }),
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[extract] doc_error docId=%s message=%s", docId, message);
            enqueue(
              sseEvent("doc_error", { docId, message, retryable: false }),
            );
          }
        }),
      );

      await Promise.all(tasks);

      if (!signal.aborted) {
        enqueue(sseEvent("done"));
      }
    },
  });

  return sseResponse(stream);
}

/**
 * Cached replay: parse JSON body → load events.json → SSE-stream with a 1.5s
 * gate before each doc batch. Groups events by source.document_id in the
 * order they first appear in the events array (which scripts/extract-case.ts
 * already sorts: date asc → doc order → in-doc order).
 */
async function handleCachedReplay(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to parse JSON body";
    return errorResponse("pdf_invalid", message, 400);
  }

  const parsed = CachedReplayBodySchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return errorResponse("pdf_invalid", `invalid request body: ${issues}`, 400);
  }
  const { caseId } = parsed.data;

  const eventsPath = join(process.cwd(), "data", "cases", caseId, "events.json");
  if (!existsSync(eventsPath)) {
    return errorResponse(
      "case_not_extracted",
      `events.json missing for ${caseId}; run scripts/extract-case.ts first`,
      404,
    );
  }

  let fixtureRaw: unknown;
  try {
    fixtureRaw = JSON.parse(readFileSync(eventsPath, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(
      "extraction_failed",
      `failed to parse events.json for ${caseId}: ${message}`,
      500,
    );
  }

  const fixture = CaseFixtureSchema.safeParse(fixtureRaw);
  if (!fixture.success) {
    const issues = fixture.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return errorResponse(
      "extraction_failed",
      `events.json for ${caseId} failed schema validation: ${issues}`,
      500,
    );
  }

  // First-appearance order of document_ids. Script-side ordering already
  // honors date asc + doc order, so this is just a one-pass partition.
  const grouped = groupByDoc(fixture.data.events);
  const totalDocs = grouped.length;
  const signal = request.signal;

  console.log(
    "[extract] cached_replay caseId=%s docs=%d events=%d",
    caseId,
    totalDocs,
    fixture.data.events.length,
  );

  const stream = createSseStream({
    signal,
    start: async (enqueue) => {
      enqueue(sseEvent("started"));
      for (const { docId, events } of grouped) {
        if (signal.aborted) return;
        enqueue(
          sseEvent("doc_started", {
            docId,
            filename: `${docId}.pdf`,
            totalDocs,
          }),
        );
        // Q20 feel-delay: gate every batch (including the first) so the
        // judge sees a beat of "thinking" before events land. Abort-aware
        // wait so a closed tab short-circuits cleanly.
        const waited = await abortableDelay(REPLAY_DOC_DELAY_MS, signal);
        if (!waited || signal.aborted) return;
        for (const event of events) {
          if (signal.aborted) return;
          enqueue(sseEvent("event", { docId, event }));
        }
        enqueue(sseEvent("doc_complete", { docId, eventCount: events.length }));
      }
      if (!signal.aborted) {
        enqueue(sseEvent("done"));
      }
    },
  });

  return sseResponse(stream);
}

interface DocBatch {
  docId: string;
  events: TimelineEvent[];
}

function groupByDoc(events: TimelineEvent[]): DocBatch[] {
  const order: string[] = [];
  const buckets = new Map<string, TimelineEvent[]>();
  for (const event of events) {
    const docId = event.source.document_id;
    let bucket = buckets.get(docId);
    if (!bucket) {
      bucket = [];
      buckets.set(docId, bucket);
      order.push(docId);
    }
    bucket.push(event);
  }
  return order.map((docId) => ({ docId, events: buckets.get(docId)! }));
}

/**
 * Sleep `ms` ms, but resolve early if `signal` aborts. Returns true if the
 * wait completed naturally, false if it was aborted.
 */
function abortableDelay(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Drop a single trailing `.pdf` (case-insensitive). Matches MOCK_DATA docId convention. */
function stripPdfExt(filename: string): string {
  return filename.replace(/\.pdf$/i, "");
}

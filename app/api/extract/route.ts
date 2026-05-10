/**
 * POST /api/extract
 *
 * Per API.md + docs/BACKEND-STANDARDS.md §J.1, §J.2, §J.7, §J.10.
 *
 * Two request shapes:
 *  - multipart/form-data with `files[]: File[]`  → live extraction (this cycle)
 *  - application/json with `{ caseId }`          → cached replay (Block 7, stub)
 *
 * Response: text/event-stream. Per-doc fan-out via pLimit(8). Per-event
 * frames stream as soon as each document completes. Per-doc errors are
 * isolated — other docs continue.
 */
import pLimit from "p-limit";
import { extractDoc } from "@/lib/claude";
import { createSseStream, sseEvent, sseResponse } from "@/lib/sse";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per J.10
const CONCURRENCY = 8; // pLimit(8) per BACKEND-STANDARDS J.7 / resolved item

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json(
    { error: { code, message, retryable: false } },
    { status },
  );
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";

  // ---------- cached replay path (Block 7 — stub for this cycle) ----------
  if (contentType.includes("application/json")) {
    // TODO Block 7: parse { caseId }, stream events from data/cases/<id>/events.json
    // with the leaky-bucket throttle (per resolved decision #5).
    return errorResponse(
      "not_implemented",
      "cached replay path is not yet implemented; multipart/form-data upload only",
      501,
    );
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

/** Drop a single trailing `.pdf` (case-insensitive). Matches MOCK_DATA docId convention. */
function stripPdfExt(filename: string): string {
  return filename.replace(/\.pdf$/i, "");
}

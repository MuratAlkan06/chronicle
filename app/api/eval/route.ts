/**
 * GET /api/eval — eval slice (cycle 7).
 *
 * Two modes per API.md:
 *  - mode=cached (case1, case2): read precomputed report from
 *    data/eval_reports/<case>.json, return as application/json.
 *  - mode=live (case3 only): SSE stream that runs extraction live, computes
 *    metrics + breakdown, writes audit log under held_out/case3/eval_runs/.
 *
 * Case 3 held-out data is labeled, hash-locked (commit 59ca076), and evaluated.
 * mode=live guards run in order before any extractDoc call: gt_not_present (GT
 * or docs missing), gt_hash_mismatch (GT blob != .gt_hash.lock), prompt_dirty
 * (uncommitted prompts/), then an isDegenerateRun check emits all_docs_failed
 * rather than persisting a zero-success run. The cached demo fallback is served
 * separately by GET /api/eval/fallback. See docs/RESOLVED-DECISIONS.md §9 and
 * docs/EVAL.md §6.
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import pLimit from "p-limit";
import { z } from "zod";
import { extractDocWithUsage } from "@/lib/claude";
import { sumUsage, isDegenerateRun, type ExtractUsage } from "@/lib/measure";
import { evaluate, breakdown, type GtEvent, type TierResult } from "@/lib/eval";
import {
  EventTypeSchema,
  DateConfidenceSchema,
  type EventType,
  type TimelineEvent,
} from "@/lib/schema";
import { createSseStream, sseEvent, sseResponse } from "@/lib/sse";

export const runtime = "nodejs";

const CONCURRENCY = 8;

// ---------------------------------------------------------------------------
// Validation schemas (inline — not exported from lib/eval per scope rules).
// ---------------------------------------------------------------------------

const GtEventSchema = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_confidence: DateConfidenceSchema,
  event_type: EventTypeSchema,
  title: z.string(),
  source_document: z.string(),
  in_scope: z.boolean(),
  notes: z.string().optional(),
});

const GtFileSchema = z.object({
  case_id: z.enum(["case1", "case2", "case3"]),
  patient: z.string(),
  labeled_at: z.string(),
  labeler_notes: z.string(),
  events: z.array(GtEventSchema),
});

const TierResultSchema = z.object({
  tier: z.enum(["strict", "loose"]),
  tp: z.number(),
  fp: z.number(),
  fn: z.number(),
  precision: z.number(),
  recall: z.number(),
  f1: z.number(),
  n_gt: z.number(),
});

const ByEventTypeEntrySchema = z.object({
  strict: TierResultSchema,
  loose: TierResultSchema,
  n_gt: z.number(),
});

const ReportSchema = z.object({
  caseId: z.enum(["case1", "case2", "case3"]),
  tiers: z.object({ strict: TierResultSchema, loose: TierResultSchema }),
  byEventType: z.record(EventTypeSchema, ByEventTypeEntrySchema),
  promptVersion: z.string(),
  promptHash: z.string(),
  generatedAt: z.string(),
});

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function jsonError(code: string, message: string, status: number): Response {
  return Response.json(
    { error: { code, message, retryable: false } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

// ---------------------------------------------------------------------------
// GET handler — query parsing + dispatch
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const caseId = url.searchParams.get("case");
  const mode = url.searchParams.get("mode");

  if (caseId !== "case1" && caseId !== "case2" && caseId !== "case3") {
    return jsonError("pdf_invalid", "case must be case1, case2, or case3", 400);
  }
  if (mode !== "cached" && mode !== "live") {
    return jsonError("pdf_invalid", "mode must be cached or live", 400);
  }
  if (mode === "live" && caseId !== "case3") {
    return jsonError("pdf_invalid", "live mode only supports case3", 400);
  }
  if (mode === "cached" && caseId === "case3") {
    return jsonError(
      "pdf_invalid",
      "case3 cached eval not available — Path B; see RESOLVED-DECISIONS.md §9",
      400,
    );
  }

  if (mode === "cached") {
    // Narrowed to case1|case2 — the case3+cached combination 400ed above.
    return handleCached(caseId as "case1" | "case2");
  }
  // mode=live, caseId=case3 (validated above).
  return handleLive(request);
}

// ---------------------------------------------------------------------------
// Cached path (Cases 1+2)
// ---------------------------------------------------------------------------

function handleCached(caseId: "case1" | "case2"): Response {
  const reportPath = join(process.cwd(), "data", "eval_reports", `${caseId}.json`);
  if (!existsSync(reportPath)) {
    return jsonError(
      "case_not_extracted",
      `Run scripts/eval-train.ts ${caseId} first`,
      404,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("extraction_failed", `failed to parse report: ${message}`, 500);
  }

  const parsed = ReportSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return jsonError("extraction_failed", `report schema invalid: ${issues}`, 500);
  }

  console.log("[eval] cached caseId=%s", caseId);
  return Response.json(parsed.data, {
    headers: { "Cache-Control": "no-store" },
  });
}

// ---------------------------------------------------------------------------
// Live path (Case 3) — SSE
// ---------------------------------------------------------------------------

function handleLive(request: Request): Response {
  const cwd = process.cwd();
  const caseDir = join(cwd, "held_out", "case3");
  const gtPath = join(caseDir, "ground_truth.json");
  const lockPath = join(caseDir, ".gt_hash.lock");
  const docsDir = join(caseDir, "docs");
  const promptPath = join(cwd, "prompts", "system_extract_v4.md");
  const signal = request.signal;

  const stream = createSseStream({
    signal,
    start: async (enqueue) => {
      enqueue(sseEvent("started"));

      // -------------------------------------------------------------------
      // Step 1: gt_not_present sentinel — fires BEFORE any extractDoc work.
      //         Multiple sentinels covered (per task contract).
      // -------------------------------------------------------------------
      if (!existsSync(gtPath)) {
        enqueue(
          sseEvent("error", {
            code: "gt_not_present",
            message:
              "Case 3 ground truth has not been written yet — see RESOLVED-DECISIONS §9 Path A/B fork; demo runs as 3-beat without /eval beat",
            retryable: false,
          }),
        );
        return;
      }

      let gtRaw: unknown;
      try {
        gtRaw = JSON.parse(readFileSync(gtPath, "utf8"));
      } catch {
        enqueue(
          sseEvent("error", {
            code: "gt_not_present",
            message:
              "Case 3 ground truth has not been written yet — see RESOLVED-DECISIONS §9 Path A/B fork; demo runs as 3-beat without /eval beat",
            retryable: false,
          }),
        );
        return;
      }

      // Template-stub sentinels — either is sufficient evidence the file is
      // unchanged from cycle 3 scaffolding.
      const stubLabeledAt =
        (gtRaw as { labeled_at?: unknown })?.labeled_at ===
        "REPLACE_WITH_ISO_TIMESTAMP_AT_END_OF_LABELING";
      const firstEvent = (gtRaw as { events?: unknown[] })?.events?.[0] as
        | Record<string, unknown>
        | undefined;
      const stubCommentKey =
        firstEvent && "_comment_DELETE_THIS_BEFORE_LABELING" in firstEvent;

      let pdfFiles: string[] = [];
      if (existsSync(docsDir)) {
        pdfFiles = readdirSync(docsDir)
          .filter((n) => n.toLowerCase().endsWith(".pdf"))
          .sort();
      }
      const noPdfs = pdfFiles.length === 0;

      if (stubLabeledAt || stubCommentKey || noPdfs) {
        enqueue(
          sseEvent("error", {
            code: "gt_not_present",
            message:
              "Case 3 ground truth has not been written yet — see RESOLVED-DECISIONS §9 Path A/B fork; demo runs as 3-beat without /eval beat",
            retryable: false,
          }),
        );
        return;
      }

      // -------------------------------------------------------------------
      // Step 2: gt_hash_mismatch — per BACKEND-STANDARDS J.5.
      // -------------------------------------------------------------------
      if (!existsSync(lockPath)) {
        enqueue(
          sseEvent("error", {
            code: "gt_hash_mismatch",
            message: "held_out/case3/.gt_hash.lock missing — refusing to run",
            retryable: false,
          }),
        );
        return;
      }
      const lockedHash = readFileSync(lockPath, "utf8").trim();
      let liveHash: string;
      try {
        liveHash = execFileSync("git", ["hash-object", gtPath], {
          encoding: "utf8",
        }).trim();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        enqueue(
          sseEvent("error", {
            code: "gt_hash_mismatch",
            message: `failed to compute ground_truth.json hash: ${message}`,
            retryable: false,
          }),
        );
        return;
      }
      if (lockedHash !== liveHash) {
        enqueue(
          sseEvent("error", {
            code: "gt_hash_mismatch",
            message:
              "Case 3 ground truth has been modified since H0 lock — eval refused",
            retryable: false,
          }),
        );
        return;
      }

      // -------------------------------------------------------------------
      // Step 3: prompt_dirty — refuse if prompts/ has uncommitted changes.
      // -------------------------------------------------------------------
      let dirtyOut: string;
      try {
        dirtyOut = execFileSync("git", ["status", "--porcelain", "prompts/"], {
          encoding: "utf8",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        enqueue(
          sseEvent("error", {
            code: "prompt_dirty",
            message: `failed to check prompts/ git status: ${message}`,
            retryable: false,
          }),
        );
        return;
      }
      if (dirtyOut.trim().length > 0) {
        enqueue(
          sseEvent("error", {
            code: "prompt_dirty",
            message:
              "prompts/ has uncommitted changes — eval refused for reproducibility",
            retryable: false,
          }),
        );
        return;
      }

      // Log the active prompt hash for the audit trail.
      let promptHash: string;
      try {
        promptHash = execFileSync("git", ["hash-object", promptPath], {
          encoding: "utf8",
        }).trim();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        enqueue(
          sseEvent("error", {
            code: "prompt_dirty",
            message: `failed to hash active prompt: ${message}`,
            retryable: false,
          }),
        );
        return;
      }
      writeFileSync(join(caseDir, "prompt_hash.txt"), promptHash + "\n", "utf8");

      // -------------------------------------------------------------------
      // Step 4: validate GT + run extraction in parallel.
      // -------------------------------------------------------------------
      const gtParse = GtFileSchema.safeParse(gtRaw);
      if (!gtParse.success) {
        const issues = gtParse.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        enqueue(
          sseEvent("error", {
            code: "extraction_failed",
            message: `ground_truth.json schema invalid: ${issues}`,
            retryable: false,
          }),
        );
        return;
      }
      const gtEvents: GtEvent[] = gtParse.data.events;

      const totalDocs = pdfFiles.length;
      const limit = pLimit(CONCURRENCY);
      const allPredicted: TimelineEvent[] = [];
      // Per-doc token usage → persisted in the eval_run audit log so cache hits
      // + cost of a measurement run are auditable (BACKEND-STANDARDS §J.4/J.11).
      const perDocUsage: { docId: string; usage: ExtractUsage }[] = [];
      // Per-doc outcome + explicit failures for the degenerate-run guard (#7):
      // a run where ZERO docs extracted successfully is never persisted, and a
      // persisted PARTIAL run records which docs failed (docFailures).
      const outcomes: { ok: boolean }[] = [];
      const docFailures: { docId: string; error: string }[] = [];

      const tasks = pdfFiles.map((filename) =>
        limit(async () => {
          const docId = filename.replace(/\.pdf$/i, "");
          enqueue(sseEvent("doc_started", { docId, filename, totalDocs }));

          let buffer: Buffer;
          try {
            buffer = readFileSync(join(docsDir, filename));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            outcomes.push({ ok: false });
            docFailures.push({ docId, error: message });
            enqueue(sseEvent("doc_error", { docId, message, retryable: false }));
            return;
          }

          try {
            const { events, usage } = await extractDocWithUsage(buffer, docId, filename, {
              signal,
            });
            perDocUsage.push({ docId, usage });
            outcomes.push({ ok: true });
            for (const event of events) {
              if (signal.aborted) return;
              allPredicted.push(event);
              enqueue(sseEvent("event", { docId, event }));
            }
            enqueue(
              sseEvent("doc_complete", { docId, eventCount: events.length }),
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[eval] doc_error docId=%s message=%s", docId, message);
            outcomes.push({ ok: false });
            docFailures.push({ docId, error: message });
            enqueue(sseEvent("doc_error", { docId, message, retryable: false }));
          }
        }),
      );

      await Promise.all(tasks);

      if (signal.aborted) return;

      // -------------------------------------------------------------------
      // Degenerate-run guard (issue #7): if ZERO docs extracted successfully
      // (e.g. an invalid ANTHROPIC_API_KEY → 401 on every call), this run
      // carries no information about model performance — it is NOT a
      // measurement. Emit an error frame and DO NOT persist: a saved
      // tp=0/fn=n_gt run would masquerade as a real held-out score (exactly the
      // pre-guard artifact that had to be forensically removed; see EVAL.md §6).
      // -------------------------------------------------------------------
      if (isDegenerateRun(outcomes)) {
        enqueue(
          sseEvent("error", {
            code: "all_docs_failed",
            message: `All ${totalDocs} document(s) failed extraction (0 successful) — not a measurement; run not persisted. First error: ${docFailures[0]?.error ?? "unknown"}`,
            retryable: false,
          }),
        );
        return;
      }

      // -------------------------------------------------------------------
      // Step 5: metrics + breakdown.
      // -------------------------------------------------------------------
      const strictResult = evaluate(allPredicted, gtEvents, "strict");
      enqueue(sseEvent("metric", { tier: "strict", value: strictResult }));

      const looseResult = evaluate(allPredicted, gtEvents, "loose");
      enqueue(sseEvent("metric", { tier: "loose", value: looseResult }));

      const strictBreakdown = breakdown(allPredicted, gtEvents, "strict");
      const looseBreakdown = breakdown(allPredicted, gtEvents, "loose");
      enqueue(
        sseEvent("breakdown", {
          value: { strict: strictBreakdown, loose: looseBreakdown },
        }),
      );

      // -------------------------------------------------------------------
      // Step 6: audit log + done.
      // -------------------------------------------------------------------
      const runsDir = join(caseDir, "eval_runs");
      mkdirSync(runsDir, { recursive: true });
      const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
      const runPath = join(runsDir, `${runStamp}.json`);
      writeFileSync(
        runPath,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            promptHash,
            temperature: 0,
            predicted: allPredicted,
            metrics: { strict: strictResult, loose: looseResult },
            byEventType: { strict: strictBreakdown, loose: looseBreakdown },
            // Token usage for this run — aggregate + per-doc. Additive to the
            // historical eval_run shape; readers treat it as optional.
            usage: sumUsage(perDocUsage.map((d) => d.usage)),
            perDocUsage,
            // Docs that failed extraction this run (empty on a fully-successful
            // run). A run where ALL docs fail is refused above, never persisted.
            docFailures,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      enqueue(sseEvent("done"));
    },
  });

  return sseResponse(stream);
}

// Internal type re-export to keep tsc happy on imports above.
export type { TierResult, EventType };

/**
 * scripts/validate-gt.ts — sanity-check held_out/case3/ground_truth.json
 * BEFORE locking + committing it.
 *
 * Per docs/EVAL.md "Quality checklist before locking the file" + the
 * BACKEND-STANDARDS J.5 held-out hygiene discipline. Catches typos in
 * event_type enums, malformed dates, missing source files, duplicate
 * IDs, and the "zero events marked in_scope:false" red flag — all
 * before the H11 live demo, where a malformed GT crashes /api/eval?mode=live
 * in front of judges.
 *
 * Usage:
 *   npx tsx scripts/validate-gt.ts
 *
 * Reads only structural metadata: directory listing of held_out/case3/docs/
 * (filenames, NOT contents) and the GT file itself. Does NOT touch PDF
 * contents and does NOT call any model — preserves held-out hygiene.
 *
 * Exit code:
 *   0 — GT is structurally valid + ready to lock (warnings allowed)
 *   1 — one or more hard validation errors; fix before committing
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  EventTypeSchema,
  DateConfidenceSchema,
} from "../lib/schema";

const GtEventSchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be ISO 8601 YYYY-MM-DD"),
  date_confidence: DateConfidenceSchema,
  event_type: EventTypeSchema,
  title: z.string().min(1),
  source_document: z.string().min(1),
  in_scope: z.boolean(),
  notes: z.string().optional(),
});

const GtFileSchema = z.object({
  case_id: z.literal("case3"),
  patient: z.string().min(1),
  labeled_at: z.string().min(1),
  labeler_notes: z.string(),
  events: z.array(GtEventSchema),
});

const GT_PATH = "held_out/case3/ground_truth.json";
const DOCS_DIR = "held_out/case3/docs";

interface ValidationResult {
  errors: string[];
  warnings: string[];
  summary: string[];
}

function validate(): ValidationResult {
  const result: ValidationResult = { errors: [], warnings: [], summary: [] };

  if (!existsSync(GT_PATH)) {
    result.errors.push(`${GT_PATH} does not exist`);
    return result;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(GT_PATH, "utf8"));
  } catch (err) {
    result.errors.push(
      `${GT_PATH} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
    return result;
  }

  const parsed = GtFileSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      result.errors.push(`schema: ${issue.path.join(".") || "<root>"}: ${issue.message}`);
    }
    return result;
  }

  const gt = parsed.data;

  // Refuse the H0 stub. The template ships with a `_comment_DELETE_THIS_BEFORE_LABELING`
  // key inside the first event; if that key still exists, the file hasn't been
  // labeled yet.
  const rawEvents = (raw as { events?: unknown[] }).events;
  if (Array.isArray(rawEvents)) {
    for (const e of rawEvents) {
      if (
        e &&
        typeof e === "object" &&
        "_comment_DELETE_THIS_BEFORE_LABELING" in (e as Record<string, unknown>)
      ) {
        result.errors.push(
          "events[*]._comment_DELETE_THIS_BEFORE_LABELING is still present — this is the H0 template stub, not real labels",
        );
        return result;
      }
    }
  }

  if (gt.labeled_at === "REPLACE_WITH_ISO_TIMESTAMP_AT_END_OF_LABELING") {
    result.errors.push(
      "labeled_at is still the H0 placeholder — set to current ISO 8601 timestamp at end of labeling",
    );
  } else {
    const ts = Date.parse(gt.labeled_at);
    if (Number.isNaN(ts)) {
      result.errors.push(`labeled_at is not a valid ISO 8601 timestamp: "${gt.labeled_at}"`);
    }
  }

  // Event count band: per EVAL.md "Total event count is in 15-30 range".
  const n = gt.events.length;
  if (n < 15) {
    result.warnings.push(
      `only ${n} events — EVAL.md expects 15-30 for an 8-doc case (likely under-labeling); proceed if this is deliberate`,
    );
  } else if (n > 30) {
    result.warnings.push(
      `${n} events exceeds the 15-30 band — EVAL.md flags this as "likely over-labeling"; review for events that should collapse to one (e.g., per-analyte splits)`,
    );
  }

  // Unique ids.
  const idCounts = new Map<string, number>();
  for (const e of gt.events) {
    idCounts.set(e.id, (idCounts.get(e.id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      result.errors.push(`event id "${id}" appears ${count}× — ids must be unique`);
    }
  }

  // OOS exclusion discipline: ≥1 event marked in_scope:false signals labeler
  // is using the in_scope mechanism rather than being too permissive.
  const oosCount = gt.events.filter((e) => !e.in_scope).length;
  if (oosCount === 0) {
    result.warnings.push(
      "zero events marked in_scope:false — EVAL.md flags this as too permissive; expected 2-3 borderline events excluded",
    );
  }

  // Source-document existence: every event's source_document must reference a
  // file in held_out/case3/docs/. Tolerant of both naming conventions:
  // - "d1_pcp_2024_01.pdf"  (matches Cases 1+2 GT convention)
  // - "d1_pcp_2024_01"      (matches what extract-case.ts emits as docId after
  //                          `filename.replace(/\.pdf$/i, "")` — which is what
  //                          live-extracted events carry as source.document_id,
  //                          and what the eval matcher tiebreak compares against)
  // Only directory listing — never reads PDF contents (held-out hygiene).
  let knownPdfFilenames: Set<string>;
  if (!existsSync(DOCS_DIR)) {
    result.errors.push(`${DOCS_DIR} does not exist — Block 1 PDFs not in place yet`);
    knownPdfFilenames = new Set();
  } else {
    knownPdfFilenames = new Set(
      readdirSync(DOCS_DIR).filter((n) => n.toLowerCase().endsWith(".pdf")),
    );
    if (knownPdfFilenames.size === 0) {
      result.warnings.push(`${DOCS_DIR} is empty — no PDFs to cross-check source_document refs against`);
    }
  }
  const knownDocIdsStripped = new Set(
    [...knownPdfFilenames].map((n) => n.replace(/\.pdf$/i, "")),
  );

  function docExists(ref: string): boolean {
    return knownPdfFilenames.has(ref) || knownDocIdsStripped.has(ref);
  }
  function docCanon(ref: string): string {
    // Canonical form for orphan-detection: stripped (matches docId convention).
    return ref.replace(/\.pdf$/i, "");
  }

  const referencedDocsCanon = new Set<string>();
  for (const e of gt.events) {
    referencedDocsCanon.add(docCanon(e.source_document));
    if (knownPdfFilenames.size > 0 && !docExists(e.source_document)) {
      result.errors.push(
        `event "${e.id}" references source_document "${e.source_document}" which does not exist in ${DOCS_DIR}/ (looked for both "${e.source_document}" and "${e.source_document}.pdf")`,
      );
    }
  }

  // Inverse: PDFs in docs/ that have ZERO events. Not necessarily wrong (a doc
  // could legitimately yield no in-scope events) but worth flagging.
  if (knownPdfFilenames.size > 0) {
    const orphanDocs = [...knownDocIdsStripped].filter((d) => !referencedDocsCanon.has(d));
    for (const d of orphanDocs) {
      result.warnings.push(
        `${DOCS_DIR}/${d}.pdf has zero events labeled — confirm this PDF is truly event-free or you missed it`,
      );
    }
  }

  // Soft duplicate check: same (date, event_type, source_document) triple.
  // EVAL.md notes this is OK if events are genuinely distinct (e.g., two
  // different labs on one panel) but more often signals labeling drift.
  const tripleCounts = new Map<string, string[]>();
  for (const e of gt.events) {
    const key = `${e.date}|${e.event_type}|${e.source_document}`;
    const ids = tripleCounts.get(key) ?? [];
    ids.push(e.id);
    tripleCounts.set(key, ids);
  }
  for (const [key, ids] of tripleCounts) {
    if (ids.length > 1) {
      result.warnings.push(
        `${ids.length} events share the same (date, event_type, source_document) triple — ${key} (ids: ${ids.join(", ")}). Confirm they're genuinely distinct.`,
      );
    }
  }

  // Per-event-type breakdown for the human-readable summary.
  const byType = new Map<string, number>();
  for (const e of gt.events) {
    byType.set(e.event_type, (byType.get(e.event_type) ?? 0) + 1);
  }
  const typeBreakdown = [...byType.entries()]
    .sort()
    .map(([t, c]) => `${t}=${c}`)
    .join(", ");

  result.summary.push(`patient=${gt.patient}`);
  result.summary.push(`labeled_at=${gt.labeled_at}`);
  result.summary.push(`events=${n} (in_scope=${n - oosCount}, in_scope:false=${oosCount})`);
  result.summary.push(`event_types: ${typeBreakdown || "(none)"}`);
  result.summary.push(`docs_referenced=${referencedDocsCanon.size}, docs_present=${knownPdfFilenames.size}`);

  return result;
}

function main(): void {
  const result = validate();

  for (const line of result.summary) {
    console.log(`[validate-gt] ${line}`);
  }
  for (const w of result.warnings) {
    console.warn(`[validate-gt] ⚠  WARNING: ${w}`);
  }
  for (const e of result.errors) {
    console.error(`[validate-gt] ✗  ERROR: ${e}`);
  }

  if (result.errors.length > 0) {
    console.error(
      `\n[validate-gt] ${result.errors.length} error(s), ${result.warnings.length} warning(s) — DO NOT lock + commit yet`,
    );
    process.exit(1);
  }

  console.log(
    `\n[validate-gt] ✓  GT is structurally valid (${result.warnings.length} warning(s)) — safe to hash-lock + chmod 444 + commit`,
  );
  console.log(
    `[validate-gt] next: git hash-object held_out/case3/ground_truth.json > held_out/case3/.gt_hash.lock && chmod 444 held_out/case3/ground_truth.json && git add held_out/case3/ && git commit`,
  );
}

main();

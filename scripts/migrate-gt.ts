/**
 * scripts/migrate-gt.ts — one-shot structural migration of
 * held_out/case3/ground_truth.json from the (incorrect) bare-array
 * TimelineEvent-shaped payload to the GtFile-shaped envelope expected by
 * scripts/eval-train.ts and app/api/eval/route.ts.
 *
 * Usage:
 *   npx tsx scripts/migrate-gt.ts
 *
 * Reads:  held_out/case3/ground_truth.json (bare array of TimelineEvent-ish
 *         items: date, date_confidence, event_type, title, source_document,
 *         + extras like severity/snippet/provider that don't belong in GT)
 *
 * Writes: held_out/case3/ground_truth.fixed.json (the migrated GtFile).
 *         Does NOT overwrite the source file — diff + review before
 *         replacing manually.
 *
 * Transform per item:
 *   - keep: date, date_confidence, event_type, title, source_document
 *   - drop: severity, snippet, provider, and any other extra keys
 *   - add:  id (sequential gt_NNN, zero-padded), in_scope (default true)
 *
 * Envelope:
 *   case_id="case3", patient="David Park, 38M", labeled_at=<now ISO>,
 *   labeler_notes="" (you fill in by hand before locking).
 *
 * Held-out hygiene: the script does not call any model. The transform is
 * pure structural projection — your label values pass through untouched.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { EventTypeSchema, DateConfidenceSchema } from "../lib/schema";

const SOURCE_PATH = "held_out/case3/ground_truth.json";
const OUTPUT_PATH = "held_out/case3/ground_truth.fixed.json";

// Minimal acceptance for the source file — only require the fields we KEEP.
// Extra keys (severity, snippet, provider, etc.) are tolerated and dropped.
const SourceItemSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be ISO 8601 YYYY-MM-DD"),
    date_confidence: DateConfidenceSchema,
    event_type: EventTypeSchema,
    title: z.string().min(1),
    source_document: z.string().min(1),
  })
  .passthrough();

const SourceArraySchema = z.array(SourceItemSchema);

interface GtEvent {
  id: string;
  date: string;
  date_confidence: z.infer<typeof DateConfidenceSchema>;
  event_type: z.infer<typeof EventTypeSchema>;
  title: string;
  source_document: string;
  in_scope: boolean;
  notes?: string;
}

interface GtFile {
  case_id: "case3";
  patient: string;
  labeled_at: string;
  labeler_notes: string;
  events: GtEvent[];
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

function main(): void {
  if (!existsSync(SOURCE_PATH)) {
    console.error(`[migrate-gt] error: ${SOURCE_PATH} does not exist`);
    process.exit(1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(SOURCE_PATH, "utf8"));
  } catch (err) {
    console.error(
      `[migrate-gt] error: ${SOURCE_PATH} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  if (!Array.isArray(raw)) {
    console.error(
      `[migrate-gt] error: ${SOURCE_PATH} top-level is not an array — nothing to migrate. ` +
        `If the file is already in the GtFile envelope shape, you don't need this script; run validate-gt directly.`,
    );
    process.exit(1);
  }

  const parsed = SourceArraySchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`[migrate-gt] error: source items fail minimum-shape validation:`);
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    console.error(
      `\n[migrate-gt] fix the offending items in ${SOURCE_PATH} and rerun. ` +
        `(The script needs at minimum: date, date_confidence, event_type, title, source_document on every item.)`,
    );
    process.exit(1);
  }

  const events: GtEvent[] = parsed.data.map((item, i) => ({
    id: `gt_${pad3(i + 1)}`,
    date: item.date,
    date_confidence: item.date_confidence,
    event_type: item.event_type,
    title: item.title,
    source_document: item.source_document,
    in_scope: true,
  }));

  const file: GtFile = {
    case_id: "case3",
    patient: "David Park, 38M",
    labeled_at: new Date().toISOString(),
    labeler_notes: "",
    events,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(file, null, 2) + "\n", "utf8");

  console.log(`[migrate-gt] read ${parsed.data.length} items from ${SOURCE_PATH}`);
  console.log(`[migrate-gt] dropped extra keys: severity, snippet, provider (and any others)`);
  console.log(`[migrate-gt] added: id=gt_001..gt_${pad3(parsed.data.length)}, in_scope=true (default)`);
  console.log(`[migrate-gt] wrapped in envelope: case_id="case3", patient="David Park, 38M", labeled_at=<now ISO>`);
  console.log(`[migrate-gt] wrote ${OUTPUT_PATH}`);
  console.log(``);
  console.log(`[migrate-gt] next:`);
  console.log(`[migrate-gt]   1. diff ${SOURCE_PATH} ${OUTPUT_PATH}  (sanity-check the transform)`);
  console.log(`[migrate-gt]   2. open ${OUTPUT_PATH}, flip 2-3 events to in_scope:false where you'd accept disagreement`);
  console.log(`[migrate-gt]   3. write a 1-2 sentence labeler_notes describing your judgment calls`);
  console.log(`[migrate-gt]   4. mv ${OUTPUT_PATH} ${SOURCE_PATH}`);
  console.log(`[migrate-gt]   5. npx tsx scripts/validate-gt.ts  (should now pass)`);
  console.log(`[migrate-gt]   6. lock + chmod 444 + commit per README.md`);
}

main();

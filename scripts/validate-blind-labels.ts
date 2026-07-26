/**
 * scripts/validate-blind-labels.ts — structural validator for a completed
 * blind-label file (issue #24).
 *
 * Same job for `label_packet/<case>/blind_labels.json` that
 * `scripts/validate-gt.ts` does for the Case 3 ground truth, and deliberately
 * the same shape: catch enum typos, malformed dates, dangling
 * `source_document` refs, duplicate ids and leftover template placeholders
 * BEFORE anyone tries to score with the file.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: compare against the original
 * `data/cases/<case>/ground_truth.json`. That comparison is the whole
 * measurement and belongs to `scripts/compare-relabel.ts`. Running it here
 * would leak the answer to a labeler validating mid-sitting — which is exactly
 * when this script is most useful. Nothing under `data/cases/<case>/` is read
 * except a directory listing of `docs/` (filenames only, never contents), which
 * is what `source_document` refs are checked against.
 *
 * Nothing under `held_out/` is read. Case 3 is refused by name in any argument
 * spelling (docs/RESOLVED-DECISIONS.md #10).
 *
 * Usage:
 *   npx tsx scripts/validate-blind-labels.ts                 # case1 + case2
 *   npx tsx scripts/validate-blind-labels.ts case1
 *   npx tsx scripts/validate-blind-labels.ts case1 --packet=/tmp/pkt
 *
 * Exit codes:
 *   0 — every requested case validates (warnings allowed)
 *   1 — one or more violations, or a requested case has no labels yet
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { EventTypeSchema, DateConfidenceSchema } from "../lib/schema";

const TAG = "[validate-blind]";

type CaseId = "case1" | "case2";
const ALL_CASES: CaseId[] = ["case1", "case2"];
const DEFAULT_PACKET_ROOT = "label_packet";

// Placeholders written by scripts/make-label-packet.ts. Their presence means
// the file is still the template, not labels.
const STUB_KEY = "_comment_DELETE_THIS_BEFORE_LABELING";
const PLACEHOLDER_PREFIXES = ["REPLACE_WITH_", "REPLACE_YYYY"];

const BlindEventSchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be ISO 8601 YYYY-MM-DD"),
  date_confidence: DateConfidenceSchema,
  event_type: EventTypeSchema,
  title: z.string().min(1),
  source_document: z.string().min(1),
  in_scope: z.boolean(),
  notes: z.string().optional(),
});

const BlindHeaderSchema = z.object({
  case_id: z.enum(["case1", "case2"]),
  patient: z.string().min(1),
  labeled_at: z.string().min(1),
  labeler_notes: z.string(),
  events: z.array(z.unknown()),
});

type BlindEvent = z.infer<typeof BlindEventSchema>;

interface Violation {
  path: string; // e.g. case1.events[3].date
  message: string;
}

interface CaseResult {
  caseId: CaseId;
  labelsPath: string;
  present: boolean;
  violations: Violation[];
  warnings: Violation[];
  summary: string[];
}

/** The regex only proves the SHAPE is YYYY-MM-DD. This proves the date exists:
 * 2024-02-30 and 2024-13-01 both pass the regex and both fail here. */
function isRealCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  if (Number.isNaN(t)) return false;
  const back = new Date(t);
  return (
    back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d
  );
}

function looksLikePlaceholder(s: string): boolean {
  return PLACEHOLDER_PREFIXES.some((p) => s.startsWith(p));
}

/** Collects everything wrong with one case. Has several early exits; callers go
 * through `validateCase`, which is what guarantees the ordering. */
function collectCaseResult(caseId: CaseId, packetRoot: string): CaseResult {
  const labelsPath = join(packetRoot, caseId, "blind_labels.json");
  const result: CaseResult = {
    caseId,
    labelsPath,
    present: false,
    violations: [],
    warnings: [],
    summary: [],
  };

  if (!existsSync(labelsPath)) {
    result.violations.push({
      path: caseId,
      message: `no blind labels at ${labelsPath} — run scripts/make-label-packet.ts ${caseId} and label the packet first`,
    });
    return result;
  }
  result.present = true;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(labelsPath, "utf8"));
  } catch (err) {
    result.violations.push({
      path: `${caseId} <file>`,
      message: `not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    });
    return result;
  }

  // Template checks run on the RAW object, BEFORE zod. The template's
  // placeholder values are deliberately not schema-valid, so schema-first
  // ordering (which is what scripts/validate-gt.ts uses) would bury the one
  // useful message — "this is still the template" — under eight type errors.
  const rawEvents = (raw as { events?: unknown[] }).events;
  if (Array.isArray(rawEvents)) {
    rawEvents.forEach((e, i) => {
      if (e && typeof e === "object" && STUB_KEY in (e as Record<string, unknown>)) {
        result.violations.push({
          path: `${caseId}.events[${i}].${STUB_KEY}`,
          message: "template stub is still present — this file has not been labeled yet",
        });
      }
    });
  }
  for (const field of ["patient", "labeled_at", "labeler_notes"] as const) {
    const v = (raw as Record<string, unknown>)[field];
    if (typeof v === "string" && looksLikePlaceholder(v)) {
      result.violations.push({
        path: `${caseId}.${field}`,
        message: `still holds the packet placeholder "${v}"`,
      });
    }
  }
  if (result.violations.length > 0) return result;

  // Header and events are validated SEPARATELY, and each event separately from
  // its siblings, so that one malformed record does not mask every violation
  // after it. A single run reports everything wrong with the file.
  const header = BlindHeaderSchema.safeParse(raw);
  if (!header.success) {
    for (const issue of header.error.issues) {
      result.violations.push({
        path: `${caseId}.${issue.path.join(".") || "<root>"}`,
        message: issue.message,
      });
    }
    return result; // no usable events array to walk
  }
  const file = header.data;

  if (file.case_id !== caseId) {
    result.violations.push({
      path: `${caseId}.case_id`,
      message: `is "${file.case_id}" but this file sits in the ${caseId} packet`,
    });
  }

  if (Number.isNaN(Date.parse(file.labeled_at))) {
    result.violations.push({
      path: `${caseId}.labeled_at`,
      message: `not a parseable ISO 8601 timestamp: "${file.labeled_at}"`,
    });
  }

  // Per-event schema pass. Events that fail are reported and then skipped for
  // the semantic checks below (there is nothing well-typed left to check).
  const events: Array<{ index: number; event: BlindEvent }> = [];
  file.events.forEach((rawEvent, i) => {
    const parsed = BlindEventSchema.safeParse(rawEvent);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        result.violations.push({
          path: `${caseId}.events[${i}]${issue.path.length ? `.${issue.path.join(".")}` : ""}`,
          message: issue.message,
        });
      }
      return;
    }
    events.push({ index: i, event: parsed.data });
  });

  // Filenames only — never PDF contents. Same hygiene rule as validate-gt.ts,
  // and the same tolerance for the two naming conventions in use: the GT
  // convention "d1_pcp_2023_01.pdf" and the extractor's docId "d1_pcp_2023_01".
  const docsDir = resolve(process.cwd(), "data", "cases", caseId, "docs");
  let pdfNames = new Set<string>();
  if (!existsSync(docsDir)) {
    result.violations.push({
      path: `${caseId}`,
      message: `data/cases/${caseId}/docs does not exist — cannot check source_document refs`,
    });
  } else {
    pdfNames = new Set(readdirSync(docsDir).filter((n) => n.toLowerCase().endsWith(".pdf")));
  }
  const strippedNames = new Set([...pdfNames].map((n) => n.replace(/\.pdf$/i, "")));

  const seenIds = new Map<string, number>();
  const referenced = new Set<string>();
  let withoutPdfSuffix = 0;

  events.forEach(({ index: i, event: e }) => {
    const at = `${caseId}.events[${i}]`;

    const first = seenIds.get(e.id);
    if (first === undefined) {
      seenIds.set(e.id, i);
    } else {
      result.violations.push({
        path: `${at}.id`,
        message: `duplicate id "${e.id}" — first seen at ${caseId}.events[${first}]`,
      });
    }

    if (!isRealCalendarDate(e.date)) {
      result.violations.push({
        path: `${at}.date`,
        message: `"${e.date}" matches YYYY-MM-DD but is not a real calendar date`,
      });
    }

    if (looksLikePlaceholder(e.title)) {
      result.violations.push({
        path: `${at}.title`,
        message: `still holds the packet placeholder "${e.title}"`,
      });
    }

    if (pdfNames.size > 0) {
      const ref = e.source_document;
      const stripped = ref.replace(/\.pdf$/i, "");
      if (!pdfNames.has(ref) && !strippedNames.has(ref)) {
        result.violations.push({
          path: `${at}.source_document`,
          message: `"${ref}" is not a file in data/cases/${caseId}/docs/ (accepted spellings: "${stripped}.pdf" or "${stripped}")`,
        });
      } else {
        referenced.add(stripped);
        if (!/\.pdf$/i.test(ref)) {
          withoutPdfSuffix++;
        }
      }
    }
  });

  // Not a violation, but it changes scoring for a reason that has nothing to do
  // with the labels: lib/eval.ts's same-document tie-break compares
  // `gt.source_document` to the prediction's `source.document_id`, which is the
  // ".pdf"-less form. The original dev GT uses the ".pdf" form throughout, so
  // the tie-break is inert there. A blind file that drops the suffix would
  // activate it and make the comparison measure two things at once.
  if (withoutPdfSuffix > 0) {
    result.warnings.push({
      path: `${caseId}.events[*].source_document`,
      message: `${withoutPdfSuffix} ref(s) omit the ".pdf" suffix. Valid, but the original labels use the ".pdf" form, and lib/eval.ts's same-document tie-break compares this field to the prediction's document_id (no suffix) — so dropping it changes matching for a reason unrelated to your labels. Add ".pdf".`,
    });
  }

  const valid = events.map((x) => x.event);
  const oos = valid.filter((e) => !e.in_scope).length;
  if (oos === 0 && valid.length > 0) {
    result.warnings.push({
      path: `${caseId}.events[*].in_scope`,
      message:
        'zero events marked in_scope:false — the protocol says to be generous with the OOS mechanism; confirm this is deliberate',
    });
  }

  if (pdfNames.size > 0) {
    for (const d of [...strippedNames].sort()) {
      if (!referenced.has(d)) {
        result.warnings.push({
          path: `${caseId}`,
          message: `${d}.pdf has zero events labeled — confirm it is truly event-free rather than skipped`,
        });
      }
    }
  }

  const byType = new Map<string, number>();
  for (const e of valid) byType.set(e.event_type, (byType.get(e.event_type) ?? 0) + 1);
  const byConf = new Map<string, number>();
  for (const e of valid) byConf.set(e.date_confidence, (byConf.get(e.date_confidence) ?? 0) + 1);
  const fmtCounts = (m: Map<string, number>): string =>
    [...m.entries()]
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join(", ") || "(none)";

  result.summary.push(`patient=${file.patient}`);
  result.summary.push(`labeled_at=${file.labeled_at}`);
  const malformed = file.events.length - valid.length;
  result.summary.push(
    `events=${file.events.length} (schema-valid=${valid.length}${malformed > 0 ? `, malformed=${malformed}` : ""}, ` +
      `in_scope=${valid.length - oos}, in_scope:false=${oos})`,
  );
  result.summary.push(`event_types: ${fmtCounts(byType)}`);
  result.summary.push(`date_confidence: ${fmtCounts(byConf)}`);
  result.summary.push(
    `docs referenced=${referenced.size}, docs present=${pdfNames.size}`,
  );

  return result;
}

/** Validate one case, with violations always reported in file order.
 *
 * Violations are collected in several passes (template, header, per-event
 * schema, semantics), so they need sorting back into file order before
 * reporting — a reader fixing the file works top to bottom.
 *
 * The sort lives HERE, wrapping the collector, rather than at the collector's
 * final `return`, because that function has five exit paths and only the last
 * one reached the sort. The template-stub path in particular — the pristine
 * packet, which is the single most common way this script gets run — bails at
 * `result.violations.length > 0` and so reported in raw insertion order:
 * `events[0]` stub first, then `patient`, `labeled_at`, `labeler_notes`. That
 * is precisely the header-below-events inversion HEADER_RANK exists to prevent,
 * left unfixed on the one path that demonstrates it. Wrapping is what makes the
 * guarantee hold for every exit path, including any added later. */
function validateCase(caseId: CaseId, packetRoot: string): CaseResult {
  const result = collectCaseResult(caseId, packetRoot);
  result.violations.sort((a, b) => sortKey(a.path).localeCompare(sortKey(b.path)));
  return result;
}

/** Rank of each top-level key in the order it appears in `blind_labels.json`,
 * which is the order someone fixing the file reads it in. */
const HEADER_RANK: Record<string, number> = {
  case_id: 0,
  patient: 1,
  labeled_at: 2,
  labeler_notes: 3,
  events: 4,
};

/** `case1.events[7].date` -> `case1.4.events[0007].date`: the rank prefix puts
 * top-level keys in FILE order, and the zero-padded index keeps event indices
 * numeric under string comparison.
 *
 * The rank prefix is load-bearing. Sorting the raw path alphabetically — which
 * is what this did until 2026-07-26 — does not put header paths first, it puts
 * three of the four last: `l` > `e`, so `case1.labeled_at`, `case1.labeler_notes`
 * and `case1.patient` all sorted BELOW `case1.events[…]`, and only `case_id`
 * landed correctly, by luck of the alphabet.
 *
 * Paths with no recognized top-level key — the whole-file failures `case1` and
 * `case1 <file>`, and zod's `case1.<root>` — get no prefix rewrite or rank 9.
 * The first two still sort ahead of everything (a prefix, and ' ' < '.'), which
 * is where a "this file is not parseable" message belongs. */
function sortKey(path: string): string {
  const padded = path.replace(/\[(\d+)\]/g, (_, n: string) => `[${n.padStart(4, "0")}]`);
  const key = /^[^.]+\.([A-Za-z_]+)/.exec(padded)?.[1];
  if (key === undefined) return padded;
  return padded.replace(/^([^.]+)\./, `$1.${HEADER_RANK[key] ?? 9}.`);
}

function main(): void {
  const raw = process.argv.slice(2);

  const refuseCase3 = (a: string): boolean =>
    a.replace(/^-+/, "").split("=")[0].toLowerCase() === "case3";
  for (const a of raw) {
    if (refuseCase3(a)) {
      console.error(`${TAG} invalid case '${a}' — this validator runs on case1/case2 only.`);
      console.error(`${TAG} Case 3 is held out (docs/RESOLVED-DECISIONS.md #10) and is never read here.`);
      process.exit(1);
    }
  }

  const packetFlag = raw.find((a) => a.startsWith("--packet="));
  const packetRoot = resolve(
    process.cwd(),
    packetFlag ? packetFlag.slice("--packet=".length) : DEFAULT_PACKET_ROOT,
  );

  const args = raw.filter((a) => !a.startsWith("--"));
  const ids = args.length > 0 ? args : ALL_CASES;
  for (const a of ids) {
    if (a !== "case1" && a !== "case2") {
      console.error(`${TAG} invalid case '${a}' — this validator runs on case1/case2 only.`);
      process.exit(1);
    }
  }
  const cases = ids as CaseId[];

  console.log(`${TAG} packet root: ${packetRoot}`);
  console.log(`${TAG} checks schema + semantics only — never compares against the original labels`);

  const results = cases.map((c) => validateCase(c, packetRoot));

  let violations = 0;
  let warnings = 0;
  for (const r of results) {
    console.log("");
    console.log(`${TAG} ── ${r.caseId} (${r.labelsPath})`);
    for (const line of r.summary) console.log(`${TAG}    ${line}`);
    for (const w of r.warnings) {
      warnings++;
      console.warn(`${TAG}    ⚠  WARNING  ${w.path}: ${w.message}`);
    }
    for (const v of r.violations) {
      violations++;
      console.error(`${TAG}    ✗  VIOLATION ${v.path}: ${v.message}`);
    }
    if (r.violations.length === 0) {
      console.log(`${TAG}    ✓  ${r.caseId} valid (${r.warnings.length} warning(s))`);
    }
  }

  console.log("");
  if (violations > 0) {
    console.error(
      `${TAG} ${violations} violation(s), ${warnings} warning(s) across ${cases.length} case(s) — not ready to score`,
    );
    process.exit(1);
  }
  console.log(
    `${TAG} all ${cases.length} case(s) valid, ${warnings} warning(s) — ready for scripts/compare-relabel.ts`,
  );
}

main();

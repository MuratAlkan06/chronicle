/**
 * scripts/extract-case.ts — CLI cache builder for cases 1+2.
 *
 * Per docs/BUILD.md H6→H7 track-B and PLAN.md Q20.
 *
 * Reads `data/cases/<id>/docs/*.pdf` (sorted by filename — the d1_/d2_ prefix
 * gives chronological doc order naturally), calls `extractDoc` from lib/claude
 * per PDF, aggregates into a single events.json shaped like CaseFixture, and
 * writes the json + a metadata.json sidecar.
 *
 * Usage:
 *   npx tsx scripts/extract-case.ts case1
 *   npx tsx scripts/extract-case.ts case2 --dry-run
 *
 * --dry-run lists the PDFs that would be processed and exits without making
 * any Anthropic API calls. Used for smoke-tests in cycles where burning ~$0.10
 * per case isn't justified.
 *
 * The events.json shape is `CaseFixture` from lib/schema (case_id, patient,
 * condition, events). Static patient/condition metadata for cases 1+2 is
 * sourced from MOCK_DATA.md and hardcoded in CASE_METADATA below.
 */
// Load .env.local before any module that reads process.env (lib/claude reads
// ANTHROPIC_API_KEY at first call). Next dev does this automatically; the
// standalone CLI does not, so we do it explicitly.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Missing file is fine — env may already be set in the shell.
}

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { extractDocWithUsage } from "../lib/claude";
import { sumUsage, type ExtractUsage } from "../lib/measure";
import {
  CaseFixtureSchema,
  TimelineEventSchema,
  type CaseFixture,
  type TimelineEvent,
} from "../lib/schema";

type CaseId = "case1" | "case2" | "case3";

interface CaseMetadata {
  patient: string;
  condition: string;
}

// Patient + condition strings sourced from MOCK_DATA.md case header blocks.
// Case 3 is intentionally NOT keyed here — Case 3 PDFs live under held_out/
// and are deferred per PLAN.md (RESOLVED-DECISIONS §9).
const CASE_METADATA: Record<"case1" | "case2", CaseMetadata> = {
  case1: {
    patient: "Sarah Chen, 47F",
    condition: "Type 2 Diabetes Mellitus",
  },
  case2: {
    patient: "Maria Rodriguez, 52F",
    condition: "Suspicious breast finding (resolved benign)",
  },
};

const MODEL_VERSION = "claude-sonnet-4-6";

function isCaseId(s: string): s is CaseId {
  return s === "case1" || s === "case2" || s === "case3";
}

function listPdfs(docsDir: string): string[] {
  // Filename sort matches the d1_/d2_/... chronological prefix convention.
  return readdirSync(docsDir)
    .filter((n) => n.toLowerCase().endsWith(".pdf"))
    .sort();
}

function promptHashShort(): string {
  // First 7 chars of `git hash-object prompts/system_extract_v4.md`.
  // Mirrors the convention already in EVAL.md / BUILD.md H7 ("prompt git hash logged").
  const out = execFileSync("git", ["hash-object", "prompts/system_extract_v4.md"], {
    encoding: "utf8",
  }).trim();
  return out.slice(0, 7);
}

function sortEvents(events: TimelineEvent[], docOrder: string[]): TimelineEvent[] {
  // Stable sort: date asc, then document order, then appearance index. Same
  // ordering the timeline will use at render time so cached + live diffs are
  // a no-op.
  const docRank = new Map(docOrder.map((d, i) => [d, i] as const));
  const indexed = events.map((e, i) => ({ e, i }));
  indexed.sort((a, b) => {
    if (a.e.date !== b.e.date) return a.e.date < b.e.date ? -1 : 1;
    const ra = docRank.get(a.e.source.document_id) ?? Number.MAX_SAFE_INTEGER;
    const rb = docRank.get(b.e.source.document_id) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.i - b.i;
  });
  return indexed.map(({ e }) => e);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const caseArg = positional[0];

  if (!caseArg || !isCaseId(caseArg)) {
    console.error(
      "[extract-case] usage: tsx scripts/extract-case.ts <case1|case2|case3> [--dry-run]",
    );
    process.exit(1);
  }

  const caseId: CaseId = caseArg;
  const cwd = process.cwd();
  const caseDir = join(cwd, "data", "cases", caseId);
  const docsDir = join(caseDir, "docs");

  if (!existsSync(docsDir)) {
    console.error(
      `[extract-case] error: ${docsDir} does not exist. ` +
        `(Case 3 PDFs live under held_out/ and are deferred per PLAN.md.)`,
    );
    process.exit(1);
  }

  const pdfNames = listPdfs(docsDir);
  if (pdfNames.length === 0) {
    console.error(`[extract-case] error: no PDFs found in ${docsDir}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`[extract-case] DRY RUN — caseId=${caseId} pdfs=${pdfNames.length}`);
    for (const name of pdfNames) {
      console.log(`[extract-case] would process ${name}`);
    }
    return;
  }

  if (caseId === "case3") {
    // Belt-and-suspenders: even if a docs/ dir later appears for case3, we
    // refuse to dump it through this script — Case 3 must go through
    // scripts/eval-case3.ts (held-out hygiene per BACKEND-STANDARDS J.5).
    console.error(
      "[extract-case] error: case3 must be processed via scripts/eval-case3.ts (held-out hygiene)",
    );
    process.exit(1);
  }

  const meta = CASE_METADATA[caseId];

  // Build a list to track first-appearance doc order from the model's
  // results, used for stable sort below.
  const docOrder: string[] = [];
  const allEvents: TimelineEvent[] = [];
  // Per-doc token usage → persisted in metadata.json so cache hits + cost are
  // auditable after the fact (scripts/cache-report.ts).
  const perDoc: { docId: string; eventCount: number; usage: ExtractUsage }[] = [];

  for (const filename of pdfNames) {
    const docId = filename.replace(/\.pdf$/i, "");
    const buffer = readFileSync(join(docsDir, filename));
    const { events, usage } = await extractDocWithUsage(buffer, docId, filename);
    docOrder.push(docId);
    allEvents.push(...events);
    perDoc.push({ docId, eventCount: events.length, usage });
    console.log(`[extract-case] doc=${docId} events=${events.length}`);
  }

  const sorted = sortEvents(allEvents, docOrder);

  const fixture: CaseFixture = {
    case_id: caseId,
    patient: meta.patient,
    condition: meta.condition,
    events: sorted,
  };

  // Belt-and-suspenders pre-write validation: re-parse against the array
  // schema (and the full fixture schema) so we never persist a partial /
  // malformed events.json. Per acceptance criterion: on failure, print
  // errors and exit non-zero without writing.
  const eventsCheck = z.array(TimelineEventSchema).safeParse(sorted);
  if (!eventsCheck.success) {
    console.error("[extract-case] zod validation failed on aggregated events:");
    for (const issue of eventsCheck.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  const fixtureCheck = CaseFixtureSchema.safeParse(fixture);
  if (!fixtureCheck.success) {
    console.error("[extract-case] zod validation failed on CaseFixture:");
    for (const issue of fixtureCheck.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  const eventsPath = join(caseDir, "events.json");
  const metadataPath = join(caseDir, "metadata.json");
  mkdirSync(dirname(eventsPath), { recursive: true });

  writeFileSync(eventsPath, JSON.stringify(fixtureCheck.data, null, 2) + "\n", "utf8");

  const metadata = {
    generatedAt: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
    temperature: 0,
    promptHash: promptHashShort(),
    caseId,
    docCount: pdfNames.length,
    eventCount: sorted.length,
    // Token usage — total across all docs plus a per-doc breakdown. Old
    // metadata.json files (pre-usage) simply omit these; every reader
    // (app/api/cases route, scripts/cache-report) treats them as optional.
    usageTotals: sumUsage(perDoc.map((d) => d.usage)),
    perDoc,
  };
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n", "utf8");

  console.log(
    `[extract-case] wrote ${eventsPath} (${sorted.length} events) and metadata.json (promptHash=${metadata.promptHash})`,
  );
}

main().catch((err) => {
  console.error("[extract-case] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});

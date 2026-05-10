/**
 * scripts/eval-train.ts — compute eval reports for Cases 1+2 from cached
 * predictions + GT, write data/eval_reports/<case>.json, append to
 * prompts/CHANGELOG.md.
 *
 * No live extraction — reads existing data/cases/<id>/events.json. Exit 1 if
 * predictions or GT are missing.
 *
 * Usage:
 *   npx tsx scripts/eval-train.ts case1
 *   npx tsx scripts/eval-train.ts case1 case2
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  // Missing file is fine — env may already be set in the shell.
}

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { evaluate, breakdown, type GtEvent, type TierResult } from "../lib/eval";
import {
  CaseFixtureSchema,
  EventTypeSchema,
  DateConfidenceSchema,
  type EventType,
  type TimelineEvent,
} from "../lib/schema";

type CaseId = "case1" | "case2";
const ALL_EVENT_TYPES: EventType[] = [
  "lab",
  "imaging",
  "visit",
  "diagnosis",
  "medication",
  "procedure",
  "referral",
];

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

function isCaseId(s: string): s is CaseId {
  return s === "case1" || s === "case2";
}

function promptHashShort(): string {
  const out = execFileSync(
    "git",
    ["hash-object", "prompts/system_extract_v4.md"],
    { encoding: "utf8" },
  ).trim();
  return out.slice(0, 7);
}

function fmtPR(r: TierResult): string {
  const p = r.precision.toFixed(2);
  const re = r.recall.toFixed(2);
  return `P=${p} R=${re}`;
}

function fmtPRF(r: TierResult): string {
  const p = r.precision.toFixed(2);
  const re = r.recall.toFixed(2);
  const f = r.f1.toFixed(2);
  return `P=${p} R=${re} F1=${f}`;
}

interface PerCaseOutcome {
  caseId: CaseId;
  strict: TierResult;
  loose: TierResult;
  reportPath: string;
}

async function runOne(caseId: CaseId): Promise<PerCaseOutcome> {
  const cwd = process.cwd();
  const caseDir = join(cwd, "data", "cases", caseId);
  const eventsPath = join(caseDir, "events.json");
  const gtPath = join(caseDir, "ground_truth.json");

  if (!existsSync(eventsPath)) {
    console.error(
      `[eval-train] ${caseId}: predictions missing — run scripts/extract-case.ts ${caseId} first`,
    );
    process.exit(1);
  }
  if (!existsSync(gtPath)) {
    console.error(
      `[eval-train] ${caseId}: ground_truth.json missing at ${gtPath}`,
    );
    process.exit(1);
  }

  const fixtureRaw = JSON.parse(readFileSync(eventsPath, "utf8"));
  const fixture = CaseFixtureSchema.safeParse(fixtureRaw);
  if (!fixture.success) {
    console.error(
      `[eval-train] ${caseId}: events.json schema invalid: ${fixture.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
    process.exit(1);
  }

  const gtRaw = JSON.parse(readFileSync(gtPath, "utf8"));
  const gtFile = GtFileSchema.safeParse(gtRaw);
  if (!gtFile.success) {
    console.error(
      `[eval-train] ${caseId}: ground_truth.json schema invalid: ${gtFile.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
    process.exit(1);
  }

  const predicted: TimelineEvent[] = fixture.data.events;
  const gt: GtEvent[] = gtFile.data.events;

  const strict = evaluate(predicted, gt, "strict");
  const loose = evaluate(predicted, gt, "loose");
  const strictBd = breakdown(predicted, gt, "strict");
  const looseBd = breakdown(predicted, gt, "loose");

  // Per-event-type combined entries — n_gt computed from GT subset of that
  // type so the cached report shape matches API.md byEventType[type].n_gt.
  const byEventType: Record<EventType, { strict: TierResult; loose: TierResult; n_gt: number }> =
    {} as Record<EventType, { strict: TierResult; loose: TierResult; n_gt: number }>;
  for (const t of ALL_EVENT_TYPES) {
    byEventType[t] = {
      strict: strictBd[t],
      loose: looseBd[t],
      n_gt: gt.filter((g) => g.in_scope && g.event_type === t).length,
    };
  }

  const report = {
    caseId,
    tiers: { strict, loose },
    byEventType,
    promptVersion: "system_extract_v4.md",
    promptHash: promptHashShort(),
    generatedAt: new Date().toISOString(),
  };

  const reportsDir = join(cwd, "data", "eval_reports");
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, `${caseId}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(
    `[eval-train] ${caseId} strict ${fmtPRF(strict)} | loose ${fmtPRF(loose)}`,
  );
  console.log(`[eval-train] wrote ${reportPath}`);

  return { caseId, strict, loose, reportPath };
}

function appendChangelog(outcomes: PerCaseOutcome[]): void {
  const cwd = process.cwd();
  const path = join(cwd, "prompts", "CHANGELOG.md");
  const hash7 = promptHashShort();
  const iso = new Date().toISOString();

  const c1 = outcomes.find((o) => o.caseId === "case1");
  const c2 = outcomes.find((o) => o.caseId === "case2");

  // Format per docs/EVAL.md "step-by-step for Murat — prompt iteration
  // discipline" §3. Strict tier's P/R for the summary numbers (loose is the
  // optimistic ceiling and not what we iterate against).
  const c1str = c1 ? `C1: ${fmtPR(c1.strict)}` : "C1: skipped";
  const c2str = c2 ? `C2: ${fmtPR(c2.strict)}` : "C2: skipped";
  const entry = `v4 | ${iso} | ${hash7} | inlined per-type Title format spec for the 6 non-visit event types (closes audit-trail divergence) | ${c1str} | ${c2str}\n`;

  if (!existsSync(path)) {
    writeFileSync(path, `# Prompt iteration log\n\n${entry}`, "utf8");
    console.log(`[eval-train] created ${path}`);
  } else {
    appendFileSync(path, entry, "utf8");
    console.log(`[eval-train] appended to ${path}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (args.length === 0) {
    console.error(
      "[eval-train] usage: tsx scripts/eval-train.ts <case1|case2> [case1|case2]",
    );
    process.exit(1);
  }
  for (const a of args) {
    if (!isCaseId(a)) {
      console.error(`[eval-train] invalid case '${a}' — expected case1 or case2`);
      process.exit(1);
    }
  }

  const outcomes: PerCaseOutcome[] = [];
  for (const caseId of args as CaseId[]) {
    outcomes.push(await runOne(caseId));
  }

  appendChangelog(outcomes);
}

main().catch((err) => {
  console.error("[eval-train] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});

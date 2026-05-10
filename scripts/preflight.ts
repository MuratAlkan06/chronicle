/**
 * scripts/preflight.ts — pre-demo smoke.
 *
 * Verifies the repo is in a demo-ready state: required env keys, on-disk
 * fixtures, public assets, and HTTP routes (if a dev server is running).
 *
 * Usage:
 *   npx tsx scripts/preflight.ts            # disk + env checks only
 *   PORT=3000 npx tsx scripts/preflight.ts  # also smoke HTTP routes
 *
 * Exits non-zero on any failure so CI / a pre-demo script can gate on it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Result = { name: string; ok: boolean; detail?: string };

const ROOT = process.cwd();
const PORT = process.env.PORT ?? "3000";
const BASE = `http://localhost:${PORT}`;

const results: Result[] = [];

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

function fileExists(rel: string): boolean {
  return existsSync(join(ROOT, rel));
}

// ---------- env keys ----------

function checkEnv() {
  const envPath = join(ROOT, ".env.local");
  if (!existsSync(envPath)) {
    record("env: .env.local present", false, "missing — copy from .env.example or set vars in shell");
    return;
  }
  record("env: .env.local present", true);

  const raw = readFileSync(envPath, "utf8");
  const has = (key: string) => new RegExp(`^${key}=.+`, "m").test(raw);

  // Mandatory
  record("env: ANTHROPIC_API_KEY", has("ANTHROPIC_API_KEY"), "extraction primary");

  // Optional with documented fallback paths
  const gemini = has("GEMINI_API_KEY");
  const voyage = has("VOYAGE_API_KEY");
  const openai = has("OPENAI_API_KEY");

  record(
    "env: GEMINI_API_KEY (or Haiku fallback)",
    gemini || has("ANTHROPIC_API_KEY"),
    gemini ? "" : "absent — explainer falls back to Haiku 4.5",
  );
  record(
    "env: VOYAGE_API_KEY or OPENAI_API_KEY",
    voyage || openai,
    !voyage && openai ? "voyage absent — embeddings will go through OpenAI fallback" : "",
  );
}

// ---------- on-disk assets ----------

function checkAssets() {
  // PDF worker
  record(
    "asset: public/pdf.worker.min.mjs",
    fileExists("public/pdf.worker.min.mjs"),
    "required for /app + /eval PDF viewer",
  );

  // Cases 1 + 2 fixtures
  for (const id of ["case1", "case2"] as const) {
    record(
      `data: cases/${id}/events.json`,
      fileExists(`data/cases/${id}/events.json`),
    );
    record(
      `data: cases/${id}/metadata.json`,
      fileExists(`data/cases/${id}/metadata.json`),
    );
    record(
      `data: cases/${id}/ground_truth.json`,
      fileExists(`data/cases/${id}/ground_truth.json`),
    );
    record(
      `data: cases/${id}/docs/`,
      fileExists(`data/cases/${id}/docs`),
    );
  }

  // Eval reports
  for (const id of ["case1", "case2"] as const) {
    record(
      `data: eval_reports/${id}.json`,
      fileExists(`data/eval_reports/${id}.json`),
    );
  }

  // Case 3 held-out
  record(
    "held-out: case3/ground_truth.json",
    fileExists("held_out/case3/ground_truth.json"),
    "Path B closes when this exists",
  );
  record(
    "held-out: case3/.gt_hash.lock",
    fileExists("held_out/case3/.gt_hash.lock"),
    "/api/eval?mode=live verifies this hash before any extractDoc",
  );
  record(
    "held-out: case3/docs/",
    fileExists("held_out/case3/docs"),
    "Case 3 PDFs",
  );

  // Demo fallback
  const fallback = join(ROOT, "data/case3_eval_fallback.json");
  if (existsSync(fallback)) {
    try {
      const json = JSON.parse(readFileSync(fallback, "utf8"));
      const isPlaceholder = json?._placeholder === true;
      record(
        "demo: case3_eval_fallback.json populated",
        !isPlaceholder,
        isPlaceholder ? "still a placeholder — H11 captures real metrics" : "",
      );
    } catch {
      record("demo: case3_eval_fallback.json populated", false, "parse failure");
    }
  } else {
    record("demo: case3_eval_fallback.json populated", false, "missing");
  }

  // Active prompt
  const cl = join(ROOT, "prompts/CHANGELOG.md");
  if (existsSync(cl)) {
    record("prompt: prompts/CHANGELOG.md present", true);
  } else {
    record("prompt: prompts/CHANGELOG.md present", false);
  }
}

// ---------- HTTP routes ----------

async function smokeRoute(name: string, url: string, expect: number) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    record(
      name,
      r.status === expect,
      r.status === expect ? "" : `got ${r.status}, expected ${expect}`,
    );
  } catch (err) {
    record(name, false, err instanceof Error ? err.message : String(err));
  }
}

async function checkRoutes() {
  // Probe whether a dev server is up first; skip route checks if not.
  try {
    await fetch(`${BASE}/`, { signal: AbortSignal.timeout(1500) });
  } catch {
    record(
      "http: dev server reachable",
      false,
      `no server at ${BASE} — skipping route smoke (run \`npm run dev\` first)`,
    );
    return;
  }
  record("http: dev server reachable", true);

  await smokeRoute("http: GET /", `${BASE}/`, 200);
  await smokeRoute("http: GET /app", `${BASE}/app`, 200);
  await smokeRoute("http: GET /eval", `${BASE}/eval`, 200);
  await smokeRoute(
    "http: GET /api/cases/case1/events",
    `${BASE}/api/cases/case1/events`,
    200,
  );
  await smokeRoute(
    "http: GET /api/cases/case1/docs/d1_pcp_2023_01",
    `${BASE}/api/cases/case1/docs/d1_pcp_2023_01`,
    200,
  );
  await smokeRoute(
    "http: GET /pdf.worker.min.mjs",
    `${BASE}/pdf.worker.min.mjs`,
    200,
  );
}

// ---------- main ----------

async function main() {
  checkEnv();
  checkAssets();
  await checkRoutes();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  console.log("\nChronicle preflight\n────────────────────");
  for (const r of results) {
    const tag = r.ok ? "✓" : "✗";
    const detail = r.detail ? `  — ${r.detail}` : "";
    console.log(`  ${tag} ${r.name}${detail}`);
  }
  console.log(`\n${passed} passed · ${failed} failed`);

  process.exit(failed > 0 ? 1 : 0);
}

void main();

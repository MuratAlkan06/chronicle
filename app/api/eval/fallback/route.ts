/**
 * GET /api/eval/fallback — serves the canonical Case 3 cached fallback.
 *
 * The /eval Cmd+Shift+L demo hotkey needs the populated
 * `data/case3_eval_fallback.json`, but repo-root `data/` is NOT served by Next
 * (a plain fetch of `/data/...` 404s in a running server). Rather than copy the
 * file into `public/` (two sources of truth) or add a next.config rewrite
 * (indirection), this route reads the ONE canonical file on demand — same App
 * Router pattern as the rest of the /api/eval family, single source of truth.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";

function jsonError(code: string, message: string, status: number): Response {
  return Response.json(
    { error: { code, message, retryable: false } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(): Promise<Response> {
  const path = join(process.cwd(), "data", "case3_eval_fallback.json");
  if (!existsSync(path)) {
    return jsonError(
      "fallback_missing",
      "data/case3_eval_fallback.json not found",
      404,
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("extraction_failed", `failed to parse fallback: ${message}`, 500);
  }

  console.log("[eval:fallback] served data/case3_eval_fallback.json");
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}

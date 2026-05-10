/**
 * GET /api/cases/:id/events
 *
 * Per API.md "GET /api/cases/:id/events" + docs/BACKEND-STANDARDS.md §J.1, §J.6.
 *
 * Reads the precomputed events.json + metadata.json that scripts/extract-case.ts
 * dumped. Validates the loaded fixture through CaseFixtureSchema (guards against
 * a hand-edited/corrupted JSON) and returns the API-shape envelope.
 *
 * Failure modes:
 *  - bad path id              → 400 pdf_invalid (reuse closest existing code)
 *  - either file missing      → 404 case_not_extracted (developer-facing signal:
 *                                 Murat ran the demo before running the script)
 *  - JSON parse / zod fail    → 500 extraction_failed
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CaseFixtureSchema } from "@/lib/schema";

export const runtime = "nodejs";

const VALID_CASE_IDS = new Set(["case1", "case2", "case3"]);

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json(
    { error: { code, message, retryable: false } },
    { status },
  );
}

interface MetadataFile {
  generatedAt: string;
  modelVersion: string;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  if (!VALID_CASE_IDS.has(id)) {
    return errorResponse(
      "pdf_invalid",
      `unknown case id "${id}" (expected case1, case2, or case3)`,
      400,
    );
  }

  const caseDir = join(process.cwd(), "data", "cases", id);
  const eventsPath = join(caseDir, "events.json");
  const metadataPath = join(caseDir, "metadata.json");

  if (!existsSync(eventsPath) || !existsSync(metadataPath)) {
    return errorResponse(
      "case_not_extracted",
      `events.json missing for ${id}; run scripts/extract-case.ts first`,
      404,
    );
  }

  let rawFixture: unknown;
  let rawMetadata: MetadataFile;
  try {
    rawFixture = JSON.parse(readFileSync(eventsPath, "utf8"));
    rawMetadata = JSON.parse(readFileSync(metadataPath, "utf8")) as MetadataFile;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cases:events] parse_failed id=%s message=%s", id, message);
    return errorResponse(
      "extraction_failed",
      `failed to read fixture for ${id}: ${message}`,
      500,
    );
  }

  const parsed = CaseFixtureSchema.safeParse(rawFixture);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    console.error("[cases:events] zod_failed id=%s issues=%s", id, issues);
    return errorResponse(
      "extraction_failed",
      `events.json for ${id} failed schema validation: ${issues}`,
      500,
    );
  }

  console.log(
    "[cases:events] served id=%s events=%d generatedAt=%s",
    id,
    parsed.data.events.length,
    rawMetadata.generatedAt,
  );

  return Response.json(
    {
      caseId: id,
      events: parsed.data.events,
      generatedAt: rawMetadata.generatedAt,
      modelVersion: rawMetadata.modelVersion,
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

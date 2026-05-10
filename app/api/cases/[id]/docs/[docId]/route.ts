/**
 * GET /api/cases/:id/docs/:docId
 *
 * Streams data/cases/<id>/docs/<docId>.pdf for the side-panel PDF viewer.
 * Per BACKEND-STANDARDS.md §J.1 error envelope; runtime=nodejs so we can
 * use fs.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, normalize, sep } from "node:path";

export const runtime = "nodejs";

const VALID_CASE_IDS = new Set(["case1", "case2", "case3"]);
const DOC_ID_PATTERN = /^[a-z0-9_]+$/i;

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json(
    { error: { code, message, retryable: false } },
    { status },
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; docId: string }> },
): Promise<Response> {
  const { id, docId } = await context.params;

  if (!VALID_CASE_IDS.has(id)) {
    return errorResponse("pdf_invalid", `unknown case id: ${id}`, 400);
  }
  if (!DOC_ID_PATTERN.test(docId)) {
    return errorResponse("pdf_invalid", `invalid doc id: ${docId}`, 400);
  }

  // Defense-in-depth: resolve, then verify the resolved path stays inside the
  // case docs directory. Belt-and-braces against any future regex slip.
  const docsRoot = join(process.cwd(), "data", "cases", id, "docs");
  const candidate = normalize(join(docsRoot, `${docId}.pdf`));
  if (!candidate.startsWith(docsRoot + sep) && candidate !== docsRoot) {
    return errorResponse("pdf_invalid", "path traversal rejected", 400);
  }
  if (!existsSync(candidate)) {
    return errorResponse(
      "doc_not_found",
      `${docId}.pdf not found for ${id}`,
      404,
    );
  }

  const buffer = readFileSync(candidate);
  const body = new Uint8Array(buffer);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "cache-control": "public, max-age=300",
      "content-length": String(body.byteLength),
    },
  });
}

/**
 * scripts/prewarm.ts — warm the Anthropic prompt cache before showtime.
 *
 * Per BUILD.md "demo-day gotchas": the Anthropic prompt-cache TTL is 5 min.
 * Sending one real Case 1 PDF extraction 2-3 minutes before the demo
 * populates the cache, saving ~3-4s on doc 1 of the live walkthrough.
 *
 * Sends ONE small Case 1 doc to /api/extract as multipart and consumes the
 * SSE response. Does not write events.json — purely a side-effect call to
 * touch lib/claude.ts → Anthropic with the system + few-shot block.
 *
 * Usage:
 *   # 1. Start dev server in another shell:
 *   npm run dev
 *   # 2. ~2-3 min before demo:
 *   npx tsx scripts/prewarm.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = process.cwd();
const PORT = process.env.PORT ?? "3000";
const BASE = `http://localhost:${PORT}`;
// Smallest Case 1 PDF — keeps the warm-up cheap (~$0.005). The cache hit
// applies to system + few-shot regardless of the doc body.
const DOC = process.env.DOC ?? "d7_pcp_2024_07.pdf";
const DOC_PATH = join(ROOT, "data/cases/case1/docs", DOC);

async function main() {
  if (!existsSync(DOC_PATH)) {
    console.error(`prewarm: doc not found at ${DOC_PATH}`);
    process.exit(1);
  }

  // Confirm dev server is up.
  try {
    await fetch(`${BASE}/`, { signal: AbortSignal.timeout(1500) });
  } catch {
    console.error(`prewarm: no dev server at ${BASE} — run \`npm run dev\` first`);
    process.exit(1);
  }

  const buffer = readFileSync(DOC_PATH);
  const filename = basename(DOC_PATH);
  const file = new File([buffer], filename, { type: "application/pdf" });

  const fd = new FormData();
  fd.append("files", file, filename);

  console.log(`prewarm: POST /api/extract  (doc=${filename}, ${buffer.byteLength} bytes)`);
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/extract`, { method: "POST", body: fd });
  if (!r.ok || !r.body) {
    console.error(`prewarm: HTTP ${r.status}`);
    process.exit(1);
  }

  // Drain SSE — count event frames + watch for done.
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let events = 0;
  let docError: string | null = null;
  let done = false;
  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buf += decoder.decode(value, { stream: true });
    while (true) {
      const idx = buf.indexOf("\n\n");
      if (idx === -1) break;
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = raw
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!line) continue;
      try {
        const frame = JSON.parse(line) as
          | { type: "event" }
          | { type: "doc_error"; message: string }
          | { type: "done" }
          | { type: string };
        if (frame.type === "event") events++;
        else if (frame.type === "doc_error") {
          docError = (frame as { message: string }).message;
        } else if (frame.type === "done") done = true;
      } catch {
        /* ignore */
      }
    }
  }

  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  if (docError) {
    console.error(`prewarm: doc_error — ${docError}  (${wall}s)`);
    process.exit(1);
  }
  console.log(
    `prewarm: ok  events=${events}  wall=${wall}s — Anthropic prompt cache warmed (~5 min TTL)`,
  );
  console.log("        Re-run within 4 min if the demo slips.");
}

void main().catch((err) => {
  console.error("prewarm: failed", err);
  process.exit(1);
});

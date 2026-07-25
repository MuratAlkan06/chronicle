/**
 * scripts/screenshot-app.ts — capture a Case 1 /app screenshot for the
 * landing-page AppMockup slot per BUILD.md H10/H11.
 *
 * Run AFTER the frontend reaches a visually presentable state (timeline
 * rendering at minimum; side panel + click-to-source highlight ideal).
 * Run BEFORE the H10/H11 polish pass — gives the landing's Section 3 mockup
 * a real product image instead of the hand-built JSX placeholder.
 *
 * One-time install (first run):
 *   npm i -D playwright
 *   npx playwright install chromium
 *
 * Usage:
 *   # 1. Start dev server in another shell:
 *   npm run dev
 *
 *   # 2. Once it's serving on http://localhost:3000:
 *   npx tsx scripts/screenshot-app.ts
 *
 *   # 3. With overrides:
 *   CASE=case2 OUT=public/hero-app.png VIEWPORT_W=1280 VIEWPORT_H=800 \
 *     OPEN_SIDE_PANEL=1 EVENT_INDEX=0 npx tsx scripts/screenshot-app.ts
 *
 * Env knobs:
 *   PORT             dev server port (default 3000)
 *   CASE             case1 | case2 | case3 (default case1 — best demo content)
 *   OUT              output path (default public/hero-app.png)
 *   VIEWPORT_W       browser viewport width  (default 1280)
 *   VIEWPORT_H       browser viewport height (default 800)
 *   OPEN_SIDE_PANEL  "1" to click the first event after stream settles
 *                    (captures the side-panel + PDF highlight state)
 *   EVENT_INDEX      which event to click when OPEN_SIDE_PANEL=1 (default 0)
 *   WAIT_MS          extra settle time after stream looks done (default 1500)
 *   FULL_PAGE        "1" for full-page screenshot, otherwise viewport only
 *                    (default 0 — viewport, matches the AppMockup aspect)
 *
 * Held-out hygiene: never loads case3, even if CASE=case3 is passed.
 * Refuses with a non-zero exit; case3 must be triggered by the live /eval
 * route at H11, not via this dev tool.
 *
 * The script does NOT mutate any committed files other than writing the
 * output PNG. If the dev server isn't running, it bails with a clear error
 * — does not start a server itself (your `npm run dev` is still where the
 * frontend session's hot-reload state lives).
 */
import { writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";

const PORT = process.env.PORT ?? "3000";
const CASE = (process.env.CASE ?? "case1") as "case1" | "case2" | "case3";
const OUT = process.env.OUT ?? "public/hero-app.png";
const VIEWPORT_W = Number.parseInt(process.env.VIEWPORT_W ?? "1280", 10);
const VIEWPORT_H = Number.parseInt(process.env.VIEWPORT_H ?? "800", 10);
const OPEN_SIDE_PANEL = process.env.OPEN_SIDE_PANEL === "1";
const EVENT_INDEX = Number.parseInt(process.env.EVENT_INDEX ?? "0", 10);
const WAIT_MS = Number.parseInt(process.env.WAIT_MS ?? "1500", 10);
const FULL_PAGE = process.env.FULL_PAGE === "1";

const CASE_BUTTON_LABEL: Record<"case1" | "case2", RegExp> = {
  case1: /sarah\s+chen/i,
  case2: /maria\s+rodriguez/i,
  // case3 (David Park) is intentionally excluded — held-out hygiene.
};

async function main(): Promise<void> {
  if (CASE === "case3") {
    console.error(
      "[screenshot-app] error: CASE=case3 is forbidden. The first time the model touches Case 3 PDFs is at H11 via /api/eval?mode=live — this dev-tool path violates held-out hygiene per docs/BACKEND-STANDARDS.md §J.5. Aborting.",
    );
    process.exit(1);
  }

  // Probe the dev server before importing playwright (faster failure mode if
  // the server isn't up — saves the user the playwright dependency error if
  // they haven't installed it yet).
  const baseUrl = `http://localhost:${PORT}`;
  try {
    const res = await fetch(`${baseUrl}/app`, { redirect: "follow" });
    if (!res.ok) {
      console.error(
        `[screenshot-app] error: ${baseUrl}/app returned HTTP ${res.status}. Is the dev server up? Run "npm run dev" in another shell.`,
      );
      process.exit(1);
    }
  } catch (err) {
    console.error(
      `[screenshot-app] error: cannot reach ${baseUrl}/app — ${err instanceof Error ? err.message : String(err)}. Run "npm run dev" in another shell first.`,
    );
    process.exit(1);
  }

  // Lazy-import playwright so the dev-server probe above runs even if
  // playwright isn't installed yet — gives a more actionable error if both
  // are missing. The module is an optional dev-only dependency, so its
  // types may not be resolvable at typecheck time; @ts-ignore is the
  // pragmatic fix for this one-shot dev tool.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chromium: any;
  try {
    // @ts-expect-error — "playwright" is an optional dev dependency loaded at
    // runtime per this file's header install instructions; it is intentionally
    // absent from package.json, so its module types can't be resolved at build.
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    console.error(
      `[screenshot-app] error: playwright is not installed. Run:\n` +
        `  npm i -D playwright\n` +
        `  npx playwright install chromium\n` +
        `then rerun this script.`,
    );
    process.exit(1);
  }

  console.log(
    `[screenshot-app] launching chromium (viewport=${VIEWPORT_W}x${VIEWPORT_H}) → ${baseUrl}/app`,
  );

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
    deviceScaleFactor: 2, // retina-quality output
    reducedMotion: "reduce", // settle animations faster + deterministic frame
  });
  const page = await context.newPage();

  try {
    await page.goto(`${baseUrl}/app`, { waitUntil: "networkidle", timeout: 30_000 });
    console.log(`[screenshot-app] navigated to /app, looking for ${CASE} preset`);

    // Click the preset button — frontend session uses readable labels
    // ("Sarah Chen", "Maria Rodriguez") on cycle-11 buttons.
    const presetRegex = CASE_BUTTON_LABEL[CASE];
    await page.getByRole("button", { name: presetRegex }).first().click({ timeout: 10_000 });
    console.log(`[screenshot-app] clicked preset, waiting for SSE stream to settle`);

    // Cached replay is 1.5s × N docs (Q20 feel-delay): case1=7 docs (~10.5s),
    // case2=6 docs (~9s). 16s ceiling covers both with a buffer.
    // Wait for at least one event to appear, then wait for stream completion.
    await page.waitForSelector(
      // Frontend session's bullet-list / timeline event renderer should expose
      // *something* identifying an event card. Common patterns: data-testid,
      // aria-role, or just a date-formatted string. Fall back to any element
      // containing a 4-digit year-ish date.
      "text=/\\b(?:202[0-9])\\b/",
      { timeout: 16_000 },
    );

    // Heuristic settle: SSE done frame closes the connection; the in-flight
    // progress strip ("N / total documents processed" per cycle 14) disappears
    // when extraction is complete. Wait until that text is gone OR a fixed
    // ceiling, whichever comes first.
    await Promise.race([
      page.waitForFunction(
        () => !document.body.innerText.match(/\bprocess(ing|ed)\s+\d+\s*\/\s*\d+/i),
        undefined,
        { timeout: 16_000 },
      ),
      page.waitForTimeout(16_000),
    ]);

    if (OPEN_SIDE_PANEL) {
      console.log(`[screenshot-app] opening side panel for event index ${EVENT_INDEX}`);
      // Frontend session's event renderer is bullet-list at cycle 14; H3-H5
      // upgrades to motion.li / event-card. Try a few candidate selectors.
      const candidates = [
        page.locator("article[data-event]").nth(EVENT_INDEX),
        page.locator("li[role=button]").nth(EVENT_INDEX),
        page.locator("[data-event-card]").nth(EVENT_INDEX),
        page.getByRole("button", { name: /lab|visit|diagnosis|medication|imaging|procedure|referral/i }).nth(EVENT_INDEX),
      ];
      let opened = false;
      for (const loc of candidates) {
        try {
          await loc.click({ timeout: 2_000 });
          opened = true;
          break;
        } catch {
          // try next candidate
        }
      }
      if (!opened) {
        console.warn(
          `[screenshot-app] could not locate a clickable event card — capturing without side panel`,
        );
      } else {
        await page.waitForTimeout(800); // panel slide-in animation
      }
    }

    await page.waitForTimeout(WAIT_MS);

    mkdirSync(dirname(OUT), { recursive: true });
    const buf = await page.screenshot({
      fullPage: FULL_PAGE,
      omitBackground: false,
      type: "png",
    });
    writeFileSync(OUT, buf);

    const sizeKb = Math.round(buf.length / 1024);
    console.log(
      `[screenshot-app] wrote ${OUT} (${sizeKb} KB, ${VIEWPORT_W}x${VIEWPORT_H}@2x${FULL_PAGE ? " full-page" : ""})`,
    );
    console.log(``);
    console.log(`[screenshot-app] next:`);
    console.log(`[screenshot-app]   1. open ${OUT} and eyeball it — is the timeline visible? side panel populated? severity colors distinct?`);
    console.log(`[screenshot-app]   2. if yes: replace the AppMockup component in app/page.tsx Section 03 with <Image src="/${OUT.replace(/^public\//, "")}" ... />`);
    console.log(`[screenshot-app]   3. if no: re-run with different env vars (OPEN_SIDE_PANEL=1, EVENT_INDEX, viewport, WAIT_MS) until the framing reads as the wow-moment`);
    console.log(`[screenshot-app]   4. delete public/placeholder-hero.png — orphaned since the HeroScrollBoard pivot`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`[screenshot-app] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

// Prevent "join is unused" lint complaint when this file imports `join` for
// future relative-path features (output path resolution, etc.).
void join;

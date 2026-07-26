/**
 * scripts/check-label-leaks.ts — mechanical sweep for original ground-truth
 * titles leaking into tracked files (issue #24).
 *
 * THE GATE THAT REPLACES A MANUAL SWEEP. Reads the 21 original Cases 1+2
 * ground-truth titles, greps every tracked file for verbatim occurrences, and
 * exits NON-ZERO if any hit falls outside the forbidden list in
 * `lib/label-leak-sources.ts`. Passing means the forbidden list is a SUPERSET of
 * the hit set — every file that carries an answer verbatim is a file the labeler
 * has been told to stay out of.
 *
 * WHY IT EXISTS. The forbidden list was assembled by hand twice. The original
 * protocol (docs/PREREG-24-blind-relabel.md) named `prompts/system_extract_v4.md`
 * at 4/21 and missed `prompts/few_shot.md` at 9/21 — it missed a bigger leak
 * than the one it named. Amendment 1 fixed that, generalized the rule to the
 * whole `prompts/` directory, and then made the identical mistake one level
 * down: it missed eight more tracked files, including `app/page.tsx` (3/21, the
 * app's main page) and `docs/CASES.md` (2/21 plus a per-document event-count and
 * type breakdown). Two hand sweeps, two sets of misses. Amendment 2 records the
 * pattern and this script is the fix: the sweep is now something a machine does.
 *
 * WHAT IT CANNOT DO. It matches titles VERBATIM. It does not and cannot detect:
 *   - paraphrase, partial quotation, or a title reformatted across lines;
 *   - COUNT and GRANULARITY leaks — `[SNIPPET]` markers, `metadata.json`'s
 *     `eventCount`, `docs/CASES.md`'s per-document event tables. Those move the
 *     `in_scope` FN denominator (confound (a) in `scripts/compare-relabel.ts`)
 *     and carry no title at all, so nothing here will ever flag them.
 * A PASS therefore means "no unlisted VERBATIM title leak", never "no leak".
 * Judgement still owns the rest; this only removes the class of miss that has
 * actually happened twice.
 *
 * HELD-OUT HYGIENE. `held_out/**` is skipped and never opened — same rule as
 * every other script in this toolkit (docs/RESOLVED-DECISIONS.md #10). Skipping
 * cannot produce a false PASS: `held_out/` is itself on the forbidden list, so a
 * hit inside it would be classified as forbidden anyway. The skip changes what
 * is printed, not the verdict.
 *
 * NOT WIRED INTO CI, deliberately, and see the note at the bottom of this file.
 *
 * Usage:
 *   npx tsx scripts/check-label-leaks.ts
 *   npx tsx scripts/check-label-leaks.ts --verbose   # per-file line numbers
 *
 * Exit codes:
 *   0 — every file carrying a verbatim original title is on the forbidden list
 *   1 — an UNLISTED file carries one (or the inputs could not be read)
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
import {
  LABELED_CASES,
  leakSources,
  firstCovering,
  type LeakSource,
} from "../lib/label-leak-sources";

const TAG = "[check-label-leaks]";

/** Only the fields this script needs; the full shape is validated by
 * `scripts/validate-gt.ts` and `scripts/compare-relabel.ts`. */
const GtFileSchema = z.object({
  events: z.array(z.object({ title: z.string().min(1), in_scope: z.boolean() })),
});

interface TitleRef {
  title: string;
  caseId: string;
}

interface Hit {
  path: string;
  titles: string[]; // which of the 21, by value
  lines: number[]; // 1-based line numbers carrying at least one
  covering: LeakSource | undefined;
}

function die(msg: string): never {
  console.error(`${TAG} ${msg}`);
  process.exit(1);
}

function rule(ch = "-", n = 100): string {
  return ch.repeat(n);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function padL(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

/** The answers, read from the only files that legitimately hold them. */
function loadTitles(): TitleRef[] {
  const out: TitleRef[] = [];
  for (const caseId of LABELED_CASES) {
    const p = resolve(process.cwd(), "data", "cases", caseId, "ground_truth.json");
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(p, "utf8"));
    } catch (err) {
      die(`${p}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const gt = GtFileSchema.safeParse(parsed);
    if (!gt.success) die(`${p}: unexpected shape — ${gt.error.issues[0]?.message}`);
    for (const e of gt.data.events) {
      if (e.in_scope) out.push({ title: e.title, caseId });
    }
  }
  if (out.length === 0) die("no in-scope ground-truth titles found — nothing to check");
  return out;
}

/** Tracked files only. Untracked working material (`label_packet/` is
 * gitignored) is not what this gate is about: the risk is a file that ships in
 * the checkout the labeler already has. */
function trackedFiles(): string[] {
  let raw: string;
  try {
    raw = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 << 20 });
  } catch (err) {
    die(`git ls-files failed — run this from inside the repo (${err instanceof Error ? err.message : String(err)})`);
  }
  return raw.split("\0").filter((s) => s.length > 0);
}

function scan(titles: TitleRef[], files: string[], sources: LeakSource[]): {
  hits: Hit[];
  scanned: number;
  skippedHeldOut: number;
  unreadable: string[];
} {
  const hits: Hit[] = [];
  const unreadable: string[] = [];
  let scanned = 0;
  let skippedHeldOut = 0;

  for (const f of files) {
    // Never opened. See the HELD-OUT HYGIENE note at the top of this file.
    if (f === "held_out" || f.startsWith("held_out/")) {
      skippedHeldOut++;
      continue;
    }

    let body: string;
    try {
      body = readFileSync(resolve(process.cwd(), f), "utf8");
    } catch {
      unreadable.push(f);
      continue;
    }
    scanned++;

    const present = titles.filter((t) => body.includes(t.title)).map((t) => t.title);
    if (present.length === 0) continue;

    const lines: number[] = [];
    body.split("\n").forEach((line, i) => {
      if (present.some((t) => line.includes(t))) lines.push(i + 1);
    });

    hits.push({ path: f, titles: present, lines, covering: firstCovering(f, sources) });
  }

  return { hits, scanned, skippedHeldOut, unreadable };
}

function main(): void {
  const verbose = process.argv.slice(2).includes("--verbose");

  const titles = loadTitles();
  const sources = leakSources();
  const files = trackedFiles();
  const { hits, scanned, skippedHeldOut, unreadable } = scan(titles, files, sources);

  console.log(rule("="));
  console.log(`${TAG} verbatim ground-truth title sweep — issue #24, Cases 1+2`);
  console.log(rule("="));
  console.log(`  titles:          ${titles.length} in-scope, from data/cases/{${LABELED_CASES.join(",")}}/ground_truth.json`);
  console.log(`  tracked files:   ${files.length} (${scanned} scanned, ${skippedHeldOut} skipped under held_out/ — never opened)`);
  console.log(`  forbidden list:  ${sources.length} entries, lib/label-leak-sources.ts`);
  if (unreadable.length > 0) {
    console.log(`  unreadable:      ${unreadable.length} (${unreadable.slice(0, 3).join(", ")}${unreadable.length > 3 ? ", …" : ""})`);
  }

  const unlisted = hits.filter((h) => h.covering === undefined);

  console.log("");
  console.log(rule("="));
  console.log(`${TAG} FILES CARRYING A VERBATIM ORIGINAL TITLE (${hits.length})`);
  console.log(rule("="));
  console.log(`  ${pad("hits", 7)}${pad("file", 60)}covered by forbidden-list entry`);
  for (const h of [...hits].sort((a, b) => b.titles.length - a.titles.length || a.path.localeCompare(b.path))) {
    const cover = h.covering ? h.covering.path : "*** NOT ON THE LIST ***";
    console.log(`  ${padL(`${h.titles.length}/${titles.length}`, 7)}${pad(` ${h.path} `, 60)}${cover}`);
    if (verbose) console.log(`         lines: ${h.lines.join(", ")}`);
  }

  // Entries with zero title hits are NOT stale. Most of them are forbidden for
  // count/granularity/prediction leaks that carry no title — which is exactly the
  // class this script cannot see. Printed as information, never as a failure.
  const quiet = sources.filter((s) => !hits.some((h) => h.covering?.path === s.path));
  if (quiet.length > 0) {
    console.log("");
    console.log(`  ${quiet.length} forbidden entr(ies) matched no verbatim title today. NOT stale — most are`);
    console.log("  listed for count, granularity or prediction leaks this sweep cannot detect:");
    for (const s of quiet) console.log(`    ${s.path}`);
  }

  console.log("");
  console.log(rule("="));
  if (unlisted.length === 0) {
    console.log(`${TAG} PASS — the forbidden list is a superset of the hit set`);
    console.log(rule("="));
    console.log(`  All ${hits.length} file(s) carrying a verbatim original title are already forbidden to`);
    console.log("  the labeler by lib/label-leak-sources.ts, which is the same list the packet");
    console.log("  README and the generator's handover banner render.");
    console.log("");
    console.log("  This is a VERBATIM-TITLE check only. It says nothing about paraphrase, and");
    console.log("  nothing about count or granularity leaks — see WHAT IT CANNOT DO in this file.");
    return;
  }

  console.error(`${TAG} FAIL — ${unlisted.length} file(s) carry a verbatim original ground-truth title`);
  console.error(`${TAG} and are NOT on the forbidden list`);
  console.error(rule("="));
  for (const h of unlisted) {
    console.error(`  ${h.path} — ${h.titles.length}/${titles.length} title(s), line(s) ${h.lines.join(", ")}`);
  }
  console.error("");
  console.error("  A labeler in this checkout can open any of these in one keystroke and the");
  console.error("  protocol does not tell them not to. Either add each to leakSources() in");
  console.error("  lib/label-leak-sources.ts — which updates the packet README, the generator's");
  console.error("  runtime banner and this gate together — or remove the title from the file.");
  console.error("");
  console.error("  If a sitting has ALREADY happened under a protocol that omitted one of these,");
  console.error("  that is a finding about the measurement, not a chore: record it as an");
  console.error("  amendment rather than quietly adding the path.");
  process.exit(1);
}

main();

// ---------------------------------------------------------------------------
// SHOULD THIS BE IN CI? Not yet, and the reason is the same one that makes it
// useful: it is a gate on a PROTOCOL, not on the product.
//
// The case for CI is real — it would have caught both rounds of misses at PR
// time, which is the whole argument for building it. But wiring it in now buys
// little and costs something:
//
//   - It only binds while the sitting is pending. Once the blind labels exist and
//     `compare-relabel.ts` has run once, contamination is no longer preventable
//     and a red build says nothing actionable.
//   - It is not a code-correctness check. `npm run lint` and `npm test` failing
//     means the product is broken; this failing means a documentation list needs
//     a line. Mixing those two failure meanings in one required status check
//     trains people to read a red `verify` job as "probably the docs thing".
//   - Every legitimate future change that adds a Cases-1+2 title to a new test
//     fixture would break `main` until the list is updated, which is the kind of
//     friction that gets a check deleted rather than fixed.
//
// The honest place for it is a pre-sitting step in the protocol — run it in the
// same breath as `make-label-packet.ts`, where a failure is exactly on point and
// there is a human present to act on it. If issue #24's sitting slips or the
// experiment is repeated on new cases, revisit: a cheap, non-blocking CI job
// that annotates rather than fails would carry most of the value at none of the
// cost above.
// ---------------------------------------------------------------------------

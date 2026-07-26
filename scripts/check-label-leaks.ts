/**
 * scripts/check-label-leaks.ts — mechanical sweep for original ground-truth
 * titles leaking into tracked files (issue #24).
 *
 * THE GATE THAT REPLACES A MANUAL SWEEP. Reads the original in-scope Cases 1+2
 * ground-truth titles, greps every tracked file for verbatim occurrences, and
 * exits NON-ZERO if any hit falls outside the forbidden list in
 * `lib/label-leak-sources.ts`. Passing means the forbidden list is a SUPERSET of
 * the hit set — every file that carries an answer verbatim is a file the labeler
 * has been told to stay out of.
 *
 * WHY IT EXISTS. The forbidden list was assembled by hand twice. The original
 * protocol (docs/PREREG-24-blind-relabel.md) named `prompts/system_extract_v4.md`
 * and missed `prompts/few_shot.md`, which carries MORE of the answer key than
 * the file it named. Amendment 1 fixed that, generalized the rule to the whole
 * `prompts/` directory, and then made the identical mistake one level down: it
 * missed eight more tracked files, including `app/page.tsx` (the app's main
 * page) and `docs/CASES.md` (titles plus a per-document event-count and type
 * breakdown). Two hand sweeps, two sets of misses. Amendment 2 records the
 * pattern and this script is the fix: the sweep is now something a machine does.
 *
 * ITS OWN OUTPUT IS CATEGORICAL, for the reason `lib/label-leak-sources.ts`
 * records about the `why` strings it prints beside: this script used to rank
 * every hit as `N/M`, and the denominator M IS the aggregate in-scope original
 * event count for the two cases being relabeled. A gate that discloses the
 * anchor while reporting on disclosure is the same defect one level out. It
 * ranks with the list's own vocabulary instead — COMPLETE > MOST > MANY >
 * SEVERAL > A FEW — which is what the ordering was for.
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
 * ---------------------------------------------------------------------------
 * THIS SCRIPT IS ANSWER-BEARING, AND THE PACKET NAMES IT TO THE LABELER.
 *
 * It reads `data/cases/<case>/ground_truth.json` and prints, per file, how many of
 * the original titles that file carries. Run during a sitting, it hands the labeler a
 * ranked map of exactly where the answers are — through a script the packet
 * README names, while explaining that the list they are reading is enforced.
 * Saying "do not run this" in the README and the handover banner is necessary and
 * is not sufficient: the tool it warns about had no opinion of its own.
 *
 * So it now REFUSES to run while a sitting is live — while any
 * `label_packet/<case>/blind_labels.json` differs from the pristine generated
 * template. The pristine test is `sittingState` in lib/label-packet.ts, shared
 * with the generator's clobber guard rather than reimplemented here, because two
 * implementations of "has labeling started?" are two things to drift and the
 * drift is silent.
 *
 * The guard runs FIRST, before a single ground-truth title is read.
 *
 * It is a guard, not a lock. `--sitting-over` opens it for the legitimate
 * post-sitting run, and anyone determined to see the answers could open
 * `MOCK_DATA.md` instead. What it removes is the ACCIDENT — the reflexive run of
 * a script the packet just named — which is the failure mode that actually
 * happens.
 * ---------------------------------------------------------------------------
 *
 * Usage:
 *   npx tsx scripts/check-label-leaks.ts
 *   npx tsx scripts/check-label-leaks.ts --verbose        # per-file line numbers
 *   npx tsx scripts/check-label-leaks.ts --packet=/tmp/p  # non-default packet root
 *   npx tsx scripts/check-label-leaks.ts --sitting-over   # after compare-relabel.ts
 *
 * Exit codes:
 *   0 — every file carrying a verbatim original title is on the forbidden list
 *   1 — an UNLISTED file carries one, or a sitting is in progress, or the inputs
 *       could not be read
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  LABELED_CASES,
  leakSources,
  firstCovering,
  type LeakSource,
} from "../lib/label-leak-sources";
import { sittingState, asPacketCaseId, type SittingState } from "../lib/label-packet";

const TAG = "[check-label-leaks]";

/** Same default and same `--packet=` spelling as `scripts/validate-blind-labels.ts`
 * and `scripts/compare-relabel.ts`, so the three scripts a sitting involves are
 * pointed at a packet the same way. */
const DEFAULT_PACKET_ROOT = "label_packet";

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

/**
 * How much of the answer key a file carries, as a WORD.
 *
 * The same five-band vocabulary `lib/label-leak-sources.ts` uses for its `why`
 * strings, and for the same reason: a printed `N/M` discloses both a per-file
 * title count and, in M, the aggregate original event count for the two cases
 * being relabeled — the single anchor the packet is built to withhold. This
 * script is the one that MEASURES that anchor, so it is the last place that
 * should print it.
 *
 * Nothing is lost. The ranking is what the number was for: the table is sorted
 * by the underlying count and the band tells a maintainer whether an entry is
 * the top of the list or the bottom of it. Anyone who needs the exact figure is
 * reading `ground_truth.json`, which is where it belongs.
 */
function severityBand(hitCount: number, totalTitles: number): string {
  const f = totalTitles > 0 ? hitCount / totalTitles : 0;
  if (f >= 1) return "COMPLETE";
  if (f >= 0.5) return "MOST";
  if (f >= 0.25) return "MANY";
  if (f >= 0.1) return "SEVERAL";
  return "A FEW";
}

/** Absolute path → the repo-relative, `/`-separated spelling an operator can
 * paste back into a command. Same helper, same reason, as the generator's. */
function repoRel(abs: string): string {
  return relative(process.cwd(), abs).split(sep).join("/");
}

// ---------------------------------------------------------------------------
// SITTING GUARD — runs before any answer is read. See the note at the top.
// ---------------------------------------------------------------------------

interface PacketLabels {
  path: string; // repo-relative, for the operator to act on
  state: SittingState;
}

/**
 * Every `<packet root>/<dir>/blind_labels.json` on disk, classified.
 *
 * Scans the ACTUAL subdirectories rather than iterating {@link LABELED_CASES},
 * so a packet under a directory name this repo does not recognise still counts.
 * Such a file cannot be compared against any template, and `sittingState`
 * reports it as in-progress: an unrecognised directory holding blind labels is
 * the one state that cannot be cleared, so it is the last one to wave through.
 * An unreadable file is treated the same way, for the same reason — the guard
 * has no basis on which to call it pristine.
 */
function packetLabelFiles(packetRoot: string): PacketLabels[] {
  if (!existsSync(packetRoot)) return [];

  let names: string[];
  try {
    names = readdirSync(packetRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch (err) {
    die(`${repoRel(packetRoot)}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const out: PacketLabels[] = [];
  for (const name of names) {
    const abs = join(packetRoot, name, "blind_labels.json");
    if (!existsSync(abs)) continue;
    let contents: string;
    try {
      contents = readFileSync(abs, "utf8");
    } catch {
      out.push({ path: repoRel(abs), state: "in-progress" });
      continue;
    }
    out.push({ path: repoRel(abs), state: sittingState(contents, asPacketCaseId(name)) });
  }
  return out;
}

/**
 * Refuses the whole run while any packet holds edited labels.
 *
 * `--sitting-over` is an ASSERTION BY THE OPERATOR, not a detected fact.
 * `scripts/compare-relabel.ts` writes no artifact, so there is nothing on disk
 * for this script to check; and a flag whose name states its own precondition
 * turns the post-sitting run into a deliberate act while leaving the reflexive
 * mid-sitting one blocked. That is the same posture as the generator's clobber
 * guard, which has no `--force` and tells you to move the file aside.
 */
function assertNoSittingInProgress(packetRoot: string, sittingOver: boolean): void {
  const found = packetLabelFiles(packetRoot);
  const live = found.filter((f) => f.state === "in-progress");
  const root = repoRel(packetRoot);

  if (live.length === 0) {
    const detail =
      found.length === 0
        ? `no packet under ${root}/`
        : `${found.length} packet(s) under ${root}/, every one a pristine template`;
    console.log(`  sitting guard:   clear — ${detail}`);
    return;
  }

  if (sittingOver) {
    console.log(`  sitting guard:   OVERRIDDEN by --sitting-over — ${live.length} packet(s) hold edited labels:`);
    for (const f of live) console.log(`                     ${f.path}`);
    console.log("                   proceeding on your assertion that compare-relabel.ts has run.");
    return;
  }

  console.error(rule("="));
  console.error(`${TAG} REFUSED — a labeling sitting is in progress; nothing was read`);
  console.error(rule("="));
  for (const f of live) console.error(`  edited, not a pristine template:  ${f.path}`);
  console.error("");
  console.error("  This script reads the original ground-truth labels and prints, per file, how");
  console.error("  many of the original titles that file carries. It is answer-bearing by");
  console.error("  construction, and your packet README names it to you — so running it now would");
  console.error("  hand you a ranked map of exactly where the answers are, through the very tool");
  console.error("  that told you to stay away from them. One line read is the measurement gone.");
  console.error("");
  console.error("  Its two legitimate windows:");
  console.error("    BEFORE the sitting — run it in the same breath as make-label-packet.ts,");
  console.error("      which is where the protocol puts it.");
  console.error("    AFTER scripts/compare-relabel.ts has run — contamination is no longer");
  console.error("      preventable by then and this is a maintenance check again. Pass");
  console.error("      --sitting-over to say so; this script cannot detect it for you.");
  console.error("");
  console.error("  If a file above is not a live sitting — a stale packet you meant to discard —");
  console.error("  move it aside instead of reaching for the flag:");
  console.error(`    mv ${live[0].path} ${live[0].path}.kept`);
  process.exit(1);
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
  const raw = process.argv.slice(2);
  const verbose = raw.includes("--verbose");
  const sittingOver = raw.includes("--sitting-over");
  const packetFlag = raw.find((a) => a.startsWith("--packet="));
  const packetRoot = resolve(
    process.cwd(),
    packetFlag ? packetFlag.slice("--packet=".length) : DEFAULT_PACKET_ROOT,
  );

  console.log(rule("="));
  console.log(`${TAG} verbatim ground-truth title sweep — issue #24, Cases 1+2`);
  console.log(rule("="));

  // FIRST, and before a single title is read: this script must not run during a
  // sitting. Exits non-zero from inside if one is live.
  assertNoSittingInProgress(packetRoot, sittingOver);

  const titles = loadTitles();
  const sources = leakSources();
  const files = trackedFiles();
  const { hits, scanned, skippedHeldOut, unreadable } = scan(titles, files, sources);

  // The COUNT of titles is deliberately not printed: it is the aggregate
  // in-scope original event count for the two cases being relabeled.
  console.log(`  titles:          the in-scope originals, from data/cases/{${LABELED_CASES.join(",")}}/ground_truth.json`);
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
  console.log(`  ${pad("carries", 9)}${pad("file", 60)}covered by forbidden-list entry`);
  for (const h of [...hits].sort((a, b) => b.titles.length - a.titles.length || a.path.localeCompare(b.path))) {
    const cover = h.covering ? h.covering.path : "*** NOT ON THE LIST ***";
    console.log(`  ${padL(severityBand(h.titles.length, titles.length), 9)}${pad(` ${h.path} `, 60)}${cover}`);
    // --verbose prints POSITIONS, which is what a maintainer chasing an unlisted
    // hit needs. Stated rather than glossed: the LENGTH of that list is a lower
    // bound on how many titles the file carries, so --verbose is weaker than the
    // categorical default. It is opt-in, it is not the default output, the
    // sitting guard above refuses the whole run while labeling is live, and the
    // packet does not name this script to the labeler. Do not remove any of
    // those three and leave this flag as it is.
    if (verbose) console.log(`           lines: ${h.lines.join(", ")}`);
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
    // Categorical here too. This is the FAILURE path, so an operator is present
    // and about to act — but a failing run is also the one most likely to be
    // pasted into an issue, and the ratio would carry the anchor with it.
    console.error(
      `  ${h.path} — carries ${severityBand(h.titles.length, titles.length)} of the answer key, line(s) ${h.lines.join(", ")}`,
    );
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
//   - And since 2026-07-26 it refuses outright while a sitting is in progress.
//     `label_packet/` is gitignored, so a CI checkout would never see one and the
//     job would pass vacuously — a green check that proves nothing during the
//     only window the gate is for.
//
// The honest place for it is a pre-sitting step in the protocol — run it in the
// same breath as `make-label-packet.ts`, where a failure is exactly on point and
// there is a human present to act on it. If issue #24's sitting slips or the
// experiment is repeated on new cases, revisit: a cheap, non-blocking CI job
// that annotates rather than fails would carry most of the value at none of the
// cost above.
// ---------------------------------------------------------------------------

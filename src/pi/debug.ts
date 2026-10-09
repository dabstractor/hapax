/**
 * /acwords debug command (PRD §08 h2.48, P1.M3.T4.S1): a read-only dump
 * of the session CandidateStore and IngestPipeline counters, registered
 * with pi only when config.debug is true. The formatter is pure — it
 * renders one store snapshot plus one stats copy and can only ever show
 * words and counters, never message bodies (PRD §08 privacy). The
 * registration function is a thin pi adapter that P1.M3.T5.S1 wires
 * inside its session_start handler after loadConfig. The dump shows
 * words and successor rows only, by design (PRD 002 delta R1): the
 * successor-index sample section (P1.M3.T2.S1, R5) renders word →
 * successor ×count rows for the tuning protocol (§09 h2.52) — series
 * pairs (spec 06 h3.6) render their nextDisplay run casing with a
 * `(series)` marker, ordinary pairs stay plain. Word rows carry the
 * casing tallies (spec 06 h2.41) — `×count (cap X/lower Y)` in the
 * popup, dedicated cap/lower TSV columns in the /tmp dump — the R1
 * evidence for the display-free schema (no stored display field;
 * the resolved form shown is capDisplay-when-present, else the key).
 * Build sections through the small helpers so a new section lands in
 * exactly one place (one builder + one spread entry).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";

import { salience } from "../core/score.js";
import type { CandidateStore } from "../core/store.js";
import { STORE_CAP } from "../core/store.js";
import type { Candidate, IngestStats, RankGroup } from "../core/types.js";
import type { HapaxConfig } from "./config.js";
import type { IngestPipeline } from "./ingest.js";

/** Human labels for the admission groups (score.ts bands 100/50). */
const GROUP_LABEL: Record<RankGroup, string> = {
  0: "rare",
  1: "mid",
  2: "common",
};

/** How many top candidates the dump lists (PRD §08 h2.48). */
const TOP_N = 50;

/**
 * The top-N candidates for the dump: salience descending, ties broken by
 * byte-lexicographic key order so the output is deterministic across
 * invocations (mirrors compareCandidates's final tie-break). `now` is
 * captured ONCE by the caller — per-row ordinals would mix "now" values
 * and produce a bogus ordering.
 */
function topCandidates(entries: Candidate[], now: number): Candidate[] {
  return entries
    .map((c) => ({ c, s: salience(c, now) }))
    .sort((a, b) => {
      if (a.s !== b.s) return b.s - a.s; // salience descending
      return a.c.key < b.c.key ? -1 : a.c.key > b.c.key ? 1 : 0;
    })
    .slice(0, TOP_N)
    .map((r) => r.c);
}

/** "hapax candidate store" section: size vs cap, ordinal, histogram. */
function storeSection(
  size: number,
  ordinal: number,
  histogram: Record<RankGroup, number>,
): string[] {
  return [
    "hapax candidate store",
    `  size: ${size} / ${STORE_CAP}   (ordinal ${ordinal})`,
    `  rank groups: rare=${histogram[0]} mid=${histogram[1]} common=${histogram[2]}`,
  ];
}

/** Numbered top-N rows: display, ×sessionCount, casing tallies
 *  (capCount/lowerCount, spec 06 h2.41), group + label. Display is the
 *  resolved interim form — capDisplay when the word has a capitalized
 *  tally form, else the bare key (never fabricated); completion-time
 *  casing resolution (spec 04 h2.32) is the query layer's job, the dump
 *  only shows the resolved form. Salience itself is deliberately not
 *  printed — count + group is the tuning signal (PRD §09). */
function topSection(rows: Candidate[]): string[] {
  return [
    `  top ${TOP_N} by salience:`,
    ...rows.map(
      (c, i) =>
        `    ${i + 1}. ${c.capDisplay !== "" ? c.capDisplay : c.key}  ×${c.sessionCount}  (cap ${c.capCount}/lower ${c.lowerCount})  group ${c.rankGroup} (${GROUP_LABEL[c.rankGroup]})`,
    ),
  ];
}

/** "ingest stats" section: wordsSeen, admitted, all six gate counts. */
function statsSection(stats: IngestStats): string[] {
  const g = stats.rejectedByGate;
  return [
    "ingest stats",
    `  words seen: ${stats.wordsSeen}   admitted: ${stats.admitted}`,
    `  gate rejections: tooShort=${g.tooShort} tooLong=${g.tooLong} lowEntropy=${g.lowEntropy} unigramRun=${g.unigramRun} secret=${g.secret} consonantRun=${g.consonantRun}`,
  ];
}

/** How many top words the successor sample covers (tuning signal for
 *  chained offers, PRD §08 h2.48 + §09 h2.52). */
const SUCCESSOR_SAMPLE_N = 10;

/** "successor index sample" section (PRD §08 h2.48, P1.M3.T2.S1): for
 *  the SUCCESSOR_SAMPLE_N highest-salience words that HAVE successors,
 *  render `word → next ×count, next2 ×count2` rows (topSuccessors is
 *  already count-desc with series-first ordering, byte-lex ties, max 3
 *  — store.ts h3.9). Series pairs (spec 06 h3.6) render their
 *  nextDisplay RUN CASING plus a ` (series)` marker; ordinary pairs
 *  stay plain `next ×count`. The marker keys off `series` alone (a
 *  series entry without nextDisplay — unreachable via the store, kept
 *  defensive — degrades to the bare key). An empty index (empty store,
 *  or enableChaining:false — nothing ever reaches recordBigramRuns)
 *  renders one `(none)` line. Pure read: topSuccessors hands back the
 *  LIVE array (or a shared frozen empty) — mapped/joined, never
 *  mutated. Sampling follows `rows`, the SAME topCandidates order the
 *  top section renders (salience desc, byte-lex ties) — no second
 *  "now", no re-sorting. */
function successorsSection(
  rows: Candidate[],
  store: CandidateStore,
): string[] {
  const sampled = rows
    .filter((c) => store.topSuccessors(c.key).length > 0)
    .slice(0, SUCCESSOR_SAMPLE_N);
  if (sampled.length === 0) {
    return ["successor index sample", "  (none)"];
  }
  return [
    "successor index sample",
    ...sampled.map((c) => {
      const succ = store
        .topSuccessors(c.key)
        .map((s) => {
          const word = s.series && s.nextDisplay ? s.nextDisplay : s.next;
          return `${word} ×${s.count}${s.series ? " (series)" : ""}`;
        })
        .join(", ");
      return `  ${c.capDisplay !== "" ? c.capDisplay : c.key} → ${succ}`;
    }),
  ];
}

/**
 * Build the full /acwords dump from one consistent snapshot: the caller
 * supplies the stats copy (getStats() already returns one) and this
 * function reads entries(), currentOrdinal() and rankGroupHistogram()
 * exactly once each. Pure string builder — no logging, no mutation; the
 * store physically cannot leak message bodies and no other text source
 * is consulted. The M2 successor-index sample section (P1.M3.T2.S1) was
 * added exactly per the standing convention: one builder
 * (successorsSection) and one spread entry in the join below.
 */
export function formatAcwordsDump(
  store: CandidateStore,
  stats: IngestStats,
): string {
  const entries = store.entries(); // defensive copies — sort freely
  const ordinal = store.currentOrdinal(); // one "now" for the whole dump
  const histogram = store.rankGroupHistogram();
  const rows = topCandidates(entries, ordinal);

  return [
    ...storeSection(store.size, ordinal, histogram),
    "",
    ...topSection(rows),
    "",
    ...statsSection(stats),
    "",
    ...successorsSection(rows, store),
  ].join("\n");
}

/** Dependency slice for registerAcwordsCommand — structural on purpose
 *  (mirrors RestoreSessionManager in ingest.ts) so tests pass plain
 *  stubs instead of a live pipeline or full config. */
export interface AcwordsCommandDeps {
  store: CandidateStore;
  pipeline: Pick<IngestPipeline, "getStats">;
  config: Pick<HapaxConfig, "debug">;
}

/**
 * Register the /acwords command with pi — ONLY when config.debug is
 * true; otherwise a silent no-op (the command must not exist in normal
 * runs). Read-only per invocation: the handler renders a fresh dump
 * (stats and ordinal advance between calls) and reports it through
 * ctx.ui.notify at level "info" — pi's notify levels are
 * "info" | "warning" | "error"; there is no "warn". Per-session
 * registration: P1.M3.T5.S1 calls this inside session_start; pi
 * tolerates duplicate names across re-registrations (numeric suffixes)
 * and the item contract deems idempotent re-registration on reload
 * acceptable.
 */
export function registerAcwordsCommand(
  pi: ExtensionAPI,
  deps: AcwordsCommandDeps,
): void {
  if (!deps.config.debug) return;
  pi.registerCommand("acwords", {
    description: "hapax: dump candidate store stats (full list → file)",
    handler: async (_args, ctx) => {
      // Full dump (2026-09): the notify popup caps at top-50, but the
      // menu limits are per-query slices of a store that can hold
      // thousands of words — owners auditing admission need the
      // COMPLETE list. Written to /tmp/hapax-store.txt, one TSV line
      // per word — columns, in fixed order: key, resolved display
      // (capDisplay-when-present, else key), x<sessionCount>,
      // cap<capCount>, lower<lowerCount> (casing tallies, spec 06
      // h2.41), g<rankGroup>, then the optional proper/typed flags —
      // count-desc then content order for stable diffs.
      let written = "";
      try {
        const rows = [...deps.store.entries()]
          .map((c) => ({ c }))
          .sort(
            (a, b) =>
              b.c.sessionCount - a.c.sessionCount ||
              a.c.key.length - b.c.key.length ||
              (a.c.key < b.c.key ? -1 : a.c.key > b.c.key ? 1 : 0),
          );
        written = rows
          .map(
            ({ c }) =>
              `${c.key}\t${c.capDisplay !== "" ? c.capDisplay : c.key}\tx${c.sessionCount}\tcap${c.capCount}\tlower${c.lowerCount}\tg${c.rankGroup}` +
              `${c.properName ? "\tproper" : ""}${c.userTyped ? "\ttyped" : ""}`,
          )
          .join("\n");
        writeFileSync("/tmp/hapax-store.txt", written + "\n");
      } catch {
        /* the notify dump below still works without the file */
      }
      ctx.ui.notify(
        formatAcwordsDump(deps.store, deps.pipeline.getStats()) +
          `\nfull list (${deps.store.size} words): /tmp/hapax-store.txt`,
        "info",
      );
    },
  });
}
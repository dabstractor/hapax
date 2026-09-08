/**
 * /acwords debug command (PRD §08 h2.48, P1.M3.T4.S1): a read-only dump
 * of the session CandidateStore and IngestPipeline counters, registered
 * with pi only when config.debug is true. The formatter is pure — it
 * renders one store snapshot plus one stats copy and can only ever show
 * words and counters, never message bodies (PRD §08 privacy). The
 * registration function is a thin pi adapter that P1.M3.T5.S1 wires
 * inside its session_start handler after loadConfig. The M2 phrase dump
 * is a REMOVED design (PRD 002 delta R1); P1.M1.T2.S3 adds a successor
 * sample section — build sections through the small helpers below so a
 * new section lands in exactly one place.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

/** Numbered top-N rows: display, ×sessionCount, group + label. Salience
 *  itself is deliberately not printed — count + group is the tuning
 *  signal (PRD §09). */
function topSection(rows: Candidate[]): string[] {
  return [
    `  top ${TOP_N} by salience:`,
    ...rows.map(
      (c, i) =>
        `    ${i + 1}. ${c.display}  ×${c.sessionCount}  group ${c.rankGroup} (${GROUP_LABEL[c.rankGroup]})`,
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

/**
 * Build the full /acwords dump from one consistent snapshot: the caller
 * supplies the stats copy (getStats() already returns one) and this
 * function reads entries(), currentOrdinal() and rankGroupHistogram()
 * exactly once each. Pure string builder — no logging, no mutation; the
 * store physically cannot leak message bodies and no other text source
 * is consulted. M2 appends its section by adding one builder here and
 * one spread entry to the join below.
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
    description: "hapax: dump candidate store stats",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        formatAcwordsDump(deps.store, deps.pipeline.getStats()),
        "info",
      );
    },
  });
}
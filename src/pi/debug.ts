/**
 * /acwords debug command (PRD §08 h2.48, P1.M3.T4.S1): a read-only dump
 * of the session CandidateStore and IngestPipeline counters, registered
 * with pi only when config.debug is true. The formatter is pure — it
 * renders one store snapshot plus one stats copy and can only ever show
 * words and counters, never message bodies (PRD §08 privacy). The
 * registration function is a thin pi adapter that P1.M3.T5.S1 wires
 * inside its session_start handler after loadConfig. M2 (P2.M2.T3.S1)
 * appends a phrases/successor section: build sections through the small
 * helpers below so a new section lands in exactly one place.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { firstWord, phraseSalience } from "../core/query.js";
import { salience } from "../core/score.js";
import type { CandidateStore } from "../core/store.js";
import { PHRASE_CAP, STORE_CAP } from "../core/store.js";
import type {
  Candidate,
  IngestStats,
  PhraseEntry,
  RankGroup,
} from "../core/types.js";
import type { HapaxConfig } from "./config.js";
import type { IngestPipeline } from "./ingest.js";

/** Human labels for the admission groups (score.ts bands 220/120). */
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

/** How many top phrases the dump lists (PRD §08 h2.48: top 10). */
const TOP_PHRASES = 10;

/** Menu-style display of a phrase key: constituent display casings
 *  joined with single spaces, exactly like rankMatches's phrase items
 *  (h2.27); an evicted constituent falls back to its (lowercase) key. */
function phraseDisplay(store: CandidateStore, key: string): string {
  return key
    .split(" ")
    .map((w) => store.get(w)?.display ?? w)
    .join(" ");
}

/**
 * "hapax phrases" section (P2.M2.T3.S1, PRD §08 h2.48 / §09 h2.52 — the
 * dump is the ONLY phrase-layer observability, so this is the tuning
 * signal): stored-phrase count against PHRASE_CAP, the top 10 phrases by
 * phraseSalience (query.ts's exported formula — never reimplemented),
 * and one successor-index sample: the top successors of the top phrase's
 * FIRST word, rendered "word → next ×count, …". Reads store state only —
 * phraseEntries() / get() / topSuccessors() / phraseSize — never message
 * bodies. Deterministic: salience descending with the byte-lexicographic
 * key tie-break (same discipline as topCandidates), one "now" ordinal
 * supplied by the caller. A store with no phrases (empty session, or
 * `enablePhrases: false` — capture never ran) renders "phrases: (none)"
 * and omits the sample; with phrases but a successor-less top word the
 * sample header is omitted.
 */
function phrasesSection(store: CandidateStore, now: number): string[] {
  const entries: PhraseEntry[] = store.phraseEntries(); // defensive copies
  if (entries.length === 0) {
    return ["hapax phrases", "  phrases: (none)"];
  }
  const rows = entries
    .map((p) => ({
      p,
      sal: phraseSalience(
        p.key.split(" ").map((w) => store.get(w)), // evicted → 0 contribution
        p,
        now,
      ),
    }))
    .sort((a, b) => {
      if (a.sal !== b.sal) return b.sal - a.sal; // salience descending
      return a.p.key < b.p.key ? -1 : a.p.key > b.p.key ? 1 : 0; // byte-lex
    })
    .slice(0, TOP_PHRASES);
  const lines = [
    "hapax phrases",
    `  phrases: ${store.phraseSize}   (cap ${PHRASE_CAP})`,
    `  top ${TOP_PHRASES} by salience:`,
    ...rows.map(
      (r, i) =>
        `    ${i + 1}. ${phraseDisplay(store, r.p.key)}  ×${r.p.count}${
          r.p.count >= 2 ? "  (repeat)" : "" // repetition-path marker (h3.7)
        }`,
    ),
  ];
  const topWord = firstWord(rows[0]!.p.key);
  const succ = store.topSuccessors(topWord);
  if (succ.length > 0) {
    lines.push("  successor sample (top successors of the top word):");
    lines.push(
      `    ${topWord} → ${succ.map((s) => `${s.next} ×${s.count}`).join(", ")}`,
    );
  }
  return lines;
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
    "",
    ...phrasesSection(store, ordinal), // M2 (P2.M2.T3.S1) — same "now"
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
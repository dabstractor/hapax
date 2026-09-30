/**
 * hapax shared core contracts.
 *
 * Single vocabulary for the core pipeline (segment → shapeGate → score →
 * store → query) and the pi adapter. PRD §04 (tokenization/scoring) and
 * §06 (candidate store).
 *
 * This module is pure declarations: NO imports, NO runtime code.
 * src/core/ must never import from pi packages (architecture invariant).
 */

/** Admission rank group. PRD §04: 0 = dictionary-absent (rare-by-default),
 * 1 = rare-but-attested (q < 20), 2 = mid-frequency (20 ≤ q < 50).
 * q ≥ 50 is rejected, never stored. Band values live in score.ts
 * (MID_FREQ_THRESHOLD / REJECT_COMMON_THRESHOLD, calibrated per BUG-001
 * and the 2026-09 Issue 1 retune that rejects "context"-class words). */
export type RankGroup = 0 | 1 | 2;

/** A word admitted to the session store. One entry per lowercase key.
 *  PRD §06 verbatim. */
export interface Candidate {
  /** lowercase */
  key: string;
  /** most recent casing seen */
  display: string;
  /** occurrences this session */
  sessionCount: number;
  /** message ordinal at last sighting */
  lastSeenOrdinal: number;
  firstSeenOrdinal: number;
  /** sticky once true */
  userTyped: boolean;
  /** capitalized-initial seen at least once */
  properName: boolean;
  /** admission group (PRD §04) */
  rankGroup: RankGroup;
  isSubword: boolean;
}

/** The unit the ingest pipeline feeds `store.upsert`. Produced by
 *  segment + shapeGate + score for each admitted candidate occurrence. */
export interface Sighting {
  /** lowercase key */
  key: string;
  /** casing as seen this occurrence */
  display: string;
  /** message ordinal of this occurrence */
  ordinal: number;
  /** true when the occurrence came from a user message */
  fromUser: boolean;
  properName: boolean;
  rankGroup: RankGroup;
  isSubword: boolean;
  /** whole-token key when this sighting is a subword; absent for
   *  whole tokens (subword rankGroup ≤ parent group + 1, PRD §04) */
  parentKey?: string;
}



/** One of a word's most frequent bigram successors (PRD §06 h3.9): an
 *  element of the top-3-per-word index CandidateStore maintains
 *  incrementally at bigram ingest (recordBigramRuns) and the
 *  chained-completion machine (P2.M2.T2.S1) reads per keystroke. */
export interface Successor {
  /** the word that followed `word` in a bigram */
  next: string;
  /** occurrences of the bigram "word next" this session */
  count: number;
}

/** Output of src/core/segment.ts tokenize(). PRD §04 segmentation. */
export interface RawToken {
  /** the matched text, original casing (normalization is P1.M2.T1.S2) */
  raw: string;
  /** true when the token came from the hexish scan (6–40 hex chars,
   *  at least one letter a–f; commit-hash-shaped). Hexish tokens are
   *  opaque — subword splitting (S2) skips them. */
  hexish: boolean;
  /** true when the token came from the technical-literal scan (2026-10
   *  rule 4c: digit-bearing mixed-class strings like `2560x1440@2`,
   *  `v1.2.3`, `192.168.1.1`, and pure digit runs ≥ 4). Like hexish,
   *  literals are opaque — subword splitting (S2) skips them; codes
   * complete whole as typed. Optional because base/hexish/compound
   * tokens are not literals. */
  literal?: boolean;
  /** true when the token came from the path scan (2026-10 rule 4d):
   *  slash-joined path-shaped runs — `src/core/query.ts`,
   *  `/home/user/x`, `../tools/build.mjs`, `example.com/a/b`. Paths are
   *  opaque (never subword-split) and carry the codebase's first
   *  key≠display divergence beyond casing: the STORE KEY is the
   *  edge/line:col-trimmed lowercase slice `raw.slice(trimFrom,
   *  trimTo)`, while `raw` — the insertion display — keeps the original
   *  edge symbols. `start`/`end` remain the ORIGINAL run bounds (the
   *  display span), so ingest's whitespace-adjacency bigram rule (which
   *  reads the raw span) stays correct. Optional: base/hexish/
   *  compound/literal tokens are not paths. */
  path?: boolean;
  /** Present iff `path`: start of the trimmed KEY inside `raw` — leading
   *  `/`, `~`, `./`, `../` and combinations are trimmed (rule 4d). */
  trimFrom?: number;
  /** Present iff `path`: end of the trimmed KEY inside `raw` — a trailing
   *  `/` and one `:line(:col)?` suffix are trimmed. Invariant:
   *  `raw.slice(trimFrom, trimTo).toLowerCase()` is the store key source. */
  trimTo?: number;
  /** UTF-16 offset of the token's first char, into the exact string passed
   *  to tokenize() — i.e. into the POST-maskSecrets segment string by the
   *  time ingest calls it (maskSecrets blanks in place, preserving length).
   *  Valid String.prototype.slice bounds: text.slice(start, end) === raw.
   *  Consumed by ingest (P1.M1.T3.S2) for the strict whitespace-only
   *  adjacency bigram rule (PRD 002 §06 h3.6). */
  start: number;
  /** one past the token's last char (exclusive), same string as `start` */
  end: number;
  /** True when the text immediately before the token (skipping
   *  whitespace) ends with sentence-ending punctuation — `.` `!` `?`,;
   *  optionally wrapped in closing quotes/brackets (`)”"’»…`). A
   *  Capitalized token at such a position is sentence-INITIAL: its
   *  capital is orthographic, not a proper-name signal (2026-09 rule —
   *  sentence-first words like "Check…" no longer set the properName
   *  hint, so relief/conjugation exemptions don't fire for them).
   *  Message starts do NOT count (no preceding punctuation). */
  sentenceStart: boolean;
}

/** Why the shape gate rejected a candidate. PRD §04 shape-gate rules. */
export type GateRejectReason =
  | 'tooShort'
  | 'tooLong'
  | 'lowEntropy'   // char-entropy < 1.5 bits/char
  | 'unigramRun'   // single-char run ≥ 4
  | 'secret'       // secret-shaped string (always reject, not configurable)
  | 'consonantRun' // consonant run ≥ 6, no vowel/digit

/** Shape-gate result. `reason` present only when ok === false. */
export interface GateResult {
  ok: boolean;
  reason?: GateRejectReason;
}

/** Loader contract for the packed dictionary (dict/common-en.bin).
 *  Implementation lives in src/core/dictionary.ts (P1.M1.T2.S1) —
 *  this is the interface only. `lookup` returns the quantized commonness
 *  rank 0–255, or null when absent. Must allocate nothing per lookup. */
export interface Dictionary {
  lookup(word: string): number | null;
  readonly version: number;
  readonly entryCount: number;
  /** OPTIONAL failure probe (BUG-004): true once the backing load threw;
   *  never resets. Absent on the eager loadDictionary() result and on
   *  plain test stubs — check with `dict.failed === true`. */
  readonly failed?: boolean;
}

/** Ingest counters owned by src/pi/ingest.ts; surfaced by /acwords. */
export interface IngestStats {
  wordsSeen: number;
  admitted: number;
  rejectedByGate: Record<GateRejectReason, number>;
}

/** Query result item from src/core/query.ts (PRD §04 query ranking;
 *  description provenance e.g. "session ×12" built by query.ts). */
export interface RankedMatch {
  key: string;
  display: string;
  description: string;
  salience: number;
  /** Session occurrences of this candidate, copied from the store entry
   *  (spec §04 h2.29, 2026-10 owner rule): menu-order key 2 WITHIN a tier
   *  — among equally strict matches the more conversation-relevant word
   *  (higher sessionCount) goes leftmost. Unlike salience (which never
   *  orders — membership/eviction only), this raw count DOES order, but
   *  a count difference can never cross a tier boundary. Agrees with
   *  description ("session x" + sessionCount). */
  sessionCount: number;
}
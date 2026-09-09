/**
 * Score — stage 3 of the segment → shapeGate → score → store → query
 * pipeline (PRD §04), two halves sharing one module.
 *
 * ADMISSION (h2.24, P1.M2.T3.S1): `admit` maps a shape-gated CandidateDraft
 * plus a dictionary lookup to a RankGroup (0 | 1 | 2) or 'reject':
 *
 *   q = dictionary.lookup(draft.key)   (0–255 quantized rank; 0 = rarest,
 *                                      255 = most common; null = absent)
 *   q === null                 → group 0    rare-by-default
 *   q < MID_FREQ_THRESHOLD     → group 1    rare-but-attested
 *   q < REJECT_COMMON_THRESHOLD → group 2   mid-frequency
 *   otherwise                  → 'reject'   very common ("the", "context",
 *                                           "data" — PRD §04's reject
 *                                           examples and their band)
 *   + proper-noun relief (BUG-002): a CAPITALIZED whole token with
 *     REJECT_COMMON_THRESHOLD ≤ q < PROPER_NOUN_ADMIT_CEILING admits at
 *     group 2 instead of rejecting.
 *
 * Band values are pinned by MEASUREMENT against the shipped artifact —
 * tools/calibrate-bands.mjs prints the rank↔word↔q table and re-verifies the
 * constants (BUG-001 history: the original 220/120 bands covered only ranks
 * ≤ 3 / ≤ 391 of the real corpus, so "the"/"with"/"this" could never be
 * rejected no matter how good the dictionary data was).
 *
 * Smaller groups rank better (rare words are the most valuable completions),
 * so the subword clamp RAISES the numeric group: a sub-word never ranks above
 * its parent whole token's group + 1 — final group is
 * max(tableGroup, parentGroup + 1), saturated at 2 (RankGroup has no 3).
 * 'reject' is immune to the clamp: a table-rejected subword
 * (q ≥ REJECT_COMMON_THRESHOLD) stays rejected; the clamp only ever demotes
 * admitted groups.
 *
 * Pipeline order (ingest, P1.M3.T2): whole tokens are admitted BEFORE their
 * sub-words so the parent's group is known — pass it as `parentGroup` when
 * scoring a draft with isSubword. Whole tokens omit the argument; a subword
 * arriving without one takes the raw table result (defensive only — the
 * ingest pipeline always supplies it for subwords).
 *
 * The thresholds are baked constants (PRD §08): the ONLY tuning surface,
 * tuned in-codebase per §09 — never read from config or env, never
 * configurable at runtime. Admission never special-cases hexish tokens: the
 * gate-admitted 13–19 hex band gets its fate here from the dictionary alone
 * (lookup miss → group 0, like any other absent word).
 *
 * QUERY-TIME RANKING (h2.25/§09, P1.M2.T3.S2): `salience` is the single
 * source of truth for how much a stored Candidate deserves menu space
 * right now. Computed at query time from store stats — never stored,
 * never persisted (PRD §04). Weights, baked constants (§08):
 *
 *   2.0 · log2(1 + sessionCount)   session frequency, log-damped
 *   3.0 · exp(-Δordinal / 20)      recency, τ = 20 messages
 *   1.5                            userTyped (sticky flag)
 *   0.8                            properName
 *   1.0 / 0.5 / 0                  rarity bonus, rankGroup 0 / 1 / 2
 *
 * `evictionScore` = salience · exp(-Δ/50): the slower τ = 50 decay used
 * ONLY by store eviction (P1.M2.T4.S3) — higher score = keep longer.
 * `compareCandidates` is the query result order (§09): salience desc →
 * shorter key → byte order on the lowercase key, so the menu never shows
 * a visible tie. query.ts (P1.M2.T5.S1) and store eviction import these;
 * never reimplement the math elsewhere.
 *
 * Pure: type-only imports, no runtime imports, no mutable state. Like the
 * admission thresholds above, every weight and tau here is a baked
 * constant tuned in-codebase per §09 — never config, never env, never a
 * runtime option.
 */

import type { CandidateDraft } from "./segment.js";
import type { Candidate, Dictionary, RankGroup } from "./types.js";

/** Reject at/above this commonness rank — very common English that must
 *  never trigger a menu ("the", "with", "this", "them", "context").
 *  PRD §04 h2.24; baked per PRD §08 (the ONLY tuning surface — never
 *  config/env).
 *
 *  Calibrated against the shipped artifact (tools/calibrate-bands.mjs).
 *  BUG-001 fix: under the frozen quant curve the original value 220 covered
 *  only ranks ≤ 3, making rejection mathematically unreachable; the first
 *  recalibration (q ≥ 100) still left the PRD's own named reject example
 *  "context" (q = 51) admitted at group 2, so ordinary prose opened menus
 *  on context/data/code/jumps/lazy-class words (2026-09 validation Issue 1).
 *  q ≥ 50 ⇔ the top ~8,501 dictionary ranks of 48,802 — the rank band the
 *  dialogue-register corpus actually assigns to everyday prose words — and
 *  "context" (q = 51), "jumps" (51), "lazy" (67), "ordinary" (79),
 *  "data" (82), "code" (91) all clear it. The BUG-001 word set
 *  (the=240, with=179, this=197, them=156) clears it with margin. */
export const REJECT_COMMON_THRESHOLD = 50 as const;

/** Demote to group 2 at/above this commonness rank
 *  (20 ≤ q < 50 — mid-frequency, e.g. "gospel"/"brazil"-band words).
 *  PRD §04 h2.24; baked per PRD §08.
 *
 *  Calibrated against the shipped artifact (tools/calibrate-bands.mjs,
 *  BUG-001 fix + 2026-09 Issue 1 retune): group 2 ⇔ dictionary ranks
 *  ~8,502–~27,000 land group 2; the rarest attested tail below stays
 *  group 1 (the corpus tail bottoms out at q ≈ 11, so 20 keeps three
 *  live bands: reject [50,255], mid [20,50), rare-attested [0,20)). */
export const MID_FREQ_THRESHOLD = 20 as const;

/** Relief ceiling for capitalized whole tokens (BUG-002 fix,
 *  bugfix/001_0f4b641cf9ce): a properName-flagged, non-subword,
 *  dictionary-attested candidate with REJECT_COMMON_THRESHOLD ≤ q <
 *  PROPER_NOUN_ADMIT_CEILING admits at group 2 instead of rejecting.
 *  Baked per PRD §08; tuned 120 → 95 by the §09 tuning-protocol re-run
 *  (P1.M2.T1.S2, Mode A below). Must satisfy 94 < ceiling ≤ 156 so
 *  national(90)/energy(94)/laboratory(57) admit while The(240)/This(197)/
 *  With(179)/Them(156) stay rejected.
 *
 *  Why 95 (measured, prose A/B against test/fixtures/sessions/
 *  prose.jsonl): the fixture contains sentence-initial capitals, and the
 *  relief admits ANY capitalized occurrence — at 120 sixteen common
 *  words stored (Check q=119, Sleep 118, Light 113, Cold 109, Strong
 *  106, Enjoy/Lunch 102, Books/Guard 95, Fresh 93, Rain/Warm 92, Spring
 *  84, Feed 88, Apple 77, Apples 59) and two expected.md `[]` labels
 *  flipped (gar → Guard, fresh → Fresh). 95 — the interval's minimum —
 *  is the tightest legal band: it excludes every excludable label-breaker
 *  (Guard/Books at q=95 reject at ceiling 95 since relief is q < ceiling
 *  STRICT) and also keeps Water(121) out — "Water" occurs capitalized in
 *  the fixture, so any ceiling ≥ 122 would re-break `wate → []`. Fresh
 *  (q=93) is below the interval floor and cannot be excluded by any
 *  legal ceiling; its expected.md row is the documented minimal
 *  re-label (fallback ladder step 3). Full probe table + A/B result in
 *  the admit() doc-block below.
 *
 *  Why a relief band and not a blanket REJECT retune: REJECT ≥ 95 would
 *  re-admit lowercase context(51)/posts(47) and break the calibration
 *  no-menu gate (test/calibration.test.ts — its probes are lowercase, so
 *  the capitalized-only relief cannot touch them). Known drift from
 *  spec/04's original 220/120 table — spec/*.md is READ-ONLY; this
 *  JSDoc is the record. Verified against the shipped artifact via
 *  tools/calibrate-bands.mjs. */
export const PROPER_NOUN_ADMIT_CEILING = 95 as const;

/** Admission outcome: a rank group (0 = rarest/best … 2 = mid-frequency)
 *  or 'reject' (never enters the store). */
export type AdmissionResult = RankGroup | "reject";

/** Options for admit(). `rejectCommonness` lets the runtime (pi config,
 *  2026-09) tighten or loosen the reject band WITHOUT a code edit —
 *  words kept leaking in ("lists", q = 49 < 50), and band tuning is an
 *  ongoing dial, not a settled constant. Default: the baked
 *  REJECT_COMMON_THRESHOLD (all pre-2026-09 callers behave identically). */
export interface AdmissionOptions {
  /** reject at/above this commonness quantile; default
   *  REJECT_COMMON_THRESHOLD. Higher → more words admitted (looser);
   *  lower → fewer (stricter). */
  rejectCommonness?: number;
}

/** English inflection suffixes stripped by the conjugation guard
 *  (2026-09, "deleted" leak). Deliberately a CONSERVATIVE set — verb/
 *  adverb/plural morphology only; derivational suffixes (-tion, -ment,
 *  -er, -ness, …) are NOT stripped: "deletion"-class words are distinct
 *  lexemes with their own dictionary entries when common. Baked. */
const INFLECTION_SUFFIXES = ["s", "es", "ed", "d", "ing", "ly"] as const;

/** Candidate stems for the conjugation guard: every one-level strip of
 *  an inflection suffix, plus e-restoration ("typing" → "type",
 *  "caching" → "cache") and doubled-consonant undo ("stopped" → "stop",
 *  "running" → "run"). Stems shorter than 3 chars are dropped. Pure;
 *  never returns the word itself. */
function inflectionStems(word: string): string[] {
  const out = new Set<string>();
  for (const suf of INFLECTION_SUFFIXES) {
    if (!word.endsWith(suf)) continue;
    const base = word.slice(0, -suf.length);
    if (base.length < 3) continue;
    out.add(base);
    if (suf === "ed" || suf === "ing") {
      out.add(base + "e"); // e-restoration: typed→type, caching→cache
      const last = base[base.length - 1]!;
      if (base.length >= 4 && last === base[base.length - 2] && !/[aeiou]/.test(last)) {
        out.add(base.slice(0, -1)); // doubled consonant: stopped→stop
      }
    }
  }
  return [...out];
}

/**
 * Admission decision for one shape-gated candidate draft (PRD §04 h2.24).
 *
 * Looks up the draft's lowercase key and applies the four-row banding table,
 * then — for sub-words only — clamps the result so it never ranks above the
 * parent whole token's group + 1 (saturated at 2). 'reject' passes through
 * unclamped.
 *
 * Proper-noun relief (BUG-002, bugfix/001_0f4b641cf9ce): BEFORE the reject
 * early-return, a candidate that tabled as 'reject' is admitted at group 2
 * when ALL of the following hold —
 *   - `result === "reject"` (the table rejected it),
 *   - `!draft.isSubword` (whole tokens only; sub-words keep the clamp and
 *     never relieve — a table-rejected sub-word stays rejected),
 *   - `draft.properName` (capitalized occurrences only: set by
 *     expandCandidates from the display's first char at extraction time —
 *     lowercase prose like "energy" still rejects, so menu noise stays
 *     calibrated),
 *   - `q !== null` (dictionary-attested only; an absent word already
 *     admits at group 0 and a relief to 2 would DEMOTE it),
 *   - `q < PROPER_NOUN_ADMIT_CEILING` (strict — the ceiling itself
 *     rejects; see the constant's JSDoc for the load-bearing (94, 156]
 *     interval and the known drift from spec/04's original 220/120
 *     table).
 *
 * Rationale: M2 integration item 7 chains "National Renewable Energy
 * Laboratory", whose words sit at q 57–94 — inside the BUG-001 reject
 * band. A blanket retune (REJECT ≥ 95) would re-admit lowercase
 * context(51)/posts(47) and break the calibration no-menu gate; the
 * capitalized-only relief admits the phrase while prose stays rejected.
 * Admission alone restores chaining: admitted whole tokens enter
 * adjacency runs, so the successor index fills (§06) with no separate
 * bigram-path change. Downstream: a relieved parent sets wholeGroup = 2,
 * so its sub-words clamp to min(2, max(table, 2+1)) = 2; properName also
 * feeds salience (W_PROPER_NAME = 0.8) — unchanged.
 *
 * MEASURED — §09 tuning-protocol re-run (P1.M2.T1.S2, Mode A; real
 * pipeline + shipped dict against test/fixtures/sessions/prose.jsonl):
 * the fixture is full of sentence-initial capitals, so the relief is
 * load-bearing there. Final ceiling 95 (tuned from S1's 120; legal
 * integer range 95..156). Probe table (word → dict q → verdict under
 * the final band):
 *
 *   admit group 2 via relief (capitalized in fixture, 50 ≤ q < 95):
 *     Apple 77, Apples 59, Feed 88, Fresh 93, Rain 92, Spring 84,
 *     Warm 92
 *   reject / delegate (capitalized in fixture, q ≥ 95): Guard 95,
 *     Books 95, Enjoy 102, Lunch 102, Strong 106, Cold 109, Light 113,
 *     Sleep 118, Check 119, Water 121, Move 128, Keep 138, Long 138,
 *     Take 155, They 174, Your 188, This 197
 *   reject via casing gate (occur ONLY lowercase → never stored despite
 *     50 ≤ q < 95): garden 86, bread 84, wind 97; and above-ceiling
 *     lowercase: kitchen 96, window 99, morning 129, more 150,
 *     water 121
 *   normal mid-band (no relief needed): fences 41, posts 47
 *
 * A/B result: at S1's ceiling 120 two expected.md prose `[]` labels
 * flipped (gar → relieved Guard 95; fresh → relieved Fresh 93). Ceiling
 * 120 → 95 — one constant, the interval minimum — re-fixed `gar`
 * (95 < 95 false → Guard rejects); `fresh` (q=93) is below the interval
 * floor and unfixable by any legal ceiling, so its expected.md row is
 * the documented minimal re-label (ladder step 3) to ["Fresh"]. Water
 * (121, capitalized in the fixture) additionally caps the ceiling at
 * 121. Evidence: test/acceptance.test.ts item-2 "prose A/B replay";
 * probe/delegation guarantees (SENTINEL identity, calledOnce,
 * __hapaxLive() null) unchanged.
 *
 * @param draft the shape-gated candidate (key must be lowercase)
 * @param dictionary quantized commonness dictionary (0–255 rank or null)
 * @param parentGroup the already-admitted parent whole token's group;
 *   required for subwords by the ingest pipeline, omitted for whole tokens
 * @param opts { rejectCommonness } band override (pi config knob);
 *   omitted → the baked constant
 * @returns the admission rank group, or 'reject' when the word is too
 *   common to store
 */
export function admit(
  draft: CandidateDraft,
  dictionary: Dictionary,
  parentGroup?: RankGroup,
  opts: AdmissionOptions = {},
): AdmissionResult {
  const rejectAt = opts.rejectCommonness ?? REJECT_COMMON_THRESHOLD;
  const q = dictionary.lookup(draft.key);
  let result: AdmissionResult;
  if (q === null) result = 0;
  else if (q >= rejectAt) result = "reject";
  else if (q >= MID_FREQ_THRESHOLD) result = 2;
  else result = 1;

  // Proper-noun relief (BUG-002): capitalized whole tokens below the
  // ceiling admit at group 2 — M2 integration item 7 (National Renewable
  // Energy Laboratory) without re-admitting lowercase prose words. Must
  // precede the reject early-return (after it this branch is dead code)
  // and the subword clamp (relief is whole-token-only; 'reject' stays
  // clamp-immune for every non-relieved draft).
  if (
    result === "reject" &&
    !draft.isSubword &&
    draft.properName &&
    q !== null &&
    q < PROPER_NOUN_ADMIT_CEILING
  ) {
    result = 2;
  }

  // Conjugation guard (2026-09, "deleted" leak): an inflection whose
  // STEM is reject-common rejects too, whatever its own q — the corpus
  // ranks inflections separately (delete=51, deleted=45) and the
  // rare-by-default hole admitted absent forms outright (deletes,
  // caching, uploads → group 0 + rarity bonus). Hapax is for proper
  // nouns and identifiers, not verb/adverb/plural morphology: skip the
  // guard when properName is set (casing evidence — "Andrews",
  // "Sanders" — outranks morphology, mirroring the relief's philosophy).
  // ONE stripping level, no recursion; subwords are guarded as well
  // ("typedFlag" → subword "typed" is still a conjugation). Two tiers:
  //   - stem ≥ rejectAt → reject (conjugation of a COMMON word), any q;
  //   - word ABSENT (q = null) + stem ≥ MID_FREQ_THRESHOLD → reject
  //     ("uploads": upload=38, "caching": cache=30 — absent inflections
  //     of attested mid-band stems are the same noise class).
  // The rejectCommonness knob governs the stem comparisons too.
  if (result !== "reject" && !draft.properName) {
    for (const stem of inflectionStems(draft.key)) {
      const qs = dictionary.lookup(stem);
      if (qs === null) continue;
      if (qs >= rejectAt || (q === null && qs >= MID_FREQ_THRESHOLD)) {
        result = "reject";
        break;
      }
    }
  }

  if (result === "reject") return result;
  if (draft.isSubword && parentGroup !== undefined) {
    // Smaller group = rarer = better rank, so the clamp RAISES the number:
    // never rank above parent + 1; saturate at 2 (parent 2 + 1 → 2, not 3).
    return Math.min(2, Math.max(result, parentGroup + 1)) as RankGroup;
  }
  return result;
}

// ── Query-time ranking (P1.M2.T3.S2) ───────────────────────────────────────
// Everything below is pure math over a stored Candidate + the current
// message ordinal. Single source of truth: query.ts and store eviction
// import these; no other module may redo the arithmetic.

/** Recency decay constant for ranking salience (messages). The recency
 *  term loses e^-1 of its value every 20 ordinals. PRD §04 h2.25. */
const RECENCY_TAU = 20;

/** Recency decay constant for eviction — deliberately SLOWER than
 *  ranking's τ = 20, so a word stays eviction-safe longer than it stays
 *  menu-hot. Don't swap the two taus. PRD §06. */
const EVICTION_TAU = 50;

/** Session-frequency weight (log2-damped: runaway counts stay bounded). */
const W_FREQ = 2.0;
/** Recency weight — the largest term: what appeared a message ago matters
 *  most right now. */
const W_RECENCY = 3.0;

/** Sticky userTyped bonus (flat once true, forever). */
const W_USER_TYPED = 1.5;
/** properName bonus. */
const W_PROPER_NAME = 0.8;
/** Rarity bonus, admission group 0 (dictionary-absent). */
const RARITY_GROUP_0 = 1.0;
/** Rarity bonus, admission group 1 (rare-but-attested). */
const RARITY_GROUP_1 = 0.5;

/**
 * Query-time salience of a stored candidate (PRD §04 h2.25) — how much
 * menu worth it has right now. Computed from store stats at query time;
 * NEVER stored on the Candidate or persisted. Weights are baked constants
 * (PRD §08), tuned in-codebase per the §09 protocol.
 *
 * @param c the stored candidate (one per lowercase key)
 * @param currentOrdinal the message ordinal "now" (≥ c.lastSeenOrdinal by
 *   the store invariant; delta 0 is fine — the recency term is e^0 = 1)
 * @returns the salience; higher = more deserving of menu space
 */
export function salience(c: Candidate, currentOrdinal: number): number {
  const delta = currentOrdinal - c.lastSeenOrdinal;
  return (
    W_FREQ * Math.log2(1 + c.sessionCount) +
    W_RECENCY * Math.exp(-delta / RECENCY_TAU) +
    W_USER_TYPED * (c.userTyped ? 1 : 0) +
    W_PROPER_NAME * (c.properName ? 1 : 0) +
    (c.rankGroup === 0
      ? RARITY_GROUP_0
      : c.rankGroup === 1
        ? RARITY_GROUP_1
        : 0)
  );
}

/**
 * Eviction score (PRD §06): salience decayed by the SLOWER τ = 50 clock.
 * Used ONLY by store eviction (P1.M2.T4.S3), which sorts ascending and
 * evicts the lowest score first — a higher score means keep longer.
 * Reuses salience() so the weights have a single source of truth.
 */
export function evictionScore(c: Candidate, currentOrdinal: number): number {
  return (
    salience(c, currentOrdinal) *
    Math.exp(-(currentOrdinal - c.lastSeenOrdinal) / EVICTION_TAU)
  );
}

/**
 * Total, deterministic order over candidates (PRD §09). Ties in salience
 * mean EXACT float equality — near-ties are distinct (salience is pure,
 * so equal inputs always give equal signs):
 *
 *  1. salience descending (higher salience first)
 *  2. tie → shorter key first
 *  3. tie → lexicographic byte order on the lowercase key
 *
 * NOT the menu order since the 2026-09 redesign (query.ts doc): the
 * completion menu sorts content-derived (shorter key → byte-lex) and
 * uses salience ONLY for membership/eviction. compareCandidates remains
 * exported as the salience-order reference (and for any future
 * salience-ranked surface); query.ts no longer mirrors it.
 *
 * @returns standard comparator number: negative → a first, positive →
 *   b first, 0 → identical keys and stats. Never NaN.
 */
export function compareCandidates(
  a: Candidate,
  b: Candidate,
  currentOrdinal: number,
): number {
  const bySalience = salience(b, currentOrdinal) - salience(a, currentOrdinal);
  if (bySalience !== 0) return bySalience;
  if (a.key.length !== b.key.length) return a.key.length - b.key.length;
  // Tie-break 3 is byte order. Keys are ASCII after segmentation, so JS's
  // UTF-16 code-unit comparison equals byte order — and unlike
  // localeCompare it is locale-independent. Never quantize salience.
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
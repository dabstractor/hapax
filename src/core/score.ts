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
 *   otherwise                  → 'reject'   very common ("the", "context")
 *
 * Smaller groups rank better (rare words are the most valuable completions),
 * so the subword clamp RAISES the numeric group: a sub-word never ranks above
 * its parent whole token's group + 1 — final group is
 * max(tableGroup, parentGroup + 1), saturated at 2 (RankGroup has no 3).
 * 'reject' is immune to the clamp: a table-rejected subword (q ≥ 220) stays
 * rejected; the clamp only ever demotes admitted groups.
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

/** Reject at/above this commonness rank (q ≥ 220 — very common English).
 *  PRD §04 h2.24; baked per PRD §08. */
export const REJECT_COMMON_THRESHOLD = 220 as const;

/** Demote to group 2 at/above this commonness rank
 *  (120 ≤ q < 220 — mid-frequency). PRD §04 h2.24; baked per PRD §08. */
export const MID_FREQ_THRESHOLD = 120 as const;

/** Admission outcome: a rank group (0 = rarest/best … 2 = mid-frequency)
 *  or 'reject' (never enters the store). */
export type AdmissionResult = RankGroup | "reject";

/**
 * Admission decision for one shape-gated candidate draft (PRD §04 h2.24).
 *
 * Looks up the draft's lowercase key and applies the four-row banding table,
 * then — for sub-words only — clamps the result so it never ranks above the
 * parent whole token's group + 1 (saturated at 2). 'reject' passes through
 * unclamped.
 *
 * @param draft the shape-gated candidate (key must be lowercase)
 * @param dictionary quantized commonness dictionary (0–255 rank or null)
 * @param parentGroup the already-admitted parent whole token's group;
 *   required for subwords by the ingest pipeline, omitted for whole tokens
 * @returns the admission rank group, or 'reject' when the word is too
 *   common to store
 */
export function admit(
  draft: CandidateDraft,
  dictionary: Dictionary,
  parentGroup?: RankGroup,
): AdmissionResult {
  const q = dictionary.lookup(draft.key);
  let result: AdmissionResult;
  if (q === null) result = 0;
  else if (q >= REJECT_COMMON_THRESHOLD) result = "reject";
  else if (q >= MID_FREQ_THRESHOLD) result = 2;
  else result = 1;

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
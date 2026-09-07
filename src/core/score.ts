/**
 * Score admission — stage 3 of the segment → shapeGate → score → store →
 * query pipeline (PRD §04 h2.24). `admit` maps a shape-gated CandidateDraft
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
 * Pure: type-only imports, no runtime imports, no mutable state. Salience
 * and query ranking live in the sibling half of this stage (P1.M2.T3.S2),
 * not here.
 */

import type { CandidateDraft } from "./segment.js";
import type { Dictionary, RankGroup } from "./types.js";

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
/**
 * Score — stage 3 of the segment → shapeGate → score → store → query
 * pipeline (PRD §04), two halves sharing one module.
 *
 * ADMISSION (h2.24, P1.M2.T3.S1; 2026-10 gradient): `admit` maps a
 * shape-gated CandidateDraft plus a dictionary lookup to a RankGroup
 * (0 | 1 | 2) or 'reject'. Dictionary ATTESTATION is near-disqualifying
 * evidence — hapax completes identifiers/hashes/jargon (the ABSENT
 * class), not ordinary English — but its weight now scales with word
 * length (spec/04 h2.26, 2026-10 owner-measured sqrt gradient):
 *
 *   q = dictionary.lookup(draft.key)   (0–255 quantized rank; 0 = rarest,
 *                                      255 = most common; null = absent)
 *   q === null                  → group 0   rare-by-default (THE value:
 *                                           identifiers, jargon, hashes)
 *   q < R_eff(len)              → group 1   flat (no table path to group 2)
 *   q ≥ R_eff(len)              → 'reject'  attested English
 *
 * R_eff(len) is the length-conditioned reject threshold (rEff below):
 * flat floor R = REJECT_COMMON_THRESHOLD (12) through 8 chars — the
 * 2026-09 retighten behavior, preserved verbatim for short words — then
 * a sqrt ramp R + (255−R)·√((len−8)/12) across 9–19 chars (commonness
 * stops being noise evidence as words lengthen: typing savings grow,
 * noise mass collapses), then admit-all from 20 chars (sentinel 256 so
 * even q=255 admits). Attested admissions are ALWAYS group 1 — the old
 * mid-band demotion row is gone; group 2 is unreachable via the table
 * (and via relief; the 2026-10 atomic-identifier rule retired the
 * subword clamp, its last reachable path).
 *
 * + proper-noun relief: RETIRED-IN-PLACE (ceiling == reject band —
 *   can no longer admit table-rejected words; see
 *   PROPER_NOUN_ADMIT_CEILING's history; still provably dead under the
 *   curve: R_eff ≥ R = ceiling everywhere).
 *
 * Band values are pinned by MEASUREMENT against the shipped artifact —
 * tools/calibrate-bands.mjs prints the rank↔word↔q table and re-verifies the
 * constants (BUG-001 history: the original 220/120 bands covered only ranks
 * ≤ 3 / ≤ 391 of the real corpus, so "the"/"with"/"this" could never be
 * rejected no matter how good the dictionary data was; 2026-09 final:
 * reject 50 → 12 after a live audit showed the mid band admitting 1,183
 * everyday words against 4,889 absent identifiers).
 *
 * 'reject' is final for every draft — there is no clamp since the 2026-10
 * atomic-identifier owner rule removed sub-word candidates entirely.
 *
 * Pipeline order (ingest, P1.M3.T2): every draft is a whole token; the
 * former parentGroup plumbing is deleted.
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

/** Reject at/above this commonness rank — dictionary-ATTESTED English
 *  is near-disqualifying evidence (2026-09 retighten): hapax exists to
 *  complete identifiers, commit-hash-shaped tokens, and jargon — the
 *  dictionary-ABSENT class — not ordinary English. Only the rarest
 *  English tail admits: q < 12 ⇔ roughly the rarest ~10% of the corpus
 *  (a live audit of ~2.2k real messages: 4,889 stored words were
 *  dictionary-absent — the value — while 1,183 words at q 20–49 were
 *  the noise leak: provider/default/null/node/enable/spec/cache;
 *  483 more were relief-only capitalized admits). Baked per PRD §08
 *  (never config/env; the `rejectCommonness` config knob overrides at
 *  runtime by owner choice, defaulting to this constant).
 *
 *  Calibration history (condensed): the original 220 covered only
 *  ranks ≤ 3 (BUG-001 — rejection mathematically unreachable);
 *  retuned 220 → 100 → 50 (2026-09 Issue 1: "context" q=51 et al. kept
 *  admitting) → 12 (2026-09 final: English attestation is evidence
 *  AGAINST admission, per owner: "not half of the english language")
 *  → 30 (2026-10 width-bound retune, owner rule: the one-line widget
 *  + line claim + width-bound count dropped the UI cost of a common
 *  word — the 8-item vertical-menu flooding that justified R=12 is
 *  gone; the dev-vocabulary class node(23)/spec(28)/null(24) admits
 *  while the prose head — the(240)/with(179)/this(197)/window(99)/
 *  context(51)/everything(139) — and the conjugation guard hold;
 *  cache(30) sits exactly ON the floor and stays out).
 *  Measured: attested-admitted table words 15,064 → 32,544 of 48,802.
 *  Calibrated against the shipped artifact via
 *  tools/calibrate-bands.mjs. */
export const REJECT_COMMON_THRESHOLD = 30 as const;

/** Demote to group 2 at/above this commonness rank
 *  (historically 20 ≤ q < 50 — mid-frequency). PRD §04 h2.24; baked per
 *  PRD §08.
 *
 *  2026-09 retighten: with REJECT_COMMON_THRESHOLD at 12, the table's
 *  mid band is unreachable (every attested q ≥ 12 rejects before the
 *  demotion matters) and group 2 is effectively retired — this constant
 *  now serves only the conjugation guard's tier-2 (stem q ≥ 20 rejects
 *  absent inflections), which tier-1 (stem ≥ 12) largely subsumes.
 *  Redundant but harmless; kept to avoid touching the guard's shape.
 *
 *  2026-10: the table's MID demotion row is DELETED outright (the R_eff
 *  gradient has no group-2 path; every attested admission is flat group
 *  1), and S2 retires the guard's tier-2 too — both guard tiers now ride
 *  R_eff(len(word)), subsuming the MID comparison. RETIRED compatibility
 *  constant: value and export unchanged (pinned === 20 in
 *  test/score.test.ts) for tools/calibrate-bands.mjs (R_eff-aware in S3)
 *  and test/helpers/bench-fixtures.ts. Do not use in new code. */
export const MID_FREQ_THRESHOLD = 20 as const;

/** Relief ceiling for capitalized whole tokens — **RETIRED-IN-PLACE
 *  (2026-09 retighten)**: set equal to REJECT_COMMON_THRESHOLD (12), so
 *  the strict `q < ceiling` test can never reach past the reject band
 *  and the relief can no longer admit table-rejected words. The
 *  mechanism (properName-flagged, dictionary-attested
 *  candidates admitting at group 2 instead of rejecting) stays in code
 *  and spec per the owner's "don't take them out just yet" — restoring
 *  it is a one-constant change. The design answer for wanting named
 *  entities back is a user allowlist (config), not a band change
 *  (spec/04).
 *
 *  Calibration history (condensed, was binding until the 2026-09
 *  retighten): BUG-002 fix — relief existed so M2's "National Renewable
 *  Energy Laboratory" chain (national q=90, energy 94, laboratory 57)
 *  could complete while lowercase prose stayed rejected; ceiling tuned
 *  120 → 95 by a measured prose A/B (at 120, sixteen common capitalized
 *  words stored and two expected.md labels flipped; 95 was the
 *  tightest legal value). A live audit of real sessions later showed
 *  the relief admitting ~483 capitalized common words (echo, windows,
 *  failed, file) — the owner retired it: "it's for completing commit
 *  hashes and variable names, not half of the english language." */
export const PROPER_NOUN_ADMIT_CEILING = 30 as const; // == floor (retired-in-place; scales with retunes)

/** Top-band ceiling for capitalized-run members — spec/04 h2.26 (P1.M1.T3.S1).
 *  A run member whose dictionary q ≥ this value is CHAIN-ONLY: it never
 *  gains admission from casing (run or single), is never upserted (the
 *  store never sees it — it can never become a standalone suggestion), but
 *  stays in the runs payload so its series bigrams still form ("typing
 *  'The ' offers 'Fed'"). Baked, NOT configurable (spec/08 h2.57).
 *
 *  Calibrated against the shipped artifact (P1.M1.T3.S1, plan 006):
 *  `node tools/calibrate-bands.mjs the and for with national energy` →
 *  the=240 / and=219 / for=194 / with=179 (all ≥ 135: chain-only material)
 *  vs national=90 / energy=94 (both < 135: run-admit at group 1). The
 *  measured population of q ≥ 135 is 203 of 48,802 words (~0.4% — the
 *  function-word head only), read from the artifact's score section with
 *  the same probe the tool uses. Below 135 the first legitimate name
 *  classes begin; 135 is the tightest legal split of the probe sets. */
export const PROPER_SERIES_TOP_BAND_CEILING = 135 as const;

/** 2026-10 length gradient (spec/04 h2.26): the flat reject floor holds
 *  through this word length. Nothing below 9 chars changed vs the 2026-09
 *  flat band. Baked per PRD §08. */
export const REJECT_LEN_FLOOR = 8 as const;

/** 2026-10 length gradient (spec/04 h2.26): admit-all from this word
 *  length — rEff returns a 256 sentinel (above the 0–255 q domain) so
 *  `q >= rEff` can never reject, including at q = 255. Baked per §08. */
export const REJECT_LEN_FULL = 20 as const;

/**
 * Length-conditioned reject threshold R_eff(len) — spec/04 h2.26
 * (2026-10 owner rule): dictionary attestation is near-disqualifying at
 * short lengths (hapax completes the ABSENT class), but commonness stops
 * being noise evidence as words lengthen — typing savings grow and the
 * noise mass collapses. The sqrt shape is steep where noise dies (9–12
 * chars) and saturates where nothing remains to admit (16+). Owner
 * measured ≈10.5k corpus flips; linear and floor-10 variants rejected.
 *
 *   R_eff(len) = floor                              len ≤ 8   (floor hold)
 *   R_eff(len) = floor + (255 − floor)·√((len − 8)/12)   8 < len < 20
 *   R_eff(len) = 256 (sentinel)                     len ≥ 20  (admit-all)
 *
 * `floor` is the RESOLVED floor — callers pass rejectAt (the
 * rejectCommonness knob or its baked default), never the constant, so
 * the knob moves the floor AND scales the whole curve (the 255
 * asymptote constant stays literal: the ramp saturates toward max-q
 * regardless of floor). Returns 256 — NOT 255 — at len ≥
 * REJECT_LEN_FULL: q ≥ 255 would still reject the most-common q;
 * the sentinel makes admit-all hold for the entire q domain. Callers
 * compare floats directly (q integer ≥ rEff float) — never round:
 * rounding shifts the 9-char 81/82 boundary. Pure math; baked shaping
 * constants per §08.
 */
export function rEff(floor: number, len: number): number {
  if (len >= REJECT_LEN_FULL) return 256;
  if (len <= REJECT_LEN_FLOOR) return floor;
  return floor + (255 - floor) * Math.sqrt((len - REJECT_LEN_FLOOR) / 12);
}

/** Admission outcome: a rank group (0 = rarest/best … 2 = mid-frequency),
 *  'reject' (never enters the store), or 'chain-only' (spec §04 h2.26: a
 *  capitalized-run member in the dictionary's very top band — never
 *  upserted, never admitted from casing, but kept in the runs payload so
 *  its series bigrams form). Only admit()'s seriesMember path returns it. */
export type AdmissionResult = RankGroup | "reject" | "chain-only";

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
  /** Occurrence is a member of a detected capitalized run (spec §04
   *  h2.26, P1.M1.T3.S1): replaces the table path entirely — absent →
   *  group 0, attested below PROPER_SERIES_TOP_BAND_CEILING → group 1
   *  (any band), at/above it → "chain-only" — and bypasses the
   *  conjugation guard (casing evidence outranks morphology).
   *  OCCURRENCE-LEVEL ONLY: callers must never cache the verdict under a
   *  token key (ingest's memo stays context-free — run membership is
   *  line context the memo cannot see). */
  seriesMember?: boolean;
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
 * Admission decision for one shape-gated candidate draft (PRD §04 h2.24;
 * 2026-10 R_eff gradient).
 *
 * Looks up the draft's lowercase key and applies the banding table against
 * the length-conditioned threshold R_eff(rejectAt, len) (see rEff).
 * Attested admissions are ALWAYS group 1 (the old mid-band row is gone);
 * group 2 is unreachable (the subword clamp is retired).
 *
 * Proper-noun relief (BUG-002, bugfix/001_0f4b641cf9ce): BEFORE the reject
 * early-return, a candidate that tabled as 'reject' is admitted at group 2
 * when ALL of the following hold —
 *   - `result === "reject"` (the table rejected it),
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
 * CALIBRATION HISTORY (condensed; was binding until the 2026-09
 * retighten): the relief existed so M2 integration item 7's "National
 * Renewable Energy Laboratory" chain (q 57–94, inside the then-reject
 * band) could complete while lowercase prose stayed rejected; ceiling
 * tuned 120 → 95 by a measured prose A/B (probe tables preserved in git
 * history at d6bbeeb^). A later live audit of real sessions showed the
 * relief admitting ~483 capitalized common words (echo, windows,
 * failed, file) — the owner retired it in place: ceiling == reject
 * band. Restoring named-entity completion is a user-allowlist design
 * question (spec/04), not a band change.
 *
 * @param draft the shape-gated candidate (key must be lowercase)
 * @param dictionary quantized commonness dictionary (0–255 rank or null)
 * @param opts { rejectCommonness } band override (pi config knob);
 *   omitted → the baked constant
 * @returns the admission rank group, or 'reject' when the word is too
 *   common to store
 */
export function admit(
  draft: CandidateDraft,
  dictionary: Dictionary,
  opts: AdmissionOptions = {},
): AdmissionResult {
  const rejectAt = opts.rejectCommonness ?? REJECT_COMMON_THRESHOLD;
  // R_eff rides the RESOLVED floor so the knob scales the whole curve;
  // float compare (q integer ≥ rEff float) — no rounding (2026-10).
  const threshold = rEff(rejectAt, draft.key.length);
  const q = dictionary.lookup(draft.key);
  let result: AdmissionResult;
  if (q === null) result = 0;
  else if (q >= threshold) result = "reject";
  else result = 1; // flat — the 2026-10 gradient deleted the MID demotion row

  // Proper-noun relief (BUG-002): capitalized whole tokens below the
  // ceiling admit at group 2 — M2 integration item 7 (National Renewable
  // Energy Laboratory) without re-admitting lowercase prose words. Must
  // precede the reject early-return (after it this branch is dead code);
  // every draft is a whole token since the 2026-10 atomic-identifier
  // rule (the old whole-token-only condition is vacuous).
  if (
    result === "reject" &&
    draft.properName &&
    q !== null &&
    q < PROPER_NOUN_ADMIT_CEILING
  ) {
    result = 2;
  }

  // Run-member override (spec §04 h2.26, P1.M1.T3.S1): a member of a
  // detected capitalized run admits REGARDLESS of the commonness band —
  // the table verdict above is replaced wholesale. Absent → group 0;
  // attested below the top-band ceiling → group 1 (any band, including
  // q ≥ the reject floor: "national"-class names); at/above the ceiling
  // → "chain-only" (never admitted from casing, never upserted — its only
  // footprint is the runs payload, so series bigrams form). Computed per
  // OCCURRENCE at run finalization (ingest); never cached under the token
  // key — run membership is line context, and memoizing it would
  // permanently admit every later occurrence of that token.
  if (opts.seriesMember === true) {
    if (q === null) result = 0;
    else if (q >= PROPER_SERIES_TOP_BAND_CEILING) result = "chain-only";
    else result = 1;
  }

  // Conjugation guard (2026-09, "deleted" leak; 2026-10 R_eff alignment):
  // an inflection whose STEM is reject-common rejects too, whatever its
  // own q — the corpus ranks inflections separately (delete=51,
  // deleted=45) and the rare-by-default hole admitted absent forms
  // outright (deletes, caching, uploads → group 0 + rarity bonus). Hapax
  // is for proper nouns and identifiers, not verb/adverb/plural
  // morphology: skip the guard when properName is set (casing evidence —
  // "Andrews", "Sanders" — outranks morphology, mirroring the relief's
  // philosophy). ONE stripping level, no recursion. (Sub-words used to
  // share this guard; they no longer exist.)
  //
  // 2026-10 (spec h2.26): BOTH former tiers ride ONE threshold —
  // R_eff(len(WORD)), the same length-conditioned curve the table uses —
  // so long absent inflections of attested stems ("configurations":
  // configuration=26 at 14 chars) loosen with the gradient instead of
  // hitting the flat floor, while floor-length words are unchanged
  // ("uploads": upload=38 ≥ rEff(12,7)=12 still rejects; "caching":
  // cache=30; "deleted": delete=51). The stem's length is irrelevant —
  // only the word's drives the threshold. At len ≥ REJECT_LEN_FULL the
  // 256 sentinel means the guard can never reject there either (qs ≤ 255
  // < 256): it loosens with the table, no special case. The old tier-2
  // (absent word + stem ≥ MID_FREQ_THRESHOLD=20) is subsumed; that
  // constant is now a retired compatibility export. The
  // rejectCommonness knob governs the guard through the same resolved
  // rejectAt the table uses. Float compare qs >= guardAt directly — no
  // rounding (rounding shifts ramp boundaries).
  //
  // Skip conditions: properName (above) and seriesMember (spec §04
  // h2.26, P1.M1.T3.S1) — a capitalized-run member bypasses the guard
  // entirely: casing evidence (the run) outranks morphology, parallel
  // to the properName skip ("Uploaded Files" admits though upload q ≥
  // floor; structural-cap line-initial members have properName false,
  // so the seriesMember flag is what carries the bypass). "chain-only"
  // is excluded for type-honesty — a chain-only verdict is final and
  // only arises on the seriesMember path anyway.
  if (
    result !== "reject" &&
    result !== "chain-only" &&
    !draft.properName &&
    opts.seriesMember !== true
  ) {
    const guardAt = rEff(rejectAt, draft.key.length); // the WORD's length
    for (const stem of inflectionStems(draft.key)) {
      const qs = dictionary.lookup(stem);
      if (qs === null) continue;
      if (qs >= guardAt) {
        result = "reject";
        break;
      }
    }
  }

  if (result === "reject") return result;
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
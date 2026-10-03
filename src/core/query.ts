/**
 * Query — stage 5 (final stage) of the segment → shapeGate → score →
 * store → query pipeline (PRD §04 h2.26 + §07 h2.44): synchronous
 * WORDS-ONLY query-time ranking. Prefix-search the store's prefix index,
 * rank by salience, return the top N as RankedMatch items — every item's
 * `display` is exactly one word — one whitespace-free token (the
 * one-word invariant: no multi-word candidates, ever; rule 4d path
 * tokens qualify, their display carries edge characters but never
 * whitespace; the only successor behavior is provider-side
 * chaining). Runs on EVERY keystroke (the provider, P1.M3.T3.S2, calls
 * this in getSuggestions) and must complete in < 1 ms on a
 * 20k-candidate store (PRD §02 h3.1) — pure computation, no
 * allocation-heavy work: one prefixRange call (the first-char bucket,
 * measured p99 0.4 ms over ~900 keys at cap), one key slice, one get
 * per candidate, one sort of the matches.
 *
 * MENU ORDER (2026-10 owner rule, spec §04 h2.29 — supersedes the
 * retired 2026-09 content-derived order, kept as history below):
 * compareRankedMatches is a 4-KEY TOTAL ORDER — tier desc
 * (strictness class: exact prefix (3) > contiguous tail (2) > scattered
 * (1) > anchorless ambient run (0)) →
 * sessionCount desc WITHIN a tier → shorter key → byte-lex. Among equally
 * strict matches the more conversation-relevant word (higher raw
 * sessionCount) belongs leftmost. The composite salience score still
 * NEVER sorts: it decides MEMBERSHIP (the fuzzThreshold admission gate
 * here, the admission bands in score.ts) and eviction; only its raw
 * sessionCount component orders, and only among same-tier neighbors — a
 * count difference can never cross a tier boundary. Two candidates swap
 * positions ONLY when one's sessionCount strictly passes the other's
 * within the same tier (owner-accepted churn; tiers and keys 3–4 stay
 * content-derived, so narrowing keeps its shape). The zero-fragment
 * listing ("#" alone) has no tiers — order is sessionCount desc →
 * shorter → byte-lex. History: 2026-09 ordered purely by content
 * (shorter key → byte-lex, counts invisible) so menus were keystroke-
 * stable but conversation-blind; h2.29 trades that for relevance within
 * the strictness tiers.
 * TIER-0 AMBIENT FALLBACK (spec §04 h2.28, 2026-10): when the anchored
 * scan admits ZERO records and the fragment is ≥ 3 chars, ONE
 * anchorless full-store pass (contiguous run anywhere,
 * score = TIER0_BASE_SCORE − TIER0_SKIP_FACTOR·runStart/len,
 * threshold-gated) may rescue a menu that would not otherwise appear —
 * it can never enrich a menu that would already open, so the
 * never-hijack profile is preserved. Public RankedMatch.tier carries
 * the strictness class on the match path only; listing items omit it
 * (so tier === 0 unambiguously means anchorless).
 * An empty result tells the provider to delegate (never an empty menu) —
 * this function just returns [].
 *
 * Word salience lives in score.js — salience() is imported, never
 * reimplemented here (score.ts module invariant). This module never
 * imports from pi packages (src/core architecture invariant, see
 * types.ts header); zero new dependencies.
 *
 * R1 (PRD 002 delta): the former multi-word candidate layer and its
 * caller-side filter seam were removed together — rankMatches accepts
 * only `{ limit }` and returns single words only. Successor chaining
 * (P1.M2.T1.S1, consumed from the provider via the store's successor
 * index) is the only M2-era query behavior, and it never flows through
 * this module: future filtering belongs in the provider, not here.
 *
 * INDEX ORDERING INVARIANT (why prefixRange-then-snapshot is the only
 * safe public enumeration path): store.prefixRange(lower) returns
 * [start, end) INDICES over the internally sorted key array, and it
 * consolidates that array first (merging pending inserts — the amortized
 * index maintenance that keeps a cold first query off the O(n log n)
 * re-sort path — and dropping evicted ghosts). sortedKeysSnapshot() alone
 * never consolidates — a snapshot from before a mutating batch can lag
 * the map: new keys missing, evicted keys (S3 eviction, P1.M2.T4.S3)
 * listed but with get() undefined. So: call prefixRange FIRST (it
 * performs any needed consolidation), THEN take the snapshot and slice
 * [start, end). Never cache keys or snapshots across rankMatches calls —
 * eviction and new inserts change the index between keystrokes. (A future
 * store accessor like keyAt(i) would be cleaner; out of scope here.)
 */

import { salience } from "./score.js";
import type { CandidateStore } from "./store.js";
import type { RankedMatch } from "./types.js";

/** Max results per query — menu height (PRD §04 h2.26: top 8). Baked,
 *  not config (§08): named constant, no magic 8 inline. */
export const DEFAULT_LIMIT = 8;

/** Admission-score calibration starting points (PRD §04 h2.28, §09 tuning
 *  protocol). Tunable constants; the tier BOUNDARIES (prefix / contiguous
 *  tail / scattered) are semantics, never tunable. Consumed by
 *  matchFragment's score arithmetic (single-sourced — no inline literals)
 *  and by the threshold tests.
 *
 *  Knob relationship (plan 003 P1.M2.T1.S3): the fuzzThreshold config key
 *  (0–100, clamped in config.ts) gates a candidate's score against these
 *  tiers — 100 = exact-prefix-only (only TIER3_SCORE survives the strict-<
 *  gate, TIER2_BASE_SCORE (85) and every tier-1 score sit below it).
 *  Tier-1 gap penalties are GAP-SIZE-SCALED (2026-10 retune of the first
 *  calibration, 50 − 5·gapRuns − min(gapChars, 15), whose max 44 gated ALL
 *  scattered matches at both mode defaults — a cliff: `del`/`delet` scored
 *  100 while `delt`, the word minus ONE interior letter, scored 44 and
 *  vanished): each gap run still costs a flat 5 but each gap CHAR now
 *  costs 3 (capped at 15 total), off a base of 70. So the tightest
 *  scattered trace — one 1-char hole — scores 62 and ADMITS at the
 *  ambient default 60, while every looser shape gates (2-char hole 59,
 *  a second gap ≤ 54); hole SIZE slopes instead of one near-flat drop.
 *  §09 tuning protocol: the knob is a runtime tuning surface; these tier
 *  boundaries are not. */
export const TIER3_SCORE = 100 as const;
export const TIER2_BASE_SCORE = 85 as const;
export const TIER2_SKIP_FACTOR = 40 as const;
export const TIER1_BASE_SCORE = 70 as const;
export const TIER1_GAPRUN_PENALTY = 5 as const;
export const TIER1_GAPCHAR_WEIGHT = 3 as const;
export const TIER1_GAPCHAR_CAP = 15 as const;

/** Tier-0 anchorless base score / skip penalty (spec §04 h2.28, 2026-10):
 *  contiguous-run matches ANYWHERE in the key (runStart counts from 0 —
 *  no anchor consumed), resorted to only when the anchored scan admits
 *  nothing and the fragment is ≥ 3 chars. Numerically equal to the tier-2
 *  pair but a DISTINCT semantic — exported separately so tuning never
 *  silently couples the tiers. Calibration starting points (§09 tuning
 *  protocol), never inlined; the tier BOUNDARIES are semantics, never
 *  tunable. Verified exemplars: esk→zendesk (runStart 2, len 7 → 74);
 *  query→src/core/query.ts (runStart 9, len 17 → 64); default-60 pass
 *  band: runStart/len ≤ 0.625. */
export const TIER0_BASE_SCORE = 85 as const;
export const TIER0_SKIP_FACTOR = 40 as const;

/** Default fuzzThreshold (PRD §08 h2.52): minimum admission score for a
 *  candidate to enter a result set. 60 admits all exact prefixes (100),
 *  strong contiguous tails, and — since the 2026-10 gap-size retune — the
 *  single tightest scattered class, one 1-char interior hole (62: `delt` →
 *  `delete`); every looser tier-1 shape gates (2-char hole 59, a second
 *  gap ≤ 54). Higher = stricter; 100 =
 *  exact-prefix-only; 0 = admit all. config.ts auto-imports this as the
 *  schema default (the rejectCommonness pattern, P1.M2.T1.S3).
 *
 *  Runtime knob (PRD §08 h2.52, wired by P1.M2.T1.S3): the `fuzzThreshold`
 *  config key (HapaxConfig.fuzzThreshold) overrides this default per
 *  config file — clamped to 0–100 (silent round-then-clamp; wrong types
 *  repair with one warning) — and the provider forwards it into every
 *  rankMatches call. RankOptions.fuzzThreshold absent here still means
 *  THIS constant, so the seam stays honest for direct callers. */
export const DEFAULT_FUZZ_THRESHOLD = 60 as const;

/** Default fuzzThreshold under the trigger char (PRD §04 trigger
 *  loosening, §08 h2.52): 45 sits under tier-2's floor — the weakest
 *  tier-2 (tail skipped the whole key) still outscores it — and under
 *  tier-1's gap-size-scaled ceiling (2026-10 retune): the admitted
 *  scattered shapes are those with 5·gapRuns + min(3·gapChars, 15) ≤ 25 —
 *  up to two gaps of ANY size, or three/four tiny gaps — so `#cfg` →
 *  `config_manager_service` (62) finally delivers the §04 exemplar (the
 *  first calibration's max was 44 < 45, admitting nothing; the old
 *  erratum pin is retired). Three-plus sizeable gaps (e.g. 4 gaps → ≤ 47)
 *  still gate. Calibration starting
 *  point (§09 tuning protocol), exactly
 *  like DEFAULT_FUZZ_THRESHOLD (60) for ambient matching. An explicitly
 *  set config fuzzThreshold overrides BOTH mode defaults — resolution
 *  lives in config.ts's resolveFuzzThreshold (the single shared
 *  helper); unset configs get this constant under `#` only. */
export const TRIGGER_FUZZ_THRESHOLD = 45 as const;

/** Options for rankMatches. Everything is optional; {} means defaults. */
export interface RankOptions {
  /** Max results; default 8 (DEFAULT_LIMIT — maxSuggestions / menu
   *  height, PRD §04). limit ≤ 0 → [] (defensive against caller bugs). */
  limit?: number;
  /** Minimum admission score (0–100) for a candidate to enter the
   *  result set (PRD §04 h2.28: below-threshold matches are discarded
   *  BEFORE ranking — they never render). Absent =
   *  DEFAULT_FUZZ_THRESHOLD (60). 0 admits every match; 100 =
 *  exact-prefix-only. Not clamped here — the config layer
   *  (P1.M2.T1.S3) owns validation; this seam trusts its caller. */
  fuzzThreshold?: number;
  /** Tier-0 anchorless pass runs UNCONDITIONALLY (spec §04 trigger
   *  loosening — no zero-anchored-result precondition; fragment floor 3
   *  still applies; threshold-gated as usual). Records are deduped
   *  against anchored admissions — the anchored record wins ('queue'
   *  under '#que' is tier-3 AND indexOf=0; one record only). */
  loose?: boolean;
}

/** Fuzzy match result (PRD §04 h2.28): `tier` is the strictness class
 *  (3 = exact prefix, 2 = contiguous tail, 1 = scattered subsequence,
 *  0 = anchorless ambient run — rankMatches' zero-anchored-results
 *  fallback, which never flows through matchFragment) — also
 *  compareRankedMatches' ORDER key 1; `score` is the admission
 *  score 0–100 — threshold-gated before ranking (the discard lives in
 *  rankMatches, P1.M2.T1.S2) and NEVER order-determining: only the tier
 *  (and within it the raw sessionCount) sorts the menu. */
export interface MatchResult {
  tier: 0 | 1 | 2 | 3;
  score: number;
}

/** Clamp a computed admission score into [0, 100] (defensive — the
 *  formulas stay in range for sane inputs; the floor guard makes
 *  pathological traces safe). */
const clampScore = (n: number): number => (n < 0 ? 0 : n > 100 ? 100 : n);

/**
 * Anchored-fuzzy match of one fragment against one candidate key
 * (PRD §04 h2.28, 2026-10 owner rule — this RETIRES plain prefix as the
 * only match mode). Consumed by rankMatches' admission gate since
 * P1.M2.T1.S2: a candidate whose score is below the active fuzzThreshold
 * is discarded inside rankMatches' candidate loop, before ranking. The
 * scan itself IS the first-char bucket: rankMatches enters the store's
 * sorted index at the fragment's first char (P1.M2.T2.S2).
 *
 * Rules:
 *  - ANCHOR: the fragment's first char must equal the candidate's first
 *    char (case-insensitive) — 'esk' NEVER matches 'zendesk'. This is
 *    load-bearing for performance: only the store's first-char bucket is
 *    fuzzy-scanned per query (T2.S2), keeping the < 1 ms keystroke
 *    budget. Mid-identifier entry stays available through sub-word
 *    candidates (§04), not anchor-less fuzzy.
 *  - Tier 3 (score 100): exact prefix — 'roun' → 'rounding'; also a
 *    1-char fragment whose anchor char matches (the provider's 1-char
 *    auto-open contract).
 *  - Tier 2: the fragment's tail (everything after the anchor) occurs
 *    CONTIGUOUSLY anywhere from index 1 — 'zsk' → 'zendesk',
 *    'zlock' → 'z_lwlock' (separators like '_' before the run are fine).
 *  - Tier 1: scattered — the tail is a subsequence of c[1..] under a
 *    GREEDY-LEFTMOST two-pointer scan (each tail char takes the earliest
 *    possible position). 'hrp' → 'handleResponseProxy'. Exhausting the
 *    candidate → null.
 *
 * Score formulas (§04 h2.28 verbatim, integer via Math.round, clamped
 * to [0, 100]): tier 3 → 100; tier 2 → 85 − 40·(charsSkippedBeforeRun /
 * len(c)) where skipped = runStart − 1 (the anchor consumes c[0]);
 * tier 1 → 70 − 5·gapRuns − min(3·gapChars, 15) (2026-10 gap-size
 * retune; first calibration was 50 − 5·gapRuns − min(gapChars, 15)).
 * gapRuns/gapChars count
 * ONLY the gap stretches BETWEEN consecutive matched tail chars — the
 * stretch between the anchor and the FIRST tail char is not a gap (the
 * anchor is not gapped). The constants are calibration starting points
 * (§09 tuning protocol) and are exported from this module (TIER3_SCORE /
 * TIER2_BASE_SCORE / TIER2_SKIP_FACTOR / TIER1_BASE_SCORE /
 * TIER1_GAPRUN_PENALTY / TIER1_GAPCHAR_WEIGHT / TIER1_GAPCHAR_CAP) — the
 * arithmetic consumes
 * them, never inline literals; the tier BOUNDARIES are semantics, never
 * tunable. Score is admission-only: score ≥ the active fuzzThreshold
 * keeps a candidate in the result set (rankMatches discards on strict
 * score < threshold), and the value never influences order.
 *
 * '/' and '.' are ordinary characters on both sides — rule-4d path keys
 * ('src/core/query.ts') flow through the same first-char scan; 'sr'
 * → tier 3, 'sr/co' → tier 1.
 *
 * Both arguments are lowercased INTERNALLY: the matcher is self-
 * contained and case-insensitive by itself — callers (T3.S1's chain
 * gate, tests) may pass raw casing.
 *
 * Pure and allocation-light: one O(len(c)) pass (plus one indexOf for
 * the tier-2 shortcut — also a single scan), no regex, no allocation
 * beyond the result object. Runs per candidate per keystroke inside
 * the < 1 ms budget (PRD §02 h3.1).
 *
 * @param f the user's fragment, any casing; empty → null (the zero-char
 *   menu listing is rankMatches' own special case, never the matcher's)
 * @param c the candidate key (lowercase by store contract, but
 *   lowercased here anyway — never assume the caller pre-lowercased)
 * @returns the tier + admission score, or null when no anchored match
 */
export function matchFragment(f: string, c: string): MatchResult | null {
  const fl = f.toLowerCase();
  const cl = c.toLowerCase();
  if (fl.length === 0 || fl.length > cl.length) return null;
  if (fl[0] !== cl[0]) return null; // ANCHOR (§04 h2.28 rule 1)
  if (fl.length === 1 || cl.startsWith(fl))
    return { tier: 3, score: TIER3_SCORE };

  const tail = fl.slice(1);

  // Tier-2 shortcut: the tail as one contiguous run, anywhere from
  // index 1 (a single indexOf = a single scan; agrees with the tier-1
  // pass, whose zero-gap trace is exactly this case).
  const runStart = cl.indexOf(tail, 1);
  if (runStart !== -1) {
    const skipped = runStart - 1; // c[0] is consumed by the anchor
    return {
      tier: 2,
      score: clampScore(
        Math.round(TIER2_BASE_SCORE - (TIER2_SKIP_FACTOR * skipped) / cl.length),
      ),
    };
  }

  // Tier 1: greedy-leftmost anchored subsequence in ONE two-pointer
  // pass over cl. Gap accounting per the spec: skipped chars BEFORE the
  // first matched tail char are free (the anchor is not gapped); each
  // skipped stretch BETWEEN consecutive tail matches is one gapRun, and
  // its length accumulates into gapChars.
  let i = 1; // next cl index to scan (c[0] consumed by the anchor)
  let gapRuns = 0;
  let gapChars = 0;
  let inGap = false; // inside a between-matches gap stretch
  let matched = false; // at least one tail char placed (lastMatch exists)
  for (let t = 0; t < tail.length; t++) {
    const ch = tail[t];
    while (i < cl.length && cl[i] !== ch) {
      if (matched) {
        if (!inGap) {
          inGap = true;
          gapRuns++;
        }
        gapChars++;
      }
      i++;
    }
    if (i >= cl.length) return null; // tail char never found → no match
    inGap = false; // cl[i] === ch: the gap (if any) ends here
    matched = true;
    i++;
  }
  return {
    tier: 1,
    score: clampScore(
      Math.round(
        TIER1_BASE_SCORE -
          TIER1_GAPRUN_PENALTY * gapRuns -
          Math.min(TIER1_GAPCHAR_WEIGHT * gapChars, TIER1_GAPCHAR_CAP),
      ),
    ),
  };
}

/** Internal sort record: the RankedMatch plus its matchFragment tier, so
 *  the comparator can apply key 1 (strictness). The PUBLIC RankedMatch
 *  carries `tier` only as a match-path DIAGNOSTIC (anchored 1–3,
 *  anchorless 0); zero-fragment listing records keep internal tier 0 as
 *  a sort no-op but OMIT it from the public record — so a public
 *  `tier === 0` unambiguously means an anchorless ambient match (which
 *  never arms a successor chain), never a listing item. The two tier-0
 *  meanings are mutually exclusive by construction: the fallback runs
 *  only when the anchored loop pushed nothing, and listings only when
 *  the fragment is empty. Exported for the comparator's contract and
 *  its tests. */
export interface RankedSortRecord {
  tier: number;
  m: RankedMatch;
}

/** Total order over the result list — the 2026-10 owner rule (spec
 *  §04 h2.29), a 4-key total order:
 *
 *  1. tier desc — matchFragment strictness: exact prefix (3) >
 *     contiguous tail (2) > scattered (1) > anchorless ambient run (0,
 *     spec §04 h2.28 — tier-0 records only ever coexist with each other,
 *     since the ambient fallback runs exclusively on an empty anchored
 *     result). Strictness ALWAYS wins: no
 *     sessionCount difference crosses a tier boundary (the 1-count
 *     exact-prefix word outranks the 40-count scattered one).
 *  2. sessionCount desc WITHIN a tier — the more conversation-relevant
 *     word leftmost. RAW store counts only: the composite salience
 *     score still never sorts (membership/eviction only, see module
 *     doc); its sessionCount component is this key.
 *  3. shorter key first.
 *  4. byte-lex on the lowercase key (keys are ASCII, so UTF-16 code-unit
 *     comparison equals byte order; locale-independent).
 *
 *  STABILITY CLAIM: two candidates swap ONLY when one's sessionCount
 *  strictly passes the other's within the same tier — same-tier churn is
 *  the owner-accepted cost; keys 1/3/4 are content-derived, so the menu
 *  stays stable while narrowing. Zero-fragment records share tier 0, so
 *  keys 2–4 order them (sessionCount desc → shorter → byte-lex).
 *  Retired history: the 2026-09 order was length → byte-lex with counts
 *  invisible. Exported for tests; rankMatches is the production caller. */
export function compareRankedMatches(
  a: RankedSortRecord,
  b: RankedSortRecord,
): number {
  if (a.tier !== b.tier) return b.tier - a.tier; // key 1: strictness desc
  const ca = a.m.sessionCount;
  const cb = b.m.sessionCount;
  if (ca !== cb) return cb - ca; // key 2: raw session count desc (within tier)
  if (a.m.key.length !== b.m.key.length) {
    return a.m.key.length - b.m.key.length; // key 3: shorter key
  }
  // Byte order (keys are ASCII, so UTF-16 code-unit comparison equals
  // byte order; locale-independent). The menu never shows a visible tie.
  return a.m.key < b.m.key ? -1 : a.m.key > b.m.key ? 1 : 0;
}

/**
 * Rank the store's candidates anchored-matching `prefix` (§04 h2.28:
 * exact prefix, contiguous tail, or — below the fuzzThreshold —
 * scattered subsequence; all share the fragment's first char) into the
 * top-N result (words-only — the one-word invariant of
 * PRD §04 h2.26 + §07 h2.44: every returned display is a single word,
 * i.e. one whitespace-free token; rule 4d path displays qualify —
 * edges differ from the key, whitespace never appears).
 *
 * ADMISSION GATE (PRD §04 h2.28, P1.M2.T1.S2): with a non-empty
 * fragment, every candidate must survive matchFragment at
 * opts.fuzzThreshold (absent = DEFAULT_FUZZ_THRESHOLD) BEFORE entering
 * `matches` — below-threshold matches are discarded inside the
 * candidate loop, never ranked, never rendered. Zero-fragment ("",
 * the `#`-alone listing) bypasses the gate entirely: no anchor → no
 * tiers → every candidate flows to the ranking path. Under the
 * first-char-bucket scan (below) the gate is LOAD-BEARING at the
 * default threshold: tier-2 tail matches (≤ TIER2_BASE_SCORE) admit
 * while above it, and every tier-1 scattered shape except the single
 * 1-char-hole class (62; looser shapes ≤ 59) stays invisible unless the
 * threshold is lowered.
 *
 * Accepts any prefix casing — it is lowercased BEFORE prefixRange, since
 * prefixRange deliberately throws RangeError on non-lowercase input
 * (caller-bug guard in store.ts). Returns at most `opts.limit` (default
 * 8) results in compareRankedMatches order (spec §04 h2.29: tier desc →
 * sessionCount desc within tier → shorter key → byte-lex; the composite
 * salience score never sorts — only its raw sessionCount component
 * does, within tiers; zero-fragment listings have no tiers and order by
 * sessionCount desc → shorter → byte-lex). Word `description` is `"session
 * x" + sessionCount` (ASCII x per the work-item contract, e.g. "session
 * x12"). `salience` is the exact unquantized value; `sessionCount` is
 * copied from the store entry and agrees with the description.
 *
 * TIER-0 ANCHORLESS FALLBACK (spec §04 h2.28): with a non-empty
 * fragment whose anchored scan admitted nothing, and length ≥ 3
 * (shorter fragments would flood), one full-store pass admits keys
 * containing the fragment as a contiguous run anywhere
 * (`key.indexOf(lower)`), scored `TIER0_BASE_SCORE −
 * TIER0_SKIP_FACTOR·runStart/len` (Math.round + clampScore, strict
 * `< threshold` gate — == survives, matching the anchored gate). A
 * runStart of 0 cannot admit here by construction (position-0 run ⇒
 * anchored tier-3 at 100 ⇒ recs non-empty ⇒ no fallback), so plain
 * indexOf is the operative arm. These records are ordinary records:
 * plural pruning and the limit slice apply; they carry public
 * `tier: 0` (the anchorless diagnostic — listing items omit tier, so
 * the signal is unambiguous for the T2 chain-arm suppression).
 * Fire condition: AMBIENT-ONLY by default — the pass is skipped whenever
 * the anchored scan admitted anything, so it can never merge into (or
 * enrich) an anchored menu (the spec's never-hijack isolation). With
 * `opts.loose` (trigger loosening, plan 004: '#' is the explicit
 * search-the-vocabulary gesture) it runs UNCONDITIONALLY and its records
 * are deduped against the anchored ones — the anchored record wins; the
 * fragment floor and the threshold gate apply identically in both modes.
 *
 * @param store the session candidate store (accepted, never constructed)
 * @param prefix the user's fragment so far, any casing
 * @param opts `{ limit, fuzzThreshold }` (defaults: 8, DEFAULT_FUZZ_THRESHOLD)
 * @returns the ranked top-N; [] when nothing matches (provider delegates)
 */
export function rankMatches(
  store: CandidateStore,
  prefix: string,
  opts: RankOptions = {},
): RankedMatch[] {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  if (limit <= 0) return []; // defensive: nothing can be returned
  const lower = prefix.toLowerCase(); // BEFORE prefixRange — it throws on uppercase
  // Anchored-fuzzy scan entry (§04 h2.28 / §06 h2.38, P1.M2.T2.S2): the
  // fragment's first char is matchFragment's exact ANCHOR, so the scan
  // enters the sorted index at the FIRST-CHAR bucket — the full fragment
  // no longer restricts the range, because tier-2 (contiguous tail) and
  // tier-1 (scattered) matches live anywhere in the bucket. Membership
  // is decided solely by matchFragment + fuzzThreshold in the loop below,
  // which already runs for every scanned key. The empty fragment keeps
  // the full-store listing: prefixRange("") → [0, n].
  const bucket = lower === "" ? "" : lower[0];
  // Ordering invariant (module doc): prefixRange rebuilds a dirty index,
  // so only a snapshot taken AFTER this call is guaranteed to agree with
  // get() — S3 eviction may have removed keys since the last rebuild.
  const [start, end] = store.prefixRange(bucket);
  const keys = store.sortedKeysSnapshot().slice(start, end);
  const ordinal = store.currentOrdinal();
  const threshold = opts.fuzzThreshold ?? DEFAULT_FUZZ_THRESHOLD;
  // Tier-carrying sort records (RankedSortRecord): the comparator needs
  // each match's strictness class; the public RankedMatch must not carry
  // it — records are stripped to `m` after the sort. Zero-fragment
  // records share tier 0 (no tiers on the "#"-alone listing), making the
  // comparator's key 1 a no-op there by construction.
  const recs: RankedSortRecord[] = [];
  for (const k of keys) {
    // Internal tier 0 on a zero-fragment listing is a SORT no-op (keys
    // 2–4 order); it is OMITTED from the public record below. Public
    // tier 0 is the ANCHORLESS ambient diagnostic (fallback push) — the
    // two meanings never meet (listings require "", the fallback
    // requires non-empty), and the omit-contract keeps public tier===0
    // unambiguous for T2's chain-arm suppression.
    let tier: 0 | 1 | 2 | 3 = 0; // zero-fragment: tier-agnostic records (keys 2–4 order)
    // §04 h2.28 admission gate (P1.M2.T1.S2): discard below-threshold
    // matches BEFORE ranking — inside the loop, before the push, so they
    // never enter the result and never render. Zero-fragment skips the
    // gate (matchFragment("") is null by contract; gating on it would
    // empty the '#'-alone listing). The comparison is STRICT: a score
    // exactly at the threshold survives.
    if (lower !== "") {
      const m = matchFragment(lower, k);
      if (m === null || m.score < threshold) continue;
      tier = m.tier;
    }
    const c = store.get(k); // undefined if evicted since the rebuild — skip
    if (!c) continue;
    recs.push({
      tier,
      m: {
        key: c.key,
        display: c.display, // insertion form exactly as stored (h2.27; rule 4d edges ride along)
        description: `session x${c.sessionCount}`, // ASCII x per item contract
        salience: salience(c, ordinal), // exact unquantized value
        sessionCount: c.sessionCount, // order key 2 within a tier (§04 h2.29)
        // Match-path diagnostic only — the key must be OMITTED entirely
        // on the zero-fragment listing path (lower === ""), so public
        // tier === 0 unambiguously means an anchorless ambient match.
        ...(lower !== "" ? { tier } : {}),
      },
    });
  }

  // TIER-0 ANCHORLESS PASS (spec §04 h2.28): ambient mode runs it only
  // when the anchored scan admitted NOTHING (it can rescue a menu that
  // would not otherwise open, never enrich one — the isolation is the
  // spec's never-hijack property); `opts.loose` (trigger loosening, plan
  // 004) runs it UNCONDITIONALLY so anchorless matches ride WITH anchored
  // results. Fragment floor ≥ 3 in both modes — shorter fragments would
  // flood. Full-store pass: prefixRange("") FIRST (ordering invariant —
  // it consolidates a dirty index), THEN a FRESH snapshot (never reuse
  // the bucket-sliced `keys`). Plain indexOf: a runStart of 0 implies an
  // anchored tier-3 match, which would have made recs non-empty — so
  // every ambient run here is genuinely mid-key.
  const runTier0 =
    lower !== "" &&
    lower.length >= 3 &&
    (opts.loose === true || recs.length === 0);
  if (runTier0) {
    // Dedup against anchored admissions — the anchored record wins. The
    // skip is UNCONDITIONAL (vacuous in ambient mode, where the pass only
    // runs on empty recs) so ONE code path serves both modes: a key that
    // already anchored ("queue" under "que" is tier 3 AND indexOf 0)
    // never duplicates as tier 0.
    const anchored = new Set(recs.map((r) => r.m.key));
    const [fStart, fEnd] = store.prefixRange("");
    const allKeys = store.sortedKeysSnapshot().slice(fStart, fEnd);
    for (const k of allKeys) {
      if (anchored.has(k)) continue; // anchored record wins (dedup)
      const runStart = k.indexOf(lower);
      if (runStart === -1) continue;
      const score = clampScore(
        Math.round(TIER0_BASE_SCORE - (TIER0_SKIP_FACTOR * runStart) / k.length),
      );
      if (score < threshold) continue; // strict gate, == survives (anchored parity)
      const c = store.get(k); // undefined if evicted ghost — skip
      if (!c) continue;
      recs.push({
        tier: 0,
        m: {
          key: c.key,
          display: c.display,
          description: `session x${c.sessionCount}`,
          salience: salience(c, ordinal),
          sessionCount: c.sessionCount,
          tier: 0, // public anchorless diagnostic (T2 chain-arm reads this)
        },
      });
    }
  }

  // Sort of the (typically small) set: O(r log r), well under the <1 ms
  // keystroke gate at realistic sizes. §04 h2.29 order (module doc):
  // tier desc → sessionCount desc within tier → shorter → byte-lex; the
  // salience value is carried per item for diagnostics/eviction parity
  // but NEVER sorts the menu. If the P1.M4.T1.S2 bench pass ever shows
  // huge hot ranges, a partial top-N selection is the documented
  // fallback — keep it simple until measured.
  recs.sort(compareRankedMatches);
  // Populate/omit contract: `m` records built on the MATCH path carry
  // their tier (anchored 1–3, anchorless 0); zero-fragment listing
  // records omit the key entirely — the map copies as-is, so public
  // `tier === 0` can only ever mean an anchorless ambient match.
  const matches = recs.map((r) => r.m);

  // PLURAL PRUNING (2026-09 owner rule, spec 04): when a result set
  // contains both a key and that key + "s", the plural is redundant
  // menu noise — the singular is the completion target, so the plural
  // is dropped. EXACT single-"s" pairs only, and only when BOTH forms
  // are in the SAME result set: "ss"-final keys never prune
  // (glass/glas), "es"/"ies" plurals are different keys entirely
  // (class vs classes — out of scope), filename-shaped keys are
  // untouched (agents vs agents.md is not a pair), and a plural whose
  // singular is absent (filtered out, not a prefix match, evicted)
  // stays. Applied BEFORE the limit slice so a pruned plural never
  // consumes a slot; can never reduce the set below its non-paired
  // members.
  if (matches.length > 1) {
    const keySet = new Set(matches.map((m) => m.key));
    return matches
      .filter(
        (m) =>
          !(
            m.key.endsWith("s") &&
            !m.key.endsWith("ss") &&
            keySet.has(m.key.slice(0, -1))
          ),
      )
      .slice(0, limit);
  }
  return matches.slice(0, limit);
}
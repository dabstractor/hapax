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
 * allocation-heavy work: one prefixRange call, one key slice, one get
 * per candidate, one sort of the (typically small) range.
 *
 * MENU ORDER (2026-09 redesign, drift from PRD §04 h2.26 recorded
 * here): compareRankedMatches is now CONTENT-DERIVED ONLY — shorter
 * key first, then byte-lex on the lowercase key. Salience is NOT a
 * sort key anymore: it decides MEMBERSHIP (admission bands) and
 * eviction, never position — a menu whose order depends on recency/
 * frequency reshuffles between keystrokes and sessions, defeating the
 * muscle memory completion exists to build. Ordering is pure text so
 * the same fragment always yields the same list: predictable, stable
 * while narrowing, and identical to editor/shell convention.
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

/** Options for rankMatches. Everything is optional; {} means defaults. */
export interface RankOptions {
  /** Max results; default 8 (DEFAULT_LIMIT — maxSuggestions / menu
   *  height, PRD §04). limit ≤ 0 → [] (defensive against caller bugs). */
  limit?: number;
}

/** Fuzzy match result (PRD §04 h2.28): `tier` is the strictness class
 *  (3 = exact prefix, 2 = contiguous tail, 1 = scattered subsequence);
 *  `score` is the admission score 0–100 — threshold-gated before ranking
 *  (the discard lives in rankMatches, P1.M2.T1.S2), NEVER order-
 *  determining: menu position stays content-derived
 *  (compareRankedMatches). */
export interface MatchResult {
  tier: 1 | 2 | 3;
  score: number;
}

/** Clamp a computed admission score into [0, 100] (defensive — the
 *  formulas stay in range for sane inputs; the floor guard makes
 *  pathological traces safe). */
const clampScore = (n: number): number => (n < 0 ? 0 : n > 100 ? 100 : n);

/**
 * Anchored-fuzzy match of one fragment against one candidate key
 * (PRD §04 h2.28, 2026-10 owner rule — this RETIRES plain prefix as the
 * only match mode; wiring into rankMatches is P1.M2.T2.S2, so the
 * function is exported-but-unconsumed until then).
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
 * tier 1 → 50 − 5·gapRuns − min(gapChars, 15). gapRuns/gapChars count
 * ONLY the gap stretches BETWEEN consecutive matched tail chars — the
 * stretch between the anchor and the FIRST tail char is not a gap (the
 * anchor is not gapped). The constants are calibration starting points
 * (§09 tuning protocol); the tier BOUNDARIES are semantics, never
 * tunable. Score is admission-only: ≥ fuzzThreshold keeps a candidate
 * in the result set, and the value never influences order.
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
  if (fl.length === 1 || cl.startsWith(fl)) return { tier: 3, score: 100 };

  const tail = fl.slice(1);

  // Tier-2 shortcut: the tail as one contiguous run, anywhere from
  // index 1 (a single indexOf = a single scan; agrees with the tier-1
  // pass, whose zero-gap trace is exactly this case).
  const runStart = cl.indexOf(tail, 1);
  if (runStart !== -1) {
    const skipped = runStart - 1; // c[0] is consumed by the anchor
    return {
      tier: 2,
      score: clampScore(Math.round(85 - (40 * skipped) / cl.length)),
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
    score: clampScore(Math.round(50 - 5 * gapRuns - Math.min(gapChars, 15))),
  };
}

/** Total order over the result list — CONTENT-DERIVED (2026-09
 * redesign): shorter key first, then byte-lex. Deliberately ignores
 * salience (see module doc: salience governs membership/eviction only,
 * never menu position). Exported for tests; rankMatches is the
 * production caller. */
export function compareRankedMatches(a: RankedMatch, b: RankedMatch): number {
  if (a.key.length !== b.key.length) return a.key.length - b.key.length;
  // Byte order (keys are ASCII, so UTF-16 code-unit comparison equals
  // byte order; locale-independent). The menu never shows a visible tie.
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Rank the store's candidates whose lowercase key starts with `prefix`
 * into the top-N result (words-only — the one-word invariant of
 * PRD §04 h2.26 + §07 h2.44: every returned display is a single word,
 * i.e. one whitespace-free token; rule 4d path displays qualify —
 * edges differ from the key, whitespace never appears).
 *
 * Accepts any prefix casing — it is lowercased BEFORE prefixRange, since
 * prefixRange deliberately throws RangeError on non-lowercase input
 * (caller-bug guard in store.ts). Returns at most `opts.limit` (default
 * 8) results in compareRankedMatches order (content-derived: shorter
 * key → byte-lex; salience never sorts — see module doc). Word `description` is `"session
 * x" + sessionCount` (ASCII x per the work-item contract, e.g. "session
 * x12"). `salience` is the exact unquantized value.
 *
 * @param store the session candidate store (accepted, never constructed)
 * @param prefix the user's fragment so far, any casing
 * @param opts `{ limit }` only (default 8)
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
  // Ordering invariant (module doc): prefixRange rebuilds a dirty index,
  // so only a snapshot taken AFTER this call is guaranteed to agree with
  // get() — S3 eviction may have removed keys since the last rebuild.
  const [start, end] = store.prefixRange(lower);
  const keys = store.sortedKeysSnapshot().slice(start, end);
  const ordinal = store.currentOrdinal();
  const matches: RankedMatch[] = [];
  for (const k of keys) {
    const c = store.get(k); // undefined if evicted since the rebuild — skip
    if (!c) continue;
    matches.push({
      key: c.key,
      display: c.display, // insertion form exactly as stored (h2.27; rule 4d edges ride along)
      description: `session x${c.sessionCount}`, // ASCII x per item contract
      salience: salience(c, ordinal), // exact unquantized value
    });
  }

  // Sort of the (typically small) set: O(r log r), well under the <1 ms
  // keystroke gate at realistic sizes. Content-derived order (module
  // doc): shorter key → byte-lex — salience is carried per item for
  // diagnostics/eviction parity but NEVER sorts the menu. If the
  // P1.M4.T1.S2 bench pass ever shows huge hot ranges, a partial top-N
  // selection is the documented fallback — keep it simple until measured.
  matches.sort(compareRankedMatches);

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
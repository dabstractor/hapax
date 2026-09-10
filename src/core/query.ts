/**
 * Query — stage 5 (final stage) of the segment → shapeGate → score →
 * store → query pipeline (PRD §04 h2.26 + §07 h2.44): synchronous
 * WORDS-ONLY query-time ranking. Prefix-search the store's prefix index,
 * rank by salience, return the top N as RankedMatch items — every item's
 * `display` is exactly one word (the one-word invariant: no multi-word
 * candidates, ever; the only successor behavior is provider-side
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
 * PRD §04 h2.26 + §07 h2.44: every returned display is a single word).
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
      display: c.display, // insertion casing exactly as stored (h2.27)
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
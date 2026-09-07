/**
 * Query — stage 5 (final stage) of the segment → shapeGate → score →
 * store → query pipeline (PRD §06): synchronous query-time ranking.
 * Prefix-search the store's prefix index, rank by salience, return the
 * top N as RankedMatch items. Runs on EVERY keystroke (the provider,
 * P1.M3.T3.S2, calls this in getSuggestions) and must complete in
 * < 1 ms on a 20k-candidate store (PRD §02 h3.1) — pure computation,
 * no allocation-heavy work: one prefixRange call, one key slice, one
 * get per candidate, one sort of the (typically small) range.
 *
 * Order is compareCandidates's exactly (PRD §04 h2.26): salience desc →
 * shorter key → byte-lex on the lowercase key — so the menu never shows
 * a visible tie. Matching is case-insensitive (h2.27): the prefix is
 * lowercased here; insertion uses the stored display casing verbatim.
 * An empty result tells the provider to delegate (never an empty menu) —
 * this function just returns [].
 *
 * Word salience lives in score.js — salience() is imported, never
 * reimplemented here (score.ts module invariant). The phrase formula is
 * PRD §06 h3.8's own arithmetic (phraseSalience below) — the one
 * sanctioned exception. The merged word+phrase order mirrors
 * compareCandidates's ladder (PRD §04 h2.26) in compareRankedMatches,
 * because phrase saliences are plain numbers, not Candidates. This
 * module never imports from pi packages (src/core architecture
 * invariant, see types.ts header); zero new dependencies.
 *
 * PHRASES (PRD §06 h3.8, P2.M1.T3.S1): admitted phrase candidates whose
 * FIRST word the fragment prefixes compete in the same ranked result set,
 * with their own salience formula — Σ constituent word saliences × 1.2,
 * plus 2.0·log2(1 + count) on the repetition path (count >= 2) — and
 * CONSTITUENT SUPPRESSION: a phrase shadows the single-word candidate
 * whose key equals its first word when the phrase's salience is >= the
 * word's (the settled tie rule: >=, tie → phrase). Only the first word
 * can prefix-collide with the fragment, so middle/last constituents are
 * never suppressed. Phrase items reuse RankedMatch unchanged — key is the
 * lowercase phrase key, display is the constituent display casings joined
 * with single spaces, description is the exact literal "phrase" — and the
 * provider (P1.M3.T3.S2) maps them through untouched.
 *
 * INDEX ORDERING INVARIANT (why prefixRange-then-snapshot is the only
 * safe public enumeration path): store.prefixRange(lower) returns
 * [start, end) INDICES over the internally sorted key array, and it
 * rebuilds that array first when it is dirty. sortedKeysSnapshot() alone
 * never rebuilds — a snapshot from before a dirtying mutation can list
 * evicted keys (S3 eviction, P1.M2.T4.S3, deletes keys and sets #dirty)
 * whose get() would return undefined. So: call prefixRange FIRST (it
 * performs any needed lazy rebuild), THEN take the snapshot and slice
 * [start, end). Never cache keys or snapshots across rankMatches calls —
 * eviction dirties the index between keystrokes. (A future store
 * accessor like keyAt(i) would be cleaner; out of scope here.)
 *
 * opts.suppress (the former M2 extension seam, anticipated by this
 * module's M1 doc) remains a caller-supplied filter over WORD candidates
 * only — it takes a Candidate, so it cannot see phrases. Constituent
 * suppression is now first-class in rankMatches; the seam keeps working
 * unchanged for word filtering.
 */

import { salience } from "./score.js";
import type { CandidateStore } from "./store.js";
import type { Candidate, PhraseEntry, RankedMatch } from "./types.js";

/** Max results per query — menu height (PRD §04 h2.26: top 8). Baked,
 *  not config (§08): named constant, no magic 8 inline. */
export const DEFAULT_LIMIT = 8;

/** Options for rankMatches. Everything is optional; {} means defaults. */
export interface RankOptions {
  /** Max results; default 8 (DEFAULT_LIMIT — maxSuggestions / menu
   *  height, PRD §04). limit ≤ 0 → [] (defensive against caller bugs). */
  limit?: number;
  /** Caller-supplied filter over WORD candidates (the former M2
   *  extension seam): return true to suppress a word before ranking.
   *  Constituent suppression is built in (PRD §06 h3.8) and deliberately
   *  does NOT go through this hook — it takes a Candidate, so it cannot
   *  see phrases. Default: nothing suppressed. */
  suppress?: (c: Candidate) => boolean;
}

/** Phrase salience multiplier (PRD §06 h3.8): a phrase is a more
 *  specific completion target than its parts, so its constituent
 *  word-salience sum is scaled UP by this factor. Baked per PRD §08. */
export const PHRASE_MULTIPLIER = 1.2;

/** Phrase repetition-bonus weight (PRD §06 h3.8): added as
 *  PHRASE_REPETITION_W · log2(1 + count) — repetition-path phrases only
 *  (entry.count >= 2, the settled admission definition of "seen
 *  repeatedly"; sticky and demote-re-admitted phrases are both covered
 *  by the count check). Baked per PRD §08. */
export const PHRASE_REPETITION_W = 2.0;

/** First word of a phrase key: "renewable energy laboratory" →
 *  "renewable". Keys are lowercase single-space-joined (types.ts); a
 *  space-free key (defense only — capture makes ≥ 2-word keys) returns
 *  the key itself. Exported for tests; rankMatches is the production
 *  caller. */
export function firstWord(phraseKey: string): string {
  const cut = phraseKey.indexOf(" ");
  return cut === -1 ? phraseKey : phraseKey.slice(0, cut);
}

/** Phrase salience (PRD §06 h3.8, exact):
 *
 *    (Σ constituent word saliences) × 1.2
 *      + 2.0·log2(1 + count)  when repetition-path (count >= 2)
 *
 *  Constituent saliences are score.ts's salience(c, currentOrdinal) —
 *  imported, never reimplemented. Missing (evicted) constituents
 *  contribute 0: a phrase never fails the query because a word fell out
 *  of the independent word store. Exported for tests; rankMatches is the
 *  production caller. */
export function phraseSalience(
  constituents: ReadonlyArray<Candidate | undefined>,
  entry: PhraseEntry,
  currentOrdinal: number,
): number {
  let sum = 0;
  for (const c of constituents) {
    if (c) sum += salience(c, currentOrdinal); // missing → 0, never a throw
  }
  let result = sum * PHRASE_MULTIPLIER;
  if (entry.count >= 2) {
    result += PHRASE_REPETITION_W * Math.log2(1 + entry.count);
  }
  return result;
}

/** Settled suppression predicate (PRD §06 h3.8): a phrase shadows a
 *  single-word candidate exactly when the phrase's salience is >= the
 *  word's — the tie goes to the phrase (>=, never >). Exported so the
 *  contract matrix {>, ==, <} is testable directly; rankMatches calls
 *  this — no duplicated comparison anywhere. */
export function phraseSuppresses(
  phraseSal: number,
  wordSal: number,
): boolean {
  return phraseSal >= wordSal;
}

/** Total order over the MERGED word+phrase result list — score.ts's
 *  compareCandidates ladder (PRD §04 h2.26) mirrored exactly, because
 *  phrase saliences are plain numbers and compareCandidates takes
 *  Candidates. Ties in salience mean EXACT float equality:
 *
 *  1. salience descending (higher salience first)
 *  2. tie → shorter key first
 *  3. tie → lexicographic byte order on the lowercase key
 *
 *  Exported for tests; rankMatches is the production caller. */
export function compareRankedMatches(a: RankedMatch, b: RankedMatch): number {
  const bySalience = b.salience - a.salience;
  if (bySalience !== 0) return bySalience;
  if (a.key.length !== b.key.length) return a.key.length - b.key.length;
  // Byte order (see score.ts compareCandidates — keys are ASCII, so
  // UTF-16 code-unit comparison equals byte order; never quantize).
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Rank the store's candidates whose lowercase key starts with `prefix`,
 * plus admitted phrase candidates whose first word that prefix matches
 * (PRD §06 h3.8), into one merged, suppression-filtered, top-N result.
 *
 * Accepts any prefix casing — it is lowercased BEFORE prefixRange (and
 * before any phrase matching; phrase keys are already lowercase), since
 * prefixRange deliberately throws RangeError on non-lowercase input
 * (caller-bug guard in store.ts). Returns at most `opts.limit` (default
 * 8) results in the compareCandidates order: salience desc → shorter
 * key → byte-lex (PRD §04 h2.26/§09). Word `description` is `"session
 * x" + sessionCount` (ASCII x per the work-item contract, e.g. "session
 * x12"); phrase `description` is the exact literal "phrase". `salience`
 * is the exact unquantized value for both kinds.
 *
 * @param store the session candidate store (accepted, never constructed)
 * @param prefix the user's fragment so far, any casing
 * @param opts limit + optional word-only suppress hook
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
  // Word candidates, salience computed once — suppression (below) and
  // the merged output reuse the same numbers, never recomputed.
  const words: { c: Candidate; sal: number }[] = [];
  for (const k of keys) {
    const c = store.get(k); // undefined if evicted since the rebuild — skip
    if (!c || (opts.suppress && opts.suppress(c))) continue; // word-only seam
    words.push({ c, sal: salience(c, ordinal) });
  }

  // ── Phrase gathering (PRD §06 h3.8) ────────────────────────────────────
  // O(#phraseCandidates) — the admission-bounded candidate set, a snapshot
  // COPY (store.ts contract), never the 10k-cap counts map. A phrase
  // competes when `lower` prefixes its FIRST word; middle/last
  // constituents cannot prefix-collide with the same fragment.
  const phraseHits: { key: string; sal: number; words: string[] }[] = [];
  for (const pk of store.phraseCandidateKeys()) {
    if (!firstWord(pk).startsWith(lower)) continue; // FIRST word only (h3.8)
    const entry = store.getPhrase(pk);
    if (!entry) continue; // demoted/evicted between snapshot & lookup — skip
    const phraseWords = pk.split(" "); // keys are single-space-joined: exact
    const constituents = phraseWords.map((w) => store.get(w)); // evicted → undefined
    phraseHits.push({
      key: pk,
      sal: phraseSalience(constituents, entry, ordinal),
      words: phraseWords,
    });
  }

  // ── Constituent suppression (PRD §06 h3.8, settled >= tie rule) ───────
  // A phrase shadows the single-word candidate whose key equals its first
  // word when the phrase's salience is >= the word's (tie → phrase).
  // Middle/last constituents are never touched — typing "renew" cannot
  // co-present with "energy" anyway (different prefixes).
  for (const p of phraseHits) {
    const fw = firstWord(p.key);
    for (let i = words.length - 1; i >= 0; i--) {
      if (words[i].c.key === fw && phraseSuppresses(p.sal, words[i].sal)) {
        words.splice(i, 1);
      }
    }
  }

  // ── Merge: words + phrases, one RankedMatch shape, one sort, one cap ──
  const merged: RankedMatch[] = words.map(({ c, sal }) => ({
    key: c.key,
    display: c.display, // insertion casing exactly as stored (h2.27)
    description: `session x${c.sessionCount}`, // ASCII x per item contract
    salience: sal, // exact unquantized salience(c, currentOrdinal)
  }));
  for (const p of phraseHits) {
    merged.push({
      key: p.key,
      display: p.words.map((w) => store.get(w)?.display ?? w).join(" "),
      description: "phrase", // exact literal per the item contract
      salience: p.sal, // exact h3.8 formula value, unquantized
    });
  }
  // Full sort of the merged (typically small) set: O(r log r), well under
  // the <1 ms keystroke gate at realistic sizes. Same ladder as
  // compareCandidates (PRD §04 h2.26) via compareRankedMatches — phrases
  // are not Candidates, so the merged list cannot sort through
  // compareCandidates itself. If the P1.M4.T1.S2 bench pass ever shows
  // huge hot ranges, a partial top-N selection is the documented
  // fallback — keep it simple until measured.
  merged.sort(compareRankedMatches);
  return merged.slice(0, limit); // shared cap truncates both kinds together
}
/**
 * Store — stage 4 of the segment → shapeGate → score → store → query
 * pipeline (PRD §06): the per-session candidate map. One entry per
 * lowercase key — casing variants ("Hapax", "hapax", "HAPAX") merge into
 * a single entry whose `display` reflects the most recent casing seen.
 *
 * UPSERT SEMANTICS (h2.36, verbatim contract):
 *
 *   Absent  → create { key, display, sessionCount: 1, firstSeenOrdinal,
 *             lastSeenOrdinal, userTyped, properName, rankGroup, isSubword }.
 *   Present → mutate in place: sessionCount++, lastSeenOrdinal = ordinal,
 *             display refreshed (most recent wins), userTyped / properName
 *             OR-in (sticky once true, never unset), rankGroup =
 *             min(existing, new) — a word first seen mid-frequency then
 *             seen rare keeps the better (lower) group. isSubword is
 *             intentionally NOT merged: a key's identity as subword is
 *             fixed by its first admission.
 *
 * ORDINAL: the pipeline assigns message ordinals (P1.M3.T2) — it calls
 * nextOrdinal() ONCE per message BEFORE processing that message's
 * sightings and stamps them into each Sighting. upsert never advances the
 * counter; nextOrdinal() starts at 1 and is strictly monotonic, never
 * reset. currentOrdinal() is the read-only view for consumers (eviction,
 * P1.M2.T4.S3; restore replay, P1.M3.T2.S3; /acwords, P1.M3.T4.S1).
 *
 * PREFIX INDEX (P1.M2.T4.S2, PRD §06 h2.35): a lazily-maintained sorted
 * array of lowercase keys. New-key inserts only mark it dirty; the next
 * query re-sorts once (Array.sort's default UTF-16 code-unit order is
 * byte-lexicographic for lowercase ASCII keys) and binary-searches the
 * prefix range — insert stays O(1), query is O(log n + range).
 *
 * Pure in-memory, session-lifetime only — no persistence (PRD: none).
 * upsert is O(1) Map work below the cap: no sorting, no scanning, no
 * per-insert index rebuild, so a 20k-entry restore replay does not
 * degrade. Eviction (P1.M2.T4.S3, PRD §06 h2.37) lives here, hooked at
 * the tail of upsert: the store stays bounded at STORE_CAP entries,
 * victims are the lowest evictionScore candidates, and every removal
 * marks the prefix index dirty (see #dirty). The scoring math is not
 * duplicated: eviction imports evictionScore from score.js — the single
 * source of truth.
 *
 * PHRASE LAYER (P2.M1.T1.S1, PRD §06 M2): a second, independent map —
 * single-space-joined lowercase phrase key → PhraseEntry — captures
 * bigram and trigram windows of consecutive admitted whole tokens within
 * one line (the ingest pipeline splits lines; newline is the only window
 * break). Same upsert/evict discipline as words — count++ on repeat,
 * PHRASE_CAP = 10,000 hard cap, exactly-`needed` lowest-score eviction —
 * with a phrase-specific score (count × exp(-Δ/50): score.ts's
 * evictionScore requires a full Candidate, so the math is a local helper
 * sharing only the τ = 50 constant) and `sticky` instead of `userTyped`
 * in the victim-pool filter. The two stores share NOTHING: phrase writes
 * never touch #map, #sortedKeys, or #dirty (the word prefix index never
 * rebuilds for phrase activity), and word eviction never touches
 * #phrases. sticky starts false and is only ever set through
 * setPhraseSticky. ADMISSION (P2.M1.T2.S1, PRD §06 h3.7) runs at each
 * phrase upsert's tail: a phrase becomes a completion CANDIDATE when its
 * count reaches 2 (repetition path) or — first sight only — every
 * constituent word is rankGroup 0 or properName and the n-gram is ≤ 5
 * words (fast path); both paths firing makes it sticky. Candidacy lives
 * in #phraseCandidates, orthogonal to counts; demotion
 * (removePhraseCandidacy, called by T2.S2's sweepPhraseDemotions) drops
 * candidacy while counts, ordinals, and sticky stay.
 *
 * SUCCESSOR INDEX (P2.M2.T1.S1, PRD §06 h3.9): every bigram phrase key
 * ("w1 w2") bumps w1 → w2 in #successorIndex at INGEST time, inside the
 * phrase upsert — never via a map-wide scan (§05 h2.34) and never on the
 * keystroke path. Each word keeps at most 3 successors, ordered
 * count-descending with byte-lex ties; on overflow the sorted tail drops
 * and eviction never backfills it (a dropped successor returns only when
 * its bigram recurs). topSuccessors() is a pure O(1) read returning the
 * live array (read-only contract) or the shared NO_SUCCESSORS constant.
 */

import { evictionScore } from "./score.js";
import type {
  Candidate,
  PhraseEntry,
  RankGroup,
  Sighting,
  Successor,
} from "./types.js";

/** Hard cap on stored word candidates — whole tokens AND sub-words count
 *  toward the same cap. PRD §06 h2.37; baked, not config (PRD §08 h2.47). */
export const STORE_CAP = 20_000;
/** Eviction batch size: the snapshot + sort that selects victims is
 *  amortized over drops of this many entries. PRD §06 h2.37; baked per
 *  §08 h2.47. The per-overflow victim COUNT is exactly `size - STORE_CAP`
 *  (PRD §09 forbids rounding up — see evictIfOverCap). */
export const EVICT_BATCH = 256;

/** Hard cap on stored phrase n-grams (bigrams AND trigrams count toward
 *  the same cap). PRD §06 M2; baked, not config (PRD §08 h2.47). The word
 *  store's cap is INDEPENDENT — the phrase map never evicts words. */
export const PHRASE_CAP = 10_000;
/** Phrase eviction batch size: the snapshot + sort that selects phrase
 *  victims is amortized over drops of this many entries (same reading of
 *  "batches of 256" as the word store's EVICT_BATCH). The per-overflow
 *  victim COUNT is exactly `size - PHRASE_CAP` — PRD §09 forbids rounding
 *  up (see evictPhrasesIfOverCap). */
export const PHRASE_EVICT_BATCH = 256;

/** Phrase eviction score (PRD §06 M2): occurrence count decayed by the
 *  same slower τ = 50 clock the word store's evictionScore decays by.
 *  Kept local to store.ts — score.ts's evictionScore requires a full
 *  Candidate (its salience weights don't apply to phrases); this is the
 *  phrase-side counterpart, not a re-derivation of the word math. */
function phraseEvictionScore(p: PhraseEntry, currentOrdinal: number): number {
  return p.count * Math.exp(-(currentOrdinal - p.lastSeenOrdinal) / 50);
}

/** Successor sort key (PRD §06 h3.9): higher count first, byte-lex
 *  ascending `next` on equal counts — the eviction comparators' inline
 *  `a < b ? -1 : …` style as a strict "a sorts before b" predicate, used
 *  by #bumpSuccessor's bounded in-place shifts. */
function successorBefore(a: Successor, b: Successor): boolean {
  if (a.count !== b.count) return a.count > b.count;
  return a.next < b.next;
}

/** Shared empty successor array (PRD §06 h3.9): topSuccessors() hands
 *  this constant to every unseen-word caller, so a keystroke-path miss
 *  allocates nothing — one frozen array for the whole process. */
const NO_SUCCESSORS: readonly Successor[] = Object.freeze([]);

/** Per-session word-candidate store (PRD §06). Pure in-memory Map from
 *  lowercase key → Candidate, plus the session's message ordinal counter. */
export class CandidateStore {
  #map = new Map<string, Candidate>();
  #ordinal = 0; // last issued message ordinal (0 = none issued yet)
  #sortedKeys: string[] = []; // key index as of the LAST rebuild
  // True when #sortedKeys may miss keys present in #map. Set by new-key
  // inserts and cleared by the next prefixRange() rebuild.
  // S3 eviction must ALSO set #dirty = true on any key removal.
  #dirty = false;
  // Phrase layer (PRD §06 M2) — deliberately NOT under #dirty: nothing
  // about #phrases ever invalidates the WORD prefix index.
  #phrases = new Map<string, PhraseEntry>();
  // Phrase admission (P2.M1.T2.S1, PRD §06 h3.7) — candidacy is
  // orthogonal to counts: a key is a completion candidate once the
  // repetition path (count ≥ 2) or the first-sight fast path (every
  // constituent rankGroup 0 / properName, ≤ 5 words) has admitted it.
  #phraseCandidates = new Set<string>();
  // Successor index (P2.M2.T1.S1, PRD §06 h3.9): word → its top-3 most
  // frequent bigram successors, ordered count-desc / byte-lex-asc, never
  // longer than 3 entries. Maintained INCREMENTALLY inside #upsertPhrase
  // (one bump per bigram key — no scans, §05 h2.34; nothing runs on the
  // keystroke path) and cleaned by #evictPhrasesIfOverCap when an evicted
  // key is a bigram. Read O(1) via topSuccessors().
  #successorIndex = new Map<string, Successor[]>();
  // Provenance of fast-path admission — the "both paths" half of the
  // sticky rule and the filter T2.S2's demotion sweep iterates. Also
  // pins the fast path to FIRST SIGHT: once recorded, a later count-1
  // upsert (e.g. post-eviction re-record) never re-evaluates.
  #fastPathAdmitted = new Set<string>();

  /** Issue the next message ordinal: 1, 2, 3… strictly monotonic, never
   *  reset. The ingest pipeline calls this once per message. */
  nextOrdinal(): number {
    return ++this.#ordinal;
  }

  /** The ordinal most recently issued (0 before any nextOrdinal() call).
   *  Read-only — advancing happens only through nextOrdinal(). */
  currentOrdinal(): number {
    return this.#ordinal;
  }

  /** Record one admitted occurrence (PRD §06 h2.36). Creates the entry on
   *  first sight, merges into it otherwise. The ordinal arrives inside the
   *  Sighting — this method never advances the counter. O(1) below the
   *  cap; on overflow it trims back to STORE_CAP via evictIfOverCap(). */
  upsert(sighting: Sighting): void {
    const existing = this.#map.get(sighting.key);
    if (!existing) {
      this.#map.set(sighting.key, {
        key: sighting.key,
        display: sighting.display,
        sessionCount: 1,
        lastSeenOrdinal: sighting.ordinal,
        firstSeenOrdinal: sighting.ordinal,
        userTyped: sighting.fromUser,
        properName: sighting.properName,
        rankGroup: sighting.rankGroup,
        isSubword: sighting.isSubword,
      });
      // New key — the sorted prefix index (h2.35) must re-sort on next
      // query. Deliberately NOT sorted here: upsert stays O(1) so a 20k
      // restore replay amortizes into one lazy rebuild.
      this.#dirty = true;
      this.evictIfOverCap(); // bounded store (§06 h2.37) — no-op below cap
      return;
    }
    existing.sessionCount++;
    existing.lastSeenOrdinal = sighting.ordinal;
    existing.display = sighting.display; // most recent casing wins
    existing.userTyped ||= sighting.fromUser; // sticky once true
    existing.properName ||= sighting.properName; // sticky once true
    // A word first seen mid-frequency then seen rare keeps the better
    // (lower) group.
    existing.rankGroup = Math.min(existing.rankGroup, sighting.rankGroup) as RankGroup;
    // isSubword intentionally NOT merged — fixed at creation.
    this.evictIfOverCap(); // unconditional but guarded: free below the cap
  }

  /** Overflow eviction (PRD §06 h2.37, §05 h2.33): when the store exceeds
   *  STORE_CAP, delete exactly `size - STORE_CAP` candidates — always the
   *  lowest `evictionScore` ones (score.ts's salience decayed by the
   *  slower τ = 50 clock, imported here so the math has one source of
   *  truth). Runs at the tail of every upsert: live ingest (P1.M3.T2.S2)
   *  and restore replay (P1.M3.T2.S3) never call eviction themselves —
   *  upsert alone keeps the store bounded.
   *
   *  Batch semantics (settled reading of h2.37): "batches of 256"
   *  amortizes victim SELECTION — one snapshot + sort serves the whole
   *  drop (EVICT_BATCH is §06's amortization granularity). The per-
   *  overflow victim count is exactly `needed`: PRD §09's acceptance
   *  contract ("insert 20,001 → exactly one eviction", size back to
   *  STORE_CAP) forbids rounding the count up to EVICT_BATCH.
   *
   *  userTyped entries are excluded from the victim pool entirely unless
   *  the evictable pool cannot cover the overflow — the cap is hard, so
   *  a userTyped-only overflow (e.g. a restore flooding userTyped keys)
   *  still trims, lowest score first.
   *
   *  Score ties break by byte-lexicographic key order
   *  (compareCandidates's final tie-break); keys are unique per store, so
   *  victim choice is fully deterministic. Underflow note:
   *  Math.exp(-Δ/50) floors huge deltas at ~0 — ancient words score ~0
   *  and go first, byte order picking among exact-0 ties.
   *
   *  Removals set #dirty: the prefix index (h2.35) must rebuild before
   *  its next query — the obligation S2's comment reserves for eviction.
   *  Cost below the cap: the size check is the first statement, so normal
   *  ingest and ≤20k restores pay nothing. */
  private evictIfOverCap(): void {
    if (this.#map.size <= STORE_CAP) return;
    const now = this.currentOrdinal(); // one "now" for the whole pass
    const needed = this.#map.size - STORE_CAP;
    const snapshot = this.entries(); // defensive copies — sort freely
    let pool = snapshot.filter((c) => !c.userTyped);
    if (pool.length < needed) pool = snapshot; // hard cap beats protection
    // Score each candidate once, then sort by the cached score — the
    // same victims as sorting with evictionScore in the comparator,
    // without redoing the math O(n log n) times per pass.
    const scored = pool.map((c) => ({ c, score: evictionScore(c, now) }));
    scored.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.c.key < b.c.key ? -1 : a.c.key > b.c.key ? 1 : 0;
    });
    // Lowest scores = the sorted head. min() is paranoia: pool ⊆ snapshot
    // and snapshot.length === #map.size > needed always.
    for (const { c } of scored.slice(0, Math.min(needed, scored.length))) {
      this.#map.delete(c.key);
    }
    this.#dirty = true; // prefix index (h2.35) rebuilds on next query
  }

  /** PRD §06 h2.35: half-open [start, end) index range over the lazily
   *  sorted key array covering exactly the keys starting with `prefix`.
   *  The caller (query.ts) must lowercase the fragment first — an
   *  uppercase prefix can never match a lowercase key and indicates a
   *  caller bug, so we throw rather than silently return empty results.
   *
   *  Rebuild policy: dirty on new-key insert, re-sorted HERE at most once
   *  per dirtying batch (lazy — PRD §02 h3.1 keeps the keystroke path
   *  under 1 ms with no allocation-heavy ingest work). End bound = first
   *  key NOT starting with prefix, found by forward scan from `start`
   *  (O(range); ranges are short in practice — chosen over prefix-
   *  successor arithmetic for clarity and 0x7A→0x7B rollover immunity).
   *  Empty store or no match → [n, n]; "" → [0, n] (end == length is
   *  valid). This is the ONLY binary-search surface over the store —
   *  query.ts (P1.M2.T5.S1) consumes it exclusively. */
  prefixRange(prefix: string): [number, number] {
    if (prefix !== prefix.toLowerCase()) {
      throw new RangeError(`prefixRange: prefix must be lowercase, got "${prefix}"`);
    }
    if (this.#dirty) {
      // Default sort = UTF-16 code-unit order: byte-lexicographic for our
      // lowercase ASCII keys (segment.ts normalizes). No comparator —
      // localeCompare would break binary-search bounds.
      this.#sortedKeys = Array.from(this.#map.keys()).sort();
      this.#dirty = false;
    }
    const start = CandidateStore.lowerBound(this.#sortedKeys, prefix);
    const keys = this.#sortedKeys;
    let end = start;
    while (end < keys.length && keys[end].startsWith(prefix)) end++;
    return [start, end];
  }

  /** Defensive copy of the key index as of the LAST rebuild (h2.35). May
   *  be stale when new keys were upserted since — this never rebuilds.
   *  Test/inspection surface only; query logic must use prefixRange(). */
  sortedKeysSnapshot(): string[] {
    return [...this.#sortedKeys];
  }

  /** Leftmost insertion point: first index i with arr[i] >= target
   *  (canonical lower-bound semantics). Standard lo/hi loop. */
  private static lowerBound(arr: string[], target: string): number {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1; // fast floor for non-huge arrays
      if (arr[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Exact lowercase-key lookup. */
  get(key: string): Candidate | undefined {
    return this.#map.get(key);
  }

  /** Number of stored candidates (one per lowercase key). */
  get size(): number {
    return this.#map.size;
  }

  /** Defensive snapshot of all entries — shallow copies, so later upserts
   *  never mutate a previously-taken snapshot. Test/inspection surface for
   *  eviction (S3), restore replay, and /acwords. */
  entries(): Candidate[] {
    return [...this.#map.values()].map((c) => ({ ...c }));
  }

  /** Entry counts per admission group over current entries. All three keys
   *  are always present (never undefined for consumers). */
  rankGroupHistogram(): Record<RankGroup, number> {
    const counts: Record<RankGroup, number> = { 0: 0, 1: 0, 2: 0 };
    for (const c of this.#map.values()) counts[c.rankGroup]++;
    return counts;
  }

  // ── Phrase layer (P2.M1.T1.S1, PRD §06 M2) ─────────────────────────────

  /** Record consecutive-token n-grams (PRD §06 M2): for each line, upsert
   *  every bigram (n = 2) and trigram (n = 3) window of ADJACENT admitted
   *  whole-token keys. Lines arrive pre-split by the ingest pipeline — a
   *  newline is the only window break, and this method never looks for
   *  one; it only joins whatever keys a line carries (keys are lowercase
   *  by the pipeline's contract; they are joined with single spaces and
   *  used as given). A line shorter than 2 keys forms no windows; empty
   *  lines are fine and form none. Windows overlap by design: "a b c"
   *  yields "a b", "b c", and "a b c".
   *
   *  Upsert semantics mirror the word store's h2.36 contract: absent →
   *  create { count: 1, firstSeenOrdinal = lastSeenOrdinal = ordinal,
   *  sticky: false }; present → count++, lastSeenOrdinal = ordinal
   *  (firstSeenOrdinal frozen, sticky untouched — P2.M1.T2.S1 sets it).
   *  The ordinal is supplied by the caller (the pipeline stamps one per
   *  message); this method never advances the counter. On overflow the
   *  map trims back to PHRASE_CAP via evictPhrasesIfOverCap() — once per
   *  call, at the tail, never per upsert. Phrase writes never touch the
   *  word map or the prefix index. */
  recordPhraseLines(lines: readonly string[][], ordinal: number): void {
    for (const line of lines) {
      for (let i = 0; i < line.length; i++) {
        if (i + 1 < line.length) {
          this.#upsertPhrase(`${line[i]} ${line[i + 1]}`, ordinal);
        }
        if (i + 2 < line.length) {
          this.#upsertPhrase(`${line[i]} ${line[i + 1]} ${line[i + 2]}`, ordinal);
        }
      }
    }
    this.#evictPhrasesIfOverCap(); // bounded map (§06 M2) — no-op below cap
  }

  /** Phrase upsert (h2.36 semantics, phrase side): create on first sight,
   *  merge otherwise. Unlike word upsert there is no #dirty to maintain —
   *  phrases are invisible to the prefix index. */
  #upsertPhrase(key: string, ordinal: number): void {
    const existing = this.#phrases.get(key);
    if (!existing) {
      const entry: PhraseEntry = {
        key,
        count: 1,
        lastSeenOrdinal: ordinal,
        firstSeenOrdinal: ordinal,
        sticky: false, // only admission (P2.M1.T2.S1) ever sets this
      };
      this.#phrases.set(key, entry);
      this.#bumpSuccessorFor(key); // successor tail (PRD §06 h3.9)
      this.#admitPhrase(key, entry); // admission tail (PRD §06 h3.7)
      return;
    }
    existing.count++;
    existing.lastSeenOrdinal = ordinal;
    // firstSeenOrdinal stays frozen at creation; sticky is untouched —
    // except through admission, immediately below.
    this.#bumpSuccessorFor(key); // successor tail (PRD §06 h3.9)
    this.#admitPhrase(key, existing);
  }

  /** Successor-index maintenance for one upserted phrase key (P2.M2.T1.S1,
   *  PRD §06 h3.9): exactly-two-word keys are bigrams and bump w1 → w2;
   *  trigrams (and anything longer) are no-ops. The single-space guard is
   *  exact because keys are lowercase single-space joins by construction.
   *  Runs at the tail of EVERY phrase upsert, AFTER the create-or-bump so
   *  the entry count is final — one O(1)-ish bump, never a scan over
   *  #phrases (§05 h2.34), and never on the keystroke path. */
  #bumpSuccessorFor(key: string): void {
    const sp = key.indexOf(" ");
    if (sp !== -1 && sp === key.lastIndexOf(" ")) {
      this.#bumpSuccessor(key.slice(0, sp), key.slice(sp + 1));
    }
  }

  /** Bump-or-insert w2 in w1's successor array, keeping the array sorted
   *  count-descending with byte-lex ascending `next` on equal counts at
   *  ALL times (so topSuccessors() stays a pure O(1) read for the chain
   *  machine, P2.M2.T2.S1). A bump can only move its entry toward the
   *  head — counts never shrink; a fresh successor inserts at its sorted
   *  position. Arrays hold ≤ 3 entries before insertion, so both shifts
   *  are bounded constant work. On overflow (length 4) the sorted TAIL
   *  drops: the lowest count and, on a count tie, the byte-lex LARGER
   *  word. A newcomer therefore needs a strictly better sort key than the
   *  incumbent worst to displace it — the PRD §06 h3.9 contract case
   *  (three incumbents, then a 4th distinct successor at count 1) never
   *  surfaces the newcomer, deterministically. */
  #bumpSuccessor(w1: string, w2: string): void {
    const arr = this.#successorIndex.get(w1);
    if (arr === undefined) {
      this.#successorIndex.set(w1, [{ next: w2, count: 1 }]);
      return;
    }
    const existing = arr.find((s) => s.next === w2);
    if (existing !== undefined) {
      existing.count++;
      let i = arr.indexOf(existing);
      while (i > 0 && successorBefore(existing, arr[i - 1])) {
        arr[i] = arr[i - 1];
        arr[i - 1] = existing;
        i--;
      }
      return;
    }
    const entry: Successor = { next: w2, count: 1 };
    let pos = arr.length;
    while (pos > 0 && successorBefore(entry, arr[pos - 1])) pos--;
    arr.splice(pos, 0, entry);
    if (arr.length > 3) arr.length = 3; // drop the sorted tail (see above)
  }

  /** Hybrid phrase admission (P2.M1.T2.S1, PRD §06 h3.7), run at the tail
   *  of EVERY phrase upsert — never as a scan over the map (§05 h2.34;
   *  the ingest path stays O(1)-ish per upserted phrase). Decision table
   *  (count = the entry's post-upsert count):
   *
   *    count ≥ 2, fast-path provenance present → candidate + sticky
   *    count ≥ 2, no provenance                → candidate (repetition)
   *    count = 1, all-rare key, ≤ 5 words      → candidate + provenance
   *    count = 1, otherwise                    → nothing
   *
   *  The fast path is FIRST-SIGHT ONLY: eligibility is evaluated exactly
   *  once (count first hitting 1 with provenance absent). A phrase that
   *  failed it and later recurs is admitted by the repetition path alone
   *  — never retro-re-evaluated, because constituents' rankGroups drift
   *  via min-merge and the PRD pins the rule to first sight. sticky is
   *  set through setPhraseSticky — once true it is never unset (mirrors
   *  userTyped OR-in semantics). Cost: O(1) set work plus, on the fast
   *  path only, ≤ 5 word-store lookups (see #firstSightFastPathEligible). */
  #admitPhrase(key: string, entry: PhraseEntry): void {
    if (entry.count >= 2) {
      // Repetition path — admits regardless of constituent rarity. When
      // the fast path had admitted this key earlier, BOTH paths have now
      // fired → sticky (resists eviction via the victim-pool filter).
      if (this.#fastPathAdmitted.has(key)) this.setPhraseSticky(key);
      this.#phraseCandidates.add(key);
    } else if (
      !this.#fastPathAdmitted.has(key) && this.#firstSightFastPathEligible(key)
    ) {
      // Fast path — first sight of an all-rare key admits immediately.
      this.#phraseCandidates.add(key);
      this.#fastPathAdmitted.add(key); // provenance for T2.S2's sweep
    }
  }

  /** Fast-path eligibility (PRD §06 h3.7): EVERY constituent word of the
   *  key must currently be a word-store Candidate with rankGroup 0
   *  (dictionary-absent, shape-gated) or properName true, and the key
   *  must be ≤ 5 words. A constituent ABSENT from the word store (never
   *  admitted, or since evicted) FAILS the path — candidacy must be
   *  provable, never assumed. Keys arrive lowercase single-space-joined,
   *  so split(" ") is exact. O(words-in-key) ≤ 5 lookups, no scans. */
  #firstSightFastPathEligible(key: string): boolean {
    const words = key.split(" ");
    // Length bound is defense-in-depth: capture produces ≤ 3-word keys
    // today (bigrams + trigrams), but admission must stay correct for n.
    if (words.length > 5) return false;
    return words.every((w) => {
      const c = this.get(w);
      return c !== undefined && (c.rankGroup === 0 || c.properName);
    });
  }

  /** Phrase-map overflow eviction — the word store's evictIfOverCap
   *  pattern (PRD §06 M2 inherits §06 h2.37) with two substitutions:
   *  the victim pool excludes `sticky` (not userTyped) entries, and the
   *  score is phraseEvictionScore (above) instead of score.ts's
   *  Candidate-typed evictionScore. Everything else is identical:
   *  early size return, snapshot via phraseEntries(), fall back to the
   *  full snapshot when the protected filter leaves fewer than `needed`,
   *  score-once-then-sort ascending with a byte-lexicographic key
   *  tie-break (keys are unique per map, so victims are deterministic),
   *  and exactly `size - PHRASE_CAP` deletions — never rounded up to
   *  PHRASE_EVICT_BATCH (PRD §09). Removals mark nothing dirty: the
   *  word prefix index is unaffected by phrase eviction. */
  #evictPhrasesIfOverCap(): void {
    if (this.#phrases.size <= PHRASE_CAP) return;
    const now = this.currentOrdinal(); // one "now" for the whole pass
    const needed = this.#phrases.size - PHRASE_CAP;
    const snapshot = this.phraseEntries(); // defensive copies — sort freely
    let pool = snapshot.filter((p) => !p.sticky);
    if (pool.length < needed) pool = snapshot; // hard cap beats protection
    // Score each entry once, then sort by the cached score (float asc,
    // byte-lex key tie-break) — the same victims as sorting with the
    // score in the comparator, without recomputing it per comparison.
    const scored = pool.map((p) => ({ p, score: phraseEvictionScore(p, now) }));
    scored.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.p.key < b.p.key ? -1 : a.p.key > b.p.key ? 1 : 0;
    });
    // Lowest scores = the sorted head. min() is paranoia: pool ⊆ snapshot
    // and snapshot.length === #phrases.size > needed always.
    for (const { p } of scored.slice(0, Math.min(needed, scored.length))) {
      this.#phrases.delete(p.key);
      this.#dropSuccessorFor(p.key); // successor cleanup (P2.M2.T1.S1)
    }
  }

  /** Eviction-side successor cleanup (P2.M2.T1.S1, PRD §06 h3.9): when a
   *  deleted phrase key is a bigram, its Successor is spliced out of w1's
   *  array — and w1's map entry dies with the last one. NO backfill: no
   *  4th-best is promoted and nothing is recomputed (a dropped successor
   *  returns only when its bigram recurs; the survivors' counts stay
   *  correct because they were counted independently). Trigram evictions
   *  are no-ops. The findIndex miss-guard is load-bearing: a bigram whose
   *  successor lost the top-3 cap long ago evicts without an entry to
   *  splice. Unknown word → no-op. */
  #dropSuccessorFor(key: string): void {
    const sp = key.indexOf(" ");
    if (sp === -1 || sp !== key.lastIndexOf(" ")) return; // bigrams only
    const arr = this.#successorIndex.get(key.slice(0, sp));
    if (arr === undefined) return;
    const w2 = key.slice(sp + 1);
    const i = arr.findIndex((s) => s.next === w2);
    if (i !== -1) arr.splice(i, 1);
    if (arr.length === 0) this.#successorIndex.delete(key.slice(0, sp));
  }

  /** Mark one phrase sticky (PRD §06 M2): sticky resists eviction exactly
   *  like userTyped words. Creation and refresh never set this — P2.M1.T2.S1
   *  admission is the only writer; it ships now because admission and this
   *  task's eviction tests both need it. Unknown key → no-op (never creates). */
  setPhraseSticky(key: string): void {
    const entry = this.#phrases.get(key);
    if (entry) entry.sticky = true;
  }

  // ── Phrase admission (P2.M1.T2.S1, PRD §06 h3.7) ─────────────────────

  /** Is `key` currently a completion candidate (PRD §06 h3.7)? Candidacy
   *  is orthogonal to counts: removePhraseCandidacy can drop it while
   *  getPhrase(key).count stays. P2.M1.T3.S1 (query integration) reads
   *  this. */
  isPhraseCandidate(key: string): boolean {
    return this.#phraseCandidates.has(key);
  }

  /** Defensive snapshot of the candidate phrase keys, in admission order.
   *  Mutating the returned array never touches the store. Consumed by
   *  P2.M1.T3.S1 and the /acwords M2 dump. */
  phraseCandidateKeys(): string[] {
    return [...this.#phraseCandidates];
  }

  /** Did the fast path admit this phrase (PRD §06 h3.7)? Provenance for
   *  T2.S2's demotion sweep — fast-path admits are the ones it re-
   *  examines — also surfaced for /acwords. False for repetition-only
   *  phrases and after removePhraseCandidacy (provenance is cleared and
   *  never re-derived: the fast path is first sight only). */
  isFastPathPhrase(key: string): boolean {
    return this.#fastPathAdmitted.has(key);
  }

  /** Demotion primitive (PRD §06 h3.7): drop candidacy and fast-path
   *  provenance ONLY. #phrases counts, ordinals, and sticky are untouched
   *  — once sticky, always sticky (same never-unset semantics as
   *  userTyped). Called by T2.S2's 40-ordinal demotion sweep; a later
   *  recurrence re-admits through the repetition path's live count ≥ 2
   *  check. Unknown key → no-op (never creates anything). */
  removePhraseCandidacy(key: string): void {
    this.#phraseCandidates.delete(key);
    this.#fastPathAdmitted.delete(key);
  }

  /** 40-ordinal demotion sweep (P2.M1.T2.S2, PRD §06 h3.7): demote every
   *  fast-path phrase candidate that never reached count ≥ 2 within 40
   *  SUBSEQUENT message ordinals. A key is demoted when ALL of: it is a
   *  candidate with fast-path provenance (repetition-confirmed candidates
   *  are never demoted), its entry count < 2 and not sticky (belt-and-
   *  braces: sticky implies count ≥ 2), and
   *  currentOrdinal() − firstSeenOrdinal ≥ 40 (firstSeen 1, now 41 →
   *  demoted; now 40 → still on probation — "40 subsequent ordinals",
   *  not "more than 40"). Demotion itself is removePhraseCandidacy:
   *  candidacy + provenance drop, counts/ordinals/sticky stay, so a later
   *  recurrence re-admits through the repetition path (provenance is gone,
   *  the fast path is first-sight only — never sticky again).
   *
   *  O(candidates): iterates phraseCandidateKeys() — a snapshot COPY, so
   *  removing entries mid-loop is safe — never the #phrases counts map
   *  (tens of thousands of counted n-grams vs a small candidate set).
   *  Per key: two O(1) set lookups + one getPhrase lookup. Wired by the
   *  ingest pipeline at the tail of each flush drain (once per flush, not
   *  per message); a second consecutive call finds nothing left to demote.
   *  @returns number of phrases demoted (for stats/tests). */
  sweepPhraseDemotions(): number {
    const now = this.currentOrdinal(); // one "now" for the whole pass
    let demoted = 0;
    for (const key of this.phraseCandidateKeys()) {
      // Snapshot copy — safe to remove while iterating.
      if (!this.isFastPathPhrase(key)) continue; // repetition-only: keep
      const entry = this.getPhrase(key); // O(1) map lookup
      if (entry === undefined) continue; // defensive; shouldn't happen
      if (entry.sticky || entry.count >= 2) continue; // confirmed: keep
      if (now - entry.firstSeenOrdinal >= 40) {
        this.removePhraseCandidacy(key); // keeps counts/ordinals/sticky
        demoted++;
      }
    }
    return demoted;
  }

  /** Exact phrase-key lookup ("word word" joined lowercase). Returns the
   *  LIVE entry — treat as read-only (same contract as get()). */
  getPhrase(key: string): PhraseEntry | undefined {
    return this.#phrases.get(key);
  }

  /** Top bigram successors of `word` (PRD §06 h3.9), best first: ordered
   *  count-descending with byte-lex ascending ties, at most 3 entries,
   *  built incrementally at INGEST inside #upsertPhrase — so this is a
   *  pure O(1) read for the keystroke path (the chained completion
   *  machine, P2.M2.T2.S1, calls it per keystroke). Returns the LIVE
   *  array — treat as read-only (same contract as get()/getPhrase()); an
   *  unseen word gets the shared NO_SUCCESSORS constant, so a miss
   *  allocates nothing. */
  topSuccessors(word: string): readonly Successor[] {
    return this.#successorIndex.get(word) ?? NO_SUCCESSORS;
  }

  /** Number of stored phrases (one per joined key). */
  get phraseSize(): number {
    return this.#phrases.size;
  }

  /** Defensive snapshot of all phrase entries — shallow copies, so later
   *  records never mutate a previously-taken snapshot. Test/inspection
   *  surface for eviction and /acwords. */
  phraseEntries(): PhraseEntry[] {
    return [...this.#phrases.values()].map((p) => ({ ...p }));
  }

  /** Live iteration over the phrase map's entries (Map values iterator:
   *  the yielded objects are the stored entries themselves, so mutations
   *  made after this call — including entries recorded mid-iteration — are
   *  visible). P2.M1.T2.S1 iterates for admission; P2.M2.T1.S1 reads
   *  bigram counts; /acwords (M2) dumps. Callers that need a stable view
   *  must copy (phraseEntries()). */
  iteratePhrases(): IterableIterator<PhraseEntry> {
    return this.#phrases.values();
  }
}
/**
 * Store — stage 4 of the segment → shapeGate → score → store → query
 * pipeline (PRD §06): the per-session candidate map. One entry per
 * lowercase key — casing variants ("Hapax", "hapax", "HAPAX") merge into
 * a single entry whose insertion form is derived AT COMPLETION TIME from
 * the casing tallies (capCount/lowerCount/capDisplay) by query.ts's
 * resolveCompletionCasing (spec 04 h2.32, PRD R2.1) — recency never
 * decides it, and no display field is stored.
 *
 * UPSERT SEMANTICS (h2.36, verbatim contract):
 *
 *   Absent  → create { key, casing tallies, sessionCount: 1,
 *             firstSeenOrdinal, lastSeenOrdinal, userTyped, properName,
 *             rankGroup }.
 *   Present → mutate in place: sessionCount++, lastSeenOrdinal = ordinal,
 *             casing tallies accumulate (capCount/lowerCount/capDisplay
 *             per h2.43 — the completion-time resolver's input),
 *             userTyped / properName OR-in (sticky once true, never
 *             unset), rankGroup = min(existing, new) — a word first seen
 *             mid-frequency then seen rare keeps the better (lower)
 *             group.
 *
 * ORDINAL: the pipeline assigns message ordinals (P1.M3.T2) — it calls
 * nextOrdinal() ONCE per message BEFORE processing that message's
 * sightings and stamps them into each Sighting. upsert never advances the
 * counter; nextOrdinal() starts at 1 and is strictly monotonic, never
 * reset. currentOrdinal() is the read-only view for consumers (eviction,
 * P1.M2.T4.S3; restore replay, P1.M3.T2.S3; /acwords, P1.M3.T4.S1).
 *
 * PREFIX INDEX (P1.M2.T4.S2, PRD §06 h2.35): a sorted array of lowercase
 * keys maintained by AMORTIZED consolidation (the cold-start fix): new-key
 * inserts only push to #pending; upsert merges the pending list into the
 * sorted array in INDEX_MERGE_BATCH-sized chunks, and a query merges the
 * ≤-batch tail (O(n + m log m), tens of µs at the 20k cap) before
 * binary-searching the prefix range. Insert stays O(1) and the query is
 * O(log n + range) — the index never hands a whole-array re-sort to the
 * keystroke path. (The old dirty-flag lazy rebuild — re-sort all 20k keys
 * on the first query after a dirtying batch — put a measured 1.4–3.3 ms
 * cold p99 on that first query, over the PRD §02 h3.1 1 ms budget.)
 * Array.sort's default UTF-16 code-unit order is byte-lexicographic for
 * lowercase ASCII keys; consolidation preserves it.
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
 * BIGRAM MAP (PRD §06 h2.38, delta R1): a slim count map keyed
 * "first second" (lowercase, single-space-joined) → { count,
 * lastSeenOrdinal } — no admission, no sticky, no demotion, no trigrams.
 * recordBigramRuns() upserts every ADJACENT pair of consecutive admitted
 * whole-token keys within one line (the ingest pipeline splits lines; a
 * newline is the only window break): absent → create { count: 1,
 * lastSeenOrdinal }, present → count++ + lastSeen refresh. The map is
 * capped at BIGRAM_CAP = 10,000 keys with lazy-heap eviction
 * (#evictBigramsIfOverCap); evicting a bigram ALSO splices it from the
 * successor index. Phrase candidacy — admission, sticky, fast paths,
 * demotion sweeps — is a REMOVED design (PRD 002 delta R1): the only
 * phrase behavior is successor chaining.
 *
 * SUCCESSOR INDEX (P2.M2.T1.S1, PRD §06 h3.9): every bigram bumps
 * w1 → w2 in #successorIndex at INGEST time, inside recordBigramRuns —
 * never via a map-wide scan (§05 h2.34) and never on the keystroke
 * path. Each word keeps at most 3 successors, ordered count-descending
 * with byte-lex ties; on overflow the sorted tail drops and eviction
 * never backfills it (a dropped successor returns only when its bigram
 * recurs). topSuccessors() is a pure O(1) read returning the live array
 * (read-only contract) or the shared NO_SUCCESSORS constant.
 */

import { evictionScore } from "./score.js";
import type {
  Candidate,
  RankGroup,
  Sighting,
  Successor,
} from "./types.js";

/** Hard cap on stored word candidates (every candidate is a whole token
 *  since the 2026-10 atomic-identifier rule). PRD §06 h2.37; baked, not
 *  config (PRD §08 h2.47). */
export const STORE_CAP = 20_000;
/** Eviction batch size: the snapshot + sort that selects victims is
 *  amortized over drops of this many entries (PRD §06 h2.37: "Evict in
 *  batches of 256 (sort snapshot, drop tail) to amortize cost"; baked per
 *  §08 h2.47). Every overflow pass rounds its victim count UP to a whole
 *  batch (bounded by the pool size), so a pass runs at most once per
 *  EVICT_BATCH new distinct keys — never per upsert — while the post-
 *  eviction size stays ≤ STORE_CAP (drop ≥ exact overflow). */
export const EVICT_BATCH = 256;

/** Prefix-index consolidation batch (h2.35 amortization): upsert merges
 *  the pending-new-key list into the sorted index whenever it reaches this
 *  many keys, and a query merges only the sub-batch tail (≤ batch − 1).
 *  Same pacing philosophy as EVICT_BATCH: bounded O(n) merges amortized
 *  over ingest — never an O(n log n) whole-index re-sort on the keystroke
 *  path. Baked, not config (PRD §08 h2.47). */
export const INDEX_MERGE_BATCH = 256;

/** Hard cap on stored bigrams (PRD §06 h2.38: "Cap the bigram map at
 *  10,000 keys"). Baked, not config (PRD §08 h2.47). The word store's
 *  cap is INDEPENDENT — bigram eviction never evicts words. */
const BIGRAM_CAP = 10_000;
/** Bigram eviction batch: each eviction ROUND pops at most this many
 *  victims, pacing heap work; rounds repeat within one recordBigramRuns
 *  call until the map is within BIGRAM_CAP (same-call cap guarantee,
 *  BUG-006 fix — the batch is the pacing unit, not a cap on total work;
 *  the §06 h2.37 "batches of 256" amortization is preserved per round). */
const BIGRAM_EVICT_BATCH = 256;

/** One bigram's counted state (PRD §06 h2.38): "first second" → this.
 *  No firstSeenOrdinal, no sticky — the delta design keeps only what
 *  eviction needs. */
interface BigramEntry {
  /** occurrences of this exact word pair this session */
  count: number;
  /** message ordinal at last occurrence */
  lastSeenOrdinal: number;
}

/** Bigram eviction key — the log domain of the phrase-era eviction score
 *  `count · exp(-(now - lastSeen) / 50)`:
 *
 *      log(score) = log(count) - now/50 + lastSeenOrdinal/50
 *
 *  At any single eviction pass `now` is one constant, so ordering by
 *  `k = log(count) + lastSeenOrdinal/50` is EXACTLY the ordering by
 *  score (same floats for exact ties → the same byte-lex tie-break).
 *  Unlike the score itself, `k` does not move as the session clock
 *  advances — only a MUTATION of the entry (count++ / lastSeen refresh)
 *  changes it — which is what lets the eviction index (#bigramEvictHeap)
 *  go stale lazily and re-validate at pop instead of the map paying a
 *  full O(n log n) sort per overflow pass. count ≥ 1 always, so log is
 *  finite. There is no sticky protection: the bigram map has no
 *  admission layer (PRD 002 delta R1), so every entry is evictable. */
function bigramSortKey(e: BigramEntry): number {
  return Math.log(e.count) + e.lastSeenOrdinal / 50;
}

/** Successor sort key (PRD §06 h3.9): higher count first, byte-lex
 *  ascending `next` on equal counts — the eviction comparators' inline
 *  `a < b ? -1 : …` style as a strict "a sorts before b" predicate, used
 *  by #bumpSuccessor's bounded in-place shifts. */
function successorBefore(a: Successor, b: Successor): boolean {
  if (a.count !== b.count) return a.count > b.count;
  return a.next < b.next;
}

// ── Eviction index (bigram map) ────────────────────────────────────────────

/** One node of the bigram eviction index: `k` is the entry's log-domain
 *  eviction key (see #bigramSortKey) as of when the node was written,
 *  `key` the bigram key. Nodes go stale when their entry is mutated
 *  (count/lastSeen move k) or evicted; pops re-validate against the live
 *  entry and re-push corrected nodes, so the heap never needs per-mutation
 *  maintenance and a pass costs O(victims · log n) — never a full-map
 *  sort (PRD §06 h2.37's amortization, taken to its conclusion). */
type EvictNode = { k: number; key: string };

/** Heap order: ascending k (lowest eviction score first), byte-lex
 *  ascending key on exact-tie k — the SAME total order the previous
 *  snapshot sort used (score asc, key asc), so victim choice is
 *  bit-identical. */
function evictNodeBefore(a: EvictNode, b: EvictNode): boolean {
  if (a.k !== b.k) return a.k < b.k;
  return a.key < b.key;
}

/** Standard binary min-heap push (sift-up). Swaps use a temp — tuple
 *  destructuring allocates per swap and this sits on the ingest hot path. */
function heapPush(heap: EvictNode[], node: EvictNode): void {
  heap.push(node);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!evictNodeBefore(heap[i], heap[parent])) break;
    const t = heap[i];
    heap[i] = heap[parent];
    heap[parent] = t;
    i = parent;
  }
}

/** Standard binary min-heap pop (sift-down); undefined when empty. */
function heapPop(heap: EvictNode[]): EvictNode | undefined {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length > 0 && last !== undefined) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && evictNodeBefore(heap[l], heap[m])) m = l;
      if (r < heap.length && evictNodeBefore(heap[r], heap[m])) m = r;
      if (m === i) break;
      const t = heap[i];
      heap[i] = heap[m];
      heap[m] = t;
      i = m;
    }
  }
  return top;
}

/** Shared empty successor array (PRD §06 h3.9): topSuccessors() hands
 *  this constant to every unseen-word caller, so a keystroke-path miss
 *  allocates nothing — one frozen array for the whole process. */
const NO_SUCCESSORS: readonly Successor[] = Object.freeze([]);

/** Per-session word-candidate store (PRD §06). Pure in-memory Map from
 *  lowercase key → Candidate, plus the session's message ordinal counter. */
export class CandidateStore {
  #map = new Map<string, Candidate>();
  // Casing-tally side map (spec 06 h2.41/h2.43, plan 006): key → (display
  // form → count) for the capDisplay argmax. NOT part of Candidate — the
  // spec's shape carries only the tallies; per-form counts are store-
  // internal evidence. Lifecycle mirrors #map exactly: entries are born
  // on a key's first mid-cap sighting and deleted in evictIfOverCap's
  // drop path (a re-created key must never inherit stale form counts).
  #capForms = new Map<string, Map<string, number>>();
  #ordinal = 0; // last issued message ordinal (0 = none issued yet)
  #sortedKeys: string[] = []; // key index as of the LAST consolidation
  // New keys upserted since the last consolidation. Pushed O(1) by upsert;
  // merged into #sortedKeys in INDEX_MERGE_BATCH chunks inside upsert, with
  // the < INDEX_MERGE_BATCH tail merged by the next prefixRange() — the
  // cold-start fix: no single query ever pays a full O(n log n) re-sort of
  // a 20k-key index (the old dirty-flag rebuild landed ~5 ms on the FIRST
  // keystroke after ingest/restore, over the §02 h3.1 1 ms query budget).
  #pending: string[] = [];
  // Evicted keys that may still linger in #sortedKeys as ghosts since the
  // last consolidation. Ghosts are correct by construction — query.ts skips
  // keys whose get() is undefined — and every consolidation filters them
  // through the live map, so the index stays bounded by the live map.
  // Counted (not listed): evictions only fire on new-key inserts, so a
  // consolidation is already imminent whenever a tombstone can exist.
  #tombstones = 0;
  // Bigram map (PRD §06 h2.38): "first second" → { count, lastSeenOrdinal }.
  // Deliberately NOT under #dirty: nothing about #bigrams ever invalidates
  // the WORD prefix index.
  #bigrams = new Map<string, BigramEntry>();
  // Successor index (P2.M2.T1.S1, PRD §06 h3.9): word → its top-3 most
  // frequent bigram successors, ordered count-desc / byte-lex-asc, never
  // longer than 3 entries. Maintained INCREMENTALLY inside recordBigramRuns
  // (one bump per bigram window — no scans, §05 h2.34; nothing runs on the
  // keystroke path) and cleaned by #evictBigramsIfOverCap when an evicted
  // key is a bigram. Read O(1) via topSuccessors().
  #successorIndex = new Map<string, Successor[]>();
  // Bigram eviction index (see EvictNode): a lazy min-heap over the live
  // bigram entries ordered by #bigramSortKey. Built on first overflow,
  // pushed on every bigram CREATE (mutation needs nothing — pops
  // re-validate), and rebuilt when stale-node dirt exceeds the live map.
  #bigramEvictHeap: EvictNode[] | null = null;

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

  /** Record one admitted occurrence (PRD §06 h2.36; casing tallies per
   *  spec 06 h2.43, plan 006). Creates the entry on first sight, merges
   *  into it otherwise. The ordinal arrives inside the Sighting — this
   *  method never advances the counter. O(1) below the cap; on overflow
   *  it trims back to STORE_CAP via evictIfOverCap().
   *
   *  Casing tallies (capCount/lowerCount/capDisplay) accumulate per the
   *  sighting's casing class: sessionCount counts BOTH casings (tallies
   *  are evidence, not occurrence counts), and the tallies never gate
   *  the occurrence bookkeeping — a dropped structural sighting is
   *  dropped from TALLIES only. Chain-only members (dictionary top-band,
   *  P1.M1.T3.S1) never reach upsert — no guard here by contract.
   *
   *  MODE A (spec 04 h2.32, PRD R2.1): casing lives ONLY in the tallies
   *  — there is no stored display and no recency merge (the legacy
   *  "most recent casing wins" write is gone). The completion-time
   *  resolver in query.ts (resolveCompletionCasing) derives the insertion
   *  form from the tallies + the live fragment's first letter. */
  upsert(sighting: Sighting): void {
    const existing = this.#map.get(sighting.key);
    if (!existing) {
      // Tally initialization per casing class (spec 06 h2.43 create row):
      // mid-cap seeds its form count (the capDisplay argmax evidence);
      // structural seeds the pending-structural counter (purgeable);
      // lower starts everything at zero/empty. structuralCapCount stays
      // UNDEFINED at 0 — absent ≡ zero keeps the optional field honest.
      const tallies =
        sighting.casing === "mid-cap"
          ? {
              capCount: 1,
              lowerCount: 0,
              capDisplay: sighting.display,
            }
          : sighting.casing === "structural-cap"
            ? {
                capCount: 1,
                lowerCount: 0,
                capDisplay: "",
                structuralCapCount: 1,
              }
            : { capCount: 0, lowerCount: 1, capDisplay: "" };
      this.#map.set(sighting.key, {
        key: sighting.key,
        ...tallies,
        sessionCount: 1,
        lastSeenOrdinal: sighting.ordinal,
        firstSeenOrdinal: sighting.ordinal,
        userTyped: sighting.fromUser,
        properName: sighting.properName,
        rankGroup: sighting.rankGroup,
      });
      if (sighting.casing === "mid-cap") {
        this.#capForms.set(
          sighting.key,
          new Map([[sighting.display, 1]]),
        );
      }
      // New key — the prefix index (h2.35) picks it up at the next
      // consolidation. Deliberately NOT sorted here: the key is parked in
      // #pending and merged in INDEX_MERGE_BATCH chunks (here, and the tail
      // at the next prefixRange) — a 20k restore replay pays ~80 bounded
      // linear merges inside the ingest it already budgeted, instead of
      // handing one ~5 ms whole-index re-sort to the FIRST keystroke after
      // the replay (PRD §02 h3.1 1 ms query budget).
      this.#pending.push(sighting.key);
      if (this.#pending.length >= INDEX_MERGE_BATCH) this.#consolidate();
      this.evictIfOverCap(); // bounded store (§06 h2.37) — no-op below cap
      return;
    }
    existing.sessionCount++;
    existing.lastSeenOrdinal = sighting.ordinal;
    existing.userTyped ||= sighting.fromUser; // sticky once true
    existing.properName ||= sighting.properName; // sticky once true
    // A word first seen mid-frequency then seen rare keeps the better
    // (lower) group.
    existing.rankGroup = Math.min(existing.rankGroup, sighting.rankGroup) as RankGroup;
    // Casing-tally merge (spec 06 h2.43) — AFTER the occurrence
    // bookkeeping above, so a dropped structural sighting is dropped
    // from TALLIES only.
    switch (sighting.casing) {
      case "lower": {
        existing.lowerCount++;
        if (existing.structuralCapCount) {
          // Twin suppression: structural contributions vanish wholesale —
          // SUBTRACTIVELY via the pending-structural counter (the raw
          // sightings are gone; never recompute). PERMANENT: once
          // lowerCount > 0, no path resurrects them.
          existing.capCount -= existing.structuralCapCount;
          existing.structuralCapCount = 0;
        }
        break;
      }
      case "mid-cap": {
        existing.capCount++;
        const forms = this.#capForms.get(existing.key) ?? new Map();
        const f = (forms.get(sighting.display) ?? 0) + 1;
        forms.set(sighting.display, f);
        this.#capForms.set(existing.key, forms);
        // capDisplay argmax; ties → the most recently bumped form (>=
        // against the CURRENT capDisplay's count, which is still in
        // `forms`). Structural forms never compete — they never touch
        // #capForms and never set capDisplay.
        if (
          existing.capDisplay === "" ||
          f >= (forms.get(existing.capDisplay) ?? 0)
        ) {
          existing.capDisplay = sighting.display;
        }
        break;
      }
      case "structural-cap":
        if (existing.lowerCount === 0) {
          existing.capCount++;
          existing.structuralCapCount = (existing.structuralCapCount ?? 0) + 1;
        }
        // else: dropped entirely from the tallies — the lowercase form is
        // the word (spec 06 h2.43 twin suppression, permanent);
        // sessionCount/display/flags above still applied.
        break;
    }
    this.evictIfOverCap(); // unconditional but guarded: free below the cap
  }

  /** Overflow eviction (PRD §06 h2.37, §05 h2.33): when the store exceeds
   *  STORE_CAP, delete candidates — always the lowest `evictionScore` ones
   *  (score.ts's salience decayed by the slower τ = 50 clock, imported here
   *  so the math has one source of truth) — until the store is back within
   *  the cap. Runs at the tail of every upsert: live ingest (P1.M3.T2.S2)
   *  and restore replay (P1.M3.T2.S3) never call eviction themselves —
   *  upsert alone keeps the store bounded.
   *
   *  Batch semantics (PRD §06 h2.37: "Evict in batches of 256 (sort
   *  snapshot, drop tail) to amortize cost"): each pass rounds the exact
   *  overflow UP to a whole batch — victims = max(size − STORE_CAP,
   *  EVICT_BATCH), bounded by the pool size — so one snapshot + sort
   *  serves ≥ EVICT_BATCH drops and a pass can run at most once per
   *  EVICT_BATCH new distinct keys, never per upsert. This is the
   *  amortization h2.37 prescribes: without it, a session whose distinct
   *  vocabulary sits at the PRD's own estimated upper range (~10–20k
   *  uniques per 300k tokens) pays a full O(n log n) sort on EVERY
   *  over-cap insert — a multi-thousand-key flood would block the event
   *  loop for seconds inside one ≤64 KB slice, against §05's "never block
   *  a keystroke". The post-eviction size bound of the §09 acceptance
   *  contract ("insert 20,001 → exactly one eviction, lowest
   *  evictionScore; userTyped survives") still holds: drop ≥ exact
   *  overflow, so the store lands at ≤ STORE_CAP after every pass (at
   *  20,001 the single pass drops a full batch of 256, lowest-score
   *  first), and because the trigger is any overflow the store never
   *  RESTS above the cap — the steady state merely rests up to
   *  EVICT_BATCH − 1 entries below it, a 256-entry batch buffer.
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
    const size = this.#map.size;
    if (size <= STORE_CAP) return;
    const now = this.currentOrdinal(); // one "now" for the whole pass
    // Round the exact overflow UP to a whole batch (bounded by the store
    // size): drop ≥ overflow keeps the post-pass size ≤ STORE_CAP, and
    // drop ≥ EVICT_BATCH guarantees ≥ EVICT_BATCH new distinct keys
    // between passes — the amortized cost PRD §06 h2.37 prescribes.
    const drop = Math.min(Math.max(size - STORE_CAP, EVICT_BATCH), size);
    // Live references, not entries() defensive copies: the sort works on
    // a fresh wrapper array and only reads key/score synchronously, so a
    // previously-taken snapshot is never aliased and later upserts can
    // mutate the underlying entries freely. Skipping 20k+ object spreads
    // per pass matters at flood scale.
    let pool: Candidate[] = [];
    for (const c of this.#map.values()) if (!c.userTyped) pool.push(c);
    if (pool.length < drop) pool = [...this.#map.values()]; // hard cap beats protection
    // Score each candidate once, then sort by the cached score — the
    // same victims as sorting with evictionScore in the comparator,
    // without redoing the math O(n log n) times per pass.
    const scored = pool.map((c) => ({ c, score: evictionScore(c, now) }));
    scored.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.c.key < b.c.key ? -1 : a.c.key > b.c.key ? 1 : 0;
    });
    // Lowest scores = the sorted head; scored.length ≥ drop always (pool
    // ⊆ the map, and drop ≤ size = map size).
    const evicted = scored.slice(0, drop);
    for (const { c } of evicted) {
      this.#map.delete(c.key);
      // Casing-tally side map dies WITH its candidate: a re-created key
      // must never inherit stale form counts (the only #capForms leak
      // vector — entries are born only at upsert, which always creates
      // the Candidate first).
      this.#capForms.delete(c.key);
    }
    // Evicted keys linger in #sortedKeys as ghosts until the next
    // consolidation (correct: query.ts skips get() === undefined). A key
    // still sitting only in #pending is filtered through the live map by
    // the merge itself — counting it here merely consolidates one pass
    // sooner (harmless, idempotent).
    this.#tombstones += evicted.length;
  }

  /** Merge #pending into #sortedKeys and drop ghost keys in one linear
   *  pass (h2.35): the sub-batch tail left by upsert (≤ INDEX_MERGE_BATCH
   *  − 1 keys) is sorted (µs at 20k scale), then a two-pointer merge walks
   *  the old array once, keeping only keys still live in the map. Cost is
   *  O(n + m log m) with m ≤ INDEX_MERGE_BATCH — tens of µs at the 20k cap
   *  — so the keystroke path never pays the O(n log n) whole-index re-sort
   *  the old dirty-flag rebuild cost the first post-ingest query. Pending
   *  keys evicted before their merge (a brand-new key can be an eviction
   *  victim in the same pass) are filtered through the live map exactly
   *  like ghosts. Byte order: default string sort = UTF-16 code-unit order
   *  = byte-lexicographic for our lowercase ASCII keys (segment.ts
   *  normalizes); no comparator — localeCompare would break the binary
   *  search bounds. */
  #consolidate(): void {
    const pending = this.#pending;
    if (pending.length !== 0) pending.sort();
    const map = this.#map;
    const old = this.#sortedKeys;
    const merged: string[] = [];
    let i = 0;
    let j = 0;
    while (i < old.length && j < pending.length) {
      const a = old[i]!;
      const b = pending[j]!;
      if (a < b) {
        if (map.has(a)) merged.push(a);
        i++;
      } else if (a > b) {
        if (map.has(b)) merged.push(b);
        j++;
      } else {
        if (map.has(a)) merged.push(a); // ghost + pending duplicate: keep one
        i++;
        j++;
      }
    }
    for (; i < old.length; i++) {
      const a = old[i]!;
      if (map.has(a)) merged.push(a);
    }
    for (; j < pending.length; j++) {
      const b = pending[j]!;
      if (map.has(b)) merged.push(b);
    }
    this.#sortedKeys = merged;
    this.#pending = [];
    this.#tombstones = 0;
  }

  /** PRD §06 h2.35: half-open [start, end) index range over the amortized
   *  sorted key array covering exactly the keys starting with `prefix`.
   *  The caller (query.ts) must lowercase the fragment first — an
   *  uppercase prefix can never match a lowercase key and indicates a
   *  caller bug, so we throw rather than silently return empty results.
   *
   *  Consolidation policy: pending new keys (from upsert) and evicted
   *  ghosts are merged HERE — in INDEX_MERGE_BATCH chunks inside upsert,
   *  and the ≤-batch tail just before this search — so the index is
   *  consistent with the live map at every query while no single query
   *  ever pays a whole-array re-sort (PRD §02 h3.1 keeps the keystroke
   *  path under 1 ms with no allocation-heavy ingest work). End bound = first
   *  key NOT starting with prefix, found by forward scan from `start`
   *  (O(range); ranges are short in practice — chosen over prefix-
   *  successor arithmetic for clarity and 0x7A→0x7B rollover immunity).
   *  Empty store or no match → [n, n]; "" → [0, n] (end == length is
   *  valid). This is the ONLY binary-search surface over the store —
   *  query.ts (P1.M2.T5.S1) consumes it exclusively. Since P1.M2.T2.S2
   *  query.ts enters at the fragment's FIRST CHAR (the anchored-fuzzy
   *  anchor, §06 h2.38), so query ranges are first-char buckets
   *  (~n/26 ≈ 730–910 keys at cap 20k), not fragment-scoped spans. */
  prefixRange(prefix: string): [number, number] {
    if (prefix !== prefix.toLowerCase()) {
      throw new RangeError(`prefixRange: prefix must be lowercase, got "${prefix}"`);
    }
    if (this.#pending.length !== 0 || this.#tombstones !== 0) {
      this.#consolidate(); // merge the pending tail, drop evicted ghosts
    }
    const start = CandidateStore.lowerBound(this.#sortedKeys, prefix);
    const keys = this.#sortedKeys;
    let end = start;
    while (end < keys.length && keys[end].startsWith(prefix)) end++;
    return [start, end];
  }

  /** Defensive copy of the key index as of the LAST consolidation (h2.35).
   *  May lag the live map: keys upserted since sit in #pending (absent
   *  here), and keys evicted since can linger as ghosts (present here,
   *  get() undefined) until the next consolidation — this never triggers
   *  one itself. Test/inspection surface only; query logic must use
   *  prefixRange(). */
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

  // ── Bigram layer (PRD §06 h2.38, delta R1) ──────────────────────

  /** Record consecutive-token bigrams (PRD §06 h2.38): for each run,
   *  upsert every ADJACENT pair of admitted whole-token keys. Runs arrive
   *  pre-split by the ingest pipeline — a newline is the only window
   *  break, and this method never looks for one; it only joins whatever
   *  keys a run carries (keys are lowercase by the pipeline's contract;
   *  they are joined with single spaces and used as given). A run shorter
   *  than 2 keys forms no windows; empty runs are fine and form none.
   *  Windows overlap by design: "a b c" yields "a b" and "b c" — and NO
   *  trigram (the n ≥ 3 layer is a removed design, PRD 002 delta R1).
   *
   *  Upsert semantics: absent → create { count: 1, lastSeenOrdinal };
   *  present → count++ and lastSeenOrdinal refresh. The ordinal is read
   *  from currentOrdinal() INSIDE (the pipeline issues one per message
   *  before the drain) — this method takes no ordinal argument and never
   *  advances the counter. Every window also bumps the successor index
   *  (w1 → w2) on create AND merge — THE consumer that keeps P1.M2
   *  chaining alive. On overflow the map drains to BIGRAM_CAP within
   *  this call via #evictBigramsIfOverCap — once per call, at the tail,
   *  never per upsert (BUG-006: the cap holds even for a single huge
   *  message). Bigram writes never touch the word map or the prefix index. */
  recordBigramRuns(runs: readonly string[][]): void {
    const ordinal = this.currentOrdinal();
    for (const run of runs) {
      for (let i = 0; i + 1 < run.length; i++) {
        const w1 = run[i];
        const w2 = run[i + 1];
        const key = `${w1} ${w2}`;
        const existing = this.#bigrams.get(key);
        if (existing) {
          existing.count++;
          existing.lastSeenOrdinal = ordinal;
        } else {
          const entry: BigramEntry = { count: 1, lastSeenOrdinal: ordinal };
          this.#bigrams.set(key, entry);
          // Index the newcomer for eviction (no-op until the heap exists —
          // the first overflow pass builds it wholesale from the live map).
          if (this.#bigramEvictHeap !== null) {
            heapPush(this.#bigramEvictHeap, { k: bigramSortKey(entry), key });
          }
        }
        this.#bumpSuccessor(w1, w2); // successor tail (PRD §06 h3.9)
      }
    }
    this.#evictBigramsIfOverCap(); // drains to BIGRAM_CAP within this call (§06 h2.38)
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
    // One scan finds the successor AND its index (a second indexOf here
    // showed up in restore-replay profiles at ~1500 messages).
    let idx = -1;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].next === w2) {
        idx = i;
        break;
      }
    }
    if (idx !== -1) {
      const existing = arr[idx];
      existing.count++;
      while (idx > 0 && successorBefore(existing, arr[idx - 1])) {
        arr[idx] = arr[idx - 1];
        idx--;
      }
      arr[idx] = existing;
      return;
    }
    const entry: Successor = { next: w2, count: 1 };
    let pos = arr.length;
    while (pos > 0 && successorBefore(entry, arr[pos - 1])) pos--;
    arr.splice(pos, 0, entry);
    if (arr.length > 3) arr.length = 3; // drop the sorted tail (see above)
  }

  /** Bigram-map overflow eviction (PRD §06 h2.38: cap 10,000, "standard
   *  eviction policy"; evicting a bigram ALSO splices it from the
   *  successor index via #dropSuccessorFor — the only sanctioned cleanup
   *  path, since word eviction never touches successors).
   *
   *  COST — the reason this pass exists at all: victim selection pulls
   *  the #bigramEvictHeap (a lazy min-heap over the live entries) and
   *  pops O(victims · log n) nodes, re-validating each against the live
   *  entry — NOT a full-map snapshot + sort. A saturated 10k bigram map
   *  therefore pays microseconds per drain instead of a ~10k-entry sort
   *  per message.
   *
   *  Semantics: rounds of at most BIGRAM_EVICT_BATCH pops repeat until
   *  the map is within BIGRAM_CAP, within the single recordBigramRuns
   *  call — the batch is the pacing unit, not a cap on total work
   *  (BUG-006). No protection filter: the bigram map has no
   *  admission/sticky layer (PRD 002 delta R1), so every entry is
   *  evictable. Stale nodes (entry mutated or evicted since the node was
   *  written) re-push the corrected key or drop out; the heap rebuilds
   *  wholesale when stale-node dirt exceeds twice the live map. Removals
   *  mark nothing dirty: the word prefix index is unaffected by bigram
   *  eviction. */
  #evictBigramsIfOverCap(): void {
    if (this.#bigrams.size <= BIGRAM_CAP) return;
    let heap = this.#bigramEvictHeap;
    if (heap === null) heap = this.#rebuildBigramHeap();
    // BUG-006 (P1.M3.T2.S1): the cap is a SAME-CALL guarantee. Each round
    // pops at most BIGRAM_EVICT_BATCH victims — the batch stays the pacing
    // unit (heap pops amortized, stale nodes re-validated in bounded
    // chunks) — but rounds repeat until the map is within BIGRAM_CAP.
    //
    // Termination: every pop either deletes one live entry, drops a stale
    // node, or re-pushes a stale node CORRECTED to its live entry's
    // current key. A node can be stale at most once per mutation of its
    // entry, and this pass's only map mutation is deletion — so stale
    // re-pushes are finite (bounded by pre-pass dirt), after which every
    // round strictly deletes until size ≤ BIGRAM_CAP. The heap cannot run
    // dry first: re-pushes keep every live entry covered by exactly its
    // most recent node, so the defensive break below is unreachable.
    do {
      let batch = BIGRAM_EVICT_BATCH; // reset per round — the pacing unit
      while (this.#bigrams.size > BIGRAM_CAP && batch-- > 0) {
        const node = heapPop(heap);
        if (node === undefined) break; // heap exhausted — defensive only
        const live = this.#bigrams.get(node.key);
        if (live === undefined) continue; // evicted since — stale node
        const k = bigramSortKey(live);
        if (k !== node.k) {
          // Stale: the entry moved (count/lastSeen changed after this node
          // was written). Re-index at its CURRENT key and keep popping —
          // the true lowest-k victims cannot be decided from a stale node.
          heapPush(heap, { k, key: node.key });
          continue;
        }
        this.#bigrams.delete(node.key);
        this.#dropSuccessorFor(node.key); // successor splice (PRD §06 h3.9)
      }
    } while (this.#bigrams.size > BIGRAM_CAP);
    // Reap stale-node dirt: every mutation-before-pop leaves its old node
    // behind. Keeping the index bounded keeps later passes O(victims).
    if (heap.length > 2 * this.#bigrams.size + 64) {
      this.#rebuildBigramHeap();
    }
  }

  /** Rebuild the bigram eviction index wholesale from the live map
   *  (bottom-up heapify, O(n)); also the lazy constructor for the first
   *  overflow pass. After this, every live entry has exactly one
   *  current node. */
  #rebuildBigramHeap(): EvictNode[] {
    const heap: EvictNode[] = [];
    for (const [key, e] of this.#bigrams) {
      heap.push({ k: bigramSortKey(e), key });
    }
    for (let i = heap.length >> 1; i-- > 0; ) {
      // Bottom-up heapify: sift each internal node down.
      let idx = i;
      for (;;) {
        const l = 2 * idx + 1;
        const r = l + 1;
        let m = idx;
        if (l < heap.length && evictNodeBefore(heap[l], heap[m])) m = l;
        if (r < heap.length && evictNodeBefore(heap[r], heap[m])) m = r;
        if (m === idx) break;
        const t = heap[idx];
        heap[idx] = heap[m];
        heap[m] = t;
        idx = m;
      }
    }
    this.#bigramEvictHeap = heap;
    return heap;
  }

  /** Eviction-side successor cleanup (P2.M2.T1.S1, PRD §06 h3.9): when an
   *  evicted bigram key is deleted, its Successor is spliced out of w1's
   *  array — and w1's map entry dies with the last one. NO backfill: no
   *  4th-best is promoted and nothing is recomputed (a dropped successor
   *  returns only when its bigram recurs; the survivors' counts stay
   *  correct because they were counted independently). The findIndex
   *  miss-guard is load-bearing: a bigram whose successor lost the top-3
   *  cap long ago evicts without an entry to splice. Unknown word →
   *  no-op. */
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

  /** Top bigram successors of `word` (PRD §06 h3.9), best first: ordered
   *  count-descending with byte-lex ascending ties, at most 3 entries,
   *  built incrementally at INGEST inside recordBigramRuns — so this is a
   *  pure O(1) read for the keystroke path (the chained completion
   *  machine, P2.M2.T2.S1, calls it per keystroke). Returns the LIVE
   *  array — treat as read-only (same contract as get()); an unseen word
   *  gets the shared NO_SUCCESSORS constant, so a miss allocates
   *  nothing. */
  topSuccessors(word: string): readonly Successor[] {
    return this.#successorIndex.get(word) ?? NO_SUCCESSORS;
  }

  /** Number of stored bigrams (one per "first second" key). /acwords and
   *  test observability (PRD §06 h2.38). */
  get bigramSize(): number {
    return this.#bigrams.size;
  }
}
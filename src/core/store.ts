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
 * upsert is O(1) Map work: no sorting, no scanning, no per-insert index
 * rebuild, so a 20k-entry restore replay does not degrade. Eviction
 * (P1.M2.T4.S3) hooks in later inside this module — not here; it must
 * also mark the index dirty (see #dirty). No scoring imports: eviction
 * reads score.ts's evictionScore through its consumer, never through
 * this module.
 */

import type { Candidate, RankGroup, Sighting } from "./types.js";

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
   *  Sighting — this method never advances the counter. O(1). */
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
}
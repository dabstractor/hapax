# 06 — Candidate Store

## M1: word candidates

`src/core/store.ts` maintains the per-session store. One entry per lowercase key:

```ts
interface Candidate {
  key: string            // lowercase
  display: string        // most recent casing seen
  sessionCount: number   // occurrences this session
  lastSeenOrdinal: number // message ordinal at last sighting
  firstSeenOrdinal: number
  userTyped: boolean     // sticky once true
  properName: boolean    // capitalized-initial seen at least once
  rankGroup: 0 | 1 | 2   // admission group (04)
  isSubword: boolean
}
```

Backing structures:

- `Map<string, Candidate>` — primary upsert path.
- **Prefix index** — maintained at ingest time for query-time speed: a sorted
  array of lowercase keys (rebuilt lazily: marked dirty on insert, re-sorted
  on next query if dirty — restores insert ~20k items once, then binary-search
  per keystroke). Query = binary search for prefix range + gather + salience
  sort of the range + top 8.

No persistence. Store is created at `session_start`, dropped at
`session_shutdown`.

## Upsert semantics

On admitting a sighting of word `w` in message with ordinal `n`:

- Absent → create entry (`sessionCount = 1`, ordinals = n, source flags set).
- Present → `sessionCount++`, `lastSeenOrdinal = n`, refresh `display` casing,
  OR in `userTyped` / `properName` flags, keep `rankGroup` = min(existing, new)
  (a word first seen mid-frequency then seen rare keeps the better group).

## Eviction

- Hard cap **20,000** entries (whole-token candidates; sub-words count toward
  the same cap).
- On overflow, evict the lowest `evictionScore`:

```
evictionScore = salience(c) * ageFactor
ageFactor = exp(-(currentOrdinal - lastSeenOrdinal) / 50)
```

- Evict in batches of 256 (sort snapshot, drop tail) to amortize cost.
- Never evict `userTyped` candidates unless the cap is exceeded by
  `userTyped` alone.

## M2: phrases

### N-gram capture

During ingestion, for each message, record bigrams and trigrams of
**consecutive admitted whole-token candidates** (post shape gate + admission;
sub-words excluded) — across sentence boundaries? No: within a line only
(newline breaks the window). Key = lowercase words joined by single spaces.

```ts
interface PhraseEntry {
  key: string            // "renewable energy laboratory"
  count: number
  lastSeenOrdinal: number
  firstSeenOrdinal: number
  sticky: boolean        // admitted via fast path AND repeated
}
```

Memory: `Map<string, PhraseEntry>`; expect tens of thousands of bigrams in a
long session — cap at 10,000 phrases with the same eviction policy.

### Phrase admission (hybrid, settled)

An n-gram becomes a completion candidate when:

- **Repetition path:** `count >= 2`, OR
- **Fast path (first sight):** every constituent word is rank group 0
  (dictionary-absent, shape-gated) or properName, AND the n-gram length
  in words is ≤ 5.

Fast-path phrases that fail to reach `count >= 2` within **40 subsequent
message ordinals** are demoted (removed from phrase candidates, kept in counts
in case they recur).

`sticky = true` when both paths fire; sticky phrases resist eviction
(same rule as userTyped).

### Constituent suppression (ranking rule)

When a phrase candidate matches, suppress single-word candidates that are a
prefix word of the phrase in the same result set if the phrase outranks them
(offering both `renewable` and `renewable energy laboratory` wastes two of
eight slots — keep only the phrase when phrase salience ≥ word salience).

Phrase salience = sum of constituent word saliences × 1.2 (phrases are more
specific targets, deserve the multiplier) + `2.0 * log2(1 + count)` if
repetition-path.

### Successor index (for chained completion)

```ts
Map<string, Array<{ next: string, count: number }>>  // top 3 per word
```

Built from the same bigram counts: `word → top-3 most frequent successors`.
Updated at ingest; trivial size.

Query use is defined in 07 (chaining). This is the M2 structure; M1 ships
without it.
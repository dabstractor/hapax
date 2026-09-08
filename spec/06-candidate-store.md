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

## M2: successor index (chained completion)

There are **no phrase candidates**. A completion item is always exactly one
word, under all circumstances. "Phrase support" means only this: after a
word is accepted, its most-likely successor is offered as the top
suggestion with **zero** additional typed characters (see 07, chained
completion). No multi-word string is ever a menu item, a `value`, or an
insertion.

### Bigram capture (raw-text adjacency, strictly)

During ingestion, record bigrams of admitted whole-token candidates
(sub-words excluded) that are **adjacent in the raw text**: the two words
are separated by nothing but plain whitespace (spaces/tabs) on the same
line. Key = lowercase `first second`.

The window breaks — no bigram forms — when ANYTHING other than plain
whitespace appears between the two words:

- **Clause and punctuation:** `,` `;` `:` `.` `!` `?` `—` `–` `…` `|` —
  `ZorpWibbleEngine, quuxblat` never chains.
- **Quotes and brackets:** `` ` `` `"` `'` `(` `)` `[` `]` `{` `}` `<` `>` —
  backtick-quoted identifiers separated by even a space do not chain
  (`` `A` `B` `` has two backticks between the words). Words entering a
  quote or leaving one do not chain across the boundary.
- **Digits, hexish, and any non-word character:** `/` `\` `=` `+` `&` `%` `#`
  `*` `@` `-` `~` `^` — a digit run or hexish token between two words breaks
  the window; `v2 release` does not chain `v2`→`release`.
- **Any other word, common or rare:** an intervening word — even a
  rank-rejected common word like `the` or `of` — breaks the window.
  Bridging over dropped common words is FORBIDDEN. `United States of
  America` yields only `united states` and `america`; the stopword-bridge
  tradeoff is accepted for predictability (bugs like
  `ZorpWibbleEngine, the quuxblat` → `zorpwibbleengine quuxblat` are the
  reason).
- **Newline:** the window never crosses a line break (unchanged).

No trigrams. No `PhraseEntry` map, no phrase admission/sticky/demotion
lifecycle, no constituent suppression — those designs are removed. The one
M2 structure is the successor index:

### Successor index (for chained completion)

```ts
Map<string, Array<{ next: string, count: number }>>  // top 3 per word
```

Built from the bigram counts: `word → top-3 most frequent successors`,
updated at ingest; trivial size. Cap the bigram map at 10,000 keys with the
standard eviction policy; evicting a bigram also splices it from the
successor index.

Query use is defined in 07 (chaining). This is the M2 structure; M1 ships
without it.
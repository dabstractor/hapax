# PRP — P2.M2.T1.S1: Successor index build (top-3 per word) at ingest

---

## Goal

**Feature Goal**: Add a successor index to `CandidateStore` (src/core/store.ts):
`Map<string, Array<{ next: string; count: number }>>` mapping each word to its
top-3 most frequent bigram successors, built **incrementally at ingest time**
(inside the existing phrase upsert path) and **never on the keystroke path**.
Expose `topSuccessors(word): ReadonlyArray<{ next: string; count: number }>`.

**Deliverable**:
1. `Successor` type in `src/core/types.ts` (single exported interface, mirrors
   `PhraseEntry` placement/style).
2. `src/core/store.ts` extension: private `#successorIndex` map, incremental
   maintenance inside `#upsertPhrase` (bigram keys only), eviction cleanup in
   `#evictPhrasesIfOverCap`, and public `topSuccessors(word)` reader.
3. Unit tests in `test/successors.test.ts`: ordering by count, top-3 truncation,
   tie determinism, eviction cleanup, and **restore replay builds the identical
   index from the same bigram stream**.

**Success Definition**: After ingesting lines where `alpha` is followed by
`beta` ×3, `gamma` ×2, `delta` ×1, `topSuccessors("alpha")` returns
`[{next:"beta",count:3},{next:"gamma",count:2},{next:"delta",count:1}]`; a
4th distinct successor (`epsilon` ×1) never appears. Replaying the identical
ingest stream into a fresh store (session-restore semantics) yields an index
deep-equal to the original. All existing tests pass; zero changes to
`query.ts`, `provider.ts`, or any `src/pi/*` file.

## User Persona

Not applicable — internal module (work-item contract: "DOCS: none — internal
module"). Indirect beneficiary: the chained-completion user (P2.M2.T2.S1) who
gets fast second-word suggestions after Tab-accepting a first word.

## Why

- PRD §06 h3.9 (quoted in full below) defines this structure as the M2
  successor index feeding chained completion.
- The chain state machine (P2.M2.T2.S1, next task) calls `topSuccessors` on
  the keystroke path — so the index MUST be prebuilt at ingest; this task is
  what makes that lookup O(1).
- The `/acwords` M2 dump (P2.M2.T3.S1) will print successor entries.

## What

- **Source of truth**: the bigram counts ALREADY maintained by the phrase
  layer (P2.M1.T1.S1). Every bigram phrase key (`"w1 w2"`, i.e.
  `key.split(" ").length === 2`) bumps `w1 → w2`. Do NOT re-derive from a
  second tokenization pass or from `iteratePhrases()` scans at query time.
- **Incremental maintenance** (either strategy is contract-approved; implement
  the incremental one): inside `#upsertPhrase`, when the key is a bigram,
  bump the count in `w1`'s successor array; if `w2` is absent from the array,
  insert it; if the array exceeds 3 entries, drop the lowest-count entry
  (byte-lex key tiebreak for determinism, mirroring the eviction
  comparators' style). Arrays never exceed 3 elements — small allocation.
- **Eviction interplay**: when `#evictPhrasesIfOverCap` deletes a bigram key,
  remove that entry from `w1`'s successor array (do NOT recompute or promote
  a 4th successor — a dropped successor stays dropped until it recurs; counts
  of remaining entries are still correct because they were counted
  independently). Trigram evictions are no-ops for this index.
- **Stale successor word counts on phrase demotion**: none — demotion
  (`removePhraseCandidacy`, `sweepPhraseDemotions`) only touches candidacy
  sets, never `#phrases` counts. The successor index tracks counts, not
  candidacy, exactly like the PRD says ("Built from the same bigram counts").
- **Reader**: `topSuccessors(word)` returns the live array — callers must
  treat it as read-only (same contract wording as `get()`/`getPhrase()`).
  Unknown word → empty array (return the shared frozen `EMPTY` constant, not
  a fresh allocation, to keep keystroke-path allocation at zero for misses).
- **NOT in scope**: any query/provider changes, `enablePhrases` gating
  (P2.M2.T3.S1 owns gating wiring), the chain state machine, /acwords dump.

### Success Criteria

- [ ] `topSuccessors("alpha")` after `alpha beta`×3, `alpha gamma`×2,
      `alpha delta`×1 returns exactly 3 entries ordered by count desc.
- [ ] Top-3 truncation: a 4th distinct successor is never returned while 3
      higher-count successors exist.
- [ ] Tie determinism: equal counts order byte-lex ascending on `next`.
- [ ] Newline/window-break semantics inherited free (bigrams only exist
      within lines — no extra work, but a test pins it).
- [ ] Phrase-map eviction removes the evicted bigram from the index.
- [ ] Restore replay: two stores fed the identical
      `recordPhraseLines` stream produce deep-equal
      `topSuccessors` results for every word seen.
- [ ] `topSuccessors` for an unseen word returns the empty constant; existing
      suite (`vitest run`) fully green.

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase would they have everything?" —
Yes. The exact anchor points in store.ts (with verified line-adjacent context),
the exact PRD clause, the existing phrase-layer semantics, and the test style
are all embedded below.

### Documentation & References

```yaml
- file: src/core/store.ts
  why: THE file to extend. Key anchors (verified against landed code):
    - class CandidateStore (line ~99); private fields near #phrases (line ~109).
    - recordPhraseLines(lines, ordinal) (line ~322): loops each line, upserts
      bigram (line[i] + " " + line[i+1]) and trigram windows.
    - #upsertPhrase(key, ordinal) (line ~339): create-or-bump on #phrases,
      then #admitPhrase. ADD the successor bump here, AFTER the create-or-bump
      (the entry.count is then correct), guarded by key.split(" ").length === 2.
    - #evictPhrasesIfOverCap (line ~424): deletes from #phrases — add the
      successor-array removal inside its delete loop.
    - Reader methods block near getPhrase/phraseEntries/iteratePhrases
      (lines ~531-556) — place topSuccessors() there with matching JSDoc style.
  pattern: "long, invariant-documenting JSDoc; named module-level constants
           (STORE_CAP, PHRASE_CAP at lines ~70-90); byte-lex comparators
           written inline (a < b ? -1 : a > b ? 1 : 0)"
  gotcha: "# is private-field syntax (#phrases etc.); store uses
           `import type` from ./types.js (note .js extension — ESM)."

- file: src/core/types.ts
  why: Where PhraseEntry lives (lines 61-72) — add Successor directly
        alongside it with the same per-field JSDoc style.
  pattern: "export interface + /** */ per field"

- file: test/phrases.test.ts
  why: The newest phrase-layer suite; copy its describe/it naming style
        ("successor index (PRD §06 h3.9) — ..."), fixture-builder helpers,
        and the deep-equal toEqual assertions on entry snapshots.
  gotcha: "tests build stores via recordPhraseLines with synthetic
           lowercase lines and explicit ordinals — same approach here."

- file: test/store.test.ts
  why: Canonical store test patterns (constants pinning, eviction tests).

- prd: PRD §06 h3.9 (verbatim):
  "Map<string, Array<{ next: string, count: number }>>  // top 3 per word
   Built from the same bigram counts: word → top-3 most frequent successors.
   Updated at ingest; trivial size."
  why: The whole contract. Also §06 M2 header: "trivially sized (top 3 per
       word) and updated at INGEST time — never on the keystroke path".
```

### Current Codebase tree (relevant excerpt)

```bash
src/core/
  types.ts        # PhraseEntry (61-72) ← add Successor here
  store.ts        # CandidateStore ← #successorIndex + topSuccessors here
  query.ts        # UNTOUCHED
  score.ts segment.ts shapeGate.ts dictionary.ts   # UNTOUCHED
test/
  phrases.test.ts # phrase-layer suite ← style source
  successors.test.ts   # NEW
src/pi/*          # ALL UNTOUCHED (index.ts already calls recordPhraseLines)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: successor bump must live INSIDE #upsertPhrase (or its caller
// loop), not in a post-ingest scan — PRD §05 h2.34 forbids map-wide scans
// on the ingest path; every upsert must stay O(1)-ish.

// GOTCHA: trigram keys ("a b c") must be EXCLUDED — check
// key.split(" ").length === 2 before bumping. split(" ") is exact because
// keys are lowercase single-space-joined by construction.

// GOTCHA: phrase eviction can delete a bigram; its successor entry must be
// spliced out of w1's array, but NEVER backfilled (no recomputation — a
// dropped 4th-best stays dropped until seen again).

// GOTCHA: ESM imports use the ".js" extension: `import type { Successor } from "./types.js"`.

// PATTERN (drop-lowest on overflow, mirrors byte-lex tiebreak style):
if (arr.length > 3) {
  let worst = 0;
  for (let i = 1; i < arr.length; i++) {
    const c = arr[i].count - arr[worst].count;
    if (c < 0 || (c === 0 && arr[i].next < arr[worst].next)) worst = i;
  }
  arr.splice(worst, 1);
}

// GOTCHA: keep arrays sorted by count desc at all times (insert in place),
// so topSuccessors() is a pure O(1) read — the chain machine (T2.S1) calls
// it per keystroke.
```

## Implementation Blueprint

### Data models and structure

```ts
// src/core/types.ts — alongside PhraseEntry
export interface Successor {
  /** the word that followed `word` in a bigram */
  next: string;
  /** occurrences of the bigram "word next" this session */
  count: number;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/core/types.ts
  - ADD: export interface Successor { next: string; count: number }
    with per-field JSDoc, directly after PhraseEntry (line ~72).
  - NAMING: field names `next`/`count` are contract-exact (PRD h3.9).

Task 2: MODIFY src/core/store.ts — index field + maintenance
  - ADD private field near #phrases:
    #successorIndex = new Map<string, Successor[]>();
  - ADD private helper #bumpSuccessor(w1: string, w2: string): void
    (bump-or-insert into w1's array keeping count-desc / byte-lex order,
    then drop-lowest if length > 3 — see pattern above).
  - MODIFY #upsertPhrase: after create-or-bump, if key has exactly 2 words,
    call this.#bumpSuccessor(key.slice(0, key.indexOf(" ")), second word).
    (Splitting once: const sp = key.indexOf(" ") — keys are single-space
    joined; or key.split(" ") for readability — either is fine at this size.)
  - MODIFY #evictPhrasesIfOverCap: in its delete loop, if the deleted key is
    a bigram, splice that Successor out of w1's array (delete the map entry
    if the array becomes empty).

Task 3: MODIFY src/core/store.ts — reader
  - ADD topSuccessors(word: string): readonly Successor[]
    near getPhrase (~line 531): live array, read-only contract in JSDoc;
    unknown word → shared frozen EMPTY array constant (module-level
    `const NO_SUCCESSORS: readonly Successor[] = []`).

Task 4: CREATE test/successors.test.ts
  - FOLLOW pattern: test/phrases.test.ts (naming, fixtures, assertions).
  - TESTS (all names test-style of the existing suite):
    1. ordering by count desc after mixed-frequency bigrams;
    2. top-3 truncation (4 distinct successors → only best 3);
    3. tie-break byte-lex ascending on equal counts;
    4. trigram keys do NOT contribute (ingest "a b c" once →
       only a→b and b→c, never a→c);
    5. line breaks inherited from phrase layer (two lines sharing no window);
    6. eviction cleanup: force #phrases over PHRASE_CAP with throwaway
       phrases (see Gotchas below), assert evicted bigram gone from index;
    7. restore replay: feed the identical recordPhraseLines stream to two
       stores; assert topSuccessors deep-equal for every first word;
    8. unseen word → [] returned (and the same reference both calls).
```

### Implementation Patterns & Key Details

```ts
// In #upsertPhrase tail (after existing create-or-bump + before/after
// #admitPhrase — order relative to admission is irrelevant, admission
// doesn't read successors):
const sp = key.indexOf(" ");
const last = key.lastIndexOf(" ");
if (sp !== -1 && sp === last) {           // exactly 2 words = bigram
  this.#bumpSuccessor(key.slice(0, sp), key.slice(sp + 1));
}

// topSuccessors — zero-allocation read:
topSuccessors(word: string): readonly Successor[] {
  return this.#successorIndex.get(word) ?? NO_SUCCESSORS;
}
```

### Integration Points

```yaml
NO wiring changes anywhere:
  - src/pi/index.ts already calls store.recordPhraseLines at ingest — the
    index builds automatically, including during session-restore replay
    (ingest-restore path replays the same message stream).
  - Consumers (P2.M2.T2.S1 chain machine, P2.M2.T3.S1 /acwords dump) are
    FUTURE tasks — they will import nothing new beyond topSuccessors().
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit          # or: npm run build / check (use the repo's script — see package.json)
npx vitest run test/successors.test.ts
npx vitest run            # full suite must stay green
```

(Use the exact scripts defined in package.json — check `scripts` first; the
repo's existing test command is what CI runs.)

### Level 2: Unit Tests

```bash
npx vitest run test/successors.test.ts -v
npx vitest run test/phrases.test.ts test/store.test.ts -v   # neighbors unaffected
```

### Level 3: Integration (no runtime wiring exists for this — smoke only)

```bash
npx vitest run test/ingest-restore.test.ts   # restore path still green
```

### Level 4: Not applicable (internal module, no UI/debug surface yet).

## Final Validation Checklist

- [ ] `Successor` interface in types.ts with contract-exact field names
- [ ] Index built only from 2-word phrase keys, incrementally in #upsertPhrase
- [ ] Arrays capped at 3, count-desc, byte-lex ties
- [ ] Eviction removes successors of evicted bigrams (no backfill)
- [ ] `topSuccessors` unknown-word → shared empty constant, zero allocation
- [ ] Restore-replay identity test passes
- [ ] Full `vitest run` green; no file outside types.ts/store.ts/test/ touched

## Anti-Patterns to Avoid

- ❌ Don't build the index from `iteratePhrases()` at query time — ingest-only
- ❌ Don't scan the whole #phrases map per ingest (h2.34)
- ❌ Don't backfill a promoted 4th successor on eviction
- ❌ Don't add gating (`enablePhrases`) here — that's P2.M2.T3.S1
- ❌ Don't touch query.ts/provider.ts — this task is store-only
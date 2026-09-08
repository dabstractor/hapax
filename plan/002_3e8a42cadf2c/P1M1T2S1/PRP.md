# PRP — P1.M1.T2.S1 (plan 002): store.ts + types.ts — phrase machinery out, recordBigramRuns in

---

## Goal

**Feature Goal**: Replace the phrase layer in `src/core/store.ts` with the
PRD §06 (h2.38/h3.7, delta) design: a slim bigram count map keyed
`"first second"` with value `{ count, lastSeenOrdinal }` — no admission, no
sticky, no demotion, no trigrams — feeding the existing successor index.
The store's public M2 surface becomes `recordBigramRuns(runs)`,
`topSuccessors(word)`, and a bigram-size/debug accessor.

**Deliverable**:
- `src/core/store.ts`: phrase constants/helpers/fields/methods deleted per the
  line-anchored inventory; new `recordBigramRuns`, `#bigrams` map, bigram cap
  10,000 with lazy-heap eviction (no sticky) calling `#dropSuccessorFor`.
- `src/core/types.ts`: `PhraseEntry` deleted; `Successor` kept.
- Minimal compile-preserving deletions in `src/core/query.ts` (phrase
  gathering/suppression block) and `src/pi/debug.ts` (phrase dump) — deeper
  redesign of those files belongs to P1.M1.T2.S2 / P1.M1.T2.S3.
- Re-pointed caller `src/pi/index.ts` (recordPhraseLines → recordBigramRuns;
  onSweepPhrases wiring deleted); `src/pi/ingest.ts` #onSweepPhrases seam
  removed. Pruned dead test cases so `npm test` is green.

**Success Definition**: `npm run check` clean; full `npm test` green with the
pruned suite; `recordBigramRuns` counts bigrams and bumps successors with no
PhraseEntry anywhere (`grep -rn "PhraseEntry\|phrase" src/core/` shows only
history-neutral identifiers); bigram map caps at 10,000 and eviction splices
the successor index; word layer (20k cap, eviction, prefix index, upsert)
byte-identical in behavior.

## Why

- PRD 002 (delta R1): the one-word invariant — "no multi-word candidates,
  ever; the only phrase behavior is successor chaining." The PhraseEntry map,
  admission/sticky/demotion lifecycle, and constituent suppression are removed
  designs. This subtask produces the new store contract that T3.S2 (ingest
  wiring), P1.M2.T1.S1 (chain machine), and P1.M3.T2.S1 (/acwords dump)
  consume.
- The successor index is the surviving M2 structure; today it is fed only
  through the doomed `#upsertPhrase`, so the refactor must re-point recording
  or the index starves and chaining (P1.M2) breaks silently.

## What

### Store changes (src/core/store.ts)

DELETE (exact inventory with line ranges in
`plan/002_3e8a42cadf2c/architecture/core_phrase_layer_map.md`):

- Constants/helpers: `PHRASE_CAP` (98–99), `PHRASE_EVICT_BATCH` (106–112),
  `phraseSortKey` (121–127), `EvictNode` (143–147), `evictNodeBefore`
  (150–156), `heapPush` (159–171), `heapPop` (174–196).
- Fields: `#phrases` (213), `#phraseCandidates` (218), `#phraseEvictHeap`
  (230), `#fastPathAdmitted` (235).
- Methods: `recordPhraseLines` (445–481), `#upsertPhrase` (484–526),
  `#admitPhrase` (578–603), `#firstSightFastPathEligible` (609–625),
  `#evictPhrasesIfOverCap` (655–709), `#rebuildPhraseHeap` (714–738),
  `setPhraseSticky` (763–766), `isPhraseCandidate` (774–777),
  `phraseCandidateKeys` (781–784), `isFastPathPhrase` (790–793),
  `removePhraseCandidacy` (800–803), `sweepPhraseDemotions` (825–841),
  `getPhrase` (844–848), `get phraseSize` (861–864), `phraseEntries`
  (868–871), `iteratePhrases` (878–880).
- `PhraseEntry` import (~L79); trim the phrase sections of the class doc
  comment (44–71) to successor-only prose.

KEEP UNCHANGED: `successorBefore` (129–135), `NO_SUCCESSORS` (199),
`#successorIndex` (225), `#bumpSuccessor` (528–575), `#dropSuccessorFor`
(748–758), `topSuccessors` (856–859), and the entire word layer (`#map`,
`#ordinal`, `#sortedKeys`, `#dirty`, `nextOrdinal`, `currentOrdinal`,
`upsert`, `evictIfOverCap` 329–372, `prefixRange`, `sortedKeysSnapshot`,
`lowerBound`, `get`, `size`, `entries`, `rankGroupHistogram`, `STORE_CAP`,
`EVICT_BATCH`).

ADD:

```ts
/** Bigram map cap (PRD §06 h2.38). */
const BIGRAM_CAP = 10_000;
const BIGRAM_EVICT_BATCH = 256;

interface BigramEntry { count: number; lastSeenOrdinal: number; }

#bigrams = new Map<string, BigramEntry>();
#bigramEvictHeap: EvictNode[] | null = null;   // EvictNode/heap helpers re-added locally

recordBigramRuns(runs: readonly string[][]): void {
  const ordinal = this.currentOrdinal();
  for (const run of runs) {
    for (let i = 0; i + 1 < run.length; i++) {
      const w1 = run[i], w2 = run[i + 1];
      const key = `${w1} ${w2}`;
      const existing = this.#bigrams.get(key);
      if (existing) { existing.count++; existing.lastSeenOrdinal = ordinal; }
      else {
        const entry = { count: 1, lastSeenOrdinal: ordinal };
        this.#bigrams.set(key, entry);
        if (this.#bigramEvictHeap !== null)
          heapPush(this.#bigramEvictHeap, { k: bigramSortKey(entry), key });
      }
      this.#bumpSuccessor(w1, w2);   // successor index is THE consumer
    }
  }
  this.#evictBigramsIfOverCap();
}

get bigramSize(): number { return this.#bigrams.size; }  // /acwords + tests
```

Eviction: reuse the lazy min-heap pattern the phrase layer had, minus sticky —
`bigramSortKey(e) = Math.log(e.count) + e.lastSeenOrdinal / 50`; heap built
wholesale on first overflow, `heapPush` on create, `heapPop` victims in
`BIGRAM_EVICT_BATCH` batches while `size > BIGRAM_CAP`, each victim
`#bigrams.delete(key)` + `#dropSuccessorFor(key)`.

### types.ts (src/core/types.ts)

- DELETE `PhraseEntry` (lines 61–78).
- KEEP `Successor` `{ next: string; count: number }` (82–90) and everything else.

### Compile-preserving deletions (minimal; deeper work is T2.S2/T2.S3)

- `src/core/query.ts`: delete the phrase-gathering block (~218–233), phrase
  RankedMatch push (~255–262), constituent suppression (~236–253),
  `phraseSalience` (115–131), `firstWord` (100–104), `phraseSuppresses`
  (136–140), `PHRASE_MULTIPLIER` (86), `PHRASE_REPETITION_W` (93), and the
  `PhraseEntry`/store-phrase imports. KEEP `rankMatches` (word-only now),
  `RankOptions`, `DEFAULT_LIMIT`, `compareRankedMatches`. NOTE: T2.S2 will
  also drop the `suppress` seam + add the one-word invariant test — that is
  fine; this task only needs the phrase symbols gone and tests compiling.
- `src/pi/debug.ts`: delete `TOP_PHRASES` (109), `phraseDisplay` (114–120),
  `phrasesSection` (122–160) + its spread (182), and imports of
  `firstWord`/`phraseSalience`/`PhraseEntry`/`PHRASE_CAP`. T2.S3 adds the
  successor-index sample section.
- `src/pi/index.ts`: line ~183 `recordPhraseLines(lines, ordinal)` →
  `recordBigramRuns(lines)`; delete the `onSweepPhrases` entry (~188) and its
  comment. KEEP the `enablePhrases` gate wrapping `onAdmittedTokens` for now
  (P1.M3.T1.S2 re-points the gate to `enableChaining`) — but if the gate's
  comment references the sweep, trim it.
- `src/pi/ingest.ts`: remove `onSweepPhrases` option (L135), field (164),
  assignment (188), invocations (233, 277) and their comments (129–135 area).
  KEEP `onAdmittedTokens` (129/163/187/233) — it is the seam that still feeds
  bigrams; its payload contract changes in P1.M1.T3.S2, not here.

### Test pruning (keep green; rewrites land in T3.S3 / M2 tasks)

- DELETE files: `test/phrases.test.ts`, `test/phrase-gating.test.ts`.
- `test/index.test.ts` 411–444: prune the recordPhraseLines-spy /
  enablePhrases-gating cases that reference deleted symbols.
- `test/ingest-restore.test.ts` 519–522, 605–676: sweep/candidacy/fast-path/
  getPhrase cases.
- `test/ingest-pipeline.test.ts` 355–375: recordPhraseLines/getPhrase cases.
- `test/acceptance.test.ts` 585, 667: recordPhraseLines / phraseSize refs.
- `test/adversarial-ingest.test.ts` 293–353; `test/adversarial-typing.test.ts` ~444.
- `test/perf-gates.test.ts` 33, 282–283, 295–300: PHRASE_CAP /
  PHRASE_EVICT_BATCH / recordPhraseLines / sweepPhraseDemotions / phraseSize.
- `test/debug.test.ts`: phrase-dump expectations.
- `test/successors.test.ts`, `test/chain.test.ts` (feeders at chain.test.ts
  134, 147–148, 372, 466): re-point `recordPhraseLines(lines, ordinal)` →
  `recordBigramRuns(lines)`. Trigram-feeding cases (3-word expectations)
  become bigram-only — adjust assertions.
- ADD minimal new coverage in `test/store.test.ts` (or a new
  `test/bigrams.test.ts`): recordBigramRuns counting/lastSeen refresh,
  successor bump equivalence, 10,001st-key eviction + successor splice,
  bigramSize accessor. TDD: write these first.

### Success Criteria

- [ ] `grep -rn "PhraseEntry\|recordPhraseLines\|sweepPhraseDemotions\|isPhraseCandidate\|iteratePhrases" src/ test/` → empty
- [ ] `recordBigramRuns([["a","b"],["a","b","c"]])`: bigram "a b" count 2,
      "b c" count 1; `topSuccessors("a")` = `[{next:"b",count:2}]`
- [ ] Inserting 10,001 distinct bigrams evicts exactly to cap (batched),
      and an evicted bigram's successor is spliced from the index
- [ ] Word layer untouched: existing store.test.ts eviction/upsert/prefix
      cases pass unchanged
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed?" — Yes: the deletion inventory is line-anchored, the new API is
specified with code, the lazy-heap eviction pattern is described from the
existing implementation, every cross-file re-point and test-prune site is
listed, and the PRD delta text (strict bigram adjacency semantics) is
referenced. The only upstream dependency (P1.M1.T1.S1, segment.ts) touches
different files entirely.

### Documentation & References

```yaml
- docfile: plan/002_3e8a42cadf2c/architecture/core_phrase_layer_map.md
  why: THE map — exact line ranges for every deleted/kept symbol, cross-file
        usage of doomed symbols (src/ + test/), shared-symbol risk notes.
  critical: "#upsertPhrase is the ONLY caller of #bumpSuccessor" and
        "#evictPhrasesIfOverCap is the ONLY caller of #dropSuccessorFor" —
        the refactor must re-point both or the successor index starves /
        becomes unbounded.

- file: src/core/store.ts (L528-575 #bumpSuccessor, L748-758 #dropSuccessorFor,
        L445-526 recordPhraseLines/#upsertPhrase as the eviction/heap pattern
        to re-implement minus sticky)
  why: keep bodies verbatim; the upsert/heap code is the template for the
        bigram variant (heapPush on create, wholesale rebuild on first
        overflow, batched heapPop victims).

- PRD §06 h2.38 + h3.7 (delta_prd.md / prd_snapshot):
  why: "Cap the bigram map at 10,000 keys with the standard eviction policy;
        evicting a bigram also splices it from the successor index." Key =
        lowercase "first second". No trigrams. One word per completion, always.

- file: plan/002_3e8a42cadf2c/P1M1T1S1/PRP.md
  why: parallel sibling touching only src/core/segment.ts + segment.test.ts —
        no file overlap with this task; do not touch segment.ts.

- files: src/pi/index.ts (L175-190 wiring), src/pi/ingest.ts (L129-135,
        163-164, 187-188, 233, 277)
  why: the exact seams to re-point/delete so the tree compiles.

- file: src/core/types.ts (L61-78 delete, L82-90 keep)
```

### Current Codebase tree (relevant)

```bash
src/core/{store,types,query,segment,score,dictionary,shapeGate}.ts
src/pi/{index,ingest,provider,debug,config}.ts
test/*.test.ts (incl. phrases, phrase-gating, chain, successors, debug,
  ingest-restore, ingest-pipeline, index, acceptance, adversarial-*, perf-gates)
```

### Desired Codebase tree

```bash
src/core/store.ts     # word layer + bigram map + successor index only
src/core/types.ts     # PhraseEntry gone
src/core/query.ts     # word-only rankMatches (minimal phrase-block deletion)
src/pi/{index,ingest}.ts  # re-pointed / seam-removed
src/pi/debug.ts       # phrase dump stripped (minimal)
test/bigrams.test.ts  # NEW — recordBigramRuns + eviction + successor splice
test/{phrases,phrase-gating}.test.ts  # DELETED
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: query.ts and debug.ts import doomed store symbols — the tree
// CANNOT compile after store.ts deletions unless their phrase blocks go in
// the same change. Do the minimal deletions there even though T2.S2/T2.S3
// own the redesign.

// CRITICAL: #dropSuccessorFor only handles exactly-one-space keys
// (bigrams). All new bigram keys are `${w1} ${w2}` with space-free words —
// safe — but never feed it joined multi-word keys.

// GOTCHA: keep the enablePhrases gate around onAdmittedTokens in index.ts
// for now (P1.M3.T1 owns the flag rename); delete ONLY the onSweepPhrases
// entry. Leaving a dangling reference to config.enablePhrases is fine.

// GOTCHA: recordBigramRuns takes NO ordinal argument (unlike
// recordPhraseLines) — read this.currentOrdinal() inside; ingest.ts:183's
// old two-arg call must drop the second arg.

// GOTCHA: word eviction (evictIfOverCap) still does NOT clean the successor
// index — pre-existing gap, out of scope; bigram eviction is the only
// sanctioned cleanup path.

// GOTCHA: heap helpers (EvictNode, evictNodeBefore, heapPush, heapPop) are
// deleted with the phrase layer but needed again for bigrams — RE-ADD them
// (can be identical code; keep them module-private).
```

## Implementation Blueprint

### Implementation Tasks (ordered, TDD)

```yaml
Task 1: CREATE test/bigrams.test.ts (red)
  - Cases: count/refresh, successor bump equivalence, cap eviction at
    10,001 distinct keys (batched, exact final size), evicted bigram spliced
    from topSuccessors, bigramSize accessor, empty/1-word runs are no-ops.

Task 2: EDIT src/core/types.ts
  - DELETE PhraseEntry (61-78). Verify nothing else references it after Task 4.

Task 3: EDIT src/core/store.ts
  - Delete per inventory (constants/helpers/fields/methods, PhraseEntry
    import, doc trim).
  - Re-add heap helpers + BIGRAM_CAP/BIGRAM_EVICT_BATCH/bigramSortKey.
  - Implement #bigrams, recordBigramRuns, #evictBigramsIfOverCap,
    get bigramSize per the What section.
  - KEEP #bumpSuccessor/#dropSuccessorFor/topSuccessors verbatim.

Task 4: EDIT src/core/query.ts + src/pi/debug.ts (minimal phrase-block deletion)
  - query.ts: delete phrase gathering/suppression/push, phraseSalience,
    firstWord, phraseSuppresses, PHRASE_MULTIPLIER, PHRASE_REPETITION_W,
    PhraseEntry import; rankMatches becomes word-only.
  - debug.ts: delete TOP_PHRASES/phraseDisplay/phrasesSection + spread +
    doomed imports; keep formatAcwordsDump compiling.

Task 5: EDIT src/pi/index.ts + src/pi/ingest.ts
  - index.ts: recordPhraseLines → recordBigramRuns (drop ordinal arg);
    delete onSweepPhrases entry + comment.
  - ingest.ts: remove onSweepPhrases option/field/assignment/invocations.

Task 6: PRUNE tests per the What-section list; re-point
  test/{successors,chain}.test.ts feeders to recordBigramRuns.

Task 7: VALIDATE (loop below); run grep cleanliness gate.
```

### Implementation Patterns & Key Details

```ts
// Eviction core (mirrors the deleted phrase pattern, minus sticky):
#evictBigramsIfOverCap(): void {
  if (this.#bigrams.size <= BIGRAM_CAP) return;
  if (this.#bigramEvictHeap === null) this.#bigramEvictHeap = this.#rebuildBigramHeap();
  let batch = BIGRAM_EVICT_BATCH;
  while (this.#bigrams.size > BIGRAM_CAP && batch-- > 0) {
    const node = heapPop(this.#bigramEvictHeap);
    if (node === undefined) { this.#bigramEvictHeap = null; break; }
    const live = this.#bigrams.get(node.key);
    if (live === undefined) continue;          // stale heap node
    if (bigramSortKey(live) !== node.k) continue; // re-push drifted key
    this.#bigrams.delete(node.key);
    this.#dropSuccessorFor(node.key);
  }
}
// bigramSortKey(e) = Math.log(e.count) + e.lastSeenOrdinal / 50
// (log-domain key from the old phraseSortKey — monotone, count-favoring,
//  recency-tilted; identical tradeoffs, no sticky exclusion.)
```

### Integration Points

```yaml
CONSUMERS (downstream, do not implement):
  - P1.M1.T3.S2 ingest.ts: changes onAdmittedTokens payload to adjacency
    runs contract; calls recordBigramRuns
  - P1.M2.T1.S1 provider chain machine: reads topSuccessors(word)
  - P1.M3.T2.S1 /acwords: reads bigramSize + successor sample
  - P1.M1.T2.S2 query.ts redesign; P1.M1.T2.S3 debug.ts successor dump

FROZEN:
  - src/core/{segment,score,dictionary,shapeGate}.ts (P1.M1.T1.S1 owns
    segment.ts in parallel)
  - store.ts word layer behavior (20k cap, eviction scores, prefix index)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check
```

### Level 2: Unit Tests

```bash
npm test -- test/bigrams.test.ts test/store.test.ts test/successors.test.ts test/chain.test.ts
npm test                     # full green after pruning
```

### Level 3: Cleanliness gates

```bash
grep -rn "PhraseEntry\|recordPhraseLines\|sweepPhraseDemotions\|isPhraseCandidate\|phraseCandidateKeys\|isFastPathPhrase\|iteratePhrases\|phraseSize\|getPhrase\b" src/ test/ | grep -v "plan/"
# Expected: empty
grep -rn "onSweepPhrases" src/   # Expected: empty
```

### Level 4: Behavior spot-check

```bash
# via a vitest scratch or node loader: ingest a repeated two-word line,
# assert topSuccessors reflects counts; force 10_001 distinct bigrams,
# assert bigramSize === 10_000 and the oldest/lowest-count successor
# disappeared from topSuccessors.
```

## Final Validation Checklist

- [ ] `npm run check` and `npm test` green
- [ ] All cleanliness greps empty
- [ ] recordBigramRuns: counting, refresh, successor bumps, cap, splice
- [ ] Word layer tests pass unchanged (store.test.ts eviction/upsert/prefix)
- [ ] No changes to segment/score/dictionary/shapeGate
- [ ] index.ts/ingest.ts re-pointed; tree compiles without the phrase seam
- [ ] Dead test cases pruned; feeders re-pointed; no orphaned test helpers

## Anti-Patterns to Avoid

- ❌ Deleting the phrase layer without re-pointing #bumpSuccessor feeding —
  the successor index starves and P1.M2 chaining fails silently
- ❌ Deleting #dropSuccessorFor callers without a bigram cap — unbounded
  successor index growth
- ❌ Touching query.ts/debug.ts beyond the minimal phrase-block deletion
  (T2.S2/T2.S3 own redesign; scope creep here risks conflicts)
- ❌ Rewriting test/successors.test.ts or chain.test.ts wholesale — re-point
  feeders only; full rewrites are P1.M1.T3.S3
- ❌ Modifying segment.ts (parallel sibling task owns it)
- ❌ Changing the onAdmittedTokens payload type in this task (P1.M1.T3.S2)

---

**Confidence Score: 9/10** — the deletion inventory is line-anchored from live
source, the new API is fully specified, every cross-file seam and test-prune
site is enumerated, and the two silent-failure risks (successor starvation,
unbounded index) are explicitly designed around.
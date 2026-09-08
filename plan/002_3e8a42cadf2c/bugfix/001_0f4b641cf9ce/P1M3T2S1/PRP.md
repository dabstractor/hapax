# PRP — P1.M3.T2.S1: Loop the batched eviction until the map is within BIGRAM_CAP

## Goal

**Feature Goal**: Close BUG-006 (Minor). `#evictBigramsIfOverCap`
(src/core/store.ts ≈L539–563) currently pops at most `BIGRAM_EVICT_BATCH =
256` victims per `recordBigramRuns` call, so a single message containing more
than ~10,256 distinct bigrams leaves the map **over its 10,000-key hard cap**
until further messages arrive (measured: an 11,000-bigram message left
`bigramSize` at 10,714; PRD §06 h2.38: "Cap the bigram map at 10,000 keys").
Fix per the PRD recommendation (code fix, not spec documentation): wrap the
256-pop batch in an outer loop so `#evictBigramsIfOverCap` returns **only when
`this.#bigrams.size <= BIGRAM_CAP`** — within the same `recordBigramRuns`
call — while keeping the inner batch constant for heap pacing and stale-node
hygiene.

**Deliverable**:
1. Modified `src/core/store.ts` — outer-loop drain in `#evictBigramsIfOverCap`
   + JSDoc rewrite (Mode A: same-call cap guarantee replaces batch-bounded
   wording) in that method and in `recordBigramRuns`'s overflow comment
   (≈L444–445) and the `BIGRAM_EVICT_BATCH` constant comment (≈L93).
2. Modified `test/bigrams.test.ts` — TDD: red test first (11k-bigram
   single-call flood ⇒ `bigramSize <= 10_000` immediately); REWRITE the
   now-contradictory "drains gradually" test; keep policy assertions
   (lowest bigramSortKey first, successor splicing).

**Success Definition**: `npm run check` and `npm test` green; one call of
`recordBigramRuns` with 11,000 distinct bigram runs leaves
`store.bigramSize <= 10_000` with **no further messages**; eviction order and
successor splicing unchanged; perf sanity for the 11k case stays far under the
3× perf-gate ceiling.

## Why

- PRD §06 h2.38: "Cap the bigram map at 10,000 keys with the standard
  eviction policy" — a hard cap that is observably violated (and stays
  violated indefinitely if the session goes quiet) is a spec deviation, even
  though the memory impact is small.
- Bug-hunt measured (BUG-006, see selected_prd_content h3.5): one ingested
  message with 11,000 bigrams → `bigramSize` 10,714; `topSuccessors('w0a')`
  already evicted; cap restored only after ~3 further messages.
- Output is consumed by P1.M4.T1.S1 (full regression re-verification).

## What

### Behavior contract

1. **The change** (src/core/store.ts ≈L539–563). Current shape:
   ```ts
   #evictBigramsIfOverCap(): void {
     if (this.#bigrams.size <= BIGRAM_CAP) return;
     let heap = this.#bigramEvictHeap;
     if (heap === null) heap = this.#rebuildBigramHeap();
     let batch = BIGRAM_EVICT_BATCH;
     while (this.#bigrams.size > BIGRAM_CAP && batch-- > 0) {
       // pop → stale? re-push : delete + #dropSuccessorFor
     }
     if (heap.length > 2 * this.#bigrams.size + 64) {
       this.#rebuildBigramHeap();
     }
   }
   ```
   New shape — outer do/while, inner batch RESET each round:
   ```ts
   #evictBigramsIfOverCap(): void {
     if (this.#bigrams.size <= BIGRAM_CAP) return;
     let heap = this.#bigramEvictHeap;
     if (heap === null) heap = this.#rebuildBigramHeap();
     // BUG-006 (P1.M3.T2.S1): the cap is a SAME-CALL guarantee. Each round
     // pops at most BIGRAM_EVICT_BATCH victims — the batch stays the pacing
     // unit (heap pops amortized, stale nodes re-validated in bounded
     // chunks) — but rounds repeat until the map is within BIGRAM_CAP.
     do {
       let batch = BIGRAM_EVICT_BATCH; // reset per round
       while (this.#bigrams.size > BIGRAM_CAP && batch-- > 0) {
         const node = heapPop(heap);
         if (node === undefined) break; // heap exhausted — defensive only
         const live = this.#bigrams.get(node.key);
         if (live === undefined) continue; // evicted since — stale node
         const k = bigramSortKey(live);
         if (k !== node.k) {
           heapPush(heap, { k, key: node.key });
           continue; // re-indexed; keep popping
         }
         this.#bigrams.delete(node.key);
         this.#dropSuccessorFor(node.key);
       }
     } while (this.#bigrams.size > BIGRAM_CAP);
     if (heap.length > 2 * this.#bigrams.size + 64) {
       this.#rebuildBigramHeap();
     }
   }
   ```
   The `this.#bigramEvictHeap` field must be kept in sync with the local
   `heap` exactly as the current code does (check how the local is written
   back — if the current code assigns `this.#bigramEvictHeap = heap` after
   rebuild, keep that; verify against the live file; `#rebuildBigramHeap`
   already stores/returns the new heap — confirm and preserve its contract).
   **Termination argument** (put it in a comment): each inner round deletes
   ≥ 0 entries; the only no-delete churn is stale re-pushes, and each
   re-push corrects a node's key to the live entry's CURRENT key — a node
   can be stale at most once per live-entry mutation, so the total
   stale-pop work is bounded and rounds strictly make progress once stale
   nodes are drained. (Defensive backstop: if you observe any risk of a
   pathological loop, add a bounded `rounds` guard of e.g.
   `Math.ceil(size / BIGRAM_EVICT_BATCH) * 4` with a final wholesale
   rebuild-and-drain fallback — but the do/while alone is the intended fix.)

2. **JSDoc (Mode A)** — rewrite:
   - `#evictBigramsIfOverCap`'s "Semantics per pass" paragraph (≈L529–531):
     replace "at most BIGRAM_EVICT_BATCH pops per call — the drain is spread
     across recordBigramRuns calls instead of stalling one message" with the
     SAME-CALL guarantee: "rounds of at most BIGRAM_EVICT_BATCH pops repeat
     until the map is within BIGRAM_CAP, within the single
     recordBigramRuns call — the batch is the pacing unit, not a cap on
     total work (BUG-006)". Keep the COST paragraph and the stale-node /
     rebuild explanation.
   - `BIGRAM_EVICT_BATCH` constant comment (≈L91–94): replace
     "a saturated map drains gradually across calls instead of stalling one
     message" with "each eviction round pops at most this many victims,
     pacing heap work; rounds repeat within one call until the map is
     within BIGRAM_CAP (same-call cap guarantee, BUG-006 fix)".
   - `recordBigramRuns`'s tail comment (≈L444–445 and the call-site comment
     ≈L470): change "trims toward BIGRAM_CAP" wording to "drains to
     BIGRAM_CAP within this call".

3. **Policy unchanged**: victims are still lowest `bigramSortKey`
   (log(count) + lastSeenOrdinal/50, byte-lex tiebreak) first; eviction
   still splices via `#dropSuccessorFor`; the wholesale rebuild guard
   (`heap.length > 2 * size + 64`) still applies after the drain.

4. **Test rewrite required — the existing "drains gradually" test now
   contradicts the contract** (test/bigrams.test.ts ≈L103–109):
   `flood(s, 10_300)` then `expect(s.bigramSize).toBe(10_044)` asserts the
   batch-bounded behavior being deleted. It MUST be rewritten (see Task 2).
   The other cap tests ("inserting the 10,001st distinct bigram evicts
   exactly to cap" → 10_000; "an evicted bigram's successor is spliced")
   remain valid and must still pass unchanged.

### Success Criteria

- [ ] TDD red→green: `flood(s, 11_000)` in ONE `recordBigramRuns` call →
      `bigramSize <= 10_000` immediately
- [ ] Eviction policy assertions unchanged and passing (lowest sort key
      first, successor spliced)
- [ ] The old batch-bounded test rewritten to the same-call guarantee
- [ ] Perf sanity: 11k-bigram ingest far under 3× the perf-gate ceiling
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

All line references read from the current tree. Key facts verified:
`BIGRAM_CAP = 10_000` (store.ts ≈L88, NOT exported), `BIGRAM_EVICT_BATCH =
256` (≈L93, not exported), `#evictBigramsIfOverCap` ≈L539–563,
`recordBigramRuns` ≈L452 with tail call ≈L470, `bigramSortKey` ≈L120,
`heapPush/heapPop` ≈L155/169, `#rebuildBigramHeap` ≈L566+ (bottom-up
heapify, O(n)), `#dropSuccessorFor` ≈L605, `get bigramSize()` ≈L630.

### Documentation & References

```yaml
- file: src/core/store.ts
  why: THE only source edit — #evictBigramsIfOverCap (~539), the three
        JSDoc/comment sites (BIGRAM_EVICT_BATCH ~91, recordBigramRuns
        ~444/470, the method's own "Semantics per pass" ~529)
  pattern: lazy min-heap with stale-node re-push; wholesale rebuild when
        heap.length > 2*size+64
  gotcha: keep the batch counter INSIDE the outer loop (reset per round);
        a batch counter declared outside makes the outer loop spin without
        popping once the counter is exhausted

- file: test/bigrams.test.ts
  why: THE test home — flood(s, n) helper (~L80: n runs of [`w${i}`, "end"]
        in ONE recordBigramRuns call), cap describe (~L77), the three
        existing cap tests including the one to REWRITE (~L103–109)
  pattern: real CandidateStore, no mocks; exact bigramSize assertions
  gotcha: all-count-1-same-ordinal floods make victim order pure byte-lex
        on the key ("w0 end" < "w1 end" < ...) — that's what the policy
        assertions rely on

- file: src/pi/ingest.ts (processText / onAdmittedTokens seam)
  why: the pipeline test path — one processText of a multi-line message
        feeds recordBigramRuns once per message (one tail pass per call,
        now draining fully); the 11k repro uses the real pipeline
  pattern: makePipeline-style harness in test/ingest-pipeline.test.ts if
        the end-to-end 11k test is hosted there; bigrams.test.ts flood()
        is sufficient for the unit-level cap guarantee
  gotcha: the PRD repro ingests 'v<i>a v<i>b' LINES — each line is a run;
        words must be admission-admitted (rare, non-secret-shaped) to
        reach onAdmittedTokens; 'v123a'-style keys are safe

- docfile: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/prd_snapshot.md (h3.5)
  why: BUG-006 statement + measured numbers (11,000 → 10,714) + the
        recommended fix (loop the 256-batch until within cap)

- file: test/perf-gates.test.ts
  why: perf sanity ceiling reference (3x budget convention) for the 11k
        ingest case
```

### Current Codebase tree (relevant)

```bash
src/core/store.ts        # CandidateStore: recordBigramRuns, #evictBigramsIfOverCap  <-- edit
test/bigrams.test.ts     # bigram cap suite                                   <-- edit
```

### Desired Codebase tree

```bash
src/core/store.ts        # outer-loop drain + Mode A JSDoc at three sites
test/bigrams.test.ts     # + same-call guarantee tests; rewritten gradual-drain test
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: the existing test at bigrams.test.ts ~L103-109 asserts the OLD
// batch-bounded behavior (10_300 flood → 10_044, then flood(0) → 10_000).
// After the fix it FAILS by design — rewrite it, don't weaken the fix.
// CRITICAL: reset `batch` inside the outer loop. A shared counter + outer
// do/while = infinite-free but zero-progress spin risk if written wrong.
// GOTCHA: BIGRAM_CAP and BIGRAM_EVICT_BATCH are module-private (not
// exported) — tests assert the literal 10_000 / behavior, not constants.
// GOTCHA: the local `heap` and this.#bigramEvictHeap must stay in sync —
// read the live method and preserve its existing write-back (rebuild path).
// GOTCHA: relative imports need .js extensions (NodeNext ESM); vitest;
// `npm run check` = tsc --noEmit is the only linter.
// GOTCHA: stale-node re-push inside the batch decrements `batch` too —
// that's fine and intended (bounded churn per round); rounds repeat.
```

## Implementation Blueprint

### Data models and structure

No data-model changes — control-flow only (outer loop) plus comments.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: RED — add the same-call guarantee test to test/bigrams.test.ts
  - ADD to the cap describe:
      it("drains to cap within the SAME recordBigramRuns call (BUG-006)", () => {
        const s = new CandidateStore();
        flood(s, 11_000); // one call, 1,000 over cap — needs ~4 batches
        expect(s.bigramSize).toBeLessThanOrEqual(10_000);
        expect(s.bigramSize).toBe(10_000); // exact: evicts exactly the overflow
      });
  - RUN it: must FAIL on current code (returns 10_714-ish). TDD red.

Task 2: GREEN — modify #evictBigramsIfOverCap in src/core/store.ts
  - WRAP the existing while-batch in the outer do/while per "What" §1,
    with `let batch = BIGRAM_EVICT_BATCH;` moved INSIDE the outer loop
  - PRESERVE verbatim: early return, lazy heap build, stale re-push,
    delete + #dropSuccessorFor, heap-exhausted break, the post-drain
    rebuild guard, and however the local heap is written back to
    this.#bigramEvictHeap (read the live code first)
  - RUN Task 1's test: green

Task 3: REWRITE the contradicted gradual-drain test (bigrams.test.ts ~L103)
  - REPLACE "a saturated map drains gradually..." with:
      it("a large overflow drains fully in one call; a later no-op call
         changes nothing", () => {
        const s = new CandidateStore();
        flood(s, 10_300);
        expect(s.bigramSize).toBe(10_000); // same-call guarantee
        flood(s, 0); // empty call: still within cap → no-op
        expect(s.bigramSize).toBe(10_000);
      });
  - KEEP unchanged: "inserting the 10,001st distinct bigram evicts exactly
    to cap" and "an evicted bigram's successor is spliced from the index"
    (policy still holds — if either breaks, the fix regressed ordering)

Task 4: ADD policy-preservation assertions for the multi-batch drain
  - EXTEND (or add) a test: flood(s, 11_000) → the lexically-lowest 1,000
    keys are gone ("w0 end" .. "w999 end" style — verify against flood()'s
    `w${i}` naming/byte-lex ordering) and a survivor ("w10000 end") keeps
    its successor [{ next: "end", count: 1 }]; i.e. multi-round eviction
    still picks lowest bigramSortKey first

Task 5: END-TO-END repro (PRD steps, real pipeline) — small companion test
  - HOST: test/bigrams.test.ts (or ingest-pipeline.test.ts if the harness
    is easier there)
  - CONSTRUCT: real IngestPipeline + real CandidateStore (makePipeline-style;
    stub dict returning null = all-rare), onAdmittedTokens wired to
    store.recordBigramRuns exactly as src/pi/index.ts ~L182 wires it
  - REPRO: build text of 11,000 lines `v${i}a v${i}b` (distinct rare pairs);
    ONE `await pipeline.processText(text, false)`; then assert
    `store.bigramSize <= 10_000` IMMEDIATELY (no further messages)
  - NOTE: if admission shape rules reject 'v123a'-style keys (check
    shapeGate: vowel-less runs / entropy), pick pair words that pass
    (e.g. `v${i}ax v${i}bx`) — the point is 11k DISTINCT ADMITTED pairs

Task 6: PERF sanity
  - TIME the 11k case (a quick performance.now() around processText in a
    scratch vitest run or reuse test/perf-gates.test.ts conventions):
    the ~4 eviction rounds (~1,000 pops + successor splices) plus the
    one-time heap build must stay FAR under 3x the existing ingest
    perf-gate ceiling; if test/perf-gates.test.ts has a bigram/ingest
    budget, re-run it — it must stay green without budget inflation
  - NO permanent perf test is required by this task (P1.M4.T1.S1 owns
    regression re-measurement); a one-off sanity number recorded in the
    PR/commit message is enough

Task 7: MODE A JSDoc sweep (src/core/store.ts)
  - REWRITE the three comment sites per "What" §2 (method semantics,
    BIGRAM_EVICT_BATCH constant, recordBigramRuns tail wording)
```

### Implementation Patterns & Key Details

```ts
// The whole fix is ~5 lines of control flow. Guard rails:
// - inner `while (size > BIGRAM_CAP && batch-- > 0)` UNCHANGED.
// - outer `do { ... } while (this.#bigrams.size > BIGRAM_CAP);`
// - `let batch = BIGRAM_EVICT_BATCH;` INSIDE the do-block.
// - early `if (size <= BIGRAM_CAP) return;` unchanged (cheap no-op path).
// - the rebuild guard stays AFTER the outer loop (rebuild once per call
//   at most, exactly as today).
```

### Integration Points

```yaml
NO integration changes:
  - recordBigramRuns public signature unchanged; callers (ingest.ts seam,
    index.ts wiring, tests) untouched
  - BIGRAM_CAP stays module-private; no exports added
  - successor index, word store, prefix index: untouched
  - P1.M4.T1.S1 consumes the guarantee via bigramSize assertions only
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run check          # tsc --noEmit — the only linter
# Expected: clean (pure control-flow change; no type surface moves).
```

### Level 2: Unit Tests

```bash
npm test -- bigrams
npm test                # full suite — store/successors/chain/perf-gates green
# Expected: new + rewritten bigram tests pass; the ONLY intentionally
# deleted assertion is the old 10_044 gradual-drain expectation.
```

### Level 3: Integration Testing

Covered by Task 5's real-pipeline repro (processText → onAdmittedTokens →
recordBigramRuns → same-call drain). No runtime surface beyond the store.

### Level 4: Domain-Specific Validation

```bash
npm test -- -t "same recordBigramRuns call"   # the BUG-006 gate
npm test -- perf-gates                        # budget ceiling re-check
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean
- [ ] `npm test` fully green

### Feature Validation

- [ ] 11k-bigram single message ⇒ `bigramSize` ≤ 10_000 immediately
- [ ] Eviction policy (lowest bigramSortKey, successor splicing) unchanged
- [ ] 10_301st-bigram exact-cap test still passes untouched
- [ ] Perf sanity recorded, far under 3× ceiling

### Code Quality Validation

- [ ] Mode A JSDoc updated at all three sites (same-call guarantee)
- [ ] Batch reset inside the outer loop; termination comment present
- [ ] No public API/export changes

## Anti-Patterns to Avoid

- ❌ Don't keep a batch counter shared across outer rounds — zero-progress
  spin.
- ❌ Don't "fix" the failing old gradual-drain test by weakening the new
  guarantee — rewrite the test to the new contract.
- ❌ Don't replace the lazy heap with a full snapshot+sort (the COST
  paragraph explains why it exists).
- ❌ Don't export BIGRAM_CAP/BIGRAM_EVICT_BATCH just for tests.
- ❌ Don't touch the word-store eviction (EVICT_BATCH/STORE_CAP) — its
  batch semantics are per-PRD and separate.
- ❌ Don't add config surface — caps are baked (PRD §08 h2.47).

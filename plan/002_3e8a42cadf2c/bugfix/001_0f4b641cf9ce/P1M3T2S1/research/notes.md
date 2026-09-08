# Research notes — P1.M3.T2.S1 (BUG-006: same-call bigram cap drain)

## Verified code facts (working tree)

- src/core/store.ts:
  - `BIGRAM_CAP = 10_000` (~L88) and `BIGRAM_EVICT_BATCH = 256` (~L93) —
    both module-private, NOT exported.
  - `recordBigramRuns(runs)` (~L452): upserts adjacent pairs, bumps the
    successor index via `#bumpSuccessor`, tail-calls
    `#evictBigramsIfOverCap()` ONCE (~L470).
  - `#evictBigramsIfOverCap()` (~L539–563): early return within cap; lazy
    `#rebuildBigramHeap()` on first overflow; single inner
    `while (size > BIGRAM_CAP && batch-- > 0)` loop popping the min-heap,
    re-pushing stale nodes (bigramSortKey mismatch), deleting live victims
    + `#dropSuccessorFor`; post-drain wholesale rebuild guard
    `heap.length > 2 * size + 64`.
  - `bigramSortKey` (~L120): log(count) + lastSeenOrdinal/50; byte-lex
    tie-break in heap comparator (`evictNodeBefore`).
  - `#rebuildBigramHeap` (~L566): bottom-up heapify O(n); check how the
    local `heap` variable is written back to `this.#bigramEvictHeap`.
  - `get bigramSize()` (~L630).
- test/bigrams.test.ts:
  - `flood(s, n)` (~L80): pushes n runs of `[`w${i}`, "end"]` in ONE
    recordBigramRuns call — all count 1, same ordinal → victim order pure
    byte-lex on key.
  - Cap tests (~L77–110): 10_001 → exactly 10_000 (KEEP); successor splice
    for "w0 end" (KEEP); **gradual-drain test ~L103–109 asserts 10_300 →
    10_044 then flood(0) → 10_000 — this CONTRADICTS the new same-call
    guarantee and must be REWRITTEN**.
- src/pi/ingest.ts / index.ts (~L182): `onAdmittedTokens: (runs) =>
  sessionStore.recordBigramRuns(runs)` — one call per message ⇒ one tail
  pass per message (the source of the bug).

## Bug (measured by the probe)

11,000-bigram single message → bigramSize 10,714; stays over cap until
~3 further messages trigger more 256-batches. PRD §06 h2.38's "Cap the
bigram map at 10,000 keys" is observably violated.

## Fix design (settled)

- Wrap the inner 256-batch in an outer `do { ... } while (size > BIGRAM_CAP)`
  with `batch` declared/reset INSIDE the do-block (shared counter = spin
  risk). Keep: early return, stale re-push, heap-exhausted break, post-loop
  rebuild guard. ~5 lines of control flow.
- Termination: each round deletes ≥0 entries; stale re-pushes are bounded
  (each corrects a node to its live key; a node goes stale at most once per
  mutation), so rounds make progress.
- Cost: 11k flood ⇒ one O(n) heap build + ~4 rounds × ≤256 pops + successor
  splices — microseconds-scale, far under perf-gate ceilings.

## Test plan (TDD)

1. RED: flood(s, 11_000) → expect bigramSize toBe 10_000 (fails today).
2. GREEN after the loop fix.
3. Rewrite gradual-drain test → 10_300 → 10_000 same call; flood(0) no-op.
4. Policy assertion: multi-round drain still evicts the lexically-lowest
   1,000 keys first; survivor keeps successor.
5. E2E repro: real pipeline + real store, one processText of 11,000
   'v<i>a v<i>b'-style lines (rare, shape-valid words — watch shapeGate
   vowel/entropy rules; use 'v<i>ax v<i>bx' if bare 'v123a' rejects).
6. Perf sanity: one-off timing vs perf-gates ceiling; P1.M4.T1.S1 owns the
   permanent regression re-measure.

## Mode A docs

Rewrite three comment sites: the method's "Semantics per pass" paragraph,
the BIGRAM_EVICT_BATCH constant comment, and recordBigramRuns' tail
wording — batch = pacing unit, cap = same-call guarantee.

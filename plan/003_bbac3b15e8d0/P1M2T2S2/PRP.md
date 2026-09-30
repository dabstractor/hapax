---
name: "P1.M2.T2.S2 (plan 003) — prefixRange → first-char range + perf gate re-basing (p99 hold)"
---

## Goal

**Feature Goal**: Re-point `rankMatches`'s scan entry to the **first-char bucket** (the anchored-fuzzy matcher's exact-anchor requirement, spec §04 h2.28 / §06 h2.38): the scan becomes `store.prefixRange(fragment[0].toLowerCase())` — the full fragment no longer restricts the range, because subsequence matches (`ze` → `zephyr`-shaped, not just `ze…`) must be scanned. Then re-base the perf fixtures/gates, which today measure a ~150-key `'co'` prefix range and thus UNDERSTATE the new ~n/26 (~770-key at 20k) scan, and confirm the <1 ms p99 budget / <3 ms CI gate actually holds.

**Deliverable**: Modified `src/core/query.ts` (scan-entry change in `rankMatches`, empty-fragment preserved), possibly a small `firstCharRange`-style helper in `src/core/store.ts` (optional — only if cleaner), re-based fixtures in `test/helpers/bench-fixtures.ts` + `test/perf-gates.test.ts` + `test/bench/core.bench.ts` (gate a / gate a2 now representative of first-char-range fuzzy scans), plus an optional loose zero-fragment sanity bound.

**Success Definition**: `rankMatches(store, 'co', …)` scans the full `'c'` bucket (tier-1 scattered matches like `'co'` inside `config`… wait, scattered = subsequence, e.g. `'co'` matching `chop`? no — anchored first char, so bucket = keys starting `'c'`, matches like `cxo…` subsequences) — i.e. membership equals `matchFragment` over the whole first-char bucket; empty fragment still lists the full store; gates a/a2 re-based to a ~770-key bucket measure p99 < 3 ms (CI) with actuals logged against the <1 ms budget; `npm run check` + `npm test` green.

## Why

- P1.M2.T1.S1's `matchFragment` is an **anchored fuzzy** matcher (first char exact + greedy subsequence + tiers 3/2/1). The current `rankMatches` scan (`store.prefixRange(lower)` over the WHOLE fragment) only ever sees exact-prefix keys — tier-2 (contiguous tail) and tier-1 (scattered) matches in the same first-char bucket are invisible. The spec (§06 h2.38) says the prefix index is "the scan entry point" *because of* the first-char anchor — the range must be the first-char bucket, not the fragment.
- Perf gates must be honest before this lands: the current fixture's `'co'` (~150 candidates) makes the gate trivially cheap under the new 5× wider scan. A green-but-unrepresentative gate would hide a budget breach.

## What

1. **query.ts scan entry** (in `rankMatches`, ~L302–307 — currently `const [start, end] = store.prefixRange(lower); const keys = store.sortedKeysSnapshot().slice(start, end);`):
   - Compute the bucket prefix: `const bucket = lower === "" ? "" : lower[0];`
   - Scan: `const [start, end] = store.prefixRange(bucket);` — identical lowerBound binary search + startsWith forward scan; the sorted-index entry point and the ordering invariant (prefixRange BEFORE sortedKeysSnapshot) are preserved.
   - Update the surrounding comments: the scan is the first-char bucket (anchored fuzzy anchor, §04 h2.28); the membership filter inside the loop (`matchFragment`) decides tier/threshold — it already runs for every scanned key.
   - `lower` is already lowercased before the call (prefixRange throws on uppercase) — `lower[0]` is therefore safe.
2. **store.ts: NO change required** (verify). `prefixRange("")` → `[0, n]` (zero-fragment full-store listing) and `prefixRange("c")` already do exactly the right thing, including the amortized INDEX_MERGE_BATCH=256 consolidation on entry. If a named helper reads cleaner, add `firstCharRange(ch)` **beside** `prefixRange` with identical consolidation semantics delegating to `prefixRange` — but a comment-only documentation touch on `prefixRange` (its JSDoc already says "the ONLY binary-search surface… query.ts consumes it exclusively") is acceptable and smaller.
3. **Re-base perf fixtures** (`test/helpers/bench-fixtures.ts`): keep/gain a HOT first char whose bucket is realistic — at STORE_CAP=20k a uniform-ish alphabet gives ~770 keys/char. Check `makeStore`'s key distribution: if keys derive from `makeSyntheticDict` words, pick the hottest first char empirically (or shape the fixture so one char's bucket is ~n/26) and update `HOT_PREFIX` (perf-gates.test.ts ~L49, core.bench.ts ~L42) to that single char. The gate's range sanity assertion (`range > 0`) should additionally assert the range is the FIRST-CHAR bucket size (e.g. `expect(range).toBeGreaterThan(300)` — honest non-degenerate scan) — pick the exact floor from the measured fixture.
4. **Gate a / gate a2 / bench gate a**: measurement loop unchanged (`rankMatches(store, HOT_PREFIX, {limit: 8})` — now a fuzzy scan over the bucket). Keep the CI bound `p99 < 3` and the logged actuals line; update bench names/comments that say "prefix 'co' (~150 range)" to the new first-char range description. Gate a2 (cold first query post-20k-fill) is unaffected mechanically — the consolidation path is unchanged — but re-verify its comment still tells the truth.
5. **Zero-fragment sanity (cheap, loose)**: the `#`-alone path now scans the FULL store (20k) with no matchFragment gate — previously the same ([0, n]) but now also sorting potentially thousands of matches under S1's new 4-key comparator before the top-8 slice. If cheap, add a loose bound (e.g. p99 of 50 zero-fragment queries < 10 ms, 10× budget, logged) — do NOT make it a hard CI gate; the spec budget covers the anchored hot path.
6. **DOCS: none** (per contract).

### Success Criteria

- [ ] `rankMatches` scans the first-char bucket: a scattered/tail match (non-prefix, same first char, above fuzzThreshold) appears in results — this is the new capability this enables (P1.M2.T2.S1's comparator orders it)
- [ ] Empty fragment still lists via `prefixRange("")`; `limit <= 0 → []` unchanged
- [ ] Gates a/a2 measure a ~770-key (or measured fixture-equivalent) first-char bucket; range sanity asserts a non-degenerate bucket; p99 < 3 ms CI bound holds with actuals logged
- [ ] Zero-fragment sanity bound present and loose (or explicitly documented as skipped if it proves flaky — log the decision in the PR/commit message)
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

An implementer with no prior knowledge needs: the exact current `rankMatches` scan lines, `prefixRange`'s contract (throws on uppercase, consolidation, [start,end) semantics), `matchFragment`'s anchor contract (S1, treat as done), S1's in-flight comparator changes (same file!), the three perf artifacts and their fixture, and what the ~770 number derives from. All below.

### Documentation & References

```yaml
- file: src/core/query.ts
  why: rankMatches (~L295-340): lowercase → prefixRange(lower) → snapshot slice
        → per-key matchFragment threshold gate (skipped for "") → get() →
        push → sort → plural-prune → slice. Change ONLY the range inputs
        (bucket = lower[0]); everything downstream already operates on the
        scanned keys.
  pattern: module doc "INDEX ORDERING INVARIANT" (prefixRange BEFORE
        sortedKeysSnapshot) and the ~L282 comment "Accepts any prefix casing —
        lowercased BEFORE prefixRange".
  gotcha: S1 (parallel, same file) is rewriting the sort/comparator and
        RankedMatch fields — your diff must touch ONLY the scan-entry lines
        and comments, leaving the loop body, sort, prune, slice to S1's
        version. Coordinate by rebasing on S1's landed code.

- file: src/core/store.ts
  why: prefixRange (L452-463): throws RangeError on non-lowercase; consolidates
        pending/tombstones first (INDEX_MERGE_BATCH=256 amortized); lowerBound
        binary search + startsWith forward scan; "" → [0, n]; no-match → [n, n];
        "the ONLY binary-search surface… query.ts consumes it exclusively".
  gotcha: NO behavior change wanted here. Optional firstCharRange helper only
        if it genuinely reads better — it must delegate to prefixRange with
        identical consolidation.

- file: plan/003_bbac3b15e8d0/P1M2T2S1/PRP.md
  why: SIBLING CONTRACT (in flight, same file): 4-key comparator, tier carried
        pre-sort, RankedMatch.sessionCount, zero-fragment ordering. Consume its
        output; do not conflict. Its zero-fragment re-point is ordering-only —
        your zero-fragment scan entry ("" → [0,n]) is already what exists.

- file: plan/003_bbac3b15e8d0/architecture/r3-query-fuzzy.md
  section: §3, §6
  why: The research note this contract cites: prefixRange is the only binary-
        search surface; the ~n/26 first-char bucket (~770 keys at 20k) vs the
        current ~150-key 'co' fixture understates the new scan; re-base before
        trusting <1 ms p99.

- file: test/perf-gates.test.ts
  why: Gate a (L~55-100): 1000-query p99, 3× budget CI bound, logged actuals,
        range sanity; gate a2: cold first query. Re-base HOT_PREFIX + range
        assertions + comments.
  pattern: dts array → sort → p99 = dts[ceil(0.99*N)-1]; console.log actuals.

- file: test/bench/core.bench.ts
  why: vitest bench gate a (~L56-61): "prefix 'co' (~150 range)" name/comment
        + bench options (warmup 100 iters). Re-base name/fixture.

- file: test/helpers/bench-fixtures.ts
  why: makeStore(STORE_CAP, seed) / makeSyntheticDict(DICT_WORDS) — determine
        the actual first-char distribution; pick/shape the hot char so the
        bucket is representative (~n/26 ≈ 770 at 20k; at least several
        hundred) and NOT degenerate.
  gotcha: keys come from the synthetic dict's words — measure the real bucket
        size with store.prefixRange(ch) per ch and pick the median/hottest.

- file: test/query.test.ts
  why: Membership tests for the new scan: a non-prefix same-first-char key
        above threshold now matches (previously invisible). Check whether
        S1's rewrite already added such cases; add only what's missing.
```

### Current Codebase tree (relevant)

```bash
src/core/query.ts             # MODIFY: rankMatches scan entry → first-char bucket
src/core/store.ts             # OPTIONAL: firstCharRange helper or comment touch-up only
test/helpers/bench-fixtures.ts# MODIFY: hot first-char fixture (representative bucket)
test/perf-gates.test.ts       # MODIFY: HOT_PREFIX, range sanity, gate a/a2 comments
test/bench/core.bench.ts      # MODIFY: gate a name/fixture
test/query.test.ts            # EXTEND (if S1 didn't): first-char-bucket membership cases
```

### Known Gotchas of our Codebase & Library Quirks

```typescript
// SI1BLING CONFLICT: S1 edits the SAME rankMatches body (sort/comparator/
// RankedMatch) in parallel. Sequence: rebase on S1's landed result; your edit
// is confined to the ~3 lines computing the range + adjacent comments.

// PREFIX SCAN WIDENING IS THE POINT: the old scan double-filtered (range
// startsWith fragment AND matchFragment); tier-2/tier-1 matches were silently
// unreachable. After the change, membership is decided SOLELY by
// matchFragment(+threshold) over the bucket — any test asserting old
// prefix-only membership must be re-based.

// CONSOLIDATION STAYS AMORTIZED: prefixRange already consolidates the pending
// tail on entry; calling it with a 1-char prefix changes nothing about
// INDEX_MERGE_BATCH behavior or the cold-start fix regression (gate a2).

// UPPERCASE FRAGMENT: lower[0] is taken AFTER toLowerCase() — keep the
// existing order (prefixRange throws RangeError on uppercase input).

// ~770 IS A DERIVED NUMBER: 20k keys / 26 ≈ 770 assumes rough uniformity; the
// real bucket size depends on makeSyntheticDict's word distribution. MEASURE
// (store.prefixRange per first char) and assert the chosen bucket's actual
// size range in the gate's sanity block — never hardcode 770.

// ZERO-FRAGMENT COST: "" → [0, 20000] means ~20k matchFragment SKIPS (gate
// skipped for "") + ~20k gets + a full sort of up to 20k matches before the
// top-8 slice. That sort was previously ~150 items under the old fixture —
// the honest zero-fragment measurement is the loose sanity bound; if it
// blows far past 10 ms, report back rather than silently loosening further
// (a bounded top-N selection is the documented fallback in query.ts's
// module doc — out of scope here, flag it).

// WARMUP MATTERS: keep the 100-iteration warmup (JIT + index consolidation)
// before timing; removing it makes p99 flaky in CI.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: REBASE on P1.M2.T2.S1's landed query.ts (comparator/sessionCount).
  If S1 has not landed, coordinate: your change must merge cleanly into its
  sort rewrite — touch only the scan-entry lines.

Task 1: MODIFY src/core/query.ts — first-char bucket scan
  - IN rankMatches after `const lower = prefix.toLowerCase();`:
      const bucket = lower === "" ? "" : lower[0];
  - CHANGE the range call: store.prefixRange(bucket)  (was: prefixRange(lower))
  - UPDATE adjacent comments: bucket = anchored-fuzzy first-char entry point
    (§04 h2.28, §06 h2.38); matchFragment(+threshold) is the sole membership
    filter; zero-fragment keeps prefixRange("").
  - NO loop-body/sort/prune/slice changes (S1's domain).

Task 2: MEASURE + RE-BASE fixtures
  - In test/helpers/bench-fixtures.ts (or a quick scratch check at impl time):
    for each 'a'-'z', record store.prefixRange(ch) width on the gate-A store;
    pick a representative char (target several hundred keys; document the
    measured width in a comment).
  - UPDATE HOT_PREFIX (perf-gates.test.ts, core.bench.ts) to that single char.
  - TIGHTEN the gate-a range sanity: expect(range).toBeGreaterThan(<measured
    floor, e.g. 300>) with a comment citing the ~n/26 rationale.
  - UPDATE bench/gate names + comments that still say "'co' (~150 range)".

Task 3: ADD zero-fragment loose sanity (perf-gates.test.ts)
  - NEW it(): ~50 iterations of rankMatches(gateAStore, "", {limit: 8});
    p99 < 10 ms hard-ish bound, actuals console.log'd, comment marking it a
    sanity bound (10× budget) not the spec gate. If impl-measured p99
    exceeds it materially, STOP and report (fallback: bounded top-N
    selection — flag, don't implement).

Task 4: EXTEND test/query.test.ts (only gaps not covered by S1's rewrite)
  - Membership: non-prefix same-first-char key above fuzzThreshold now
    matches (e.g. store keys 'crossover' & 'codec'; fragment 'cd' matches
    'codec' tier-3 AND scattered 'c…d…' keys in the c-bucket).
  - Negative: keys with a DIFFERENT first char never match (anchor holds).
  - Empty fragment unchanged ([0,n] listing, threshold bypass).

Task 5: VALIDATE
  - npm run check
  - npx vitest --run test/query.test.ts test/perf-gates.test.ts -v
  - npx vitest --run test/bench -v   (or npm run bench — informational actuals)
  - npm test
```

### Implementation pattern

```typescript
const lower = prefix.toLowerCase(); // BEFORE prefixRange — it throws on uppercase
// Anchored-fuzzy scan entry (§04 h2.28 / §06 h2.38): the first char is the
// exact anchor, so the sorted index's first-char bucket is the entry point —
// the FULL fragment no longer restricts the range (tier-1/2 subsequence
// matches live anywhere in the bucket). matchFragment + fuzzThreshold is
// the sole membership filter below. Empty fragment lists the whole store.
const bucket = lower === "" ? "" : lower[0];
const [start, end] = store.prefixRange(bucket);
```

### Integration Points

```yaml
NONE this task:
  - store.ts behavior unchanged; consumers of prefixRange elsewhere
    (debug.ts /acwords dump, adversarial storedKeys helper) keep working —
    verify with the full suite.
  - Downstream (do NOT implement): P1.M2.T3.S1 re-points the chain
    successor filter to the fuzzy membership gate; P1.M3 widget consumes
    rankMatches output unchanged.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/query.test.ts test/store.test.ts -v
npm test   # full suite green
```

### Level 3: Perf Gates (the point of this task)

```bash
npx vitest --run test/perf-gates.test.ts -v   # gates a/a2 (+ new zero-fragment sanity) — read the logged actuals
npx vitest --run test/bench -v                # informational measured actuals
# Gate a must now log a first-char bucket range (several hundred keys) and
# hold p99 < 3 ms; record the measured p99/median in the task report.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors; `npm test` all green
- [ ] No behavior change in store.ts (or only an additive delegating helper)

### Feature Validation

- [ ] Scan entry = first-char bucket; scattered/tail matches reachable; anchor (different first char) never matches
- [ ] Empty fragment → prefixRange("") full-store listing, threshold bypass, unchanged
- [ ] Gates re-based: representative bucket size asserted, comments truthful, actuals logged, p99 < 3 ms holds
- [ ] Zero-fragment loose sanity present (or explicitly reported as skipped with reasoning)

### Code Quality Validation

- [ ] Diff confined to scan-entry lines + fixture/gate files; S1's comparator work untouched
- [ ] Measured bucket size documented in comments (no hardcoded 770)

## Anti-Patterns to Avoid

- ❌ Don't filter the bucket by the full fragment anywhere (comment or code) — that reverts the fuzzy capability
- ❌ Don't change prefixRange's contract, consolidation, or the RangeError guard
- ❌ Don't hardcode the ~770 figure — measure the fixture's real bucket
- ❌ Don't silently loosen the zero-fragment bound if it fails — report; top-N selection is a flagged fallback, not this task
- ❌ Don't edit S1's comparator/loop-body regions while it's in flight — rebase instead
- ❌ Don't drop the 100-iteration warmup from gate a

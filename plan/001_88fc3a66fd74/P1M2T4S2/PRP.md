# PRP — P1.M2.T4.S2: Prefix index — dirty-flag lazy rebuild + binary search

## Goal

**Feature Goal**: Add the prefix index to `CandidateStore` (created in
P1.M2.T4.S1): a lazily-maintained sorted array of lowercase keys enabling
O(log n) prefix-range queries, so the keystroke-path query (P1.M2.T5.S1)
stays under 1 ms (PRD §02 h3.1, §06 h2.35).

**Deliverable**:
- Modify `src/core/store.ts` (produced by S1 — treat its PRP as the
  contract) to add:
  - Private `#sortedKeys: string[]` and `#dirty: boolean` fields.
  - `upsert()` sets `#dirty = true` **only when a NEW key is created**
    (merges into existing keys do not dirty the index).
  - `prefixRange(prefix: string): [number, number]` — a half-open
    `[start, end)` index range into the sorted key array. If `#dirty`,
    first rebuild via `Array.from(this.#map.keys()).sort()` (default
    JS sort = UTF-16 code-unit order, i.e. byte-lexicographic for
    lowercase ASCII keys) and clear the flag. Then two binary searches:
    lower bound of `prefix` (first key ≥ prefix), and first key that does
    NOT start with `prefix`.
  - Read-only accessor `sortedKeysSnapshot(): string[]` (defensive copy)
    for tests/inspection.
- Modify/extend `test/store.test.ts` (or add `test/store-prefix.test.ts`
  if S1's file has diverged — prefer extending S1's file with a new
  `describe("prefix index")` block) covering: rebuild correctness after
  dirty, no-rebuild when only merges occur, 20k-key correctness and
  rebuild-then-query, interleaved insert/query sequences, empty-prefix and
  no-match ranges, and an assertion that `prefixRange` receives a
  **lowercased** prefix (uppercase input is a caller bug — throw
  `RangeError` or assert-fail; see gotcha below).

**Success Definition**: `npm run check` and `npm test` pass; `prefixRange`
is the ONLY public surface for binary-searching the store (query.ts will
consume it exclusively — nothing else may binary-search); upsert remains
O(1) for merges and O(1) for new keys (dirty flag only, no sort on insert).

## Why

- PRD §06 h2.35: the prefix index is maintained at ingest time "for
  query-time speed: a sorted array of lowercase keys (rebuilt lazily:
  marked dirty on insert, re-sorted on next query if dirty — restores
  insert ~20k items once, then binary-search per keystroke). Query =
  binary search for prefix range + gather + salience sort of the range +
  top 8."
- PRD §02 h3.1: query path is synchronous on every keystroke, must
  complete < 1 ms, "No allocation-heavy work; the store's prefix index is
  maintained at ingest time." Lazy rebuild amortizes the ~20k sort over
  many inserts; only one sort happens at the next query.
- Downstream: P1.M2.T5.S1 (`query.ts rankMatches`) calls `prefixRange`
  then gathers `map.get(sortedKeys[i])` for i in the range. Eviction
  (S3) must set `#dirty = true` when it removes keys (note for S3, not
  this item — but design `prefixRange` so it re-derives from the map,
  never holds stale references).

## What

### Behavior contract

1. `upsert()` on a key absent from the map → create entry (S1 semantics)
   AND `this.#dirty = true`. On a merge (key present) → do NOT touch the
   flag (sort order is unaffected by count/flag/display updates).
2. `prefixRange(prefix)`:
   - Precondition: `prefix === prefix.toLowerCase()` — lowercase keys
     would never match an uppercase prefix, so an uppercase prefix
     indicates a caller bug. Enforce with `if (prefix !== prefix.toLowerCase()) throw new RangeError(...)`.
   - If `#dirty`: `#sortedKeys = Array.from(this.#map.keys()).sort();`
     `#dirty = false;`
   - `start` = lowerBound(#sortedKeys, prefix) — index of first
     `k >= prefix`.
   - `end` = first index `i >= start` where `!#sortedKeys[i].startsWith(prefix)`.
     Compute as lowerBound for the "prefix upper bound": the smallest
     string greater than every string starting with `prefix`. Simple
     robust approach: increment the last char's code point
     (`prefix.slice(0, -1) + String.fromCharCode(last + 1)`, handling
     `{` (0x7B) rollover by dropping the last char and bumping the
     previous), then lowerBound that; OR scan forward from `start` while
     `startsWith` holds (range is short in practice, but scan is
     O(range) — acceptable and simplest; prefer the arithmetic-bound
     approach for strict O(log n)). Either is acceptable; document choice.
   - Empty store or no matches → `[n, n]` (empty range, valid indices).
   - Empty string `""` prefix → `[0, size]` (every key starts with "").
3. Both binary searches must be **lower-bound** (leftmost insertion
   point) implementations — hand-rolled (no lodash; project has no
   deps beyond dev tooling). Standard `lo/hi` loop, `while (lo < hi)`.

### Success Criteria

- [ ] `prefixRange` returns exact `[start, end)` for all keys having the prefix and none else
- [ ] Index rebuilt only when dirty; merge-only upserts leave it clean (verify via `sortedKeysSnapshot` staleness or a test counter is impossible — verify behaviorally, see tests)
- [ ] 20k synthetic keys: correct range results; querying after bulk insert triggers exactly one rebuild (behaviorally: second `prefixRange` after no new inserts returns consistent results)
- [ ] Interleaved insert/query sequences always return correct results regardless of dirty state
- [ ] Uppercase prefix throws RangeError
- [ ] `upsert` still O(1) per call (no sort/scan — dirty flag only)
- [ ] `npm run check` + `npm test` pass; no other file modified

## All Needed Context

### Context Completeness Check

An implementer with zero codebase knowledge needs: the exact S1 API being
extended (below), the types (already in `src/core/types.ts`), PRD §06
h2.35 wording (quoted above), ESM NodeNext conventions, and the binary
search pattern. All provided here.

### Documentation & References

```yaml
- file: plan/001_88fc3a66fd74/P1M2T4S1/PRP.md
  why: CONTRACT for the store this item extends. Defines CandidateStore
        (Map<string,Candidate>, #ordinal, nextOrdinal/currentOrdinal,
        upsert, get, size, entries, rankGroupHistogram).
  pattern: "class CandidateStore { #map = new Map<string, Candidate>(); ... }"
  gotcha: "S1 is being implemented IN PARALLEL. If store.ts does not exist
        yet when you start, WAIT/re-check — do not recreate it from
        scratch. Your diff must only ADD #sortedKeys, #dirty, prefixRange,
        sortedKeysSnapshot, and the one dirty-flag line in upsert()."

- file: src/core/types.ts
  why: Candidate/Sighting definitions (import for types if needed; store.ts
        already imports them via S1).
  gotcha: Do not modify types.ts — no new shared types are needed; the
        return type is the tuple [number, number].

- file: test/store.test.ts (from S1)
  why: Existing test conventions (vitest, sighting() factory, PRD-citing
        header comments). Extend or mirror.
  pattern: "const sighting = (over: Partial<Sighting> = {}): Sighting => ({...})"

- docfile: plan/001_88fc3a66fd74/prd_snapshot.md
  why: PRD §06 h2.35 (prefix index paragraph) + §02 h3.1 (<1ms keystroke
        path) — authoritative contract, quoted in this PRP.
  section: "06 — Candidate Store / M1: word candidates"

- url: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
  why: Confirms default .sort() compares UTF-16 code units —
        byte-lexicographic for lowercase ASCII keys, exactly what the PRD
        means; no comparator needed.
  critical: Only add a comparator if non-ASCII keys were expected — they
        are not (segment.ts normalizes to lowercase ASCII word chars).

- url: https://en.cppreference.com/w/cpp/algorithm/lower_bound
  why: Canonical lower-bound binary search semantics (first element for
        which comp(elem, value) is false) — the loop shape to implement.
```

### Current Codebase tree (relevant part)

```bash
src/core/
  dictionary.ts score.ts segment.ts shapeGate.ts types.ts
  store.ts          # ← exists when you start (S1); MODIFY, don't recreate
test/
  store.test.ts     # ← S1's suite; EXTEND with describe("prefix index")
package.json        # scripts: check = tsc --noEmit, test = vitest --run
tsconfig.json       # ESM, NodeNext, ES2022
```

### Desired Codebase tree

```bash
src/core/store.ts      # MODIFIED — + prefix index (fields, dirty flag in upsert, prefixRange, sortedKeysSnapshot)
test/store.test.ts     # MODIFIED — + describe("prefix index") suite (or new test/store-prefix.test.ts)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: S1 runs in PARALLEL. Re-read src/core/store.ts before editing;
// if absent, do not author it — coordinate/wait. Your changes are additive.

// CRITICAL: keep upsert O(1). The ONLY new work in upsert is
//   if (created) this.#dirty = true;
// NEVER sort in upsert — that would break the 20k restore-replay budget.

// GOTCHA: default Array.prototype.sort() is UTF-16 code-unit order —
// correct for lowercase keys. Do NOT pass a localeCompare comparator
// (locale-aware ordering ≠ byte order and breaks binary search bounds).

// GOTCHA: prefix must be lowercased by the CALLER (query.ts lowercases
// the fragment). Enforce with the RangeError check — silently returning
// empty results on an uppercase prefix would hide caller bugs.

// GOTCHA: the half-open end bound. "First key not starting with prefix"
// can be computed either by (a) arithmetic successor of the prefix then
// lowerBound, or (b) forward scan from start while startsWith(prefix).
// (b) is O(range) — fine in practice, simplest, and immune to the 0x7A→0x7B
// rollover edge ('z' + 1 = '{' which sorts after all lowercase — actually
// makes arithmetic work, but 'z' itself needs care if non [a-z] chars
// appear). Prefer (b) for clarity unless profiling says otherwise.

// GOTCHA: end ≤ #sortedKeys.length is a VALID result (prefix reaches the
// array's end). Return the tuple as-is; callers iterate start..end exclusive.

// GOTCHA: deleting/evicting (S3, later) must dirty the index too — leave
// a short comment noting this so S3's implementer sees it.

// ESM NodeNext: relative imports already use ".js" suffix in store.ts.
```

## Implementation Blueprint

### Data models and structure

No new shared types. Additions to `CandidateStore`:

```ts
#sortedKeys: string[] = [];
#dirty = false;          // true when #sortedKeys may miss keys present in #map
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY baseline
  - READ src/core/store.ts (S1's output). Confirm class CandidateStore with
    #map, upsert with absent/present branches, get/size/entries exist.
  - If store.ts is missing, STOP — S1 has not landed; re-check before proceeding.

Task 2: MODIFY src/core/store.ts — index fields + dirty flag
  - ADD #sortedKeys / #dirty private fields (see blueprint above)
  - MODIFY upsert(): in the ABSENT branch only, after #map.set(...),
    add `this.#dirty = true;`
  - MERGE branch: no change
  - ADD comment near #dirty: "S3 eviction must also set dirty on removal."

Task 3: MODIFY src/core/store.ts — prefixRange + helpers
  - IMPLEMENT (see pattern block): prefixRange(prefix): [number, number]
  - IMPLEMENT private static lowerBound(arr: string[], target: string): number
  - IMPLEMENT sortedKeysSnapshot(): string[] (return [...this.#sortedKeys] —
    reflects last rebuild, NOT necessarily current map; document that)
  - JSDoc each method citing PRD §06 h2.35

Task 4: EXTEND test/store.test.ts
  - FOLLOW pattern: existing describe/it style + sighting() factory
  - COVERAGE: see test blueprint below
  - PLACEMENT: new describe("prefix index") block inside test/store.test.ts

Task 5: VALIDATE
  - npm run check && npm test
```

### Implementation Patterns & Key Details

```ts
/** PRD §06 h2.35: prefix range over the lazily-sorted key index.
 *  Caller (query.ts) must lowercase the fragment. */
prefixRange(prefix: string): [number, number] {
  if (prefix !== prefix.toLowerCase()) {
    throw new RangeError(`prefixRange: prefix must be lowercase, got "${prefix}"`);
  }
  if (this.#dirty) {
    // Default sort = UTF-16 code-unit (byte-lexicographic) order.
    this.#sortedKeys = Array.from(this.#map.keys()).sort();
    this.#dirty = false;
  }
  const start = CandidateStore.lowerBound(this.#sortedKeys, prefix);
  // First key not starting with prefix (forward scan; ranges are short).
  let end = start;
  const keys = this.#sortedKeys;
  while (end < keys.length && keys[end].startsWith(prefix)) end++;
  return [start, end];
}

/** Leftmost insertion point: first index i with arr[i] >= target. */
private static lowerBound(arr: string[], target: string): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;   // fast floor for non-huge arrays
    if (arr[mid] < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}
```

Test blueprint (`describe("prefix index")`):

1. **New key dirties**: insert "alpha", "beta" → prefixRange("al") ===
   [i, i+1) covering only "alpha". Insert "alpine" → prefixRange("al")
   now covers both ("alpha", "alpine" adjacent post-rebuild).
2. **Merge does NOT dirty / results stay correct**: upsert existing key
   twice; ranges unchanged and correct.
3. **No match**: prefixRange("zzz") on keys without it → [n, n] empty.
4. **Empty store**: prefixRange("a") → [0, 0].
5. **Empty prefix**: returns [0, size].
6. **Ordering correctness**: insert unsorted keys
   (["dog","cat","cow","cod"]) → prefixRange("co") covers exactly
   ["cod","cow"] contiguously.
7. **20k bulk**: generate 20k synthetic lowercase keys (e.g.
   `key-${i.toString(36)}` padded/deduped, mixed lengths 3–12). Query
   several prefixes; verify each returned range's keys all start with the
   prefix AND that the neighboring keys outside [start,end) do not, AND
   that the range equals brute-force `keys.filter(k => k.startsWith(p))`
   count. Then insert one more key, query again — still consistent.
8. **Interleaved**: loop { insert batch of 50 random keys; query 3
   prefixes; assert vs brute force } × 20 rounds — dirty-state
   transitions exercised repeatedly.
9. **Uppercase throws**: expect(() => s.prefixRange("Al")).toThrow(RangeError).
10. **sortedKeysSnapshot**: after rebuild, equals
    [...map keys].sort(); mutating the snapshot doesn't affect the store.

### Integration Points

```yaml
DOWNSTREAM:
  - P1.M2.T5.S1 query.ts rankMatches: consumes prefixRange(prefix) then
    gathers #map entries — it must access entries WITHOUT binary search.
    Consider adding `getAt(index: number): Candidate | undefined` helper?
    NO — keep scope tight; query.ts will combine sortedKeysSnapshot-like
    access via prefixRange + existing get(). But expose nothing extra here.
  - P1.M2.T4.S3 eviction: must set #dirty on removal (comment left in code).
CONFIG: none. DISK: none.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check        # tsc --noEmit — must be clean
```

### Level 2: Unit Tests

```bash
npx vitest --run test/store.test.ts   # S1 suite + new prefix suite all pass
npm test                              # full suite, no regressions
```

### Level 3: Integration (module-level sanity)

```bash
npx tsx -e "import('./src/core/store.ts').then(m => {
  const s = new m.CandidateStore();
  s.upsert({key:'hapax',display:'hapax',ordinal:s.nextOrdinal(),fromUser:false,properName:false,rankGroup:1,isSubword:false});
  s.upsert({key:'haptic',display:'haptic',ordinal:s.nextOrdinal(),fromUser:false,properName:false,rankGroup:1,isSubword:false});
  console.log(JSON.stringify(s.prefixRange('hap')));
})" 
# Expected: [0,2]
```

### Level 4: Performance sanity (informational; M4 owns real gates)

```bash
# 20k-insert rebuild + query must be well under 1 query-second total;
# steady-state (clean) prefixRange must be microseconds. A quick timing
# loop in tsx is sufficient confirmation:
npx tsx -e "import('./src/core/store.ts').then(m => {
  const s = new m.CandidateStore(); let o = 0;
  for (let i = 0; i < 20000; i++) s.upsert({key:'k'+i.toString(36).padStart(4,'0'),display:'x',ordinal:++o,fromUser:false,properName:false,rankGroup:1,isSubword:false});
  let t = performance.now(); s.prefixRange('k1'); const dirty = performance.now()-t;
  t = performance.now(); for (let i=0;i<1000;i++) s.prefixRange('k1'); const per = (performance.now()-t)/1000;
  console.log('rebuild(ms):', dirty.toFixed(2), 'clean query(ms):', per.toFixed(4));
})"
# Expected: rebuild low tens of ms; clean per-query << 0.01 ms
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run check` clean; `npm test` all pass
- [ ] Only store.ts + its test file modified/added

### Feature Validation
- [ ] prefixRange exactness verified against brute force (20k + interleaved tests)
- [ ] Dirty flag set only on new-key creation; rebuild happens at most once per dirtying batch
- [ ] Uppercase prefix rejected with RangeError
- [ ] upsert remains O(1) (no sort/scan added to it)
- [ ] Success criteria in "What" section all checked

### Code Quality Validation
- [ ] `.js` import suffixes preserved; no pi/* imports
- [ ] JSDoc cites PRD §06 h2.35 / §02 h3.1
- [ ] lowerBound is a correct leftmost-bound binary search
- [ ] No localeCompare / no external deps introduced
- [ ] Comment for S3 (eviction must dirty) present

## Anti-Patterns to Avoid

- ❌ Don't sort or rebuild inside upsert — lazy is the whole point
- ❌ Don't use localeCompare or a custom comparator — byte order via default sort
- ❌ Don't expose the raw #sortedKeys array — prefixRange + snapshot accessor only
- ❌ Don't add eviction/phrase/query logic (S3/P2/T5 items)
- ❌ Don't recreate store.ts if S1 hasn't landed — additive edits only
- ❌ Don't silently accept uppercase prefixes — throw, don't return empty

---

**Confidence Score: 9/10** — the contract is a small, well-specified
addition to a precisely-defined S1 class; PRD wording is quoted verbatim;
the only coordination risk (parallel S1) is mitigated by the verify-first
task and additive-edit rule.
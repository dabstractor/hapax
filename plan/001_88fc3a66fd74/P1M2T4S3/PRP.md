# PRP — P1.M2.T4.S3: Eviction — 20k cap, batch-256, ageFactor, userTyped protection

## Goal

**Feature Goal**: Add bounded-capacity eviction to `CandidateStore` so the
store never exceeds 20,000 entries during live ingest (P1.M3.T2.S2) or
session-restore replay (P1.M3.T2.S3). Eviction picks victims via
`evictionScore = salience(c) * exp(-(currentOrdinal - lastSeenOrdinal)/50)`
(PRD §06 h2.37), drops them in batches of 256, never removes `userTyped`
candidates unless `userTyped` alone exceeds the cap, and keeps the prefix
index (S2) consistent by marking it dirty on removal.

**Deliverable**: Modify `src/core/store.ts` — add exported constants
`STORE_CAP = 20_000` and `EVICT_BATCH = 256`, a private `evictIfOverCap()`
method invoked at the end of every `upsert()`, and prefix-index dirtying on
removal. Extend `test/store.test.ts` with a `describe("eviction")` suite per
PRD §09 (insert 20,001 → exactly one eviction, lowest evictionScore evicted,
userTyped survives).

**Success Definition**: `npm run check` and `npm test` pass; a store into
which arbitrary many sightings are upserted never exceeds
`STORE_CAP + (userTyped-overflow)` entries; eviction removes the
lowest-scoring non-userTyped entries in ≥256-sized batches (except the final
trim to exactly the cap).

## Why

- PRD §06 h2.37: hard cap 20,000 entries (sub-words count toward the same
  cap); overflow evicts lowest `evictionScore`, in batches of 256, never
  `userTyped` unless userTyped alone exceeds the cap.
- PRD §05 h2.33: cap applies during restore replay too — a huge history may
  evict early words; because eviction reuses the same `salience` formula,
  "survivors are the right survivors." At typical vocab sizes (~10–20k
  uniques/300k tokens) eviction rarely triggers, but the bound must exist.
- Downstream contract: live ingest (P1.M3.T2.S2) and restore (P1.M3.T2.S3)
  call `upsert` per sighting and rely on it alone for bounding — they will
  NOT call eviction explicitly. `evictIfOverCap` must therefore run inside
  `upsert` (end of method), NOT be a public API the pipeline must remember
  to call.

## What

### Behavior contract

1. **Trigger**: at the end of every `upsert()` call, if `this.#map.size >
   STORE_CAP`, run eviction. (Called "at the end of each ingest flush" in
   the item description; per-upsert invocation is the safe equivalent —
   cost is guarded by the size check, and restore replay uses upsert too.)
2. **Victim selection**:
   - Snapshot candidates via `entries()` (defensive copies — see gotcha
     about live objects).
   - Partition: `protected = userTyped`, `evictable = !userTyped`.
   - If `evictable.length === 0` (cap exceeded by userTyped alone), fall
     back to evicting from the userTyped pool as well — the cap is hard.
   - Compute `evictionScore(c, this.currentOrdinal())` for each candidate
     in the evictable pool (import from `./score.js` — single source of
     truth; never reimplement the math).
   - Sort **ascending** by score; deterministic tie-break: lower key wins
     eviction order via byte-lexicographic key comparison (matches
     compareCandidates's final tie-break; ties otherwise evict
     arbitrarily — make it deterministic for tests).
   - Number to evict: `this.#map.size - STORE_CAP`, but evict in batch
     steps of `EVICT_BATCH` (256): evict
     `min(EVICT_BATCH * ceil(needed / EVICT_BATCH), pool.length)` entries —
     i.e. round the eviction count UP to a multiple of 256 (that's the
     amortization: drop the sorted tail in 256-chunks), never evicting more
     than the available pool. For the canonical 20,001 → 20,000 case this
     still results in a batch of 256 being dropped, leaving 19,745 entries —
     wait, NO: see "Batch semantics" below.
3. **Removal**: `this.#map.delete(key)` per victim AND `this.#dirty = true`
   (S2's prefix index must rebuild — S2 left a comment in the code marking
   this obligation; honour it).
4. **userTyped protection**: userTyped entries are excluded from the
   evictable pool entirely (their scores are not even computed) unless the
   non-userTyped pool is empty while the cap is still exceeded.
5. **Constants**: export `STORE_CAP = 20_000` and `EVICT_BATCH = 256` as
   named top-level exports of `src/core/store.ts` (baked, not config —
   PRD §08 h2.47).

### Batch semantics (settled reading of PRD §06 h2.37)

"On overflow, evict in batches of 256 (sort snapshot, drop tail) to
amortize cost." The **unit test contract from PRD §09 / the item
description is unambiguous and MUST win**: "insert 20,001 → exactly one
eviction, lowest evictionScore evicted." Therefore:

- When overflow is 1 (20,001 entries), evict **exactly 1** entry — the
  lowest-scoring evictable one. `size` after === `STORE_CAP` === 20,000.
- The batch-of-256 amortization means: when overflow exceeds a single
  eviction's worth, drop victims in chunks of 256 from the sorted tail —
  evict `min(256 * ceil(needed/256) rounded behavior …)`. Simplest
  compliant rule: **evict `needed` victims (bringing size to exactly
  STORE_CAP), where the *sort* is done once over the snapshot (the
  amortized part); a full re-scan/sort is never done per victim.** The
  "batch" describes amortizing the sort/snapshot, not evicting extra
  entries. Choose this interpretation; the §09 test (exactly one eviction
  at 20,001) is the acceptance authority and it forbids evicting 256 when
  only 1 must go. Document this reading in a code comment.

### Success Criteria

- [ ] Upserting 20,001 distinct keys → `size === 20_000`, and the evicted
      key is the provably lowest `evictionScore` among non-userTyped entries
- [ ] A `userTyped` entry with the lowest score survives when any
      non-userTyped overflow exists
- [ ] When ALL entries are userTyped and cap is exceeded, eviction proceeds
      (hard cap wins) from the userTyped pool, lowest score first
- [ ] Eviction marks the prefix index dirty: a subsequent `prefixRange`
      returns ranges excluding evicted keys (S2 interplay)
- [ ] `STORE_CAP` and `EVICT_BATCH` exported; no magic numbers inline
- [ ] `evictionScore` imported from `./score.js`, never reimplemented
- [ ] `npm run check` + `npm test` pass

## All Needed Context

### Context Completeness Check

Implementer needs: the current `store.ts` (quoted/summarized below), S2's
prefix-index contract, `score.ts`'s `evictionScore` signature, PRD §06
h2.37 + §05 h2.33 (quoted above), and the §09 test contract. All here.

### Documentation & References

```yaml
- file: src/core/store.ts
  why: THE file to modify. Current state (S1 landed; S2 in parallel):
        class CandidateStore with #map: Map<string,Candidate>, #ordinal,
        nextOrdinal(), currentOrdinal(), upsert(sighting) (O(1), absent→
        create / present→merge), get(), get size, entries() (defensive
        shallow copies), rankGroupHistogram().
  gotcha: "S2 is being implemented IN PARALLEL and will add #sortedKeys,
        #dirty, prefixRange(), sortedKeysSnapshot(). If those are present,
        KEEP them and set #dirty on eviction; if absent when you start,
        code eviction to call a private markDirty() hook — coordinate:
        your eviction code should reference a single line
        `this.#dirty = true;` that either you add (if S2 hasn't landed) or
        reuse (if it has). Do NOT recreate or delete S2's code."

- file: src/core/score.ts
  why: IMPORT `evictionScore` (and nothing else needed) from here.
        Signature: evictionScore(c: Candidate, currentOrdinal: number): number
        = salience(c, currentOrdinal) * exp(-(currentOrdinal -
        c.lastSeenOrdinal) / 50). Single source of truth; store.ts's header
        comment says 'No scoring imports: eviction reads score.ts's
        evictionScore through its consumer' — that comment is now OUTDATED
        by this item: eviction lives IN the store, so store.ts now imports
        evictionScore from score.js. Update that header sentence.
  critical: "score.ts is PURE (type-only imports except Dictionary type) —
        no circular import risk: score.ts does not import store.ts."

- file: src/core/types.ts
  why: Candidate shape — fields used by eviction: key, lastSeenOrdinal,
        userTyped. Read-only; do not modify.

- file: test/store.test.ts
  why: Test conventions: vitest, `sighting(over)` factory
        (`const sighting = (over: Partial<Sighting> = {}): Sighting =>
        ({ key:'hapax', display:'hapax', ordinal:1, fromUser:false,
        properName:false, rankGroup:2, isSubword:false, ...over })`),
        PRD-citing describe blocks. Extend with describe("eviction").
  gotcha: "For 20k tests use unique keys (`w${i}`) and advance ordinals
        with the store's nextOrdinal() or explicit sighting.ordinal values;
        salience/evictionScore depend on ordinal deltas — construct scores
        deliberately (see test blueprint)."

- docfile: plan/001_88fc3a66fd74/prd_snapshot.md
  why: PRD §06 h2.37 (Eviction) and §05 h2.33 (Eviction interplay) —
        authoritative contracts, quoted in this PRP.
  section: "06 — Candidate Store / Eviction"

- file: plan/001_88fc3a66fd74/P1M2T4S2/PRP.md
  why: CONTRACT for the prefix index this item must keep consistent
        (#dirty on removal — S2's PRP explicitly reserves this for S3).
  pattern: "if #dirty: #sortedKeys = Array.from(#map.keys()).sort()"
```

### Current Codebase tree (relevant part)

```bash
src/core/
  score.ts    # evictionScore(c, currentOrdinal) — import from here
  store.ts    # MODIFY: constants, evictIfOverCap, dirty-on-remove, upsert hook
  types.ts    # read-only
test/
  store.test.ts   # EXTEND with describe("eviction")
package.json      # scripts: check = tsc --noEmit; test = vitest --run
```

### Desired Codebase tree

```bash
src/core/store.ts      # MODIFIED (additive)
test/store.test.ts     # MODIFIED (new suite)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: S2 runs in PARALLEL. Re-read store.ts immediately before
// editing; your diff must be additive (constants, evictIfOverCap, one line
// at end of upsert, #dirty set in eviction). Never delete S2 code.

// CRITICAL: upsert must stay effectively O(1) below cap: eviction work runs
// ONLY when size > STORE_CAP. The size check is the first line of the hook:
//   if (this.#map.size <= STORE_CAP) return;
// so normal ingest and 20k-and-under restores pay zero eviction cost.

// GOTCHA: entries() returns shallow COPIES — good: sorting the snapshot
// never mutates live candidates. Deleting still needs the key: use
// this.#map.delete(c.key).

// GOTCHA: ageFactor uses currentOrdinal() at eviction time, and salience's
// recency term uses it too — do NOT precompute a "now" per batch
// differently; one currentOrdinal() value for the whole pass.

// GOTCHA: overflow of exactly 1 must evict exactly 1 (PRD §09 authority —
// see "Batch semantics" above). Do NOT round eviction count up to 256.

// GOTCHA: currentOrdinal may be 0 (no message ordinals issued) in unit
// tests that pass explicit sighting.ordinal values — that's fine:
// evictionScore handles delta 0 or negative deltas gracefully (exp ≥ 1);
// prefer advancing ordinals realistically in tests anyway.

// GOTCHA: Math.exp(-delta/50) underflows to ~0 for huge deltas — an old
// unseen word scores ~0 and is correctly evicted first. Score ties at 0
// are broken by key byte order (make the comparator do this explicitly).

// ESM NodeNext: import { evictionScore } from "./score.js";
```

## Implementation Blueprint

### Data models and structure

No new types. Additions to `src/core/store.ts`:

```ts
/** Hard cap on stored word candidates (whole tokens AND sub-words count
 *  toward the same cap). PRD §06 h2.37; baked per PRD §08 h2.47. */
export const STORE_CAP = 20_000;
/** Eviction batch size — sorts/snapshots are amortized over drops of this
 *  many entries. PRD §06 h2.37. */
export const EVICT_BATCH = 256;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY baseline
  - READ src/core/store.ts. Confirm S1's class exists; note whether S2's
    #sortedKeys/#dirty/prefixRange have landed (parallel work).
  - READ src/core/score.ts exports: evictionScore exists (it does — verified).

Task 2: MODIFY src/core/store.ts — constants + import
  - ADD export const STORE_CAP / EVICT_BATCH (top of file after imports)
  - ADD import { evictionScore } from "./score.js";
  - UPDATE the module header comment sentence that says "No scoring imports"
    to state eviction imports evictionScore from score.js.

Task 3: MODIFY src/core/store.ts — eviction core
  - IMPLEMENT private evictIfOverCap(): void
    * early return if size <= STORE_CAP
    * const now = this.currentOrdinal();
    * snapshot = this.entries(); evictable = snapshot.filter(c => !c.userTyped)
    * if evictable.length < needed → include userTyped pool (hard cap):
      pool = evictable.length > 0 ? evictable : snapshot
      (and if pool still smaller than needed, evict the whole pool)
    * sort ascending: score = evictionScore(c, now); tie → c.key byte order
    * needed = this.#map.size - STORE_CAP
    * victims = pool.slice(0, needed)  // lowest scores = the sorted head
    * for each victim: this.#map.delete(v.key)
    * mark prefix index dirty (this.#dirty = true — S2's field; if S2 has
      not landed, still write the line guarded by a short TODO comment, or
      better: coordinate — re-read the file before finalizing)
  - HOOK: call this.evictIfOverCap() as the LAST statement of upsert().
    Note: eviction runs after BOTH create and merge branches — a merge can
    push size over? No, merges never change size; only the create branch
    can. Call it unconditionally at the end anyway (cheap, guarded).

Task 4: EXTEND test/store.test.ts — describe("eviction")
  - FOLLOW existing sighting() factory pattern
  - COVERAGE: see blueprint below

Task 5: VALIDATE — npm run check && npm test
```

### Implementation Patterns & Key Details

```ts
private evictIfOverCap(): void {
  // PRD §06 h2.37. Runs only on overflow; upsert below cap pays nothing.
  if (this.#map.size <= STORE_CAP) return;
  const now = this.currentOrdinal();
  const needed = this.#map.size - STORE_CAP;
  const snapshot = this.entries(); // defensive copies — sort freely
  let pool = snapshot.filter((c) => !c.userTyped);
  // Hard cap wins if userTyped alone exceeds it (or the evictable pool
  // can't cover the overflow).
  if (pool.length < needed) pool = snapshot;
  pool.sort((a, b) => {
    const d = evictionScore(a, now) - evictionScore(b, now);
    if (d !== 0) return d;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; // deterministic
  });
  // Batch-256 amortization = one snapshot+sort serves the whole drop
  // (PRD §09: overflow of 1 evicts exactly 1 — never round up to 256).
  const victims = pool.slice(0, Math.min(needed, pool.length));
  for (const v of victims) this.#map.delete(v.key);
  this.#dirty = true; // prefix index (S2) must rebuild — removals happened
}
```

Test blueprint (`describe("eviction (PRD §06 h2.37 / §05 h2.33)")`):

1. **20,001 → exactly one evicted**: loop i in 0..20_000 upsert
   `sighting({ key: `w${i}`, ordinal: i+1, rankGroup: 0 })` (all distinct,
   ascending ordinals — "w0" is oldest/lowest score: seen at ordinal 1,
   never again; later words have smaller deltas). Assert
   `s.size === STORE_CAP` (20,000) and `s.get("w0") === undefined` —
   the provably lowest evictionScore (oldest lastSeen, sessionCount 1,
   no bonuses). Verify with evictionScore directly in the test against a
   couple of near-ties if paranoid.
2. **Lowest score evicted, not oldest key order**: craft three entries
   with distinct (sessionCount, lastSeenOrdinal) so the lowest
   evictionScore is NOT the alphabetically-first; overflow by 1 → that
   entry gone, others present.
3. **userTyped survives**: 20,000 non-userTyped + 1 userTyped overflow
   where the userTyped entry has the lowest score → userTyped still
   present, lowest non-userTyped evicted instead.
4. **userTyped-only overflow evicts anyway**: fill STORE_CAP+1 entries ALL
   fromUser: true → size === STORE_CAP, the lowest-score userTyped entry
   evicted (hard cap wins).
5. **Mixed protection at scale**: 10,000 userTyped + 10,002 regular →
   overflow 2 → both victims non-userTyped; all userTyped retained.
6. **Prefix index interplay (if S2 landed)**: fill to overflow with keys
   sharing a prefix ("ev0".."ev20000"); evict; `prefixRange("ev")` range
   length === size; evicted keys absent. If S2's API is not present yet,
   guard with a comment and skip this case (S2 owns it).
7. **Sub-words count toward cap**: include `isSubword: true` sightings in
   the 20,001 loop — they evict identically (no special casing).
8. **Constants exported**: `expect(STORE_CAP).toBe(20_000)`,
   `expect(EVICT_BATCH).toBe(256)`.

### Integration Points

```yaml
DOWNSTREAM (consumers, do not implement here):
  - P1.M3.T2.S2 IngestPipeline: relies on upsert() alone for bounding.
  - P1.M3.T2.S3 session restore: replays history through upsert — eviction
    fires mid-replay per h2.33 ("survivors are the right survivors").
  - P2.M1.T1.S1 phrase store cap 10,000: "same eviction policy" — will
    mirror this pattern later; keep evictIfOverCap self-contained.
CONFIG: none — constants baked (PRD §08 h2.47 "not configurable").
DISK: none.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check    # tsc --noEmit — must be clean
```

### Level 2: Unit Tests

```bash
npx vitest --run test/store.test.ts   # full store suite passes (S1+S2+S3)
npm test                              # no regressions elsewhere
```

### Level 3: Module sanity (bounded under flood)

```bash
npx tsx -e "import('./src/core/store.ts').then(m => {
  const s = new m.CandidateStore();
  for (let i = 0; i < 50000; i++) s.upsert({key:'w'+i,display:'w'+i,ordinal:i+1,fromUser:false,properName:false,rankGroup:0,isSubword:false});
  console.log('size:', s.size, '(expect 20000)');
})"   # Expected: size: 20000
```

### Level 4: Performance sanity (informational)

```bash
# 50k upserts with the cap active must stay fast (sort of ~20k snapshot
# per overflow batch amortized); expect well under a few seconds total.
npx tsx -e "import('./src/core/store.ts').then(m => {
  const s = new m.CandidateStore(); const t = performance.now();
  for (let i = 0; i < 50000; i++) s.upsert({key:'w'+i,display:'x',ordinal:i+1,fromUser:false,properName:false,rankGroup:0,isSubword:false});
  console.log('elapsed ms:', (performance.now()-t).toFixed(0), 'size:', s.size);
})"
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run check` clean; `npm test` all pass
- [ ] Only `src/core/store.ts` and `test/store.test.ts` modified

### Feature Validation
- [ ] 20,001 insert → size 20,000, exactly one evicted, lowest score gone
- [ ] userTyped protected unless userTyped-only overflow; hard cap absolute
- [ ] Prefix index dirtied on removal (or S2-coordinated)
- [ ] STORE_CAP / EVICT_BATCH exported named constants
- [ ] evictionScore imported from score.js — math never duplicated
- [ ] Below-cap upserts unchanged (O(1), early return)

### Code Quality Validation
- [ ] `.js` import suffixes; no pi/* imports; no new deps
- [ ] JSDoc cites PRD §06 h2.37 / §05 h2.33
- [ ] Deterministic tie-break documented
- [ ] Header comment updated (store now imports score.ts)
- [ ] No config/env reads for cap or batch size

## Anti-Patterns to Avoid

- ❌ Don't reimplement salience/ageFactor math in store.ts — import evictionScore
- ❌ Don't round eviction counts up to 256 — §09's "exactly one eviction" test is authoritative
- ❌ Don't evict userTyped while any non-userTyped overflow relief exists
- ❌ Don't run eviction cost (snapshot/sort) when size ≤ STORE_CAP
- ❌ Don't sort/scan inside the merge branch of upsert
- ❌ Don't delete or rewrite S2's prefix-index code — additive edits only
- ❌ Don't make cap/batch configurable — PRD §08 h2.47 bakes them

---

**Confidence Score: 8/10** — precise PRD text, existing evictionScore
function verified in score.ts, clear §09 test contract. The two residual
risks: (1) parallel S2 edits to the same file (mitigated by verify-first +
additive-edit rule + dirty-flag coordination note), (2) the batch-256
interpretation is settled explicitly here in favor of the §09 authority.
# PRP — P1.M2.T4.S1: Candidate map, upsert semantics, ordinal counter

## Goal

**Feature Goal**: Implement `CandidateStore` in `src/core/store.ts` — the
per-session word-candidate map (one entry per lowercase key) with exact
PRD §06 upsert semantics and a per-session monotonic message ordinal counter.
No persistence, no prefix index (S2), no eviction (S3), no phrases (P2).

**Deliverable**:
- New file `src/core/store.ts` exporting `class CandidateStore` with:
  - `nextOrdinal(): number` — increments and returns the message ordinal; the
    ingest pipeline calls this ONCE per message BEFORE processing that
    message's sightings.
  - `currentOrdinal(): number` — the ordinal most recently issued (0 before
    any call).
  - `upsert(sighting: Sighting): void` — PRD §06 semantics (below).
  - `get(key: string): Candidate | undefined` — exact lowercase key lookup.
  - `get size(): number` — entry count.
  - `entries(): Candidate[]` — defensive snapshot copy of all values
    (test/inspection surface; used by S2/S3//acwords later).
  - `rankGroupHistogram(): Record<RankGroup, number>` — counts per group
    0/1/2 over current entries.

**Success Definition**: `npm test` and `npm run check` pass with a new
`test/store.test.ts` covering every upsert branch (create, merge, flag OR-in,
display refresh, rankGroup min, ordinal counter monotonicity); zero changes
to `src/core/types.ts` or any other existing file.

## Why

- The store is the heart of the core pipeline (segment → shapeGate → score →
  **store** → query). It consumes `Sighting` objects already defined in
  `src/core/types.ts` and is consumed by:
  - P1.M2.T4.S2 (prefix index — will hook insert to mark an index dirty),
  - P1.M2.T4.S3 (eviction — uses `entries()` + `currentOrdinal()`),
  - P1.M2.T5.S1 (query), P1.M3.T2.S3 (restore replay), P1.M3.T4.S1 (/acwords).
- One entry per lowercase key with `display` = most recent casing is the
  settled PRD §04/§06 casing-merge decision: casing variants (e.g. `Hapax`,
  `hapax`, `HAPAX`) must merge into a single entry.

## What

New class `CandidateStore`, pure in-memory, no I/O, no imports beyond
`./types.js`.

### Upsert semantics (PRD §06 h2.36 — verbatim contract)

On `upsert(s)` where `s.key` is lowercase and `s.ordinal` is the message
ordinal of this occurrence:

- **Absent** → create entry:
  `{ key: s.key, display: s.display, sessionCount: 1,
     lastSeenOrdinal: s.ordinal, firstSeenOrdinal: s.ordinal,
     userTyped: s.fromUser, properName: s.properName,
     rankGroup: s.rankGroup, isSubword: s.isSubword }`
- **Present** → mutate in place:
  - `sessionCount++`
  - `lastSeenOrdinal = s.ordinal`
  - `display = s.display` (refresh casing to this sighting's — most recent wins)
  - `userTyped = userTyped || s.fromUser` (sticky once true)
  - `properName = properName || s.properName`
  - `rankGroup = Math.min(existing, s.rankGroup)` — a word first seen
    mid-frequency then seen rare keeps the better (lower) group.
  - `isSubword` NOT updated on merge (set at creation; a key's identity as
    subword is fixed by its first admission).

Ordinal counter: starts at 0; `nextOrdinal()` returns 1, 2, 3… strictly
monotonic, never reset. `currentOrdinal()` is read-only.

### Success Criteria

- [ ] `CandidateStore` exported from `src/core/store.ts` with the exact API above
- [ ] Absent→create and present→merge branches match the PRD semantics exactly
- [ ] Casing variants merge into one entry; `display` reflects most recent casing
- [ ] `userTyped`/`properName` are OR-in (sticky) — never unset by later sightings
- [ ] `rankGroup` = min(existing, new) on merge
- [ ] Ordinal counter is monotonic and `nextOrdinal()`/`currentOrdinal()` behave as specified
- [ ] `entries()` returns a defensive copy — mutating it does not affect the store
- [ ] `rankGroupHistogram()` returns exact counts keyed 0/1/2
- [ ] `npm test` and `npm run check` pass; no existing file modified

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase: they need to know that
`Candidate` and `Sighting` ALREADY EXIST in `src/core/types.ts` (do not
redeclare), that this is an ESM NodeNext project (`.js` import suffixes),
and vitest test conventions. All provided below.

### Documentation & References

```yaml
- file: src/core/types.ts
  why: Defines Candidate and Sighting verbatim — the store's whole data
        vocabulary. Read first; import from here.
  pattern: "export interface Candidate { key; display; sessionCount;
        lastSeenOrdinal; firstSeenOrdinal; userTyped; properName;
        rankGroup: RankGroup; isSubword }"
  gotcha: "Sighting carries fromUser (maps to Candidate.userTyped) and
        optional parentKey (subword lineage — IGNORED by the store; the
        parentKey clamp happens upstream in score.ts admit())."

- file: src/core/score.ts
  why: Upstream producer context — admit() decides rankGroup; P1.M2.T3.S2
        (parallel) adds salience/evictionScore there. NOT imported by store.
  pattern: Existing header-comment + JSDoc style citing PRD sections.
  gotcha: "Do NOT import score.ts into store.ts — this item needs no scoring.
        Eviction (S3) will use score.ts's evictionScore via the consumer."

- file: test/score.test.ts
  why: Test conventions — vitest describe/it/expect, header comment citing
        PRD section, small helper factories at top of file.
  pattern: "const draft = (key, isSubword=false): CandidateDraft => ({...})"

- docfile: plan/001_88fc3a66fd74/prd_snapshot.md
  why: PRD §06 (h2.35 candidate store, h2.36 upsert semantics) is the
        authoritative contract, reproduced in the What section above.
  section: "06 — Candidate Store"
```

### Current Codebase tree (relevant part)

```bash
src/core/
  dictionary.ts   # packed dict loader (done)
  score.ts        # admit() + thresholds (salience being added in parallel)
  segment.ts      # tokenize + normalization (done)
  shapeGate.ts    # gate rules (done)
  types.ts        # Candidate, Sighting, RankGroup, ... (done — READ-ONLY here)
test/
  score.test.ts segment.test.ts shapeGate.test.ts dictionary.test.ts ...
package.json     # scripts: check = tsc --noEmit, test = vitest --run
tsconfig.json    # ESM, NodeNext, ES2022
```

### Desired Codebase tree with files to be added

```bash
src/core/store.ts      # NEW — CandidateStore class (this item)
test/store.test.ts     # NEW — full unit suite for CandidateStore
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: ESM NodeNext — relative imports MUST use ".js" extension:
import type { Candidate, RankGroup, Sighting } from "./types.js";

// CRITICAL: src/core/ must never import pi packages (architecture invariant,
// stated in types.ts header).

// GOTCHA: upsert receives the ordinal IN the Sighting — the store must NOT
// call nextOrdinal() itself; the pipeline owns ordinal assignment. The
// counter methods exist so the pipeline (P1.M3.T2.S2) and eviction (S3)
// can read it.

// GOTCHA: Record<RankGroup, number> = { 0: n, 1: n, 2: n } — initialize
// all three keys to 0 so consumers never see undefined.

// GOTCHA: entries() must return a shallow COPY of each Candidate (spread),
// so later upserts can't mutate a previously-taken snapshot mid-test.

// PERFORMANCE (PRD §02 budgets): upsert must be O(1) Map work only —
// no sorting, no scanning, no per-insert index rebuild (S2 handles the
// index lazily). A 20k-entry restore replay must not degrade.
```

## Implementation Blueprint

### Data models and structure

No new types — reuse `Candidate`, `Sighting`, `RankGroup` from
`src/core/types.ts`. The class holds:

```ts
export class CandidateStore {
  #map = new Map<string, Candidate>();  // primary: lowercase key → entry
  #ordinal = 0;                          // last issued message ordinal
  // ...methods below
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/core/store.ts
  - IMPLEMENT: header comment citing PRD §06 h2.35/h2.36; class CandidateStore
    with private Map + ordinal field; methods nextOrdinal(), currentOrdinal(),
    upsert(sighting), get(key), get size(), entries(), rankGroupHistogram()
  - FOLLOW pattern: src/core/score.ts (module header comment style, JSDoc
    citing PRD sections, exported const style)
  - NAMING: class CandidateStore; camelCase methods
  - DEPENDENCIES: import type { Candidate, RankGroup, Sighting } from "./types.js"
  - PLACEMENT: src/core/store.ts

Task 2: CREATE test/store.test.ts
  - IMPLEMENT: vitest suite; local sighting() factory:
      const sighting = (over: Partial<Sighting> = {}): Sighting => ({
        key: "hapax", display: "hapax", ordinal: 1, fromUser: false,
        properName: false, rankGroup: 2, isSubword: false, ...over });
  - FOLLOW pattern: test/score.test.ts (header comment citing PRD §06,
    factory helpers, plain describe/it/expect)
  - NAMING: test/store.test.ts; describe blocks per method
  - COVERAGE (see test blueprint below)
  - PLACEMENT: test/store.test.ts (colocated flat test dir — matches all
    existing tests)

Task 3: VALIDATE
  - npm run check && npm test
```

### Implementation Patterns & Key Details

```ts
/** PRD §06 h2.36. The pipeline assigns the ordinal (via nextOrdinal())
 *  before processing a message's sightings; upsert never advances it. */
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
    return;
  }
  existing.sessionCount++;
  existing.lastSeenOrdinal = sighting.ordinal;
  existing.display = sighting.display;              // most recent casing wins
  existing.userTyped ||= sighting.fromUser;          // sticky
  existing.properName ||= sighting.properName;       // sticky
  existing.rankGroup = Math.min(existing.rankGroup, sighting.rankGroup) as RankGroup;
  // isSubword intentionally NOT merged — fixed at creation
}
```

Test blueprint (each as its own `it`):

1. **Counter**: `currentOrdinal() === 0` initially; `nextOrdinal()` returns
   1 then 2 then 3; `currentOrdinal()` tracks last issued.
2. **Create**: first upsert → `get("hapax")` matches full expected Candidate
   object (use `toEqual` with the literal); `size === 1`;
   `firstSeenOrdinal === lastSeenOrdinal === ordinal`.
3. **Merge counts**: second upsert same key → `sessionCount === 2`,
   `lastSeenOrdinal` updated, `firstSeenOrdinal` unchanged, `size` still 1.
4. **Casing merge**: upsert `{key:"hapax", display:"Hapax"}` then
   `{key:"hapax", display:"HAPAX"}` → one entry, `display === "HAPAX"`.
5. **userTyped sticky**: create with `fromUser: false`, then upsert
   `fromUser: true` → true; then upsert `fromUser: false` again → STILL true.
6. **properName OR-in**: analogous with properName.
7. **rankGroup min**: create with `rankGroup: 2`, upsert `rankGroup: 1` → 1;
   then upsert `rankGroup: 2` → still 1.
8. **isSubword fixed at creation**: create `isSubword: false`, upsert
   `isSubword: true` → stays false.
9. **entries() defensive copy**: take snapshot, mutate
   `snapshot[0].sessionCount`, assert store's entry unaffected; also assert
   array length === size.
10. **rankGroupHistogram**: seed one entry per group (+duplicates) →
    `{ 0: <count0>, 1: <count1>, 2: <count2> }`; empty store → all zeros.
11. **get() miss** returns undefined; **size 0** on fresh store.

### Integration Points

```yaml
DOWNSTREAM (no wiring in this item — just be consumable):
  - P1.M2.T4.S2 (prefix index): will observe inserts; keep upsert free of
    index concerns now (S2 will add a dirty flag inside store.ts itself).
  - P1.M2.T4.S3 (eviction): consumes entries() + currentOrdinal() + score.ts
    evictionScore; needs the O(1) upsert invariant preserved.
  - P1.M3.T2.S3 (restore replay): will upsert ~20k historical sightings —
    nothing here may do per-insert O(n) work.
CONFIG: none. DISK: none (PRD: no persistence).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check          # tsc --noEmit — must be clean
npx prettier --check src/core/store.ts test/store.test.ts 2>/dev/null || true
# (project has no lint/format script beyond tsc; check is the gate)
```

### Level 2: Unit Tests

```bash
npx vitest --run test/store.test.ts   # all 11 coverage areas pass
npm test                              # full suite — no regressions
```

### Level 3: Integration Testing

N/A for this item (pure in-memory module, no I/O). Quick manual sanity:

```bash
node --input-type=module -e "
import { CandidateStore } from './src/core/store.ts';" 2>/dev/null || \
npx tsx -e "import('./src/core/store.ts').then(m => { const s = new m.CandidateStore(); s.upsert({key:'x',display:'X',ordinal:s.nextOrdinal(),fromUser:false,properName:false,rankGroup:1,isSubword:false}); console.log(s.size, s.get('x')); })" || true
# Expected: prints 1 and the created Candidate object
```

### Level 4: Performance sanity (informational — S3/M4 own the real gates)

```bash
# 20k upserts must complete well under a second (O(1) per upsert):
npx vitest --run test/store.test.ts  # the perf-relevant invariant is structural:
                                      # no sort/scan anywhere in store.ts
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run check` clean
- [ ] `npm test` — all pass, including 11 coverage areas in test/store.test.ts
- [ ] No existing file modified (only store.ts + store.test.ts added)

### Feature Validation
- [ ] All upsert branches (create/merge) match PRD §06 h2.36 exactly
- [ ] Ordinal counter: nextOrdinal() monotonic from 1; currentOrdinal() read-only
- [ ] entries()/get()/size/rankGroupHistogram() behave per spec
- [ ] Success criteria in "What" section all checked

### Code Quality Validation
- [ ] Imports use `.js` suffix (NodeNext ESM)
- [ ] No imports from src/pi/* (core purity invariant)
- [ ] store.ts does not import score.ts (no scoring needed here)
- [ ] Header comment cites PRD §06 like sibling modules
- [ ] upsert is O(1) — no hidden scans (future 20k replay + eviction depend on it)

## Anti-Patterns to Avoid

- ❌ Don't redeclare Candidate/Sighting in store.ts — import from types.ts
- ❌ Don't call nextOrdinal() inside upsert (pipeline owns ordinal assignment)
- ❌ Don't return live Map values from entries() (defensive copies only)
- ❌ Don't sort or scan in upsert (O(1) invariant for restore replay)
- ❌ Don't add prefix-index/eviction/phrase logic — those are S2/S3/P2
- ❌ Don't persist anything — store is session-lifetime only by design

---

**Confidence Score: 9/10** — data model already exists in types.ts, semantics
are verbatim from PRD §06, test conventions are established in test/score.test.ts,
and the only parallel-work interface (score.ts salience functions) is not
imported by this module.
# PRP — P2.M1.T1.S1: `CandidateStore.reset()` — in-place drop of words + bigrams + successor index

## Goal

**Feature Goal**: Add a single public method `reset(): void` to `CandidateStore` (src/core/store.ts) that performs the **wholesale in-place drop** mandated by spec 06 "Branch purity (2026-10 owner rule)" (PRD h2.42): every backing layer is emptied and the message-ordinal counter re-zeroed, such that **reset-then-replay == fresh-store-replay** byte-for-byte.

**Deliverable**:
1. `reset()` in `src/core/store.ts` with Mode A JSDoc citing spec 06 Branch purity (h2.42) and spec 05 Branch navigation rebuild (h2.37).
2. A purity test battery in `test/store.test.ts` pinning the equivalence with the repo's exact-`toEqual` idiom (`entries()` + `sortedKeysSnapshot()` + per-word `topSuccessors()` + `bigramSize` + `currentOrdinal()`).

**Success Definition**: A store that has ingested a rich mixed sequence, after `reset()` and replaying that same sequence through the normal public chain (`nextOrdinal()` → `upsert()` → `recordBigramRuns()`), is deep-equal (vitest `toEqual`) on every observable surface to a fresh `CandidateStore` fed the same sequence — including a variant that saturates the bigram cap and exercises the eviction heap. `npm run check` and `npm test` green. This method is consumed later by P2.M1.T2.S1 (the `session_tree` handler); no caller is wired in this item.

## User Persona (if applicable)

**Target User**: Not an end user — the next work item. P2.M1.T2.S1's `session_tree` handler needs exactly one primitive to implement spec 05 h2.37 step 4 ("the old store is dropped first and the replay fills a fresh store"): a way to empty the SAME `CandidateStore` instance the registered fallback provider and chain machine already close over (architecture/03 §R3: there is no unregister API for `addAutocompleteProvider`, so a fresh store instance is NOT a viable swap for the fallback path — in-place reset of the existing instance is).

**Use Case**: `/tree` branch navigation → handler discards the pending ingest queue → calls `store.reset()` → replays `ctx.sessionManager.getBranch()` oldest→newest through the identical restore pipeline → gate releases on settle. Store ends up identical to a fresh `/resume` of that branch; dead-branch words (e.g., a misspelling from an abandoned branch) cannot linger.

**Pain Points Addressed**: Today there is NO reset/clear API (architecture/03 §R3 line: "CandidateStore has no reset/clear API today"); the only options were leaking a fresh registration or leaving dead-branch words as append-only residue.

## Why

- **Spec 06 h2.42 (Branch purity)**: "on branch navigation the store is replaced WHOLESALE, in-place (old store dropped, snapshot replay fills a fresh store and successor index…)… a rebuilt store is identical to a fresh `/resume` of the same branch (pinned in tests, 09)." `reset()` IS the "old store dropped" half of that sentence; the purity test IS the "pinned in tests" half.
- **Unblocks P2.M1.T2.S1** (handler) and **P2.M1.T1.S2** (re-armable gate) — this is the first primitive of the P2 branch-hygiene milestone.
- P1 casing-tally work (capCount/lowerCount/capDisplay, `#capForms` side map) added hidden state that a rebuild MUST also drop or re-created keys would inherit stale form counts and break the purity equivalence.

## What

`reset(): void` — synchronous, total (no throw paths), no arguments, no return value. Effect: every private field of `CandidateStore` is replaced with its original field-initializer value (see Blueprint for the exact field table). After `reset()`:

- `size === 0`, `entries()` → `[]`, `get()` → `undefined` for every key, `rankGroupHistogram()` → `{0:0, 1:0, 2:0}`
- `bigramSize === 0`; `topSuccessors(w)` → the shared frozen empty array for every word
- `sortedKeysSnapshot()` → `[]`; `prefixRange()` behaves as on a fresh store (`[0,0]` for any non-matching prefix)
- `currentOrdinal() === 0`; `nextOrdinal()` returns `1` again (the replay chain re-issues ordinals 1..N, exactly like a fresh store — this is what makes replayed `firstSeenOrdinal`/`lastSeenOrdinal`, and therefore replay-time eviction scores, line up with a fresh `/resume`)

No other behavior changes. No caller is added in this item.

### Success Criteria

- [ ] `reset()` re-assigns ALL nine private fields (`#map`, `#capForms`, `#ordinal`, `#sortedKeys`, `#pending`, `#tombstones`, `#bigrams`, `#successorIndex`, `#bigramEvictHeap`) to their initial values
- [ ] Emptiness assertions pass (every public read surface reports the fresh-store value)
- [ ] Purity equivalence: `reset` + replay of sequence S ≡ fresh store fed S, via exact `toEqual` on `entries()`, `sortedKeysSnapshot()`, per-word `topSuccessors()`, plus `size`/`bigramSize`/`currentOrdinal()`/`rankGroupHistogram()` equality — with S exercising: all three casing classes, twin suppression (structural-cap then lower), multi-form mid-cap argmax, `userTyped`/`properName` stickiness, `rankGroup` min-merge, ordinal gaps, repeated bigrams (count > 1), top-3 successor displacement (a word with ≥ 4 distinct successors), and > 256 distinct keys (crossing `INDEX_MERGE_BATCH` consolidation) with a sub-batch pending tail at the end
- [ ] Bigram-cap flood variant: sequence saturating `BIGRAM_CAP` (10,000) + eviction, then reset + replay ≡ fresh + replay (pins `#bigramEvictHeap` re-lazy-ification)
- [ ] `#capForms` isolation pin: after reset, a re-created mid-cap key must not inherit old cap-form counts (argmax follows ONLY post-reset evidence)
- [ ] Mode A JSDoc on `reset()` citing spec 06 h2.42 + the purity equivalence; the class-header/`nextOrdinal()` "never reset" ordinal wording amended minimally to name `reset()` as the only zeroing path
- [ ] `npm run check` green; `npm test` green (no regressions elsewhere)

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, could they implement this from this PRP alone?" — Yes: the field inventory below is exhaustive (taken from the current 837-line src/core/store.ts), the test idioms are quoted with file/line anchors, and the spec citations resolve to named headings in spec/.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/core/store.ts
  why: The ONLY production file modified. Full read required — reset() must cover every private field.
  pattern: Class uses `#private` fields with inline initializers (lines ~265-295); wholesale re-assignment mirrors those initializers exactly.
  gotcha: |
    Nine fields, not two. #capForms (casing-tally side map), #pending, #tombstones,
    #sortedKeys, and #bigramEvictHeap are easy to miss; missing ANY breaks purity equivalence.

- file: spec/06-candidate-store.md
  why: "Branch purity (2026-10 owner rule)" section = the governing rule (PRD h2.42). Also "Eviction" (h2.44) and "M2: successor index" (h2.45) for cap context.
  critical: "a rebuilt store is identical to a fresh /resume of the same branch (pinned in tests, 09)" — this item delivers both halves of that sentence for the store primitive.

- file: spec/05-ingestion-pipeline.md
  why: "Branch navigation rebuild (session_tree…)" section (PRD h2.37) — reset()'s caller contract: drop FIRST, then replay; queries held at the gate until settle make the emptied state unobservable.
  critical: reset() itself does NOT build the gate or replay anything — that is P2.M1.T2.S1/S2. Do not implement the handler here.

- file: test/store.test.ts
  why: Host file for the new battery; source of the two idioms this repo pins stores with.
  pattern: |
    (1) Sighting fabricator (line ~31): `const sighting = (over: Partial<Sighting> = {}): Sighting => ({ key: "hapax", display: "hapax", ordinal: 1, fromUser: false, properName: false, casing: "lower", rankGroup: 2, ...over })`.
    (2) Exact-object toEqual (line ~89): `expect(s.get("zzqv")).toEqual({ key: "zzqv", capCount: 1, … })` — full literal, no property-picking.
    describe titles cite spec: `describe("… (PRD §06 h2.36)")`.

- file: test/successors.test.ts
  why: Precedent for fabricated `string[][]` runs fed directly to recordBigramRuns (bypassing the pipeline is sanctioned when raw text is impractical), and for the bigram-cap eviction flood.
  pattern: `s.recordBigramRuns([["a","b"],…])` then `expect(s.topSuccessors("a")).toEqual([{next,count}])`; 10k-cap flood fabricates distinct runs at scale.
  gotcha: Bigram-window logic (strict adjacency, gap splitting) lives in src/pi/ingest.ts, NOT in recordBigramRuns — the store takes admitted lowercase key runs on faith. Pure store tests never need the pipeline.

- file: plan/006_7bd0258da993/architecture/02-store-query-r1-r2.md
  why: "§3 Store internals" (field map), "§7 Test-battery conventions" (exact toEqual is THE store-equality idiom), "§8 Branch-purity comparison options" (the comparison surface: entries() + sortedKeysSnapshot() + per-word topSuccessors — there is no bigram dump API and none is needed).
  gotcha: §3 was written pre-P1-tallies (mentions `display` "most recent casing wins") — the CURRENT store.ts is truth; tallies + #capForms have since replaced it.

- file: plan/006_7bd0258da993/architecture/03-pi-surfaces-r2-r3-r4.md
  why: "R3 seams" section — documents WHY in-place reset (no unregister API; provider closures capture the store instance; a fresh CandidateStore cannot be swapped in for the fallback path). Explains the consumer contract for P2.M1.T2.S1.
  gotcha: That doc's "either construct a fresh CandidateStore and swap the slot" option was superseded by this work item — reset() on the SAME instance is the chosen design.

- file: test/no-persistence.test.ts
  why: RAM-only discipline is enforced by a filesystem assertion suite (full real pipeline runs, then zero hapax-written files allowed). reset() must introduce NO fs/network/import changes — it only re-assigns in-memory fields, so this passes by construction. Do not add any I/O.

- file: src/core/types.ts
  why: `Sighting` (key/display/ordinal/fromUser/properName/casing/rankGroup) and `Successor` ({next, count}) shapes used by the tests.
```

### Current Codebase tree (relevant excerpt)

```bash
src/core/
  store.ts        # CandidateStore — MODIFY (add reset(), amend 2 doc comments)
  types.ts        # Candidate / Sighting / Successor — READ ONLY
  score.ts        # evictionScore (imported by store) — READ ONLY
test/
  store.test.ts   # MODIFY (append reset() describe block)
  successors.test.ts  # READ ONLY (flood + fabricated-runs precedent)
spec/
  06-candidate-store.md   # governing rule — READ ONLY (spec already mandates reset's behavior)
```

### Desired Codebase tree with files to be added

```bash
src/core/store.ts        # + reset() method (~20 lines + JSDoc), placed after currentOrdinal(), before upsert()
test/store.test.ts       # + describe("reset() — branch-purity drop (spec 06 h2.42, P2.M1.T1.S1)") at file end
# No new files. No spec edits (spec 05/06 already specify this behavior ahead of code — "status: adopted ahead of implementation").
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: reset() must zero #ordinal to 0, NOT preserve it. A fresh store starts at 0 and
// the replay chain calls nextOrdinal() once per message → ordinals 1..N. If the counter kept
// advancing, every replayed firstSeenOrdinal/lastSeenOrdinal (and every eviction score
// computed from them) would differ from a fresh /resume of the same branch — breaking the
// h2.42 equivalence that this method exists to provide. "Identical to a fresh /resume" is
// the spec sentence; ordinal restart is its arithmetic consequence.

// CRITICAL: #capForms (key → Map<display, count>, the capDisplay-argmax evidence) is a SIDE
// map not reachable through entries(). Dropping #map alone leaves stale form counts that a
// re-created key would inherit — capDisplay would then resolve from pre-reset evidence and
// the purity toEqual would fail (capDisplay IS a Candidate field). Eviction deletes #capForms
// entries alongside #map entries; reset must drop the whole map.

// CRITICAL: #bigramEvictHeap must go back to null (its "not yet built" lazy state), not [].
// The heap is lazily constructed on first overflow (#rebuildBigramHeap); null is the exact
// fresh-instance state. A carried-over heap would reference dead keys (pops re-validate, so
// it wouldn't corrupt — but fresh-equality demands the identical lazy state, and the flood
// test pins it).

// GOTCHA: Do NOT call #consolidate() before dropping. Consolidation exists to keep the index
// consistent with the live map for QUERIES; reset drops both #sortedKeys and #pending
// together, so there is nothing to reconcile. Wholesale replacement is O(1); iterating/clearing
// the old maps in place would be O(n) for zero benefit (h2.42 says "replaced WHOLESALE").

// GOTCHA: sortedKeysSnapshot() returns copies, but topSuccessors() returns the LIVE array.
// Post-reset readers holding an old topSuccessors reference see a stale (now-orphaned) array —
// acceptable: the handler holds all queries at the gate until replay settle (spec 05/07), so
// no sanctioned reader observes the intermediate state. Note this in the JSDoc, do not "fix" it.

// GOTCHA: no-persistence — reset() touches nothing but in-RAM fields; no imports may be added
// to store.ts for this feature. test/no-persistence.test.ts runs the full pipeline and asserts
// zero hapax-written files; a reset() that stayed pure passes unchanged.

// GOTCHA: The class-header JSDoc and nextOrdinal()'s JSDoc currently say the ordinal is
// "strictly monotonic, never reset" (written pre-h2.42). The spec itself never says "never
// reset" (verified: no such wording in spec/05 or spec/06) — amend BOTH comments minimally to
// name reset() as the only zeroing path. This is Mode A documentation riding with the work.
```

## Implementation Blueprint

### Data models and structure

No type changes. `reset()` operates on the existing private-field set (complete inventory, verified against current src/core/store.ts):

| Field | Type | Initial value (reset target) | Role |
|---|---|---|---|
| `#map` | `Map<string, Candidate>` | `new Map()` | word candidates |
| `#capForms` | `Map<string, Map<string, number>>` | `new Map()` | capDisplay argmax evidence (side map) |
| `#ordinal` | `number` | `0` | message ordinal counter |
| `#sortedKeys` | `string[]` | `[]` | prefix index (last consolidation) |
| `#pending` | `string[]` | `[]` | un-merged new keys |
| `#tombstones` | `number` | `0` | evicted-ghost counter |
| `#bigrams` | `Map<string, BigramEntry>` | `new Map()` | bigram counts (BIGRAM_CAP 10,000) |
| `#successorIndex` | `Map<string, Successor[]>` | `new Map()` | top-3 successors per word |
| `#bigramEvictHeap` | `EvictNode[] \| null` | `null` | lazy eviction heap ("not yet built") |

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/core/store.ts — add reset()
  - IMPLEMENT: `reset(): void` — re-assign each of the nine private fields to its
    field-initializer value (table above). No loops, no consolidation, no allocation
    beyond the fresh empty maps/array literals. Synchronous, total.
  - PLACEMENT: after currentOrdinal(), before upsert() — it is a lifecycle method
    and pairs with the ordinal read API.
  - JSDOC (Mode A, rides with the work) — cover: (a) cites spec 06 "Branch purity
    (2026-10 owner rule)" (PRD h2.42) + spec 05 "Branch navigation rebuild" step 4
    ("the old store is dropped first and the replay fills a fresh store");
    (b) the purity equivalence: reset + replay through the normal chain (nextOrdinal
    → upsert → recordBigramRuns) ≡ fresh CandidateStore fed the same sequence —
    ordinal re-zeroing is what aligns replayed ordinals/eviction scores with a
    fresh /resume; (c) wholesale O(1) replacement (GC reaps old structures —
    h2.42 "replaced WHOLESALE, in-place"); (d) caller contract: queries must be
    held at the gate until replay settle (spec 05 / 07) — the emptied state is
    never observable; live topSuccessors() arrays taken before reset are orphaned
    by design; (e) RAM-only: no fs/network; (f) consumed by P2.M1.T2.S1's
    session_tree handler.
  - AMEND (2 lines, Mode A): class-header sentence "nextOrdinal() starts at 1 and
    is strictly monotonic, never reset" and nextOrdinal()'s "strictly monotonic,
    never reset" JSDoc → name reset() (the h2.42 wholesale drop) as the only
    zeroing path. Spec files are NOT edited (no spec text says "never reset";
    the spec already mandates rebuild-before-replay).

Task 2: MODIFY test/store.test.ts — append the reset() battery
  - PLACEMENT: new describe at file end:
    `describe("reset() — branch-purity drop (spec 06 h2.42 / P2.M1.T1.S1)", …)`
  - FOLLOW pattern: this file's `sighting()` fabricator (Partial<Sighting> override)
    and exact-object toEqual idiom; successors.test.ts's fabricated-runs style.
  - CASES (all pure-store; no pipeline, no mocks, no dictionaries):
    1. "empties every public surface" — feed a few messages (upserts incl. all
       casings + recordBigramRuns), reset(), then assert: size === 0,
       entries() toEqual [], sortedKeysSnapshot() toEqual [], bigramSize === 0,
       topSuccessors("knownkey") toEqual [], get("knownkey") undefined,
       rankGroupHistogram() toEqual {0:0,1:0,2:0}, prefixRange("a") toEqual [0,0],
       currentOrdinal() === 0, nextOrdinal() === 1.
    2. "reset-then-replay ≡ fresh-store-replay (purity, spec 06 h2.42)" — THE pin.
       Build a scripted sequence S as a replay helper `applySeq(s: CandidateStore)`
       using ONLY the public chain (per fake message: `s.nextOrdinal()`, then
       upserts with that ordinal, then `s.recordBigramRuns(runs)`). S must include:
       lower/mid-cap/structural-cap sightings; twin suppression (structural-cap
       then lower for one key); multi-form mid-cap argmax incl. a tie resolved by
       recency; fromUser:true once (userTyped sticky); properName:true;
       rankGroup 2-then-0 min-merge; ordinal gaps (nextOrdinal with no upserts);
       repeated bigrams (count > 1); one word with 4+ distinct successors (top-3
       tail drop); 300+ distinct keys (crosses INDEX_MERGE_BATCH=256 so a
       consolidation fires mid-replay); a final message adding a sub-batch of new
       keys (leaves a non-empty #pending tail — both stores must lag identically).
       Then: A = new CandidateStore(); applySeq(A); A.reset(); applySeq(A);
       B = new CandidateStore(); applySeq(B); assert
       `expect(A.entries()).toEqual(B.entries())`,
       `expect(A.sortedKeysSnapshot()).toEqual(B.sortedKeysSnapshot())`,
       `expect(A.size).toBe(B.size)`,
       `expect(A.bigramSize).toBe(B.bigramSize)`,
       `expect(A.currentOrdinal()).toBe(B.currentOrdinal())`,
       `expect(A.rankGroupHistogram()).toEqual(B.rankGroupHistogram())`, and
       per-word `expect(A.topSuccessors(k)).toEqual(B.topSuccessors(k))` for
       every key in the union of A/B entries() key sets.
    3. "bigram-cap flood: reset re-lazy-ifies the eviction heap" — fabricate
       10,050+ distinct 2-length runs (`recordBigramRuns` takes admitted lowercase
       keys on faith — successors.test.ts precedent), driving #bigrams past
       BIGRAM_CAP=10,000 so #evictBigramsIfOverCap runs and the heap is built;
       then reset + replay-vs-fresh with the same toEqual battery as case 2
       (pins #bigramEvictHeap → null).
    4. "#capForms isolation: re-created keys inherit no stale form counts" —
       key "acme": mid-cap sightings with display "Acme" ×2; reset(); one mid-cap
       sighting display "ACME"; expect get("acme").capDisplay toBe "ACME"
       (stale inheritance would keep argmax "Acme" at count 2).
    5. "reset on a fresh store is a safe no-op" — new store, reset, then a
       small applySeq, equivalence vs fresh-applySeq (also guards the
       empty-consolidation edge).
  - COVERAGE NOTE: word-cap eviction (>STORE_CAP=20,000) during replay is NOT
    flooded here — it is deterministic given identical inputs (h2.42: "Eviction
    during replay is deterministic (same order, same salience inputs)") and the
    full-scale rebuild acceptance battery is P2.M1.T2.S2's scope. The bigram
    flood (case 3) IS included because its heap is separate lazily-built state.

Task 3: VALIDATE (see Validation Loop) — no Task 3 code exists; running gates IS the task.
```

### Implementation Patterns & Key Details

```ts
// The entire production change (src/core/store.ts), modulo JSDoc:
reset(): void {
  // Wholesale in-place drop (spec 06 "Branch purity", PRD h2.42) — see JSDoc for
  // the purity equivalence and the gate contract. Field-for-field mirror of the
  // class field initializers; nothing may survive, nothing may be reconciled first.
  this.#map = new Map();
  this.#capForms = new Map();
  this.#ordinal = 0; // replay re-issues 1..N like a fresh /resume — the equivalence hinge
  this.#sortedKeys = [];
  this.#pending = [];
  this.#tombstones = 0;
  this.#bigrams = new Map();
  this.#successorIndex = new Map();
  this.#bigramEvictHeap = null; // back to the "not yet built" lazy state
}

// Replay helper pattern for the tests (case 2) — public API ONLY, mirroring the
// store.ts header contract: "the pipeline calls nextOrdinal() ONCE per message
// BEFORE processing that message's sightings" and recordBigramRuns reads
// currentOrdinal() inside:
function applySeq(s: CandidateStore): void {
  // message 1
  const o1 = s.nextOrdinal();
  s.upsert(sighting({ key: "hapax", ordinal: o1, rankGroup: 2 }));
  s.upsert(sighting({ key: "zorpwibble", display: "ZorpWibble", ordinal: o1,
    casing: "mid-cap", rankGroup: 1, properName: true }));
  s.recordBigramRuns([["hapax", "zorpwibble"]]);
  // … message 2..k: structural-cap + lower twin suppression, userTyped, ordinal
  // gaps, 4-successor word, 300+ distinct keys, sub-batch final pending tail …
}
```

### Integration Points

```yaml
NO INTEGRATION in this item:
  - No caller is wired. P2.M1.T2.S1 (session_tree handler) consumes reset();
    P2.M1.T1.S2 (re-armable gate) is a sibling primitive. Do NOT touch
    src/pi/ingest.ts, src/pi/index.ts, or any UI file.
  - No spec edit: spec/05 + spec/06 already mandate this behavior ahead of code
    ("status: adopted ahead of implementation — code lands with this spec");
    reset() is the code landing WITH the existing spec.
  - No config: reset() is unconditional (nothing in §08's config surface applies).
  - No new exports beyond the method itself; no changes to src/core/types.ts.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit          # same as `npm run check` — zero errors expected
# There is no linter/formatter configured in this repo (package.json: check/test/bench only).
# Run after editing store.ts, before touching tests.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest --run test/store.test.ts     # the new describe + all existing store suites
npx vitest --run test/successors.test.ts test/bigrams.test.ts   # bigram/successor layers untouched by regressions
npx vitest --run test/no-persistence.test.ts   # RAM-only discipline (should pass unchanged)
npm test                                 # FULL suite — zero regressions repo-wide
```

Expected: all green. If the purity equivalence (case 2/3) fails, the cause is a missed private field or an ordinal decision — re-read the field table in the Blueprint before touching test expectations; the test is almost certainly right.

### Level 3: Integration Testing (System Validation)

Not applicable — no runtime wiring in this item (no extension entry point touched, no events). The method's consumer lands in P2.M1.T2.S1; its integration acceptance (branch-purity battery at handler scale, live `/tree` verification) is P2.M1.T2.S2/P3.M1.T2.S3 scope.

### Level 4: Creative & Domain-Specific Validation

```bash
# Determinism re-run (purity must hold across runs — no Math.random/Map-order dependence):
npx vitest --run test/store.test.ts && npx vitest --run test/store.test.ts
```

Spec 09's live-TTY verification rule applies to UI-layer changes; this is a pure core-store change, so the unit battery above is the binding verification for this item.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` (tsc --noEmit) — zero errors
- [ ] `npm test` — full suite green, including pre-existing suites (store/successors/bigrams/query/acceptance/no-persistence)
- [ ] Determinism: two consecutive `vitest --run test/store.test.ts` both green

### Feature Validation

- [ ] All 5 test cases from Task 2 present and passing
- [ ] Equivalence battery covers `entries()` + `sortedKeysSnapshot()` + per-word `topSuccessors()` + `bigramSize` + `currentOrdinal()` + `rankGroupHistogram()` (exact `toEqual` idiom)
- [ ] Ordinal re-zeroed (nextOrdinal() returns 1 after reset) — the fresh-`/resume` alignment
- [ ] `#capForms` and `#bigramEvictHeap` resets pinned by targeted cases (4 and 3)
- [ ] reset() is pure in-RAM: no new imports, no fs/network — no-persistence suite passes unchanged

### Code Quality Validation

- [ ] JSDoc cites spec 06 Branch purity (h2.42) + spec 05 Branch navigation rebuild (h2.37) + the purity equivalence + the gate caller contract
- [ ] Class-header and nextOrdinal() "never reset" wording amended minimally (reset() named as the only zeroing path)
- [ ] Field-reset table complete: all nine private fields, values mirror field initializers
- [ ] No caller wired, no spec edit, no config change (integration-points discipline)
- [ ] Test describe title carries the spec citation per store.test.ts convention

### Documentation & Deployment

- [ ] Mode A satisfied: documentation rides with the code (JSDoc), nothing else pending for this item
- [ ] No environment variables, no schema changes, nothing to deploy

## Anti-Patterns to Avoid

- ❌ Don't preserve the ordinal counter "because it's the session's clock" — the spec's fresh-`/resume` equivalence REQUIRES re-zeroing; the store's ordinal belongs to the store being wholesale-replaced.
- ❌ Don't `clear()` the maps in place with loops, and don't consolidate the prefix index first — wholesale re-assignment is the h2.42 semantic and is O(1).
- ❌ Don't reset only `#map`/`#bigrams`/`#successorIndex` — the side structures (`#capForms`, `#pending`, `#tombstones`, `#sortedKeys`, `#bigramEvictHeap`) are exactly the hidden state the equivalence test exists to catch.
- ❌ Don't wire the `session_tree` handler or touch the gate here — sibling items P2.M1.T1.S2 / P2.M1.T2.S1 own those; scope creep here breaks their PRPs.
- ❌ Don't add a bigram/successor dump API "to make testing easier" — the established comparison surface (entries + sortedKeysSnapshot + per-word topSuccessors) is sufficient and adding public surface is out of scope.
- ❌ Don't edit spec/ — the spec was adopted ahead of this code; this item lands code WITH the existing spec text.
- ❌ Don't catch exceptions around reset() — it has no throw paths; wrapping adds noise.

---

**Confidence Score: 9/10** — The change surface is one method plus tests in a single, fully-inventoried file; every private field, idiom, and spec citation above was verified against the live code (store.ts read in full, test idioms quoted from store.test.ts / successors.test.ts, architecture/02 §8's comparison-surface guidance folded into the test design). The one residual risk is test-sequence richness: the equivalence battery only proves purity if sequence S genuinely exercises consolidation boundaries, successor-cap displacement, and casing-tally paths — the Blueprint enumerates the required ingredients precisely to close that gap.

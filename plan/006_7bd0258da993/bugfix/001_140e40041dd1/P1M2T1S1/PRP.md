---
name: "P1.M2.T1.S1 (bugfix 001_140e40041dd1) — Thread Sighting.path and store pathDisplay with a sticky-first merge policy"
---

## Goal

**Feature Goal**: Fix the store half of BUG-002 — path sightings currently
lose their verbatim edge-bearing display at the store seam
(`CandidateDraft.path` exists but `Sighting` has no path field; upsert's
create branch discards `sighting.display` for lower-casing sightings — and
edge-bearing paths always classify 'lower'). Thread `draft.path` through
the Sighting build and store a **`pathDisplay`** field on the Candidate
record with a **sticky-first** merge policy (first path sighting's display
wins; never overwritten).

**Deliverable**:
1. `types.ts`: `path?: boolean` on Sighting; `pathDisplay?: string` on
   Candidate (optional; absent ≡ not-a-path)
2. `src/pi/ingest.ts`: one-line `draft.path` pass-through at the
   Sighting-build site(s)
3. `src/core/store.ts` upsert: create branch seeds `pathDisplay` when
   `sighting.path` (every casing branch); merge branch never overwrites
4. TDD extensions in `test/store.test.ts` path-merge describe; Mode-A
   JSDoc; spec/06 drift recorded for P2.M2.T2.S2 (spec NOT edited)

**Success Definition**: after upserting path sightings with variants
('/home/x/y', bare, '../'), the store holds ONE entry with key
'home/x/y' and `pathDisplay === '/home/x/y'` (first sighting's display);
non-path sightings leave pathDisplay undefined; the existing
`not.toHaveProperty("display")` pin stays true; `npm run check` +
`npm test` green. (Query/resolver consumption is P1.M2.T1.S2; end-to-end
insertion is P1.M2.T2.S1.)

## Why

- BUG-002 (Major): spec 04 rule 4d pins that a path token's KEY is
  edge-trimmed but its DISPLAY preserves the leading `/`, `~`, `./`,
  `../`; spec 04 Case handling: "paths and technical literals always
  insert verbatim"; spec 09 integration item 7: "an absolute path
  inserts with its leading /". The tally migration (commit 7b28849)
  deleted Candidate.display and the store now drops the sighting display
  for every 'lower' sighting — so Tab-inserting `/home/...` strips the
  slash on both display paths. This task restores the data path; S2 adds
  the resolver guard.
- Why a field on the record (not a side map like `#capForms`): the
  record dies with eviction automatically, needs no serialization
  handling (the store is RAM-only; reset() + replay rebuild through
  normal upsert), and reads stay O(1) with no cross-structure cleanup.
- Why sticky-first: edge variants of one trimmed key merge into one
  entry (test/store.test.ts:200–220) and their displays can differ —
  the policy must be deterministic and must not let recency decide
  ("firstSeenOrdinal stays at the first sighting" is the existing
  precedent).

## What

### 1. src/core/types.ts

```ts
// Sighting — add (mirrors draft.path; JSDoc cites rule 4d + the S2 seam):
  /** true when this occurrence is a path-shaped candidate (rule 4d):
   *  `display` carries the original edge symbols ('/…', '../…') while
   *  `key` is the edge-trimmed lowercase form. The store seeds the
   *  candidate's pathDisplay from the FIRST such sighting (sticky-first;
   *  later sightings never overwrite — edge-variant merges must be
   *  deterministic and recency never decides). Absent ≡ not a path. */
  path?: boolean;

// Candidate — add (same optional-field style as structuralCapCount?):
  /** Verbatim edge-bearing display (leading '/', '~', './', '../')
   *  for path-class candidates (rule 4d): seeded by the first path
   *  sighting, never overwritten. Absent ≡ the candidate never arrived
   *  as a path sighting. Wins over capDisplay in completion-time
   *  resolution when both exist (letter-initial paths can classify
   *  mid-cap — P1.M2.T1.S2's resolver guard). */
  pathDisplay?: string;
```

### 2. src/pi/ingest.ts — Sighting-build seam

At the Sighting literal(s) (~:940 and ~:985 — `display: draft.display`
sites; check both, plus any other Sighting construction), add:

```ts
  ...(draft.path ? { path: true } : {}),
```

(same conditional-spread style the codebase already uses for optional
fields). One-line per site.

### 3. src/core/store.ts — upsert

Create branch (the tallies switch at :384–398): seed pathDisplay for
EVERY casing branch when `sighting.path` (the letter-initial-path corner
classifies mid-cap and also needs it — pathDisplay outranks capDisplay
at the resolver). Cleanest: after the `this.#map.set(sighting.key, {...})`
literal, or inside it via spread:

```ts
      this.#map.set(sighting.key, {
        key: sighting.key,
        ...tallies,
        // Sticky-first path display (BUG-002): the FIRST path sighting's
        // edge-bearing form wins; later sightings never overwrite —
        // edge variants of one trimmed key merge, and recency must never
        // decide the insertion form (rule 4d display preservation).
        ...(sighting.path ? { pathDisplay: sighting.display } : {}),
        sessionCount: 1,
        ... // rest unchanged
      });
```

Merge branch (after the create early-return): NO change — existing
records never get pathDisplay overwritten, and non-path sightings never
set it. Add one comment in the merge section stating the sticky-first
invariant explicitly ("pathDisplay, once set, is immutable").

Eviction / `entries()` `{...c}` copies: no extra work (the field rides
the record).

### 4. TDD — test/store.test.ts, path-merge describe (:200+)

Extend/adjust (helper `sighting(over)` fabricates literals — path
sightings pass `path: true`):

```yaml
STICKY-FIRST MERGE:
  - s.upsert(sighting({key:'home/x/y', display:'/home/x/y', ordinal:5, path:true}))
    then sighting({key:'home/x/y', display:'home/x/y', ordinal:9, path:true})
    then sighting({key:'home/x/y', display:'../x/y', ordinal:11, path:true})
    → ONE entry; key 'home/x/y'; pathDisplay === '/home/x/y' (FIRST —
    never overwritten); sessionCount 3; first/lastSeenOrdinal 5/11
  - reverse order ('../x/y' first) → pathDisplay === '../x/y'
    (sticky-first is order-deterministic, not symbol-preferential)

NON-PATH ISOLATION:
  - non-path sightings only → pathDisplay undefined (no property);
    a later path sighting on an EXISTING non-path record… DECISION:
    the merge branch never writes pathDisplay, so it stays undefined.
    PIN this in a test with a comment: only the CREATE branch seeds it
    (a word that first arrived as a word, then appears inside a path
    span, keeps no pathDisplay — the trimmed-key candidate would insert
    bare; acceptable, recorded for S2's drift notes)
  - the existing :209 pin `expect(c).not.toHaveProperty("display")`
    stays TRUE — extend the same test to assert
    `expect(c).toHaveProperty("pathDisplay", '/home/x/y')` in the
    sticky case and `not.toHaveProperty('pathDisplay')` in the
    non-path case

MID-CAP PATH CORNER:
  - letter-initial path sighting {key:'home/user/x', display:'Home/User/x',
    casing:'mid-cap', path:true} → capDisplay 'Home/User/x' AND
    pathDisplay 'Home/User/x' both present (resolver order is S2's;
    here we pin that the field survives alongside capDisplay)

STRUCTURAL/LOWER BRANCHES:
  - path sighting with casing 'lower' (the BUG-002 class: display
    '/home/…', key 'home/…') seeds pathDisplay alongside
    {capCount:0, lowerCount:1, capDisplay:""} — exact-object toEqual on
    the full candidate per the store-equality idiom
```

Exact-object `toEqual` is the store-suite idiom — update existing
path-merge tests' expected literals if they assert full objects (new
optional field only appears when path:true was passed, so most existing
literals stay valid; verify).

### Success Criteria

- [ ] Sighting.path and Candidate.pathDisplay added with Mode-A JSDoc
- [ ] ingest passes draft.path through (both Sighting-build sites)
- [ ] Create branch seeds pathDisplay for every casing when sighting.path; merge branch never overwrites (pinned by tests)
- [ ] Sticky-first across edge variants; non-path sightings leave it undefined; :209 display-absence pin intact
- [ ] Mid-cap corner: both capDisplay and pathDisplay can coexist
- [ ] `npm run check` + `npm test` green; spec/06 drift recorded in research notes (spec NOT edited)

## All Needed Context

### Context Completeness Check

An implementer needs: the exact current Sighting/Candidate/upsert code,
the corner-case decisions (mid-cap path, later-path-on-word-record), the
test idioms, the sticky-first rationale, and the scope fences against
S2/T2.S1. All below (verified live + the [V]-verified architecture memo).

### Documentation & References

```yaml
- file: src/core/types.ts
  why: Sighting (~:77-95, read live — no path field today) and Candidate
        (:21-50, no display by design; structuralCapCount? is the
        optional-internal-field precedent).
  pattern: optional field + absent-≡-default JSDoc, same style as
           structuralCapCount?.
  gotcha: do NOT reintroduce a general display field — completion-time
          resolution owns casing; pathDisplay is path-class only.

- file: src/core/store.ts
  why: upsert create branch :384-398 (tallies switch — the 'lower' row
        at :388-398 discards sighting.display), merge branch after the
        early return (touch NOTHING there except a comment), #capForms
        side-map as the ANTI-pattern (does not die with eviction).
  pattern: conditional spread for optional fields; comment citing rule 4d.

- file: src/pi/ingest.ts
  why: The Sighting-build seam — sighting literals at ~:940 and ~:985
        (both carry display: draft.display; check for any third site).
        One-line conditional spread at each.

- file: test/store.test.ts
  why: Path-merge describe :200+ (three edge-variant tests, the :209
        display-absence pin, the sighting(over) helper, exact-object
        toEqual idiom).
  gotcha: existing full-object assertions may need the new optional
          field ONLY where path:true is passed — audit each.

- file: src/core/segment.ts
  why: CandidateDraft (:722-740) + the path branch (:795-806) — the
        INPUT contract (already correct, pinned by
        test/segment.test.ts:782-795; unchanged by this work).

- docfile: plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/bug002-path-display.md
  section: "§1 Segment stage", "§2 Store stage", "§8 fix design"
  why: The [V]-verified end-to-end display-flow map: where display is
        destroyed, the mid-cap path corner (letter-initial paths keep
        edges in capDisplay "by accident"), and the fix design this
        contract implements.

- docfile: plan/006_7bd0258da993/bugfix/001_140e40041dd1/prd_snapshot.md
  section: h2.2/h3.1 (Issue 2 / BUG-002) + h2.5 recommendation 2
  why: The defect + the recommended shape (store the raw-edge display
        alongside the tallies via the existing path flag).

- docfile: plan/006_7bd0258da993/bugfix/001_140e40041dd1/P1M1T2S2/PRP.md
  why: The parallel predecessor (widget typed-arming e2e + /acwords
        markers) — widget/debug/test scope only; confirms no
        store/types/ingest overlap.
```

### Current Codebase tree (relevant)

```bash
src/core/types.ts        # MODIFY: Sighting.path?, Candidate.pathDisplay?
src/core/store.ts        # MODIFY: upsert create-branch seed + merge comment
src/pi/ingest.ts         # MODIFY: draft.path pass-through (Sighting builds)
test/store.test.ts       # MODIFY: path-merge describe extensions
```

### Known Gotchas & Library Quirks

```typescript
// CRITICAL: seed pathDisplay in EVERY casing branch of the create
// switch when sighting.path — the letter-initial path corner
// ('Home/User/x') classifies mid-cap and must ALSO get pathDisplay
// (pathDisplay outranks capDisplay at the resolver, S2).

// GOTCHA: the merge branch must NEVER write pathDisplay — sticky-first
// means create-only seeding. A path sighting arriving on an existing
// non-path record leaves it display-less; pin that with a comment
// (recorded for S2's drift notes).

// GOTCHA: exact-object toEqual in the store suite — a new optional
// property that is UNDEFINED is invisible to toEqual, but one that is
// PRESENT (path:true case) breaks any existing literal that doesn't
// list it. Audit existing expected literals in the path-merge describe.

// GOTCHA: entries() returns {...c} copies — pathDisplay rides along
// with no extra work; eviction drops it with the record. Do NOT add a
// #capForms-style side map (would need cross-structure cleanup).

// GOTCHA: ingest has MULTIPLE Sighting-build sites (~:940 and ~:985);
// grep 'display: draft.display' and thread path at EACH — a missed site
// silently drops the flag for one pipeline path.

// GOTCHA: spec/*.md is READ-ONLY here — record the Candidate
// record-shape drift (new field) in the research notes for
// P2.M2.T2.S2's drift report instead.
```

## Implementation Blueprint

### Implementation Tasks (ordered — TDD)

```yaml
Task 1: WRITE the failing store tests (test/store.test.ts)
  - ADD/EXTEND the path-merge describe with the cases in "What" §4
    (sticky-first both orders; non-path isolation incl. the
    later-path-on-word-record pin; mid-cap corner; lower-branch
    exact-object literal with pathDisplay)
  - Extend the :209-pin test: toHaveProperty("pathDisplay", ...) in the
    path case; not.toHaveProperty("pathDisplay") in the non-path case
  - RUN: npx vitest --run test/store.test.ts → RED

Task 2: TYPES (src/core/types.ts)
  - ADD Sighting.path? and Candidate.pathDisplay? with the JSDoc in
    "What" §1 (rule 4d, sticky-first, resolver-order note)

Task 3: STORE (src/core/store.ts)
  - CREATE branch: conditional spread `...(sighting.path ? { pathDisplay:
    sighting.display } : {})` + the sticky-first comment
  - MERGE branch: add the immutability comment (no code change)

Task 4: INGEST (src/pi/ingest.ts)
  - GREP 'display: draft.display' → thread
    `...(draft.path ? { path: true } : {})` at every Sighting-build site

Task 5: FULL validation
  - npm run check
  - npx vitest --run test/store.test.ts test/segment.test.ts
    test/ingest.test.ts test/ingest-pipeline.test.ts
  - npm test (full suite)
  - RECORD spec/06 Candidate record-shape drift in research notes (for
    P2.M2.T2.S2)
```

### Implementation pattern

Create branch (store.ts), final shape:

```typescript
this.#map.set(sighting.key, {
  key: sighting.key,
  ...tallies,
  // Sticky-first path display (BUG-002, rule 4d): the FIRST path
  // sighting's edge-bearing form wins; later sightings never overwrite
  // (edge variants merge to one key; recency never decides insertion).
  ...(sighting.path ? { pathDisplay: sighting.display } : {}),
  sessionCount: 1,
  lastSeenOrdinal: sighting.ordinal,
  firstSeenOrdinal: sighting.ordinal,
  userTyped: sighting.fromUser,
  properName: sighting.properName,
  rankGroup: sighting.rankGroup,
});
```

### Integration Points

```yaml
NONE new this task (data path only):
  - P1.M2.T1.S2: resolveCompletionCasing pathDisplay-first guard +
    query-level regression battery (rankMatches '/home/…' keeps the slash)
  - P1.M2.T2.S1: index.test.ts e2e verbatim insertion
  - P2.M2.T2.S2: consumes the spec/06 drift note recorded here
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check        # tsc --noEmit — zero errors
grep -n 'display: draft.display' src/pi/ingest.ts   # every site now also threads path
```

### Level 2: Unit Tests

```bash
npx vitest --run test/store.test.ts -v               # extended describe green
npx vitest --run test/segment.test.ts test/ingest*.test.ts -v  # neighbors untouched
npm test                                              # full suite green
```

### Level 3: Behavior reasoning (in-suite)

The end-to-end display/insertion behavior is S2/T2.S1's battery; here the
store-level assertions ARE the contract: sticky-first across orders,
non-path isolation, mid-cap coexistence, exact-object literals.

### Level 4: Spec conformance re-read

Re-read spec/04 rule 4d + Case handling ("paths always insert verbatim")
against the data path: draft (edges) → Sighting (path flag) → Candidate
(pathDisplay, sticky) — no stage drops the edges anymore. Record the
Candidate record-shape drift for P2.M2.T2.S2.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors
- [ ] `npm test` full suite green

### Feature Validation

- [ ] '/home/x/y' → bare → '../' variants: ONE entry, pathDisplay === first display
- [ ] Reverse order pins order-determinism
- [ ] Non-path sightings: pathDisplay undefined; :209 display-absence pin intact
- [ ] Mid-cap path corner: capDisplay + pathDisplay coexist
- [ ] Merge branch never overwrites (comment + pinned)

### Code Quality Validation

- [ ] Mode-A JSDoc on both fields + the tally-switch comment
- [ ] Conditional-spread style; no side maps; eviction-safe by construction
- [ ] TDD order; no resolver/query changes (S2 scope); no spec edits

## Anti-Patterns to Avoid

- ❌ Don't overwrite pathDisplay on later sightings (sticky-first, create-only)
- ❌ Don't seed only the 'lower' branch — mid-cap paths need it too
- ❌ Don't use a side map (#capForms style) — field-on-record dies with eviction
- ❌ Don't reintroduce a general Candidate.display
- [ ] ❌ Don't edit spec/*.md — record the drift instead
- ❌ Don't wire the resolver here (P1.M2.T1.S2)

**Confidence Score: 9/10** — a small data-path change with [V]-verified
seams, decided corner cases, pinned test idioms, and explicit scope
fences.

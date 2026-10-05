# PRP — P1.M1.T2.S2 (plan 006): Series bigrams: BigramEntry/Successor extension + series-first top-3 retention

---

## Goal

**Feature Goal**: Implement spec 06 h3.6/h3.7's series extensions in the
store: `recordBigramRuns` consumes the enriched `RunMember` payload from
P1.M1.T1.S2, recording every adjacent pair inside a capitalized run as a
**series bigram** — including chain-only members — each marked `series` and
remembering the second word's run casing (`nextDisplay`). The successor
index's per-word top-3 becomes **series-first** (series entries above
ordinary successors regardless of counts), stabilizing the 07 h2.53 offer
rule. Same window-break rules (upstream), same bigram cap/eviction.

**Deliverable**:
- `src/core/types.ts`: `Successor` + `BigramEntry` gain `series?: boolean`
  and `nextDisplay?: string` (Mode-A JSDoc).
- `src/core/store.ts`: widened `recordBigramRuns` payload (string members
  still accepted as ordinary), series marking + `nextDisplay`, extended
  `successorBefore` (series first), upgrade-in-place on later series
  re-sighting.
- TDD battery in `test/bigrams.test.ts` + `test/successors.test.ts`
  (conventions already there; pure store, no mocks).

**Success Definition**: Series marking, chain-only inclusion, series-first
retention, eviction parity all pinned; existing bigram/successor/store/
chain tests green (plain-string feeders keep working); `npm run check` +
`npm test` green; output consumed by P1.M2.T2.S1/S2 (offers) and
P1.M2.T3.S1 (/acwords).

## Why

- Spec goals 11: completing or typing a capitalized-series member must
  offer the next member top, zero typed chars. That requires (a) the pairs
  to exist even when a member is chain-only (top-band ceiling, P1.M1.T3.S1
  — "typing `The ` offers `Fed`"), and (b) series entries to outrank
  ordinary successors in the top-3 so they can't be crowded out by
  high-count ordinary bigrams (07 h2.53 "series first regardless of counts").
- The window-break logic stays in ingest (pre-chunked runs arrive via
  `onAdmittedTokens`); the store adds NO window logic.

## What

### 1. types.ts

```ts
// Successor (and BigramEntry identically) gain:
/** True when this pair came from a capitalized run (spec 06 h3.6): a
 *  proper-noun series pair. Series successors rank above ordinary ones
 *  in the per-word top-3 regardless of counts (07 h2.53). */
series?: boolean;
/** Run casing of the SECOND word of a series pair (e.g. "Renewable") —
 *  the offer's display form. Undefined for ordinary pairs. */
nextDisplay?: string;
```

### 2. recordBigramRuns (store.ts :536–561) — payload widening + marking

- Signature: accept
  `readonly (readonly (RunMember | string)[])[]` — `typeof m === "string"`
  members are ordinary (series false, no nextDisplay); this keeps every
  existing caller/test (chain.test.ts feeders, bigrams.test.ts) green
  without edits. RunMember is imported from the payload module (wherever
  P1.M1.T1.S2 exported it — segment.ts or ingest.ts; check and import).
- Per adjacent pair `(m1, m2)`:
  - `w1 = typeof m1 === "string" ? m1 : m1.key`, `w2` likewise; key
    `${w1} ${w2}` — unchanged.
  - `isSeries = both members are RunMember AND both rawCasing start with
    an uppercase ASCII letter` (the walk's own definition — see gotcha
    below for verification).
  - BigramEntry create: add `...(isSeries ? { series: true, nextDisplay:
    m2.rawCasing } : {})`. Merge: if `isSeries`, upgrade the existing
    entry in place (`entry.series = true; entry.nextDisplay = m2.rawCasing`)
    — one-directional, never downgrades; ordinary merges leave series
    fields untouched.
  - `#bumpSuccessor(w1, w2, isSeries ? m2.rawCasing : undefined)`.

### 3. #bumpSuccessor (:573–606) + successorBefore (:143)

- Create path: `entry.series = isSeries || undefined`,
  `entry.nextDisplay = nextDisplay`.
- Bump path: if the bump carries series marking, set it on the existing
  entry (`existing.series = true; existing.nextDisplay ??= nextDisplay`)
  BEFORE the re-sort walk — an upgraded entry must be able to move toward
  the head past ordinary entries.
- `successorBefore` gains, as its FIRST comparison:
  `if (!!a.series !== !!b.series) return !!a.series;` — then the existing
  count-desc / byte-lex asc ladder unchanged.
- The sorted-tail drop at length 4 now drops the worst under the extended
  order: ordinary low-count entries die first; series entries survive
  unless competing with other series entries (count/lex among them).
  Update the method's doc comment to describe the extended order.
- `topSuccessors` stays a pure O(1) read; arrays still ≤ 3.

### 4. Eviction parity (unchanged, pinned by test)

- `bigramSortKey` ignores series (same policy for series and ordinary);
  cap/heap/drain and `#dropSuccessorFor` splices untouched.

### Success Criteria

- [ ] Series marking: pairs from a capitalized run carry `series: true` and the second member's `nextDisplay` (both on BigramEntry and Successor)
- [ ] Chain-only inclusion: a run member never upserted (top-band) still forms its pairs — its neighbors' successor entries exist
- [ ] Series-first retention: a count-1 series successor outranks a count-40 ordinary successor in `topSuccessors`; ordinary ties keep count/lex order; series-vs-series keeps count/lex
- [ ] Overflow: a 4th successor drops the extended-order tail; a series newcomer displaces an ordinary incumbent
- [ ] Plain-string runs still work (backward compat); eviction parity pinned
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they implement this
successfully?" — Yes: current recordBigramRuns/#bumpSuccessor/successorBefore
code shapes are line-anchored, the upstream payload contract is quoted, the
series-derivation rule and its verification step are specified, and the
battery is enumerated.

### Documentation & References

```yaml
- docfile: plan/006_7bd0258da993/architecture/02-store-query-r1-r2.md
  sections: §3, §8
  why: store internals — recordBigramRuns :536-561, #bumpSuccessor :573-606,
        successorBefore :140-143, BigramEntry :110/:113, bigramSortKey :136,
        BIGRAM_CAP 10_000, #dropSuccessorFor :706-717; "runs arrive
        pre-chunked by ingest — store adds NO window logic".

- file: plan/006_7bd0258da993/P1M1T1S2/PRP.md
  why: CONTRACT (Complete): `RunMember { key: string; rawCasing: string }`
        exported (check its final home — segment.ts or ingest.ts);
        `onAdmittedTokens?: (runs: readonly (readonly RunMember[])[])`.
  critical: VERIFY at implementation time whether T1.S2's payload marks
        runs as capitalized vs ordinary adjacency runs. If unmarked,
        derive series from BOTH members' rawCasing starting with an
        uppercase ASCII letter (the walk's definition). If marked
        (e.g. a run-kind field), use that flag directly.

- file: plan/006_7bd0258da993/P1M1T3.S1 (Planned)
  why: CONTRACT: chain-only members never reach upsert but appear in runs.
        The store needs NO admission knowledge — record every pair — but a
        comment at recordBigramRuns should note the contract.

- file: plan/006_7bd0258da993/P1M1T2S1/PRP.md
  why: PARALLEL sibling editing store.ts (upsert/eviction/#capForms —
        different regions than :536-606). Re-read the live file before
        editing; no semantic overlap.

- files: src/core/store.ts (:536–561, :573–606, :140–143, :113, :136),
        src/core/types.ts (Successor :82, BigramEntry site :113 is
        store-local — add fields in BOTH places per the item contract)
  why: the edit sites.

- files: test/bigrams.test.ts (:14–71 region), test/successors.test.ts
  why: battery conventions (pure store, hand-built calls, exact toEqual).

- PRD §06 h3.6/h3.7 + §04 h2.26 "Successors" + §07 h2.53 — normative.
```

### Current Codebase tree (relevant)

```bash
src/core/store.ts        # recordBigramRuns, #bumpSuccessor, successorBefore, BigramEntry
src/core/types.ts        # Successor
test/{bigrams,successors}.test.ts
```

### Desired Codebase tree

```bash
src/core/store.ts        # widened payload, series marking, series-first order
src/core/types.ts        # Successor.series/nextDisplay
test/{bigrams,successors}.test.ts   # +series battery
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: "bump only moves toward the head" must survive: set the
// series flag on the existing entry BEFORE the re-sort walk so an
// upgraded entry can pass ordinary entries. Never DOWNGRADE series→
// ordinary (a later ordinary merge of the same pair keeps the mark).

// CRITICAL: backward-compat payload — plain string members must remain
// legal (chain.test.ts / bigrams.test.ts feeders); typeof-guard, don't
// migrate callers in this task.

// GOTCHA: nextDisplay belongs to the SECOND word of the pair (the offer
// target), per h3.7 "nextDisplay carries the run casing for series
// entries". Store ONE display per pair, refreshed on series re-sighting.

// GOTCHA: topSuccessors consumers (chain offers in provider/widget)
// currently ignore series/nextDisplay — that's fine; P1.M2.T2.S1/S2
// consume them. Do not change the return type.

// GOTCHA: BigramEntry is store-module-local (:113); Successor is in
// types.ts. The item says extend BOTH — keep the field sets identical.

// NodeNext .js imports; no mocks (pure store tests).
```

## Implementation Blueprint

### Implementation Tasks (ordered, TDD)

```yaml
Task 1: ADD TDD battery (red) — test/bigrams.test.ts + test/successors.test.ts:
  1. series marking: RunMember run ["National","Renewable","Energy"]
     → bigrams "national renewable"/"renewable energy" carry series:true
     and nextDisplay "Renewable"/"Energy" (inspect via successors + a
     bigram read; if no public bigram getter exposes entries, assert via
     topSuccessors fields).
  2. chain-only inclusion: run ["The","Fed","Cut"] where "The" is never
     upserted — pairs "the fed" form; topSuccessors("the") non-empty.
  3. ordinary pair (plain strings, or lowercase RunMembers) → no series
     fields.
  4. series-first retention: word with ordinary successor count 40 and
     series successor count 1 → series first in topSuccessors.
  5. series-vs-series order: count desc then byte-lex among series.
  6. overflow: 3 ordinary incumbents + series newcomer → newcomer
     displaces the worst ordinary; 3 series incumbents + ordinary
     newcomer at any count → newcomer never surfaces.
  7. upgrade-in-place: ordinary pair later seen in a capitalized run →
     entry gains series+nextDisplay and moves above ordinary peers; the
     reverse (series pair later seen lowercase) keeps the mark.
  8. eviction parity: 10,001 mixed series/ordinary bigrams → drains to
     cap, victims spliced from successors, series entries evictable
     (same bigramSortKey — no series protection).
Task 2: EDIT src/core/types.ts — Successor.series/nextDisplay + JSDoc.
Task 3: EDIT src/core/store.ts — BigramEntry fields; recordBigramRuns
  widening + marking + merge-upgrade; #bumpSuccessor signature
  (w1, w2, nextDisplay?) + create/bump marking + doc comment;
  successorBefore series-first comparison; chain-only contract comment.
Task 4: VALIDATE — bigrams/successors/store/chain suites, full npm test,
  npm run check.
```

### Implementation Patterns & Key Details

```ts
// Extended order (successorBefore, first line):
if (!!a.series !== !!b.series) return !!a.series;
// then existing: count desc, byte-lex asc — unchanged.

// Pair classification inside recordBigramRuns:
const asMember = (m: RunMember | string) =>
  typeof m === "string" ? { key: m, rawCasing: "" } : m;
const isSeries =
  a.rawCasing !== "" && b.rawCasing !== "" &&
  /[A-Z]/.test(a.rawCasing[0]!) && /[A-Z]/.test(b.rawCasing[0]!);
// (replace with the run-kind flag if T1.S2's payload provides one)
```

### Integration Points

```yaml
CODE: src/core/store.ts, src/core/types.ts
TESTS: test/bigrams.test.ts, test/successors.test.ts
CONSUMES: RunMember payload (T1.S2, landed); runs include chain-only
          members (T3.S1, upcoming — store is agnostic)
DOWNSTREAM: P1.M2.T2.S1/S2 (series-first offers read topSuccessors),
  P1.M2.T3.S1 (/acwords series-marked sample), P2.M1.T2.S2 (purity
  equality — series fields part of state)
FROZEN: ingest.ts (payload construction done), query.ts, provider/widget,
  bigramSortKey/eviction policy
```

## Validation Loop

### Level 1–2

```bash
npm run check
npx vitest --run test/bigrams.test.ts test/successors.test.ts test/store.test.ts test/chain.test.ts
npm test
```

### Level 3: Behavior spot-check

```bash
# recordBigramRuns([[{"key":"national","rawCasing":"National"},
# {"key":"renewable","rawCasing":"Renewable"}]]) →
# topSuccessors("national")[0] === { next:"renewable", count:1,
# series:true, nextDisplay:"Renewable" }
```

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green; plain-string feeders unchanged
- [ ] Series marking + nextDisplay on both BigramEntry and Successor
- [ ] Chain-only members form pairs; ordinary pairs unaffected
- [ ] Series-first top-3 (incl. overflow displacement + upgrade-in-place)
- [ ] Eviction parity (no series protection; splice intact)
- [ ] Mode-A JSDoc on new fields + recordBigramRuns payload comment
- [ ] Diff confined to store.ts, types.ts, the two test files

## Anti-Patterns to Avoid

- ❌ Adding window-break logic to the store (ingest owns it)
- ❌ Breaking plain-string callers (backward-compat payload is required)
- ❌ Downgrading series on later ordinary sightings, or setting series
  before checking BOTH members' casing
- ❌ Protecting series entries from bigram eviction (same policy — h2.45)
- ❌ Changing topSuccessors' return type or O(1) read contract
- ❌ Touching upsert/#capForms (parallel sibling P1.M1.T2.S1 owns those
  regions of store.ts)

---

**Confidence Score: 8/10** — store edit sites and semantics are fully
anchored; the single open detail (whether T1.S2's payload marks run kind
vs deriving from rawCasing) is resolved by an explicit verify-first rule
with a specified fallback derivation.

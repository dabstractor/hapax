# PRP — P1.M1.T2.S1 (plan 006): Candidate casing tallies (additive migration, display kept temporarily)

---

## Goal

**Feature Goal**: Implement spec 06 h2.41/h2.43 tally semantics in the
candidate store: every `Candidate` accumulates `capCount` / `lowerCount` /
`capDisplay` from its sightings' casing classes, with the permanent
twin-suppression rule (structural-cap contributions vanish forever at the
first lowercase sighting). This is the ADDITIVE half of the migration —
`display` stays populated exactly as today so all ~22 `.display` consumers
stay green until P1.M2.T1.S2 removes it.

**Deliverable**:
- `src/core/types.ts`: `Candidate` gains `capCount: number`,
  `lowerCount: number`, `capDisplay: string`, and one internal non-spec
  field `structuralCapCount?: number` (Mode-A JSDoc on all four, semantics
  incl. the permanence rule, spec anchor 06 h2.43).
- `src/core/store.ts`: tally accumulation at upsert's create + merge sites
  (:264–298), the store-internal per-form frequency side map `#capForms`,
  and eviction sync.
- Store battery in `test/store.test.ts` (extending the exact-object toEqual
  idiom at :86) — no mocks, hand-built `Sighting` literals.

**Success Definition**: All tally cases pass (create-per-class, mid-cap
accumulation with capDisplay majority/tie-recent, structural-conditional
counting, permanent twin suppression, post-lower structural drops);
existing store tests pass with the new fields added to expectations;
`npm run check` + `npm test` green; `display` behavior byte-identical
(recency wins, untouched).

## Why

- Spec 06 h2.41 defines the Candidate shape WITH tallies (no `display` in
  the spec's shape — display is legacy being retired); h2.43 defines the
  merge semantics. Goal 12 (§01): "displayed forms follow conversation
  frequency rather than recency" — the tallies are the evidence base the
  P1.M2.T1.S1 resolver will read.
- score.ts provably reads no `display` (grep zero hits, scout §3) — the
  additive fields cannot perturb salience/eviction.
- Consumers: P1.M2.T1.S1 (resolver), P1.M2.T1.S2 (display removal),
  P1.M2.T3.S1 (/acwords tally columns), P2.M1.T2.S2 (branch purity
  equality assertions).

## What

### 1. types.ts — Candidate (additive)

```ts
export interface Candidate {
  key: string;
  /** KEPT (legacy, temporary): most recent casing seen. Removed by
   *  P1.M2.T1.S2 once the casing resolver replaces all consumers. */
  display: string;
  /** Capitalized-tally sightings (spec 06 h2.43): mid-cap sightings always
   *  count; a structural-cap (sentence-initial) sighting counts ONLY while
   *  the word has never been seen lowercase. */
  capCount: number;
  /** Lowercase sightings. Once > 0 it is permanent — later structural-cap
   *  sightings never contribute to capCount again, and the structural
   *  contributions counted before the first lowercase sighting were
   *  removed permanently (twin suppression, 06 h2.43). */
  lowerCount: number;
  /** Most frequent capitalized form; ties → the most recent sighting's
   *  form. Only MID-CAP sightings compete (structural forms are purgeable
   *  evidence). Empty string when no valid capitalized sighting exists. */
  capDisplay: string;
  /** INTERNAL (not spec'd): pending structural-cap contributions inside
   *  capCount, removed wholesale at the first lowercase sighting. Never
   *  serialized, never user-facing. */
  structuralCapCount?: number;
  sessionCount: number;
  lastSeenOrdinal: number;
  firstSeenOrdinal: number;
  userTyped: boolean;
  properName: boolean;
  rankGroup: RankGroup;
}
```

### 2. store.ts — tally accumulation (upsert :264–298) + side map

Add `#capForms = new Map<string, Map<string, number>>()` (per-key form→count
for the capDisplay argmax). Not part of Candidate; deleted when the word is
evicted (see §4).

**Create path** (per `sighting.casing`):

| casing | capCount | lowerCount | capDisplay | structuralCapCount |
|---|---|---|---|---|
| `lower` | 0 | 1 | `""` | 0 |
| `mid-cap` | 1 | 0 | `sighting.display` (+ form count 1) | 0 |
| `structural-cap` | 1 | 0 | `""` | 1 |

**Merge path** (after the unchanged sessionCount/ordinal/display/flags/
rankGroup lines):

```ts
switch (sighting.casing) {
  case "lower":
    existing.lowerCount++;
    if (existing.structuralCapCount) {
      existing.capCount -= existing.structuralCapCount; // twin suppression
      existing.structuralCapCount = 0;                  // PERMANENT (lowerCount>0)
    }
    break;
  case "mid-cap": {
    existing.capCount++;
    const forms = this.#capForms.get(existing.key) ?? new Map();
    const f = (forms.get(sighting.display) ?? 0) + 1;
    forms.set(sighting.display, f);
    this.#capForms.set(existing.key, forms);
    // capDisplay: argmax form count; ties → the most recently bumped form
    // (compare against the OLD capDisplay's count, which is still in `forms`).
    if (existing.capDisplay === "" ||
        f >= (forms.get(existing.capDisplay) ?? 0)) {
      existing.capDisplay = sighting.display;
    }
    break;
  }
  case "structural-cap":
    if (existing.lowerCount === 0) {
      existing.capCount++;
      existing.structuralCapCount = (existing.structuralCapCount ?? 0) + 1;
    }
    // else: dropped entirely — the lowercase form is the word (06 h2.43);
    // sessionCount/display/flags above still applied.
    break;
}
```

`sessionCount` counts BOTH casings (unchanged); `display` keeps its
recency-wins assignment at :291 (temporary, deliberate).

### 3. Semantics pins

- **Permanence**: once `lowerCount > 0`, structural-cap sightings NEVER
  contribute again — no field may resurrect the removed contributions.
- **capDisplay tie rule**: a mid-cap form that TIES the current maximum
  takes over (most recent sighting wins) — the `>=` above.
- **Chain-only members** (dictionary top-band, P1.M1.T3.S1) never reach
  `upsert` — the store needs no guard, but add a comment noting the
  contract.
- Paths/hexish/literals arrive with raw-casing `display` and their casing
  class per P1.M1.T1.S1 — no special-casing here.

### 4. Eviction sync

In `evictIfOverCap`'s drop path (where `#map.delete(key)` happens), add
`this.#capForms.delete(key)` — the side map must never outlive its
candidate (a re-created key would otherwise inherit stale form counts).

### 5. TDD battery (test/store.test.ts — write first, red)

Hand-built `Sighting` literals (no mocks), extending the :86 exact-object
`toEqual` idiom (existing tests need the new fields added to expectations):

1. Create per class — the three table rows above, exact objects.
2. Mid-cap accumulation: `Zendesk` ×2 + `ZENDESK` ×1 → capCount 3,
   capDisplay "Zendesk" (majority); make `ZENDESK` ×2 → flips to "ZENDESK".
3. Tie → most recent: two forms at equal counts, latest sighting's form wins.
4. Structural-conditional: `Check` (structural) ×3 → capCount 3, capDisplay
   "".
5. Twin suppression PERMANENCE: structural ×3 then `check` → capCount 0,
   lowerCount 1; then structural again → still capCount 0, forever; mid-cap
   after lower still counts (capCount 1, capDisplay set).
6. Structural after lower: dropped from tallies but sessionCount++
   (both casings), display refresh, sticky OR-ins intact.
7. display still recency (unchanged legacy pin).
8. Eviction sync: force eviction of a word with #capForms entries, re-create
   the key, assert fresh tallies (no stale form-count carryover).
9. rankGroup min / userTyped stickiness regression (existing cases, now
   with new fields in expectations).

### Success Criteria

- [ ] All 9 case groups pass; `npm run check` + `npm test` green
- [ ] `display` behavior byte-identical (no consumer changes anywhere)
- [ ] Permanence rule pinned: no path resurrects removed structural counts
- [ ] `#capForms` lifecycle synced with eviction
- [ ] Diff confined to `src/core/types.ts`, `src/core/store.ts`,
      `test/store.test.ts`

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed?" — Yes: current Candidate/Sighting shapes quoted, upsert code shape
with line anchors, the full merge-rule table with code, the side-map design
rationale, eviction-sync requirement, consumer-inventory rationale for
keeping display, and the battery list are all specified.

### Documentation & References

```yaml
- docfile: plan/006_7bd0258da993/architecture/02-store-query-r1-r2.md
  section: §1 anchors, §3 store internals, §5 .display consumer inventory
  why: corrected line anchors (Candidate :19-33, Sighting :36-47, upsert
        :264-298 incl. the :291 display assignment); "Nothing reads display
        for scoring" verification; the ~22-consumer inventory that forces
        the ADDITIVE-only approach here.
  critical: "the R1 tallies must be accumulated at these two sites (create
        + merge)" — exactly :264-298.

- file: src/core/types.ts (Candidate :19-33, Sighting :36-47 with the new
        casing field)
  why: the migration site + the upstream Sighting.casing contract.

- file: src/core/store.ts (upsert :264-298, evictIfOverCap drop path)
  pattern: create-fills-all-fields / merge-bumps idiom; sticky OR-ins;
        rankGroup min.
  gotcha: the eviction drop path is the only place #capForms may leak —
        add the delete there.

- file: plan/006_7bd0258da993/P1M1T1S1/PRP.md
  why: CONTRACT (upstream): Sighting.casing: CasingClass
        ('lower' | 'mid-cap' | 'structural-cap') threaded segment→ingest;
        "Store's upsert receives it (store logic untouched)" — THIS task is
        that store logic. If S1 has not landed, its field shape is the
        contract; sequence after it.
  note: P1.M1.T1.S2 (run walk, parallel) consumes the same classes but
        touches ingest, not the store — no conflict.

- PRD §06 h2.41 (Candidate shape WITH tallies) + h2.43 (upsert semantics
  with the permanence rule) — normative source, quoted in the item.
```

### Current Codebase tree (relevant)

```bash
src/core/types.ts    # Candidate + Sighting (casing landed by S1)
src/core/store.ts    # upsert + eviction ← fix site
test/store.test.ts   # battery (:86 exact-object idiom)
```

### Desired Codebase tree

```bash
src/core/types.ts    # Candidate + capCount/lowerCount/capDisplay/structuralCapCount
src/core/store.ts    # tally accumulation + #capForms side map + eviction sync
test/store.test.ts   # +9 case groups
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: keep display populated exactly as today (:291) — ~22 consumers
// stay green only until P1.M2.T1.S2 swaps them to the resolver. Any
// "helpful" display change here breaks widget/provider/debug tests.

// CRITICAL: the structural purge is SUBTRACTIVE against capCount using
// structuralCapCount — never recompute from raw sightings (they are gone).
// And once lowerCount > 0, structuralCapCount stays 0 forever.

// GOTCHA: capDisplay ties → most recent: use >= against the CURRENT
// capDisplay's form count (the bumped form may tie and must win).

// GOTCHA: structural-cap sightings NEVER set/compete for capDisplay
// (purgeable evidence; contract text pins mid-cap-only competition).

// GOTCHA: sessionCount counts BOTH casings — tallies are evidence, not
// occurrence counts; do not gate sessionCount on casing class.

// GOTCHA: structuralCapCount is optional (undefined ≡ 0) so existing
// exact-object tests can adopt it incrementally; keep arithmetic
// null-safe ((existing.structuralCapCount ?? 0)).
```

## Implementation Blueprint

### Implementation Tasks (ordered, TDD)

```yaml
Task 1: ADD the 9 TDD case groups to test/store.test.ts (red); extend
        existing exact-object expectations with the new fields.
Task 2: EDIT src/core/types.ts — Candidate additive fields + Mode-A JSDoc.
Task 3: EDIT src/core/store.ts — #capForms side map; create/merge tally
        accumulation per the What section; eviction-path #capForms.delete;
        chain-only comment.
Task 4: VALIDATE — npm test -- test/store.test.ts; full npm test; check.
```

### Implementation Patterns & Key Details

```ts
// The merge switch lands AFTER the unchanged legacy lines
// (sessionCount/lastSeenOrdinal/display/sticky/rankGroup) so casing
// classification can never skip the occurrence bookkeeping — a dropped
// structural sighting is dropped from TALLIES only.
```

### Integration Points

```yaml
CODE: src/core/types.ts, src/core/store.ts
TESTS: test/store.test.ts
DOWNSTREAM (do not implement here):
  - P1.M2.T1.S1 resolver reads capCount/lowerCount/capDisplay
  - P1.M2.T1.S2 removes Candidate.display (subtractive half)
  - P1.M2.T3.S1 /acwords tally columns; P2.M1.T2.S2 purity equality
  - P1.M1.T3.S1 guarantees chain-only members never reach upsert
FROZEN: score.ts (reads no display — verified), query.ts, provider/widget
  (display consumers untouched), ingest.ts (Sighting construction is S1's)
```

## Validation Loop

### Level 1: Syntax

```bash
npm run check
```

### Level 2: Unit tests

```bash
npm test -- test/store.test.ts
npm test        # full suite — display consumers are the canary
```

### Level 3: Behavior spot-check

```bash
# Hand-build sightings: Check(structural)×3 → capCount 3; add check(lower)
# → capCount 0 lowerCount 1; add Check(structural) → still 0; add
# Zendesk(mid-cap)×2 + ZENDESK×2 → capDisplay "ZENDESK" (latest tie).
```

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green; display consumers byte-stable
- [ ] Create-per-class table pinned; mid-cap majority + tie-recent pinned
- [ ] Twin suppression permanence pinned (incl. post-lower structural drop)
- [ ] sessionCount counts both casings; sticky flags/rankGroup untouched
- [ ] #capForms eviction sync verified (no stale carryover)
- [ ] JSDoc on all four new fields with the 06 h2.43 anchor

## Anti-Patterns to Avoid

- ❌ Touching `display` behavior (additive-only migration; removal is
  P1.M2.T1.S2)
- ❌ Recomputing tallies from raw text (sightings are consumed once)
- ❌ Letting structural-cap sightings set capDisplay or resurrect after a
  lowercase sighting
- ❌ Leaking #capForms past eviction
- ❌ Gating sessionCount/flags on casing class (tallies are evidence only)
- ❌ Adding store-side guards for chain-only members (P1.M1.T3.S1 owns the
  ingest-side guard)

---

**Confidence Score: 9/10** — the spec semantics are quoted verbatim, the
upsert sites are line-anchored, the side-map/tie-rule/optional-field design
decisions are made explicitly, and the additive-only constraint is enforced
by the verified consumer inventory.

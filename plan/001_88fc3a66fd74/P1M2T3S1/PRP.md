# PRP — P1.M2.T3.S1: Admission decision (bands 220/120, subword clamp)

## Goal

**Feature Goal**: Implement `admit()` in `src/core/score.ts` — the PRD §04 h2.24
admission decision that maps a shape-gated `CandidateDraft` plus a dictionary
lookup to a `RankGroup` (0 | 1 | 2) or `'reject'`, with the subword clamp
(a subword never ranks above its parent whole token's group + 1).

**Deliverable**: `src/core/score.ts` exporting:
- `admit(draft: CandidateDraft, dictionary: Dictionary, parentGroup?: RankGroup): RankGroup | 'reject'`
- `REJECT_COMMON_THRESHOLD = 220`
- `MID_FREQ_THRESHOLD = 120`

plus `test/score.test.ts` (or `test/admission.test.ts` — follow the existing
one-file-per-module test layout in `test/`).

**Success Definition**: All bands of the PRD table implemented exactly; subword
clamping correct; `npm test` green; `npm run check` (tsc) clean; no new
dependencies; module stays pure core (no pi imports).

## Why

Admission is the only place dictionary commonness gates the store: very common
English words (`the`, `context`) must never enter the candidate store; rare
words get the best rank group (0) because they are the most valuable
completions. The ingest pipeline (P1.M3.T2.S2) calls `admit` for every
shape-gated draft and folds the result into a `Sighting` for
`store.upsert` (P1.M2.T4.S1). Constants 220/120 are baked — the ONLY tuning
surface (PRD §04/§08; tuning happens in-codebase per §09, never at runtime).

## What

Given `q = dictionary.lookup(draft.key)` (0–255 quantized rank, `null` when
absent — PRD §03 loader contract):

| Condition                      | Result (whole token)                  |
| ------------------------------ | ------------------------------------- |
| `q !== null && q >= 220`       | `'reject'` — very common (`the`)      |
| `q !== null && 120 <= q < 220` | group `2` — mid-frequency (`tokenizer`) |
| `q !== null && q < 120`        | group `1` — rare-but-attested         |
| `q === null`                   | group `0` — rare-by-default           |

Subword candidates (`draft.isSubword === true`) take the SAME table, then the
result is clamped: final group = `Math.max(tableGroup, parentGroup! + 1)` when
`parentGroup` is supplied — a subword never ranks above parent + 1. A subword
that the table rejects (`q >= 220`) is still `'reject'` (clamp applies only to
admitted groups; you cannot clamp "reject" into admission).

### Success Criteria

- [ ] `admit` exported from `src/core/score.ts` with the exact signature above
- [ ] `REJECT_COMMON_THRESHOLD`/`MID_FREQ_THRESHOLD` exported named constants (220/120)
- [ ] All four table rows correct, including exact boundary values 119/120/219/220
- [ ] Subword clamp: subword of parent group 2 can never be group < max(table, 3→ but group caps at 2, i.e. a parent-group-2 child is always group 2 unless rejected); subword of parent group 1 with table group 0 → group 2; etc.
- [ ] Works with a stubbed `Dictionary` (no real binary needed in unit tests)
- [ ] `npm test` and `npm run check` pass

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase: everything needed is below — the
exact input/output types already exist, the test layout is given, and the table
is fully specified.

### Documentation & References

```yaml
- file: src/core/segment.ts (lines ~160-175)
  why: defines CandidateDraft — the input type. key (lowercase), display,
        properName, isSubword, parentKey (set iff isSubword).
  gotcha: do not modify segment.ts; import the type via
        `import type { CandidateDraft } from "./segment.js"` (note .js ESM
        suffix used throughout this codebase).

- file: src/core/types.ts
  why: RankGroup = 0 | 1 | 2 and Dictionary interface
        (`lookup(word: string): number | null`). Import type-only.

- file: src/core/shapeGate.ts
  why: sibling module — copy its file header/comment style and JSDoc density.
        Admission runs AFTER the shape gate in the pipeline; hexish 13–19 band
        was deliberately gate-admitted and relies on this module (dictionary
        lookup or q===null→group 0) for its fate — admission never
        special-cases hexish.

- file: test/shapeGate.test.ts
  why: test conventions — vitest describe/it, a small local `draft()` factory
        helper at the top, exhaustive boundary assertions, explanatory
        comments citing PRD sections.

- file: src/core/dictionary.ts
  why: real Dictionary implementation (only if an integration-style test is
        desired; NOT required — stub lookup in unit tests per the contract).
```

### Current Codebase tree (relevant)

```bash
src/core/
  types.ts        # RankGroup, Dictionary, Candidate, Sighting — DO NOT MODIFY
  segment.ts      # tokenize + expandCandidates + CandidateDraft
  shapeGate.ts    # passesShape (P1.M2.T2, in flight in parallel)
  dictionary.ts   # packed loader
test/
  segment.test.ts shapeGate.test.ts dictionary.test.ts ...
package.json      # scripts: check = tsc --noEmit, test = vitest --run
```

### Desired Codebase tree

```bash
src/core/score.ts        # NEW — admit() + two constants (this task ONLY;
                         #   salience/ranking is P1.M2.T3.S2, do not implement)
test/score.test.ts       # NEW — admission unit tests with stub Dictionary
```

### Known Gotchas & Library Quirks

```python
# CRITICAL: use `import type { CandidateDraft } from "./segment.js"` — the
# codebase uses ESM NodeNext-style .js specifiers in TS imports.
# CRITICAL: src/core must never import from pi packages (architecture invariant).
# RankGroup values: SMALLER = rarer = better rank. The clamp therefore RAISES
#   the numeric group: clamp = Math.max(group, parentGroup + 1), then
#   Math.min(2, ...) since RankGroup caps at 2 (parentGroup 2 + 1 = 3 must
#   saturate to 2). Reject is unaffected by the clamp.
# parentGroup is `RankGroup | undefined`: whole tokens omit it; when a subword
#   arrives without parentGroup, apply the table unclamped (defensive — the
#   ingest pipeline will always supply it for subwords).
# Constants are baked: do NOT read from config/env (PRD §08 "not configurable").
# q is an integer 0–255 by contract — no range validation needed; but q values
#   are rank-like where LOW = rare? NO — per PRD §04 table, LOW q = rare-but-
#   attested (group 1) and HIGH q = very common. The build pipeline quantized
#   so that 0 = rarest, 255 = most common; trust the table verbatim.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/core/score.ts
  - IMPLEMENT: file header comment in the codebase style (module role in the
    pipeline, PRD §04 h2.24 citation, purity note: type-only imports).
  - EXPORT: const REJECT_COMMON_THRESHOLD = 220 as const
  - EXPORT: const MID_FREQ_THRESHOLD = 120 as const
  - IMPLEMENT: admit(draft, dictionary, parentGroup?) with JSDoc:
      q = dictionary.lookup(draft.key)
      q === null                    -> group 0
      q < MID_FREQ_THRESHOLD        -> group 1
      q < REJECT_COMMON_THRESHOLD   -> group 2
      else                          -> 'reject'
      if (draft.isSubword && parentGroup !== undefined && result !== 'reject')
        result = Math.min(2, Math.max(result, parentGroup + 1)) as RankGroup
  - NAMING: snake-case file, camelCase functions, match segment.ts/shapeGate.ts tone.
  - PLACEMENT: src/core/score.ts. NO salience code (P1.M2.T3.S2 owns the rest
    of the module later).

Task 2: CREATE test/score.test.ts
  - IMPLEMENT: stub Dictionary factory at top:
      const dict = (entries: Record<string, number>): Dictionary => ({
        lookup: (w) => w in entries ? entries[w] : null,
        version: 1,
        entryCount: Object.keys(entries).length,
      });
  - COVER (whole token): q===null→0; q=0→1; q=119→1; q=120→2; q=219→2;
    q=220→reject; q=255→reject. Use keys that pass no special rules ("zzqv",
    "tokenish" etc. — key strings are arbitrary since the dict is stubbed).
  - COVER (subword clamp, isSubword:true drafts): parent 0 + table 0 → 1;
    parent 1 + table 0 → 2; parent 2 + table 0 → 2 (saturate, NOT 3);
    parent 0 + table 1 → 1; parent 1 + table 2 → 2; parent 0 + table 2 → 2;
    subword with q>=220 → 'reject' regardless of parent.
  - COVER: subword without parentGroup → unclamped table result.
  - FOLLOW pattern: test/shapeGate.test.ts (draft factory, describe/it naming,
    boundary-value comments).
```

### Implementation Patterns & Key Details

```typescript
export type AdmissionResult = RankGroup | 'reject'; // local alias, fine

export function admit(
  draft: CandidateDraft,
  dictionary: Dictionary,
  parentGroup?: RankGroup,
): AdmissionResult {
  const q = dictionary.lookup(draft.key);
  let result: AdmissionResult;
  if (q === null) result = 0;
  else if (q >= REJECT_COMMON_THRESHOLD) result = 'reject';
  else if (q >= MID_FREQ_THRESHOLD) result = 2;
  else result = 1;
  if (result === 'reject') return result;
  if (draft.isSubword && parentGroup !== undefined) {
    // smaller group = rarer; never rank above parent + 1; saturate at 2
    return Math.min(2, Math.max(result, parentGroup + 1)) as RankGroup;
  }
  return result;
}
```

### Integration Points

```yaml
DOWNSTREAM: src/pi/ingest.ts (P1.M3.T2.S2) — pipeline order:
  expandCandidates → passesShape → admit → build Sighting (types.ts) →
  store.upsert (P1.M2.T4.S1). Whole tokens are admitted BEFORE their subwords
  so the parent's group is known — note this ordering in score.ts's header
  comment so the ingest implementer cannot get it wrong.
NO config changes. No new deps. types.ts untouched.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check          # tsc --noEmit — expect zero errors
```

### Level 2: Unit Tests

```bash
npm test               # full vitest run — all existing suites stay green
npx vitest --run test/score.test.ts   # focused run while iterating
```

### Level 3: Integration

Not applicable — pure module, no I/O. The stub-dictionary tests ARE the
integration surface (they consume the real `Dictionary` interface).

### Level 4: Domain-specific

Boundary-value review: 119/120 and 219/220 are the load-bearing edges; the
saturating clamp at parent group 2 (2+1 → 2, never 3) is the #1 likely bug.
Verify test names cite PRD §04 h2.24.

## Final Validation Checklist

- [ ] `npm run check` clean; `npm test` all green
- [ ] `admit`, `REJECT_COMMON_THRESHOLD`, `MID_FREQ_THRESHOLD` exported
- [ ] All four table rows + both boundaries (120, 220) tested
- [ ] Subword clamp incl. saturation at 2 and reject-immunity tested
- [ ] No modifications to types.ts, segment.ts, shapeGate.ts, dictionary.ts
- [ ] No salience/ranking code (that is P1.M2.T3.S2)
- [ ] Module pure: type-only imports from ./types.js and ./segment.js
- [ ] Constants baked — no config/env reads

## Anti-Patterns to Avoid

- ❌ Don't make thresholds configurable or env-driven (PRD §08 forbids)
- ❌ Don't clamp `'reject'` into an admitted group
- ❌ Don't return group 3 (RankGroup caps at 2)
- ❌ Don't load the real binary dictionary in unit tests — stub `lookup`
- ❌ Don't implement salience/eviction/ranking here (sibling task scope)

## Confidence Score: 9/10
Types, table, clamp semantics, and test conventions are all pinned to existing
code; the only residual risk is the parallel P1.M2.T2.S2 work, which touches
only shapeGate.ts and cannot conflict with this file.
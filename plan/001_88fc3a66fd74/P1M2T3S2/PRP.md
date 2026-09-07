# PRP — P1.M2.T3.S2: Salience formula, eviction score, ranking comparators

## Goal

**Feature Goal**: Implement the query-time ranking math in `src/core/score.ts`
(the same module as `admit()` from P1.M2.T3.S1, which lands in parallel and
MUST be preserved): `salience()`, `evictionScore()`, and
`compareCandidates()`. These three functions are the ONLY ranking math in the
codebase — `src/core/query.ts` (P1.M2.T5.S1) and store eviction
(P1.M2.T4.S3) import them; never reimplement.

**Deliverable**: additions to `src/core/score.ts` exporting:
- `salience(c: Candidate, currentOrdinal: number): number`
- `evictionScore(c: Candidate, currentOrdinal: number): number`
- `compareCandidates(a: Candidate, b: Candidate, currentOrdinal: number): number`
- Optional named constant `TOP_N = 8` is NOT this task's scope (query.ts owns top-N).

plus tests in `test/score.test.ts` (or a clearly separated
`test/ranking.test.ts` if you prefer file separation — both acceptable; do not
delete the admission tests).

**Success Definition**: hand-computed orderings from PRD §09 pass (frequency
beats rare-once; recency decay τ=20; userTyped flips a tie); `npm test` and
`npm run check` green; module stays pure core.

## Why

Ranking is what makes the completion menu useful: session-specific frequency,
recency, user typing, proper names, and rarity must combine deterministically
into a total order with no visible ties. Salience is computed at **query time
from store stats** — never stored, never persisted (PRD §04). Weights
2.0/3.0/1.5/0.8/1.0 are **baked constants, NOT configurable**; tuning happens
in-codebase per the §09 protocol.

## What

Exact contracts (all in `src/core/score.ts`, alongside `admit`):

```typescript
salience(c, currentOrdinal) =
    2.0 * Math.log2(1 + c.sessionCount)
  + 3.0 * Math.exp(-(currentOrdinal - c.lastSeenOrdinal) / 20)
  + 1.5 * (c.userTyped ? 1 : 0)
  + 0.8 * (c.properName ? 1 : 0)
  + 1.0 * (c.rankGroup === 0 ? 1.0 : c.rankGroup === 1 ? 0.5 : 0)

evictionScore(c, currentOrdinal) = salience(c, currentOrdinal)
                                 * Math.exp(-(currentOrdinal - c.lastSeenOrdinal) / 50)

compareCandidates(a, b, currentOrdinal):
  1. salience descending  (higher salience first)
  2. tie → shorter candidate first (key length)
  3. tie → lexicographic byte order on the lowercase key
  Return a standard comparator number (negative → a first).
```

### Success Criteria

- [ ] All three functions exported with exact signatures above
- [ ] `evictionScore` REUSES `salience` (single source of truth for weights)
- [ ] `compareCandidates` produces a total, deterministic order (comparator
      must be consistent: same inputs → same sign; never returns NaN)
- [ ] Weights/taus baked as module-level consts (e.g. `SALIENCE_WEIGHTS`,
      `RECENCY_TAU = 20`, `EVICTION_TAU = 50`) — no config/env reads
- [ ] `admit` + its two threshold constants from S1 remain intact
- [ ] `npm test` and `npm run check` pass

## All Needed Context

### Context Completeness Check

Everything needed is here: the input type `Candidate` already exists verbatim
in `src/core/types.ts` (shown below), formulas are fully specified, and test
conventions are pinned by existing suites.

### Documentation & References

```yaml
- file: src/core/types.ts
  why: defines Candidate — the exact input shape:
        { key (lowercase), display, sessionCount, lastSeenOrdinal,
          firstSeenOrdinal, userTyped (sticky), properName, rankGroup:
          0|1|2, isSubword }
  gotcha: DO NOT modify types.ts. Import type-only:
        `import type { Candidate } from "./types.js"` (ESM .js specifier).

- file: plan/001_88fc3a66fd74/P1M2T3S1/PRP.md (previous item, in flight)
  why: defines what src/core/score.ts will already contain: `admit()`,
        `REJECT_COMMON_THRESHOLD = 220`, `MID_FREQ_THRESHOLD = 120`, and the
        file header comment. Treat as a CONTRACT: append your functions to
        that file without altering existing exports or header semantics
        (you may extend the header comment to cover the whole module).

- file: test/shapeGate.test.ts and test/segment.test.ts
  why: test conventions — vitest describe/it, local factory helper at top,
        boundary-value comments citing PRD sections.

- file: src/core/segment.ts / src/core/shapeGate.ts
  why: sibling module style for JSDoc density and header comments. Read-only.
```

### Current Codebase tree (relevant)

```bash
src/core/
  types.ts        # Candidate, RankGroup — READ-ONLY
  segment.ts shapeGate.ts dictionary.ts   # read-only siblings
  score.ts        # EXISTS or lands via P1.M2.T3.S1 (admit only)
test/
  segment.test.ts shapeGate.test.ts ...   # vitest, --run mode
package.json      # check = tsc --noEmit; test = vitest --run
```

### Desired Codebase tree

```bash
src/core/score.ts        # EXTEND: + salience, evictionScore, compareCandidates
test/score.test.ts       # EXTEND (or test/ranking.test.ts if split)
```

### Known Gotchas & Library Quirks

```python
# CRITICAL: ESM NodeNext imports use .js suffix in TS: from "./types.js".
# CRITICAL: src/core must never import from pi packages.
# CRITICAL: currentOrdinal - c.lastSeenOrdinal >= 0 by store invariant; but
#   Math.exp of a negative /tau is fine even for delta 0 (=1.0). Do NOT clamp.
# compareCandidates must compare SALIENCE numerically first — floating-point
#   near-ties do NOT count as ties; only exact equality falls through to
#   length then key compare. This is deterministic because salience is pure.
# Tie-break 3 is BYTE order on the lowercase key: plain `a.key < b.key`
#   (JS string comparison is UTF-16 code-unit order; keys are ASCII after
#   segmentation, so this equals byte order — note it in a comment).
# Eviction tau = 50 (slower decay than ranking's tau = 20) — don't swap them.
# P1.M2.T3.S1 runs in PARALLEL: if score.ts does not exist yet when you start,
# create it with BOTH halves? NO — check the repo first; if score.ts is
# missing, write only your half and leave a header comment noting admit()
# arrives from S1; if present, extend it. Never delete or rename admit.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EXTEND src/core/score.ts
  - CHECK: does score.ts exist (S1 may have landed)? If yes extend; if no,
    create with your functions + a header noting admit() is owned by S1.
  - IMPLEMENT: module constants
      const RECENCY_TAU = 20;
      const EVICTION_TAU = 50;
      const W_FREQ = 2.0, W_RECENCY = 3.0, W_USER_TYPED = 1.5,
            W_PROPER_NAME = 0.8, RARITY_GROUP_0 = 1.0, RARITY_GROUP_1 = 0.5;
    (naming is yours; weights stay literal numbers, never configurable)
  - IMPLEMENT: salience(c, currentOrdinal) per formula, JSDoc citing PRD §04
    h2.25; note "computed at query time; never stored".
  - IMPLEMENT: evictionScore(c, currentOrdinal) = salience * exp(-delta/50),
    JSDoc: used ONLY by store eviction (P1.M2.T4.S3); higher = keep longer.
  - IMPLEMENT: compareCandidates(a, b, currentOrdinal): salience desc →
    a.key.length asc → a.key locale-free lexicographic asc. Standard
    comparator return (a first → negative).

Task 2: EXTEND test/score.test.ts (or CREATE test/ranking.test.ts)
  - IMPLEMENT: candidate factory helper:
      const cand = (over: Partial<Candidate> = {}): Candidate => ({
        key: 'token', display: 'token', sessionCount: 1,
        lastSeenOrdinal: 1, firstSeenOrdinal: 1, userTyped: false,
        properName: false, rankGroup: 0, isSubword: false, ...over });
  - COVER salience (hand-computed values):
      * fresh single sighting at same ordinal, group 0: exact value
        2*log2(2) + 3*e^0 = 2 + 3 = 5.0 (assert closeTo)
      * frequency term: sessionCount 8 → 2*log2(9) ≈ 6.339
      * recency decay: delta 20 → 3*e^-1 ≈ 1.1036; delta 40, delta 100 → ~0
      * userTyped adds exactly 1.5; properName adds exactly 0.8
      * rarity: group 0 → +1.0, group 1 → +0.5, group 2 → +0
  - COVER evictionScore: equals salience * exp(-delta/50); delta 0 → salience;
    delta 50 → salience/e; large delta → → 0.
  - COVER compareCandidates (PRD §09 orderings):
      * frequency beats rare-once: A sessionCount 8 vs B sessionCount 1,
        both seen at same ordinal, same flags → A first even when rarer group.
      * recency decay τ=20: A seen 30 messages ago vs B seen 1 ago (similar
        counts) → B first.
      * userTyped flips a tie: two otherwise-identical candidates, one
        userTyped → typed one first.
      * exact tie → shorter key first ('fix' before 'fixpoint').
      * still tied → byte order: 'abort' before 'abstract'.
      * full-order determinism: sort a shuffled array of ~8 mixed candidates
        twice, assert identical result (stable, total order).
  - KEEP: all existing admission tests untouched and green.
```

### Implementation Patterns & Key Details

```typescript
export function salience(c: Candidate, currentOrdinal: number): number {
  const delta = currentOrdinal - c.lastSeenOrdinal;
  return (
    W_FREQ * Math.log2(1 + c.sessionCount) +
    W_RECENCY * Math.exp(-delta / RECENCY_TAU) +
    W_USER_TYPED * (c.userTyped ? 1 : 0) +
    W_PROPER_NAME * (c.properName ? 1 : 0) +
    (c.rankGroup === 0 ? RARITY_GROUP_0 : c.rankGroup === 1 ? RARITY_GROUP_1 : 0)
  );
}

export function evictionScore(c: Candidate, currentOrdinal: number): number {
  return salience(c, currentOrdinal) *
         Math.exp(-(currentOrdinal - c.lastSeenOrdinal) / EVICTION_TAU);
}

export function compareCandidates(
  a: Candidate, b: Candidate, currentOrdinal: number,
): number {
  const s = salience(b, currentOrdinal) - salience(a, currentOrdinal); // desc
  if (s !== 0) return s;
  if (a.key.length !== b.key.length) return a.key.length - b.key.length;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; // ASCII keys = byte order
}
```

### Integration Points

```yaml
DOWNSTREAM:
  - src/core/query.ts (P1.M2.T5.S1): calls compareCandidates for final order,
    slices top 8. It must NOT recompute salience separately.
  - src/core/store.ts eviction (P1.M2.T4.S3): sorts by evictionScore ascending
    to pick eviction victims (lowest score evicted first); userTyped
    protection is store logic, not score logic.
NO config changes. No new deps. types.ts untouched.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check          # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/score.test.ts   # focused while iterating
npm test                              # whole suite green (incl. admission)
```

### Level 3: Integration

N/A — pure module; downstream consumers land later. Hand-computed values in
tests ARE the verification (compute expected numbers with a calculator or
node one-liner, e.g. `2*Math.log2(9)`, `3*Math.exp(-1)`).

### Level 4: Domain-specific

Re-verify the three PRD §09 orderings by name in test titles so the tuning
protocol (§09 h2.52) can find them later.

## Final Validation Checklist

- [ ] `npm run check` clean; `npm test` all green
- [ ] `salience`, `evictionScore`, `compareCandidates` exported with exact signatures
- [ ] Hand-computed values asserted (5.0 fresh case; τ=20 decay; τ=50 eviction)
- [ ] §09 orderings tested: frequency-beats-rare-once, recency decay, userTyped tie-flip
- [ ] Tie-breaks (length, byte order) and full-sort determinism tested
- [ ] admit + 220/120 constants from S1 intact; no conflicts with parallel S1 work
- [ ] No config/env reads; no pi imports; types.ts unmodified
- [ ] Salience never stored/persisted (pure function only)

## Anti-Patterns to Avoid

- ❌ Don't store salience on Candidate or in the store (query-time only)
- ❌ Don't make weights configurable (PRD §08 explicitly forbids)
- ❌ Don't reimplement the formula inside evictionScore — call salience()
- ❌ Don't use localeCompare for tie-break 3 (locale-dependent); use raw string compare
- ❌ Don't round or quantize salience floats before comparing
- ❌ Don't touch admit() or duplicate admission logic

## Confidence Score: 9/10
Candidate type, formulas, tie-break rules, test conventions, and the parallel
S1 contract are all pinned; residual risk is only file-level merge with the
in-flight S1 PRP, mitigated by the extend-vs-create instructions above.
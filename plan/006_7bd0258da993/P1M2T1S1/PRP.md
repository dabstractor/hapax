---
name: "P1.M2.T1.S1 (plan 006) — Pure casing resolver in core + resolver battery"
---

## Goal

**Feature Goal**: Implement spec §04 h2.32's completion-time casing
resolution as a pure function in `src/core/query.ts`:
`resolveCompletionCasing(c, fragmentFirstLetter)` — an uppercase fragment
first letter never has its Shift press uncased (capitalized form wins);
a lowercase/zero fragment resolves by conversation-frequency tallies
(ties → lowercase; cap-only words complete capitalized; all-caps and
paths verbatim). No resolver exists today; RankedMatch.display is still
filled from the legacy `Candidate.display` (removal + wiring is
P1.M2.T1.S2).

**Deliverable**:
1. `resolveCompletionCasing` export + JSDoc (Mode A, spec anchor 04
   h2.32, pinned rules) in `src/core/query.ts`
2. Resolver battery (TDD) — new describe in `test/query.test.ts`

**Success Definition**: All battery cases green (capital-fragment
preserve incl. 'Nr'+'NREL'→'NREL' and no-cap-sightings→capitalize-key;
frequency winner; tie→lower; cap-only→capitalized; all-caps verbatim;
paths verbatim; zero-fragment listing uses the frequency branch); pure
function, no pi imports, no store dependency; `npm run check` +
`npm test` green with zero behavior change yet (resolver unconsumed —
wiring is S2).

## Why

- Spec §04 h2.32: "Insertion casing is resolved at completion time from
  the casing tallies" — the tallies landed (P1.M1.T2.S1) but nothing
  resolves from them yet; ~22 downstream `.display` consumers
  (provider/widget/ingest/debug) currently read the legacy
  `Candidate.display` (recency-casing), which S2 removes. The resolver
  is the shared primitive S2 (query wiring), P1.M2.T2.S1/S2 (successor
  labels), and P1.M2.T3.S1 (/acwords) all consume.
- Goal 13 (capitalized series): "a typed capital first letter is never
  uncased, and displayed forms follow conversation frequency rather
  than recency."

## What

In `src/core/query.ts`:

```ts
/** Completion-time casing resolution (spec §04 h2.32; PRD R2). Pure:
 *  consumes the candidate's casing tallies plus the live fragment's
 *  first letter — never the store, never recency.
 *
 *  Rules (pinned; spec 04 h2.32):
 *   - UPPERCASE fragment first letter: the capitalized form wins — the
 *     user's Shift press is never overridden. capDisplay verbatim when
 *     a valid capitalized sighting exists ('Nr' + capDisplay 'NREL' →
 *     'NREL'; + 'National' → 'National' — only the first letter is
 *     adapted and the rest comes from the winning form's spelling;
 *     capDisplay already starts uppercase); otherwise the key's first
 *     letter is capitalized.
 *   - Lowercase or ZERO-length fragment (''): the form that occurred
 *     more often wins (capCount vs lowerCount); ties → lowercase; a
 *     word seen only capitalized completes capitalized. All-caps words
 *     ('NREL') complete verbatim (their sightings all count as
 *     capitalized occurrences). Paths/technical literals have no
 *     casing variance — lowercase-only tallies return the key
 *     verbatim.
 *   - Defensive: a non-letter first letter takes the frequency branch;
 *     capCount > 0 with empty capDisplay falls back to capitalizing
 *     the key (never returns "").
 */
export function resolveCompletionCasing(
  c: Pick<Candidate, "key" | "capCount" | "lowerCount" | "capDisplay">,
  fragmentFirstLetter: string,
): string;
```

Implementation sketch (exact rules):

```ts
const upper = fragmentFirstLetter >= "A" && fragmentFirstLetter <= "Z";
if (upper) {
  return c.capDisplay !== ""
    ? c.capDisplay
    : c.key.charAt(0).toUpperCase() + c.key.slice(1);
}
// Frequency branch (lowercase, zero-fragment, non-letter — defensive).
if (c.capCount > c.lowerCount) {
  return c.capDisplay !== ""
    ? c.capDisplay
    : c.key.charAt(0).toUpperCase() + c.key.slice(1); // defensive
}
return c.key; // lowercase wins or ties
```

Import: `Candidate` type already imported? Check query.ts's type imports
(it imports `RankedMatch` from types.js) — add `Candidate` as a
type-only import if missing.

### Battery (TDD — new describe in test/query.test.ts)

```yaml
UPPERCASE-FRAGMENT BRANCH:
  - 'Nr' + {key:'nrel', capDisplay:'NREL', capCount:5, lowerCount:9} → 'NREL'
    (Shift preserved even though lowercase dominated the tallies)
  - 'Nr' + {key:'national', capDisplay:'National', ...} → 'National'
  - 'N' + {key:'zendesk', capDisplay:'', capCount:0, lowerCount:7} → 'Zendesk'
    (no capitalized sightings → capitalize the key's first letter)
  - multi-char rest untouched: 'Z' + capDisplay 'Z_lwlock' → 'Z_lwlock'

FREQUENCY BRANCH (lowercase fragment 'n' / zero-fragment ''):
  - capCount 5 > lowerCount 2 → capDisplay
  - lowerCount 9 > capCount 2 → key
  - tie 4/4 → key (ties → lowercase)
  - cap-only {capCount:3, lowerCount:0} → capDisplay ("seen only
    capitalized completes capitalized")
  - all-caps: {key:'nrel', capDisplay:'NREL', capCount:4, lowerCount:0}
    → 'NREL' (verbatim)
  - zero-fragment ('') behaves exactly as a lowercase fragment
    (the '#'-alone listing path)
  - path candidate: {key:'src/core/query.ts', capDisplay:'', capCount:0,
    lowerCount:5} + 's' → key verbatim; + 'S' → 'Src/core/query.ts'?
    NO — pin the ACTUAL rule outcome: uppercase branch with empty
    capDisplay capitalizes the first letter ('Src/core/query.ts').
    Spec says paths "insert verbatim" — verbatim holds for the
    frequency branch; the uppercase branch capitalizes only when the
    USER typed a capital. PIN BOTH outcomes in the test with comments
    citing h2.32 (the uppercase-fragment capitalization is the
    never-override rule, not a path violation).

DEFENSIVE:
  - capCount > 0, capDisplay '' → never "" (capitalized key)
  - non-letter fragmentFirstLetter ('#', '/') → frequency branch
```

Note: pure-function tests need no store — hand-built tally literals
(the `Pick` shape). Mocking: none.

### Success Criteria

- [ ] `resolveCompletionCasing` exported from src/core/query.ts with the Mode-A JSDoc (rules + spec anchor 04 h2.32)
- [ ] Every battery case above passes, written red-first
- [ ] Pure: no pi imports, no runtime dependencies beyond the type import; O(1)
- [ ] Zero behavior change elsewhere (`npm run check` + `npm test` green; resolver unconsumed)

## All Needed Context

### Context Completeness Check

An implementer needs: the exact tally-field contracts (capDisplay's
empty-string semantics, lowerCount permanence), the spec's rule text,
the exact expected outputs for every battery case (including the
path-under-uppercase nuance), the placement rationale, and the scope
fence against S2's wiring. All below.

### Documentation & References

```yaml
- file: src/core/query.ts
  why: The resolver's home (S2 wires it at the two match-construction
        sites :531/:582 — DO NOT touch those this task). Export near the
        top with the other pure helpers; type-import Candidate from
        ./types.js.
  pattern: heavy JSDoc citing spec sections; pure module (no pi imports).
  gotcha: do NOT modify rankMatches/match construction — wiring is
          P1.M2.T1.S2; leaving the resolver unconsumed is CORRECT here.

- file: src/core/types.ts
  why: Candidate (:21+) — the four tally fields' EXACT contracts:
        capCount (capitalized tally; structural-cap counts only until
        the first lowercase sighting), lowerCount (permanent once > 0),
        capDisplay (most frequent capitalized form, ties → most recent,
        ONLY mid-cap sightings compete, EMPTY STRING when no valid
        capitalized sighting), display (legacy, removed by S2).
        RankedMatch (:199-219) for context only.

- docfile: plan/006_7bd0258da993/architecture/02-store-query-r1-r2.md
  section: "§4" (two display construction sites), "§5 .display consumer
           inventory (~22 sites)", "§7 test-battery conventions"
  why: Confirms no resolver exists, the S2 wiring sites, the consumer
        set this resolver will eventually feed, and the describe-with-
        spec-cite test style.

- docfile: plan/006_7bd0258da993/prd_snapshot.md (mirrors spec/)
  section: h2.32 "Case handling" + h2.9 goal 13
  why: The authoritative rule text: uppercase fragment → capitalized
        form wins, Shift never overridden, only first letter adapted;
        lowercase → frequency, ties → lowercase, cap-only → capitalized,
        all-caps verbatim, paths/literals verbatim; menu labels use the
        same resolution.

- docfile: plan/006_7bd0258da993/P1M1T3S2/PRP.md
  why: The parallel predecessor (mid-cap relaxed band 95 in score.ts +
        ingest occurrence override) — different file areas; read to
        confirm no conflicts and to reuse its casing-class vocabulary.

- file: test/query.test.ts
  why: Battery home (new describe; pure-function cases need no store
        fixture). Follow the existing describe-with-spec-cite titles and
        file-header doc-comment; update the header to mention the
        resolver battery.
```

### Current Codebase tree (relevant)

```bash
src/core/query.ts     # ADD resolveCompletionCasing (+ Candidate type import)
test/query.test.ts    # ADD describe("resolveCompletionCasing — spec §04 h2.32")
```

### Desired Codebase tree

```bash
src/core/query.ts     # MODIFIED: + resolver export (unconsumed yet)
test/query.test.ts    # MODIFIED: + resolver battery
```

### Known Gotchas & Library Quirks

```typescript
// CRITICAL: capDisplay === "" is the "no valid capitalized sighting"
// sentinel (Candidate contract) — every branch must handle it; never
// return "" from the resolver.

// GOTCHA: uppercase-branch capitalization of a path key
// ('S' + 'src/core/query.ts' → 'Src/core/query.ts') is the CORRECT
// outcome — the never-override rule outranks path verbatim-ness, which
// holds on the frequency branch (paths have lowercase-only tallies).
// Pin both outcomes with spec-citing comments so a future "fix"
// doesn't fork the rules.

// GOTCHA: zero-fragment ('') is the '#'-alone listing path — the
// frequency branch (no first letter to preserve). Non-letter first
// letters (defensive) take the same branch.

// GOTCHA: the resolver consumes capCount AS STORED (it may still
// include pending structural-cap contributions — that's upsert
// bookkeeping via structuralCapCount; the spec's "occurred more often
// in the conversation" reads the tallies, and twin suppression keeps
// them honest once a lowercase sighting lands). Do NOT subtract
// structuralCapCount here.

// GOTCHA: only the FIRST letter is adapted — never re-case the rest of
// the winning form (capDisplay's spelling wins wholesale; the key's
// spelling wins wholesale in the capitalize-key fallback).

// GOTCHA: don't wire the resolver into rankMatches or touch
// Candidate.display — both are P1.M2.T1.S2.
```

## Implementation Blueprint

### Implementation Tasks (ordered — TDD)

```yaml
Task 1: WRITE the failing battery (test/query.test.ts)
  - ADD describe("resolveCompletionCasing — spec §04 h2.32 (PRD R2)")
    with the cases enumerated in "What" (uppercase branch incl.
    'Nr'+'NREL' and capitalize-key fallback; frequency branch incl.
    tie→lower, cap-only, all-caps, zero-fragment; path both branches;
    defensive never-empty + non-letter)
  - Hand-built tally literals (the Pick shape) — no store, no mocks
  - RUN: npx vitest --run test/query.test.ts → RED (undefined export)

Task 2: IMPLEMENT (src/core/query.ts)
  - TYPE-IMPORT Candidate (extend the existing types.js import)
  - ADD resolveCompletionCasing + the Mode-A JSDoc from "What"
  - PLACEMENT: before rankMatches, near the other pure exports
  - RUN: npx vitest --run test/query.test.ts → GREEN

Task 3: FULL validation
  - npm run check; npm test (resolver unconsumed — no behavior change;
    all suites green)
```

### Implementation pattern

Final-form function (the sketch in "What" is the contract — one
uppercase check, one frequency branch, two fallbacks, all O(1)):

```typescript
export function resolveCompletionCasing(
  c: Pick<Candidate, "key" | "capCount" | "lowerCount" | "capDisplay">,
  fragmentFirstLetter: string,
): string {
  const upper = fragmentFirstLetter >= "A" && fragmentFirstLetter <= "Z";
  if (upper || c.capCount > c.lowerCount) {
    return c.capDisplay !== ""
      ? c.capDisplay
      : c.key.charAt(0).toUpperCase() + c.key.slice(1);
  }
  return c.key; // lowercase wins or ties (spec: ties → lowercase)
}
```

Note the folded form: the uppercase branch and the capCount-wins branch
share the same "capitalized form" tail — keep them as two explicit
branches with comments if clearer; either shape must pass the battery.

### Integration Points

```yaml
NONE this task (resolver exported but unconsumed):
  - P1.M2.T1.S2: wire at BOTH match-construction sites (query.ts :531
    anchored/gated loop, :582 tier-0 pass; zero-fragment flows through
    :531 with fragment-first-letter "" ) and REMOVE Candidate.display
  - P1.M2.T2.S1/S2: successor labels resolve via the same function
  - P1.M2.T3.S1: /acwords display
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check      # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/query.test.ts -v   # resolver describe green; existing describes untouched
npm test                                  # full suite green
```

### Level 3–4: Not applicable (pure function, no integration)

The completion-time behavior emerges when S2 wires the resolver; this
task's Level 4 is a spec re-read: every battery case traceable to a
spec §04 h2.32 sentence.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors
- [ ] `npm test` full suite green

### Feature Validation

- [ ] 'Nr'+'NREL'→'NREL', 'Nr'+'National'→'National', no-cap→capitalized key
- [ ] Frequency winner / tie→lower / cap-only→capitalized / all-caps verbatim
- [ ] Zero-fragment = frequency branch; paths verbatim on that branch
- [ ] Never returns ""; non-letter fragment defensive
- [ ] Only the first letter is ever adapted

### Code Quality Validation

- [ ] Mode-A JSDoc with pinned rules + spec anchor
- [ ] Pure, O(1), no pi imports, no store access
- [ ] TDD order followed; no wiring/scope creep into S2

## Anti-Patterns to Avoid

- ❌ Don't re-case the whole winning form — only the first letter is ever adapted
- ❌ Don't subtract structuralCapCount in the resolver (upsert bookkeeping owns it)
- ❌ Don't special-case paths/all-caps with typeof checks — the tallies already encode them
- ❌ Don't wire into rankMatches or remove Candidate.display (S2 scope)
- ❌ Don't return "" on capDisplay-empty with capCount>0

**Confidence Score: 9/10** — pure function, spec text explicit, tally
contracts verified in types.ts, every battery case's expected output
enumerated (including the one judgment call — path-under-uppercase —
resolved with spec reasoning and pinned in tests).

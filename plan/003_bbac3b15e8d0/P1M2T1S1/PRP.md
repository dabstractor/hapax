---
name: "P1.M2.T1.S1 (plan 003) — matchFragment: first-char anchor + greedy subsequence + tiers 3/2/1"
---

## Goal

**Feature Goal**: Implement the pure anchored-fuzzy matcher of PRD §04
h2.28: `matchFragment(f, c)` — case-insensitive first-char anchor,
greedy-leftmost anchored subsequence, strictness tiers 3 (exact prefix) /
2 (contiguous tail) / 1 (scattered), and the tier admission-score
arithmetic. This is the matching primitive that retires plain-prefix as
the only match mode; S2/T2/T3 wire it into ranking, the store scan, and
the chain gate.

**Deliverable**:
- `export interface MatchResult { tier: 1 | 2 | 3; score: number }`
- `export function matchFragment(f: string, c: string): MatchResult | null`
  in `src/core/query.ts`, with full JSDoc
- TDD unit tests in `test/query.test.ts` (new describe, pure-function
  cases; no store needed)

**Success Definition**: All tier/anchor/case-insensitivity cases green
(`'esk'` never matches `'zendesk'`; `'zsk'`→tier 2 on `'zendesk'`;
`'zlock'`→tier 2 on `'z_lwlock'`; `'hrp'`→tier 1 on
`'handleResponseProxy'`; `'roun'`→tier 3 on `'rounding'`; `/`-bearing
path-key spot-check); score arithmetic per §04's formula (computed, not
prose-approximated); `npm run check` + `npm test` green with zero
production behavior change yet (matchFragment is exported but not yet
consumed by rankMatches — that is T2.S2).

## Why

- PRD §04 h2.28 (2026-10 owner rule) RETIRES plain prefix matching:
  matching becomes first-char-anchored fuzzy with threshold-gated
  admission scoring, so a large store never floods results (M3 goal 8)
  while mid-identifier entry stays available through sub-word candidates.
- The anchor is load-bearing for performance: only the store's first-char
  bucket is fuzzy-scanned per query (T2.S2), keeping the < 1 ms keystroke
  budget.
- This task lands ONLY the pure function + tests. Score stub returning 0
  would ease review, but the item prefers landing the real arithmetic
  (all inputs fall out of the same two-pointer pass) — this PRP lands the
  real arithmetic; the below-threshold DISCARD and `fuzzThreshold` wiring
  stay in S2/S3.

## What

In `src/core/query.ts`:

```ts
/** Fuzzy match result (PRD §04 h2.28): tier = strictness (3 = exact
 *  prefix, 2 = contiguous tail, 1 = scattered subsequence), score =
 *  admission score 0–100 (threshold-gated later, NOT order-determining). */
export interface MatchResult {
  tier: 1 | 2 | 3;
  score: number;
}

export function matchFragment(f: string, c: string): MatchResult | null;
```

### Algorithm (single two-pointer pass)

1. Normalize: `f = f.toLowerCase(); c = c.toLowerCase();` (c is a
   lowercase store key by contract, but the matcher is self-contained —
   never assume the caller pre-lowercased).
2. Edge cases: `f.length === 0` → null (zero-fragment listing is
   rankMatches' special case, never the matcher's); `f.length > c.length`
   → null; `f[0] !== c[0]` → null (ANCHOR).
3. Tail = `f.slice(1)` vs `c.slice(1)`.
   - Tier 3: `tail === ""` (f length 1) OR `c.startsWith(f)` →
     `{ tier: 3, score: 100 }`.
   - Tier 2: `const runStart = c.indexOf(tail, 1)`; if `runStart !== -1`
     → `{ tier: 2, score: tier2Score(runStart - 1, c.length) }` where
     charsSkippedBeforeRun = runStart − 1.
   - Tier 1: greedy leftmost two-pointer scan of tail through `c[1..]`
     (advance j over c, consume tail chars on match). If all tail chars
     consumed → tier 1, scoring from the trace: gapRuns = number of gap
     stretches BETWEEN consecutive matched tail chars (gaps before the
     first matched tail char after the anchor are NOT gapRuns — the
     anchor is not gapped); gapChars = total skipped characters across
     those gaps. Else → null.
4. Score arithmetic (§04 h2.28 verbatim, integer, clamped to [0, 100]):
   - tier 3: `100`
   - tier 2: `85 − 40 · (charsSkippedBeforeRun / len(c))`
   - tier 1: `50 − 5 · gapRuns − min(gapChars, 15)`

Note: a zero-gap tier-1 trace is exactly the tier-2 contiguous case, so
`indexOf` (step 3) and the pass agree; you may compute both in one pass
or use indexOf for the tier-2 shortcut — either is a single pass total.
Round to integer (`Math.round`); clamp defensively.

### JSDoc (Mode: rides with the code)

Document: the anchor rule (`esk` never matches `zendesk`; mid-identifier
entry via sub-word candidates), greedy-leftmost semantics, tier
definitions with the spec's examples, the score formulas + "constants are
calibration starting points (§09 tuning protocol); tier BOUNDARIES are
semantics, never tunable", that score is admission-only (threshold-gated
before ranking, never order-determining), and that `/` and `.` are
ordinary characters on the candidate side (rule-4d path keys).

### Success Criteria

- [ ] `matchFragment` + `MatchResult` exported from src/core/query.ts; no other production change
- [ ] Anchor: `'esk'` → null on `'zendesk'`; first-char case-insensitive
- [ ] Tiers: 3 = exact prefix (`'roun'`→`'rounding'`), 2 = contiguous tail (`'zsk'`→`'zendesk'`, `'zlock'`→`'z_lwlock'`), 1 = scattered (`'hrp'`→`'handleResponseProxy'`)
- [ ] Scores computed by the formula (assert exact values, see worked examples); tier 1 max ≤ 50; tier 3 always 100
- [ ] `f.length === 0` → null; `f.length === 1` matching anchor → tier 3 / 100; `f.length > c.length` → null
- [ ] Case-insensitive: `'ZSK'` ≡ `'zsk'`; candidate side too (`'Rounding'` key impossible in store, but matcher lowercases anyway)
- [ ] `/`-spot-check pinned: `'sr/co'` vs `'src/core/query.ts'` → tier 1 (scattered; `'r/co'` not contiguous in `'rc/core/query.ts'`); `'sr'` → tier 3
- [ ] `npm run check` + `npm test` green (P1.M1.T2.S4's prefix-matcher pins untouched — rankMatches unchanged)

## All Needed Context

### Context Completeness Check

An implementer needs: the exact spec text (quoted below), the current
query.ts layout, the worked score examples, the drift note about the
prose's ≈69 example, the scope fences (S2 discard, S3 threshold config,
T2 ranking/scan, T3 chain gate — all NOT this task), and test-file
conventions. All below.

### Documentation & References

```yaml
- file: src/core/query.ts
  why: The ONLY source file to modify. rankMatches/prefixRange seam at
        ~L107 (do NOT touch); add MatchResult + matchFragment near the top,
        after DEFAULT_LIMIT / RankOptions, before rankMatches.
  pattern: module header style, exported-const + interface + function with
           heavy JSDoc; pure module (imports salience from score.js —
           matchFragment itself needs NO imports).
  gotcha: rankMatches must keep its current prefix behavior — the wiring
          change is T2.S2; leaving matchFragment unconsumed is CORRECT here.

- file: test/query.test.ts
  why: Where the tests go (new describe appended; pure-function cases need
        no store fixture). Existing describes pin the CURRENT prefix
        contract — leave them; T2 rewrites the ordering block.
  pattern: header doc-comment updated; it-blocks with inline comments
           computing expected scores.

- file: plan/003_bbac3b15e8d0/architecture/r3-query-fuzzy.md
  section: "§7 Feasibility" + "§8 Recommended signatures + risks"
  why: Confirms the single-pass approach, the MatchResult shape, which
        risks belong to OTHER tasks (RankedMatch churn, perf-gate re-basing,
        chain filter) — scope fences for this PRP.

- file: plan/003_bbac3b15e8d0/P1M1T2S4/PRP.md
  why: The parallel predecessor — pins path candidates under the CURRENT
        matcher. Its tests must stay green (they will: rankMatches is
        untouched); its `sr` → `src/core/query.ts` case informs the
        /-spot-check test.

- docfile: plan/003_bbac3b15e8d0/prd_snapshot.md
  section: h2.28 "Query matching (anchored fuzzy; 2026-10 owner rule)"
  why: The authoritative spec — anchor, subsequence, tiers, score
        formulas, threshold-gating semantics (gating itself is S2).
```

### Current Codebase tree (relevant)

```bash
src/core/query.ts       # rankMatches (prefix) — ADD matchFragment + MatchResult
test/query.test.ts      # ADD describe("matchFragment — anchored fuzzy (§04 h2.28)")
```

### Desired Codebase tree

```bash
src/core/query.ts       # MODIFIED: + MatchResult, + matchFragment (exported, unconsumed yet)
test/query.test.ts      # MODIFIED: + matcher describe (TDD)
```

### Known Gotchas & Library Quirks

```typescript
// CRITICAL: 'hr' → 'handleResponse' computes to EXACTLY 85 by the formula
// (contiguous from c[1], skip 0). The PRD prose's "≈ 69" example is
// inconsistent with its own formula — the FORMULA wins (spec: constants
// are calibration starting points; test the formula, not the prose).
// Similarly 'zsk'→'zendesk' = 85 − 40·3/7 ≈ 68 (not the prose's ≈62).

// GOTCHA: tier 1 max score is 50 (50 − 0 − 0 when everything is
// gap-free... which is actually tier 2) — with the future default
// threshold 60 ALL scattered matches gate out. Intended per spec; do NOT
// "fix" the formula here.

// GOTCHA: lowercase INSIDE matchFragment (both args) — rankMatches
// lowercases the fragment today, but T3.S1 (chain gate) and tests may
// pass raw casing; the matcher is self-contained.

// GOTCHA: empty fragment → null, NOT tier 3. The '#'-alone zero-fragment
// listing is rankMatches' own special case (T2), never the matcher's.

// GOTCHA: 1-char fragment with a matching anchor → tier 3 score 100 —
// required by the provider's auto-open contract (1-char answers).

// GOTCHA: charsSkippedBeforeRun counts from c[1] (runStart − 1), because
// c[0] is consumed by the anchor. gapRuns/gapChars count ONLY gaps between
// matched tail chars (the anchor char is never gapped).

// GOTCHA: '/' and '.' are ordinary characters — path keys
// ('src/core/query.ts', ≤96 chars) flow through the same first-char scan
// once T2 wires it; the anchor matches the TRIMMED key's first char.

// GOTCHA: keep it integer and O(len(c)) — no regex backtracking, no
// allocation beyond the result object. This runs per candidate per
// keystroke inside the < 1 ms budget.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies — TDD)

```yaml
Task 1: WRITE the failing matcher tests (test/query.test.ts)
  - ADD describe("matchFragment — anchored fuzzy (PRD §04 h2.28)") with:
    * anchor: 'esk' vs 'zendesk' → null; 'roun' vs 'rounding' → tier 3;
      'ZSK' vs 'zendesk' ≡ 'zsk' (case-insensitive, both sides)
    * tiers: 'zsk'→zendesk tier 2 score 85−40·3/7 (≈68, assert rounded
      exact); 'zlock'→'z_lwlock' tier 2 score 70; 'hrp'→
      'handleResponseProxy' tier 1 (compute gapRuns/gapChars by hand:
      h anchor; r@1, p@7... verify trace: 'andleresponseproxy' — r then p
      with one gap run); 'hr'→'handleResponse' tier 2 score 85 (formula,
      NOT the prose ≈69 — comment the drift)
    * boundaries: '' → null; 'z' vs 'zendesk' → {3,100}; 'z' vs 'hapax'
      → null; f longer than c → null; f === c → {3,100}
    * score math: tier 1 max ≤ 50 (a best-case scattered trace, e.g.
      'zp' vs 'zendesk': z anchor, p@6, one gap run of 4 chars →
      50 − 5 − 4 = 41); clamped to [0,100]
    * '/'-spot-check: 'sr' vs 'src/core/query.ts' → {3,100};
      'sr/co' vs 'src/core/query.ts' → tier 1 (scattered — 'r/co' not
      contiguous in 'rc/core/query.ts'); pin the exact score from the
      hand-computed trace
  - RUN: npx vitest --run test/query.test.ts → red (matchFragment undefined)

Task 2: IMPLEMENT (src/core/query.ts)
  - ADD MatchResult interface + matchFragment per the algorithm in "What"
  - PLACE: after RankOptions, before compareRankedMatches/rankMatches
  - JSDoc per "JSDoc" section (anchor, greedy-leftmost, tiers with spec
    examples, formulas, calibration-vs-semantics note, /-as-ordinary-char)
  - DO NOT touch rankMatches, compareRankedMatches, RankOptions, DEFAULT_LIMIT
  - RUN: npx vitest --run test/query.test.ts → green

Task 3: FULL validation
  - npm run check; npm test (all suites green — the prefix-matcher pins,
    path-candidate pins from P1.M1.T2.S4, perf gates unaffected)
```

### Implementation pattern

```typescript
// Single pass over c; tier-2 shortcut via indexOf (also a single pass).
export function matchFragment(f: string, c: string): MatchResult | null {
  const fl = f.toLowerCase();
  const cl = c.toLowerCase();
  if (fl.length === 0 || fl.length > cl.length) return null;
  if (fl[0] !== cl[0]) return null; // ANCHOR (§04 h2.28 rule 1)
  if (fl.length === 1 || cl.startsWith(fl)) return { tier: 3, score: 100 };
  const tail = fl.slice(1);
  const runStart = cl.indexOf(tail, 1);
  if (runStart !== -1) {
    const skipped = runStart - 1; // c[1..runStart-1] skipped before the run
    return { tier: 2, score: clamp(Math.round(85 - 40 * (skipped / cl.length))) };
  }
  // Tier 1: greedy leftmost anchored subsequence with a gap trace.
  let i = 1, gapRuns = 0, gapChars = 0, inGap = false;
  for (const ch of tail) {
    const at = cl.indexOf(ch, i); // careful: must scan forward from i —
    if (at === -1) return null;   // implement with an explicit char loop
    if (at > i) { gapRuns++; gapChars += at - i; }
    i = at + 1;
  }
  return { tier: 1, score: clamp(Math.round(50 - 5 * gapRuns - Math.min(gapChars, 15))) };
}
// NOTE: the sketch's per-char indexOf is O(len(tail)·len(c)) worst case
// and double-counts gaps — the landed version must be ONE two-pointer
// pass (advance j over cl, consume tail chars) tracking inGap/lastMatch,
// which is O(len(c)) and correct. Use the sketch for shape, not bytes.
```

### Integration Points

```yaml
NONE this task (matchFragment exported but unconsumed):
  - P1.M2.T1.S2: admission-score threshold discard inside rankMatches'
        candidate loop + RankOptions.fuzzThreshold default wiring
  - P1.M2.T1.S3: fuzzThreshold config surface (0–100 clamp, default 60)
  - P1.M2.T2.S2: prefixRange(f[0]) first-char scan replacing prefixRange(f)
  - P1.M2.T3.S1: chain successor filter → fuzzy membership gate
  - P1.M3.T2.S1: widget visibility consumes ≥1 surviving candidate
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check      # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/query.test.ts -v   # matcher describe green, existing describes untouched
npm test                                  # full suite green
```

### Level 3: Performance sanity (informational — gates re-based in T2.S2)

```bash
# The matcher is O(len(c)) per call; no gate applies until wired into
# rankMatches (T2.S2). Optional: a 20k-call loop timing sanity in the
# matcher describe (mirroring test/query.test.ts's perf-sanity style).
```

### Level 4: Spec conformance re-read

Re-read PRD h2.28 after implementation and check every bullet: anchor,
greedy-leftmost subsequence, the three tier definitions + examples,
score formulas, "tier boundaries are semantics, never tunable",
threshold semantics (forward-declared for S2).

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors
- [ ] `npm test` full suite green

### Feature Validation

- [ ] `'esk'` never matches `'zendesk'`; anchor case-insensitive
- [ ] Tier 3/2/1 classifications per spec examples
- [ ] Scores exact per formula (integer, clamped); prose-approximation drift documented in test comments
- [ ] `''`→null; 1-char→{3,100}; too-long→null
- [ ] `/`-spot-check pinned (sr → tier 3; sr/co → tier 1)

### Code Quality Validation

- [ ] Single O(len(c)) pass; no regex, no allocations beyond the result
- [ ] JSDoc complete (anchor, tiers, formulas, calibration note, / semantics)
- [ ] No consumption wiring, no RankedMatch changes, no rankMatches changes (scope fences to S2/T2/T3/M3)
- [ ] TDD order followed

## Anti-Patterns to Avoid

- ❌ Don't wire matchFragment into rankMatches or change compareRankedMatches (T2 scope)
- ❌ Don't add the threshold discard or DEFAULT_FUZZ_THRESHOLD constant (S2/S3 scope)
- ❌ Don't chase the PRD prose's "≈ 62 / ≈ 69" examples over the formula
- ❌ Don't use regex or per-char indexOf loops that break the O(len(c)) bound
- ❌ Don't special-case '/' — it's an ordinary character on both sides
- ❌ Don't forget the self-lowercase (matcher is case-insensitive by itself)

**Confidence Score: 9/10** — algorithm, formulas, worked examples, edge
cases, test home, and scope fences are all pinned; the only judgment call
(the prose-vs-formula drift) is resolved in favor of the formula and
documented.

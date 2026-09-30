---
name: "P1.M2.T1.S2 (plan 003) — Admission score constants + below-threshold discard before ranking"
---

## Goal

**Feature Goal**: Land the threshold-gating half of PRD §04 h2.28's admission score: export the score formula constants from `src/core/query.ts` as named calibration starting points (spec §09 tuning protocol), add the baked `DEFAULT_FUZZ_THRESHOLD = 60` + a `fuzzThreshold` option on `RankOptions`, and discard candidates scoring below the threshold INSIDE rankMatches' candidate loop — before they ever enter the matches array — while leaving ranking/comparator and the store scan to P1.M2.T2.*.

**Deliverable**:
- Exported constants in `src/core/query.ts`: `TIER3_SCORE = 100`, `TIER2_BASE_SCORE = 85`, `TIER2_SKIP_FACTOR = 40`, `TIER1_BASE_SCORE = 50`, `TIER1_GAPRUN_PENALTY = 5`, `TIER1_GAPCHAR_CAP = 15`, `DEFAULT_FUZZ_THRESHOLD = 60` — each `as const` with JSDoc (calibration starting points; tier boundaries are semantics, never tunable)
- `matchFragment` refactored to consume the exported constants (behavior identical — S1's pinned scores must stay green)
- `RankOptions.fuzzThreshold?: number` (default `DEFAULT_FUZZ_THRESHOLD`) and the below-threshold skip in rankMatches' candidate loop (non-empty fragment only)
- TDD tests in `test/query.test.ts`: score arithmetic per tier via imported constants; below-threshold never renders; `fuzzThreshold: 0` admits everything; the default-60-kills-tier-1 pin; `fuzzThreshold: 100` = exact-prefix-only

**Success Definition**: All S1 matcher pins stay green (values unchanged, now computed from exported constants); rankMatches discards low-scoring fuzzy matches before ranking; zero-fragment queries bypass the gate entirely (full listing, unchanged); prefix-era rankMatches tests stay green (prefixes are tier 3 / score 100 — always pass); `npm run check` + `npm test` green.

## Why

- PRD §04 h2.28: "Candidates scoring below `fuzzThreshold` ... are discarded BEFORE ranking — they render nothing even though they technically match." At a ~20k-entry store with loose fuzzy settings, results flood; only fairly strict matches belong. The default admits every exact prefix and strong contiguous tails and gates out most scattered matches.
- The spec's config schema (§08 h2.52) requires `fuzzThreshold`'s default to be auto-imported from the baked constant in the query module — "same pattern as rejectCommonness" (config.ts imports REJECT_COMMON_THRESHOLD from ../core/score.js). S2 bakes that constant; P1.M2.T1.S3 wires the config key to it.
- Pinning "default 60 kills ALL tier-1" is a spec-quoted regression guard (tier 1 max score is 50) — without the pin, a future constant tweak could silently re-admit scattered matches.

## What

All in `src/core/query.ts` unless noted.

### 1. Export the calibration constants (refactor, no behavior change)

```ts
/** Admission-score calibration starting points (PRD §04 h2.28, §09 tuning
 *  protocol). Tunable constants; the tier BOUNDARIES (prefix / contiguous
 *  tail / scattered) are semantics, never tunable. */
export const TIER3_SCORE = 100 as const;
export const TIER2_BASE_SCORE = 85 as const;
export const TIER2_SKIP_FACTOR = 40 as const;
export const TIER1_BASE_SCORE = 50 as const;
export const TIER1_GAPRUN_PENALTY = 5 as const;
export const TIER1_GAPCHAR_CAP = 15 as const;

/** Default fuzzThreshold (PRD §08 h2.52): minimum admission score for a
 *  candidate to enter a result set. 60 admits all exact prefixes (100)
 *  and strong contiguous tails, gates out ALL scattered matches (tier-1
 *  max = 50). Higher = stricter; 100 = exact-prefix-only; 0 = admit all.
 *  config.ts auto-imports this as the schema default (rejectCommonness
 *  pattern). */
export const DEFAULT_FUZZ_THRESHOLD = 60 as const;
```

Replace the inline literals in `matchFragment`'s score arithmetic with these constants. Every score S1 pinned must remain byte-identical (`Math.round` still applied to tier 2; clamp still defensive).

### 2. fuzzThreshold option + the discard

- `RankOptions` gains `fuzzThreshold?: number` (JSDoc: 0–100; absent = `DEFAULT_FUZZ_THRESHOLD`; S3 plumbs the config value).
- In `rankMatches`' candidate loop: when the fragment is NON-EMPTY, gate each candidate through `matchFragment(f, key)` — `if (m === null || m.score < (opts.fuzzThreshold ?? DEFAULT_FUZZ_THRESHOLD)) continue;` — before pushing to `matches`. The gate runs per-candidate inside the loop (r3 doc §7: "skip candidates below threshold so they never enter matches"), NOT as a post-ranking filter.
- Zero-fragment (`f === ""`, the `#`-alone listing): no anchor, no tiers, NO gate — every candidate flows to the ranking path unchanged (P1.M2.T2.S1 owns that ordering).
- Do NOT touch `compareRankedMatches`, `DEFAULT_LIMIT`, `prefixRange`, or the comparator — ranking rewrite is P1.M2.T2.S1, scan re-basing is P1.M2.T2.S2.

### 3. Interaction note (why existing tests stay green)

With the gate in the loop, rankMatches' effective match predicate becomes fuzzy membership. Every OLD prefix match is tier 3 (score 100 ≥ any threshold ≤ 100), so all existing prefix-era expectations hold at default. New behavior visible only for thresholds > 100 (impossible — clamped) — i.e., at default the observable change vs. S1 is nil for prefix probes; the new tests exercise the gate directly through non-prefix fuzzy matches and option overrides.

### Success Criteria

- [ ] Constants exported; matchFragment consumes them; S1's exact score pins still green
- [ ] `RankOptions.fuzzThreshold` honored: below-threshold matches never enter the result (never render)
- [ ] `fuzzThreshold: 0` admits everything that matches; `fuzzThreshold: 100` = exact-prefix-only (tiers 2/1 max 85 < 100)
- [ ] Default-60-kills-tier-1 pinned with a spec-quoted comment (tier 1 max = 50)
- [ ] Zero-fragment path bypasses the gate (full listing unchanged)
- [ ] `npm run check` + `npm test` green; comparator/scan untouched

## All Needed Context

### Context Completeness Check

An implementer needs: the S1 matcher contract (shape, algorithm, worked score values), the exact scope fences (S3 config plumbing, T2.S1 comparator, T2.S2 scan), the rejectCommonness default-import pattern, the formula-vs-prose drift, and test conventions. All below.

### Documentation & References

```yaml
- file: plan/003_bbac3b15e8d0/P1M2T1S1/PRP.md
  why: THE upstream contract: MatchResult shape, matchFragment algorithm
        (two-pointer + indexOf tier-2 shortcut), score formulas with
        worked values (zsk→zendesk = 68 NOT prose's 62; hr→handleResponse
        = 85 NOT prose's 69; zlock→z_lwlock = 80; zp→zendesk tier-1 = 41),
        placement (after RankOptions, before rankMatches), and S1's test
        describe to keep green.
  critical: the formula wins over the PRD prose — pin formula-computed values.

- file: src/core/query.ts
  why: The ONLY source file to modify: add constants near DEFAULT_LIMIT;
        refactor matchFragment's literals; extend RankOptions; add the
        loop gate in rankMatches (~L110–119 candidate loop per r3 doc).
  gotcha: don't reorder/gate the zero-fragment branch; don't touch
          compareRankedMatches/prefixRange (T2's scope).

- file: src/pi/config.ts (line ~39)
  why: The default-import pattern S3 will replicate for fuzzThreshold
        (imports REJECT_COMMON_THRESHOLD from ../core/score.js). Read for
        pattern only — S3 makes the edit.

- file: test/query.test.ts
  why: Where tests go: S1's "matchFragment — anchored fuzzy" describe stays
        green; add a "admission threshold — fuzzThreshold gating (§04 h2.28)"
        describe. Prefix-era rankMatches describes untouched.
  pattern: assert via imported constants + hand-computed traces.

- docfile: plan/003_bbac3b15e8d0/architecture/r3-query-fuzzy.md
  section: "§7 Feasibility" (L81–118) + "§8 Recommended signatures + risks"
  why: Confirms loop placement of the discard, the 60-kills-tier-1 analysis,
        the 100=prefix-only derivation, and which risks belong to T2 (RankedMatch
        churn, perf re-basing, chain filter).

- docfile: plan/003_bbac3b15e8d0/prd_snapshot.md
  section: h2.28 (score formulas + threshold semantics), h2.52 (schema:
        fuzzThreshold default auto-import), h2.55 (query.test.ts: "Admission
        score + threshold" block)
  why: Authoritative spec for this exact behavior.
```

### Current Codebase tree (relevant)

```bash
src/core/query.ts    # matchFragment (S1) + rankMatches (prefix era) — MODIFY
test/query.test.ts   # ADD threshold-gating describe
```

### Desired Codebase tree

```bash
src/core/query.ts    # + exported score constants, + DEFAULT_FUZZ_THRESHOLD,
                     #   RankOptions.fuzzThreshold, loop gate in rankMatches
test/query.test.ts   # + "admission threshold" describe (TDD)
```

### Known Gotchas & Library Quirks

```typescript
// CRITICAL: S1's PRP documents the prose-vs-formula drift: 'zsk'→'zendesk'
// = 85 − 40·3/7 = 67.86 → rounds to 68 (PRD prose says ≈62). Pin 68 with a
// drift comment. Both clear 60 — the "passes barely" intent holds; note that
// any len(c) growth drops tier-2 scores fast (40/len scaling).

// GOTCHA: tier 2 rounds via Math.round — 'zlock'→'z_lwlock' = 85 − 40·1/8
// = 80 exactly; keep S1's rounding exactly (don't switch to truncation).

// GOTCHA: default 60 vs tier-1 max 50 — the discard kills EVERY scattered
// match at default. That is INTENDED (spec: "gates out most scattered
// matches"). Do not "fix" by lowering DEFAULT_FUZZ_THRESHOLD.

// GOTCHA: the gate compares score < threshold STRICTLY — a candidate exactly
// AT the threshold survives (zsk at 68 vs threshold 68 admits). Pin the
// strict-or-not boundary once, explicitly (score 100 vs threshold 100 →
// survives → exact-prefix-only mode at 100).

// GOTCHA: fuzzThreshold on RankOptions is OPTIONAL — absent means the baked
// default, NOT 0. S3 will pass the config value; tests exercise overrides.

// GOTCHA: zero-fragment listing must not run matchFragment at all ('' → null
// by S1's contract — gating on null would empty the menu). Guard with a
// fragment-length check before the gate, not inside matchFragment.

// GOTCHA: perf — the gate adds a matchFragment call per candidate per query.
// Prefixes short-circuit to tier 3 via startsWith inside matchFragment; the
// <1ms budget is preserved (r3 doc §7 feasibility). Perf gates must stay
// green; if they wobble, the scan re-basing (T2.S2 first-char range) is the
// planned remedy — do not inline-optimize here.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies — TDD)

```yaml
Task 1: WRITE failing threshold tests (test/query.test.ts)
  - ADD describe("admission threshold — fuzzThreshold gating (PRD §04 h2.28)")
    with a small seeded CandidateStore (existing store fixtures pattern in
    this file):
    * below-threshold never renders: store with 'zendesk' (tier-2 probe
      'zsk' scores 68) — rankMatches(store, 'zsk', { fuzzThreshold: 90 })
      → [] (and via default path: threshold 60 → ['zendesk'])
    * threshold 0 admits everything that matches: 'zsk' at 0 → ['zendesk'];
      scattered 'hrp' vs 'handleResponseProxy' (tier 1, low score) appears
      at 0, absent at 60 (the kill pin)
    * default-60-kills-tier-1 pin (spec-quoted comment): tier-1 max is 50 —
      at DEFAULT_FUZZ_THRESHOLD no scattered match ever renders
    * fuzzThreshold 100 = exact-prefix-only: prefix probe renders; 'zsk'
      (68) and any tier-1 do not
    * boundary: score exactly equals threshold → survives (100 vs 100)
    * score arithmetic per tier via constants: recompute zsk=68 /
      zlock=80 / zp-tier1=41 from the EXPORTED constants (import them;
      assert matchFragment returns Math.round of the formula) — constants
      are single-sourced
    * zero-fragment bypass: rankMatches(store, '') with fuzzThreshold 100
      still returns the full listing (no gate on the listing path)
  - RUN: npx vitest --run test/query.test.ts → new cases red

Task 2: IMPLEMENT (src/core/query.ts)
  - ADD the seven exported constants with JSDoc (Task list §1 text)
  - REFACTOR matchFragment's literals → constants (scores byte-identical)
  - EXTEND RankOptions with fuzzThreshold?: number
  - ADD the loop gate in rankMatches: non-empty fragment only;
    m = matchFragment(f, key); skip when null or score < (opts.fuzzThreshold
    ?? DEFAULT_FUZZ_THRESHOLD)
  - RUN: npx vitest --run test/query.test.ts → all green (S1 describe + new)

Task 3: FULL validation
  - npm run check; npm test (perf gates, provider suites, path-candidate
    pins from P1.M1.T2.S4 all green)
```

### Implementation pattern

The gate (inside rankMatches' candidate loop):

```typescript
const threshold = opts.fuzzThreshold ?? DEFAULT_FUZZ_THRESHOLD;
for (/* each candidate key in the scan */) {
  if (fragment !== "") {
    const m = matchFragment(fragment, key);
    if (m === null || m.score < threshold) continue; // §04 h2.28: discard BEFORE ranking
  }
  // ... existing push-to-matches work (salience/description unchanged; T2.S1 owns comparator)
}
```

### Integration Points

```yaml
CONFIG (deferred to P1.M2.T1.S3):
  - src/pi/config.ts will add the "fuzzThreshold" schema key, clamp 0–100,
    and default-import DEFAULT_FUZZ_THRESHOLD from ../core/query.js
    (rejectCommonness pattern). S2 only bakes + exports the constant.

RANKING (P1.M2.T2.S1):
  - consumes the filtered match stream; adds sessionCount to RankedMatch,
    the 4-key comparator, zero-fragment ordering, plural-prune placement.

SCAN (P1.M2.T2.S2):
  - prefixRange → first-char range re-basing (perf) — orthogonal to the gate.

CHAIN GATE (P1.M2.T3.S1):
  - re-points provider's startsWith successor filter to fuzzy membership at
    threshold 0 — reuses matchFragment + the semantics pinned here.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check     # tsc --noEmit — zero errors
grep -n "= 100\|= 85\|= 50" src/core/query.ts | grep -v "as const\|JSDoc"  # no stray literals in the formulas
```

### Level 2: Unit Tests

```bash
npx vitest --run test/query.test.ts -v   # S1 matcher describe + new threshold describe green
npm test                                   # full suite green (perf gates included)
```

### Level 3: Behavioral audit

- At default threshold, prefix probes render exactly as before (no observable regression)
- `zsk` renders 'zendesk' at 60, vanishes at 90 — the gate is pre-ranking (assert result length, not ordering)
- Zero-fragment listing unchanged under threshold 100

### Level 4: Perf sanity

```bash
npx vitest --run test/perf-gates.test.ts   # <1ms budget holds (prefixes short-circuit tier 3)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` + `npm test` green; perf gates green
- [ ] All score constants exported `as const` with calibration JSDoc; single-sourced (no inline literals)

### Feature Validation

- [ ] Below-threshold matches never render; discard happens inside the candidate loop (pre-ranking)
- [ ] `fuzzThreshold: 0` admits all; `100` = exact-prefix-only; strict-< boundary pinned
- [ ] Default 60 kills all tier-1 — spec-quoted pin
- [ ] Zero-fragment path bypasses the gate

### Code Quality Validation

- [ ] S1's matcher pins untouched and green; comparator/scan/prefixRange untouched (T2 scope)
- [ ] Tests assert against imported constants (survive retunes per the tuning protocol)
- [ ] No config.ts edit (S3's scope)

## Anti-Patterns to Avoid

- ❌ Don't post-filter after ranking — the spec says discard BEFORE ranking, inside the loop
- ❌ Don't reorder/limit in this task — ranking is T2.S1's rewrite
- ❌ Don't gate the zero-fragment listing — no anchor means no tiers
- ❌ Don't "fix" default-60-kills-tier-1 — it's the intended calibration
- ❌ Don't duplicate literals — every formula constant flows from the exports
- ❌ Don't touch config.ts or the provider chain filter (S3 / T3.S1)

**Confidence Score: 9/10** — the S1 contract pins the algorithm and worked values; the only design judgment (gate placement inside the loop, zero-fragment bypass, strict-< boundary) is specified and consistent with the r3 feasibility doc and the T2/T3 scope fences.

---
name: "P1.M2.T3.S1 (plan 003) — Chain successor filter → fuzzy membership gate (threshold 0, count ranking unchanged)"
---

## Goal

**Feature Goal**: Replace the armed-chain typed-fragment successor filter in
`src/pi/provider.ts` (~L514-519) — currently
`store.topSuccessors(armed.word).filter((s) => s.next.startsWith(frag.toLowerCase()))`
— with fuzzy membership via `matchFragment(frag, s.next) !== null` (spec §07
h2.49: "typed chars filter the live successor list with the same anchored
fuzzy matcher (04) as a membership gate"). THRESHOLD STAYS 0 for the chain
duration: any tier (3/2/1) match passes; scores/tiers do NOT reorder — the
successor-count order from `topSuccessors` is preserved (no re-sort). Ranking
within a chain stays successor-count-based.

**Deliverable**: Modified `src/pi/provider.ts` (the branch-(b) filter only;
plus comment updates), and re-pointed chain tests in `test/chain.test.ts` /
`test/provider-match.test.ts` covering fuzzy membership cases (tier-2 tail,
tier-1 scattered, anchor-miss negative). No new files.

**Success Definition**: A typed fragment that is an anchored fuzzy match of a
successor (but not a prefix) keeps that successor in the armed chain's menu
(armed on e.g. "zorp", fragment "ze" → "zendesk" successor offered; "zk" →
"zendesk" tier-2 match offered); an anchor-missing fragment ("zk" vs a
successor starting with a different letter) filters it out and, when zero
successors match, disarms on the SAME keystroke with the normal path
answering (existing h2.43 disqualification behavior). All existing chain
tests (with any prefix-only expectations updated) pass; `npm run check` +
`npm test` green; the one-shot grant tracker (`chainWordsSeen` /
`chainLastArmedPrefix`) is byte-identical.

## Why

- The query path moved to anchored-fuzzy matching (P1.M2.T1.S1's
  `matchFragment`, landed; P1.M2.T2.S2 in parallel re-points
  `rankMatches`' scan to the first-char bucket). The armed chain is the last
  `startsWith` holdout in the keystroke path; spec §07 h2.49 (2026-10 rule)
  explicitly says chains use "the same anchored fuzzy matcher (04) as a
  membership gate … threshold stays 0 for the duration of the chain".
- Membership-only keeps the chain's semantic identity: chains are
  bigram-driven, ranked by the successor index's counts, NOT by fuzzy score
  or sessionCount. Applying `fuzzThreshold` here would starve chains whose
  successors are short (tier-2 scores fall below 60 quickly) — the spec
  deliberately chose 0.

## What

1. In `src/pi/provider.ts`, armed branch (b) (typed fragment), the filter
   becomes:
   ```ts
   const succ =
     frag === undefined || !fragAtWordStart
       ? []
       : store
           .topSuccessors(armed.word)
           .filter((s) => matchFragment(frag, s.next) !== null) // membership gate, threshold 0
           .slice(0, config.maxSuggestions);
   ```
   - Import `matchFragment` from `../core/query.js` (check whether the
     provider already imports from query.ts; if not, add the type/value
     import following the existing import style).
   - `matchFragment` lowercases both arguments internally (its JSDoc says
     callers may pass raw casing) — the old explicit
     `frag.toLowerCase()` disappears.
   - Empty fragment never reaches this filter (branch (a) handles the
     zero-typed-char offer; branch (b) requires `frag !== undefined`).
     `matchFragment("", …) === null` by contract, so even a stray empty
     frag filters to zero → disarm, which is the existing (c) behavior.
2. Update the surrounding comments: cite §07 h2.49 ("same anchored fuzzy
   matcher as a membership gate; ranking stays successor-count-based;
   threshold 0"), and note tiers/scores are ignored — only `!== null`
   (membership) is consulted.
3. Zero-char branch (a), `publishChain`, BUG-005 word-start guard, one-shot
   grant logic, `chain.reset()` paths, forced single-item returns, fallback
   display: all UNTOUCHED. "Fallback display path otherwise byte-identical."
4. Tests: re-point `test/chain.test.ts` (and `test/provider-match.test.ts`
   if it has armed-chain typed-fragment cases) to fuzzy membership:
   - Tier-2 tail: fragment "ze" (if prefix semantics were also fine) — the
     load-bearing new case is a NON-prefix contiguous tail, e.g. armed word
     with successor "zendesk", fragment "zk" (z + contiguous "k") → offered
     (old `startsWith` missed it).
   - Tier-1 scattered: fragment that is an anchored subsequence with gaps
     of a successor (e.g. successor "handleResponseProxy"-shaped, fragment
     "hrp") → offered.
   - Anchor miss: fragment whose first char differs from the successor's
     first char → filtered out; and typing past EVERY successor (zero
     membership) → disarm + normal-path/delegate answer on the SAME
     keystroke (keep the existing h2.43 same-call assertion shape).
   - Order preservation: when two successors both match at different tiers,
     the successor-count order from `topSuccessors` holds (a higher-tier
     match does NOT jump ahead).
   - Audit existing chain tests for prefix-only assumptions: e.g. the
     "alpha b/br" narrowing cases (successors "beta"/"bravo") — "br" vs
     "beta" is an anchor hit with no subsequence ("r" not in "eta") → still
     filtered; these stay green. Any test that asserts a successor is
     EXCLUDED purely because it isn't a prefix must be updated to the
     fuzzy-membership expectation.
5. DOCS: none (internal module, per contract).

### Success Criteria

- [ ] provider.ts branch (b) uses `matchFragment(frag, s.next) !== null`; no `startsWith` successor filter remains
- [ ] No sorting added: `.filter(...).slice(0, config.maxSuggestions)` keeps `topSuccessors` order
- [ ] New tier-2/tier-1 membership cases + anchor-miss negative + order-preservation case in test/chain.test.ts
- [ ] One-shot grant, word-start guard, zero-char branch untouched (diff shows only filter + comments + import + tests)
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

The implementer needs: the exact current filter site, `matchFragment`'s
contract, what `topSuccessors` guarantees, the grant-tracker lines that must
not move, and the existing test harness shapes. All pinned below.

### Documentation & References

```yaml
- file: src/pi/provider.ts (~L470-540)
  why: the armed branch. (a) zero-char offer at L481-498 (topSuccessors
        slice, publishChain, forced narrowing) — UNTOUCHED. (b) typed
        fragment at ~L509-519: frag regex /[A-Za-z][A-Za-z0-9_]*$/ at a
        word start (BUG-005 guard, keep), then the startsWith filter —
        THE ONLY production change. (c) disarm fall-through at L520-531.
        One-shot grant tracker: chainWordsSeen/chainLastArmedPrefix at
        L277-278 and their update block L400-428 — MUST remain byte-identical.
  gotcha: `armed` may be stale after an (a) reset inside the same call —
        the existing comment at L510 explains why branch (b) is safe; don't
        disturb it.

- file: src/core/query.ts (matchFragment, ~L188)
  why: the shared matcher. Contract: lowercase-internal on both args;
        empty f or len(f) > len(c) → null; anchor f[0]===c[0]; tier 3 =
        startsWith, tier 2 = contiguous tail via indexOf(f.slice(1),1),
        tier 1 = greedy-leftmost anchored subsequence; returns
        {tier, score} or null. Membership = non-null.
  gotcha: do NOT apply fuzzThreshold here — the chain runs at threshold 0
        by spec (§07 h2.49); the score field is ignored entirely.
  gotcha: a fragment LONGER than the successor returns null (membership
        fails) — same practical outcome as the old startsWith.

- file: src/core/store.ts (topSuccessors)
  why: returns the armed word's successors already ordered by successor
        index count (top-3 by spec §06 h3.7). The provider does NOT
        re-sort today — 'ranking within a chain stays successor-count-based'.
        Keep it that way: filter + slice only.

- file: test/chain.test.ts
  why: the armed-chain suite: makeStack/armViaTab/suggest harness,
        seedStore fixtures, the "further typing filters the successor set
        live (threshold 0…)" case at ~L391, "zero matching successors →
        disarm + normal candidates on the SAME call" at ~L405, and the
        1-char fragment / disarm cases at ~L355-390. Extend with the
        fuzzy membership cases; update any prefix-only exclusion
        expectations.

- file: test/provider-match.test.ts (~L749)
  why: the word-start unfiltered topSuccessors case — chain display
        contract (bare single-word values, never a leading space). Any
        typed-fragment cases here follow the same re-point.

- docfile: plan/003_bbac3b15e8d0/architecture/r3-query-fuzzy.md §5
  why: research note this task implements — quotes the exact filter line
        and confirms "topSuccessors returns successors already ordered by
        successor-index count and the provider does NOT re-sort".

- docfile: plan/003_bbac3b15e8d0/architecture/r4-widget-pi-api.md §3
  why: provider/index wiring context; confirms the armed-branch seam is
        provider-local (no query.ts or widget changes needed).

- spec: spec/07-*.md h2.49 (M2 chained completion) + h2.28 (Query matching)
  why: binding behavior — "same anchored fuzzy matcher (04) as a
        membership gate; ranking within a chain stays SUCCESSOR-COUNT-based
        … threshold stays 0 for the duration of the chain".
```

### Current Codebase tree (relevant)

```bash
src/pi/provider.ts        # armed chain branch (b) filter — the change site
src/core/query.ts         # matchFragment (landed, P1.M2.T1.S1) — DO NOT MODIFY
src/core/store.ts         # topSuccessors — DO NOT MODIFY
test/chain.test.ts        # armed-chain suite — extend/re-point
test/provider-match.test.ts  # fallback display + match-state cases
```

### Desired Codebase tree

```bash
src/pi/provider.ts        # MODIFIED: branch (b) filter startsWith → matchFragment
test/chain.test.ts        # MODIFIED: fuzzy membership cases added/updated
test/provider-match.test.ts  # MODIFIED (if it has typed-fragment chain cases)
```

### Known Gotchas & Library Quirks

```typescript
// CRITICAL: ESM imports use ".js" specifiers in TS source (repo convention).
// CRITICAL: matchFragment(frag, s.next) — pass frag RAW; the matcher
// lowercases internally. The old `.toLowerCase()` on frag goes away.
// CRITICAL: membership gate = `!== null`. A tier-1 scattered match with
// score 12 still passes (threshold 0); never compare score to anything.
// CRITICAL: do NOT reuse rankMatches for the chain — it applies
// fuzzThreshold and session ranking; the chain is filter+slice only.
// 'zk' vs 'zendesk' is tier 2 (anchor z + contiguous 'k'): MATCHES now.
// 'zk' vs a successor starting with any other letter: anchor miss → null.
// Keep `.slice(0, config.maxSuggestions)` AFTER the filter (topSuccessors
// stores ≤3, cap is symmetry) — order = successor-count order.
// The parallel task P1.M2.T2.S2 touches src/core/query.ts (scan entry +
// perf gates) — this task touches ONLY provider.ts + the two test files;
// no file overlap, no coordination needed beyond rebasing if both land
// near-simultaneously.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/pi/provider.ts — branch (b) filter
  - REPLACE the startsWith filter with matchFragment membership (code above).
  - ADD import of matchFragment from "../core/query.js" (value import).
  - UPDATE comments at the filter and in the module header chain section
    (L251-260): cite §07 h2.49 membership-gate rule + threshold 0 +
    successor-count ordering preserved.
  - DO NOT TOUCH: branch (a), publishChain, BUG-005 guard, grant tracker,
    reset paths, forced returns, delegation, close-on-space.

Task 2: EXTEND test/chain.test.ts
  - ADD describe "armed-chain fuzzy membership gate (§07 h2.49, plan 003 S1)":
    tier-2 tail membership ('zk' → 'zendesk' successor offered, old
    startsWith missed it); tier-1 scattered membership (fragment an
    anchored gapped subsequence of a longer successor); anchor miss
    filters; zero membership disarms same-call; two successors matching
    at different tiers keep topSuccessors order.
  - FIX any existing case whose expectation was prefix-only (audit the
    ~L355-420 block; 'b'/'br' vs beta/bravo cases remain valid — verify).

Task 3: AUDIT test/provider-match.test.ts
  - Re-point any armed typed-fragment case to fuzzy expectations; keep the
    ~L749 word-start unfiltered-offer case unchanged.

Task 4: VALIDATE
  - npm run check && npm test
```

### Implementation Patterns & Key Details

```typescript
// The single production edit (provider.ts branch (b)):
const succ =
  frag === undefined || !fragAtWordStart
    ? []
    : store
        .topSuccessors(armed.word)
        // §07 h2.49: same anchored-fuzzy matcher as a MEMBERSHIP gate.
        // Threshold 0 for the chain duration — any tier passes, scores
        // never reorder; order stays topSuccessors' successor-count order.
        .filter((s) => matchFragment(frag, s.next) !== null)
        .slice(0, config.maxSuggestions);
```

### Integration Points

```yaml
PRODUCTION: provider.ts only. No store.ts / query.ts / widget / config
  changes. No new config knobs (threshold 0 is baked chain semantics).
PARALLEL WORK: P1.M2.T2.S2 (rankMatches scan entry) touches query.ts —
  zero file overlap with this task.
DOWNSTREAM: P1.M3 widget tasks (T1-T3) consume the same armed-branch seam
  unchanged — do not alter publishChain's display contract (bare
  single-word values, never leading/trailing spaces).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/chain.test.ts
npx vitest --run test/provider-match.test.ts
npm test        # full suite green (no regressions elsewhere — filter is provider-local)
```

### Level 3: Integration

```bash
npx vitest --run test/adversarial-typing.test.ts test/acceptance.test.ts
# Chain-adjacent suites: confirm no behavioral drift outside the armed
# typed-fragment filter. Live TTY verification of chains is M3 (P1.M3.T4)
# territory — NOT this task's gate.
```

### Level 4: Domain-specific

Review the diff: production changes must be confined to the branch-(b)
filter, its comments, and one import. Grep check:
`grep -n "startsWith(frag" src/pi/provider.ts` → no hits;
`grep -n "chainWordsSeen\|chainLastArmedPrefix" src/pi/provider.ts` →
unchanged lines.

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green
- [ ] No `startsWith` successor filter remains in the armed branch
- [ ] Membership gate is `matchFragment(frag, s.next) !== null`, no threshold comparison
- [ ] topSuccessors order preserved (no re-sort, slice after filter)
- [ ] Grant tracker / word-start guard / zero-char branch / publishChain untouched
- [ ] Tier-2, tier-1, anchor-miss, zero-membership disarm, and order-preservation tests present
- [ ] No changes to src/core/*, no config surface changes, no docs

## Anti-Patterns to Avoid

- ❌ Don't apply fuzzThreshold in the chain (spec: threshold 0 for chain duration)
- ❌ Don't re-sort successors by tier/score/fuzzy score (successor-count order is the chain's identity)
- ❌ Don't route the chain through rankMatches (wrong ranking + threshold semantics)
- ❌ Don't touch the one-shot grant tracker, BUG-005 guard, or publishChain
- ❌ Don't pre-lowercase frag before matchFragment (matcher does it; keep call sites honest)
- ❌ Don't add config knobs or docs — out of scope per contract

## Confidence Score: 8/10

The change site, matcher contract, ordering guarantee, and test harnesses are
all pinned to exact lines. Residual risk: an un-audited existing chain test
elsewhere (e.g. adversarial-typing/acceptance) may hold a prefix-only
exclusion expectation for armed fragments — discoverable in one test run,
fix is a one-line expectation update.

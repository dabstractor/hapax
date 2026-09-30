# PRP — P1.M2.T4.S2: Spec-text drift corrections flagged by the PRD

## Goal

**Feature Goal**: Resolve the two recorded spec-text drift items from the
bugfix-001 PRD (§Recommendations, "not counted as bugs"): make `spec/04`
and `spec/09` arithmetically/semantically consistent with their own
governing formulas and the pinned implementation behavior.

**Deliverable**: Two minimal, surgical text edits:
1. `spec/04-tokenization-and-scoring.md` ~line 309 — the measured-effect
   example says "at 9 chars admits q<82"; the spec's own formula gives
   `R_eff(9) ≈ 82.147` with float comparison and no rounding, so **q=82
   ADMITS** and q=83 is the first reject. Correct the example to match
   (e.g. "at 9 chars admits q<82.15 (q=82 admits, q=83 rejects)").
2. `spec/09-testing-and-acceptance.md` ~line 86 — "Eviction: insert
   20,001 → exactly one eviction" reads as a single victim and
   contradicts `spec/06` line 58 ("Evict in batches of 256 (sort
   snapshot, drop tail) to amortize cost"), which is what the
   implementation and tests follow. Reword to the batch semantics
   (e.g. "exactly one eviction pass — a full 256-victim batch"), making
   spec/06 the governing clause.

**Success Definition**: Both spec passages match the pinned behavior in
`test/score.test.ts:128-138` and `test/store.test.ts:431+`; no code or
test changes; `npm run check` and `npm test` pass unchanged;
`git diff --stat` shows ONLY `spec/04-*.md` and `spec/09-*.md`.

## Why

- AGENTS.md binding policy: spec and code must agree; drift recorded in
  the PRD must be resolved so the whole changeset lands coherent.
- These are pure text corrections (no code dependency) sequenced LAST in
  the changeset so code + spec + README (P1.M2.T4.S1) all land together.
- The wrong "q=82 rejects" arithmetic could mislead a future maintainer
  into "fixing" the implementation to match the example — which would
  break the no-rounding contract pinned at test/score.test.ts:129.

## What

### Drift site 1 — spec/04-tokenization-and-scoring.md (~:309)

Current text (inside the "Measured effect against the shipped artifact
(sqrt 8→20)" paragraph):

> nothing below 9 chars changes; at
> 9 chars admits q<82, 10 → q<110 (`government` yes; `everything`
> q=139 no), …

Truth: `rEff(REJECT_COMMON_THRESHOLD, 9) ≈ 82.147` (test/score.test.ts
asserts `toBeCloseTo(82.147, 2)`); admission is `q < R_eff(len)` with a
plain float compare and **no rounding**, so q=82 admits and q=83 is the
first reject. The sibling boundaries in the same sentence (110, 133,
152, 184) are stated as integers but are floors of non-integer
R_eff values too — leave them (they are correct as "admits q<floor+…"
only if verified). **Verify each**: the pinned test also states
10-char 110 admits / 139 rejects and 14-char 183/184 — so the existing
integers for 10 and 14 are consistent with the "last-admit integer"
reading. Only the 9-char figure is arithmetically wrong under that
reading: last-admit at 9 chars is 82, so "admits q<82" (i.e. ≤81) is
off by one. Minimal fix: change `q<82` to `q≤82` (or `q<82.15` /
"q=82 yes, q=83 no"). Keep the parenthetical examples (`government`
yes; `everything` no) — they remain correct.

### Drift site 2 — spec/09-testing-and-acceptance.md (~:86)

Current text (in the **store.test.ts** description list):

> - Eviction: insert 20,001 → exactly one eviction, lowest evictionScore;
>   userTyped survives.

Truth (spec/06 :58, governing): eviction runs in batches of 256 —
snapshot, sort by evictionScore, drop the tail batch. The pinned test
(test/store.test.ts:431) is named "20,001 inserts → exactly one eviction
pass (a full 256 batch), size back within the cap". Minimal fix:
"exactly one eviction" → "exactly one eviction pass (a full 256-victim
batch, per spec/06's batch-of-256 amortization)"; keep "lowest
evictionScore; userTyped survives".

### Success Criteria

- [ ] spec/04's 9-char example admits q=82 (consistent with R_eff(9)≈82.147 and test/score.test.ts:128-138)
- [ ] spec/09:86 wording describes the batch-of-256 eviction pass and defers to spec/06 as governing
- [ ] No other sentence in either file altered (minimal-diff policy)
- [ ] No code or test file modified
- [ ] `npm run check` and `npm test` pass unchanged
- [ ] README (edited by P1.M2.T4.S1 in parallel) not touched by this task

## All Needed Context

### Context Completeness Check

An implementer who knows nothing about this repo needs: the exact drift
sentences, the exact governing clauses, the exact pinning tests, and the
repo's spec-maintenance policy. All reproduced below — no further
research required.

### Documentation & References

```yaml
- file: spec/04-tokenization-and-scoring.md
  why: Drift site 1. The "Measured effect" paragraph (~:306-315) and the
        R_eff formula/admission table above it (~:298-304:
        "q < R_eff(len) → Admit"). Read both to confirm the example must
        follow the float-compare formula.
  gotcha: "Do NOT touch the admission table, the ramp formula, or the
        2026-10 owner-rule paragraph — only the one wrong figure. The
        sibling boundary integers (110/133/152/184) match the pinned
        probes; leave them."

- file: spec/09-testing-and-acceptance.md
  why: Drift site 2. Line ~:86 in the store.test.ts bullet list.
  gotcha: "It's a description of the TEST SUITE's coverage, so the fixed
        wording should describe what test/store.test.ts actually asserts
        (see test/store.test.ts:422-460)."

- file: spec/06-candidate-store.md (~:58)
  why: GOVERNING clause for drift site 2: "Evict in batches of 256
        (sort snapshot, drop tail) to amortize cost." spec/09 defers to it.
        READ-ONLY.

- file: test/score.test.ts (:118-145)
  why: Pinning test for drift site 1 — "sqrt ramp boundary at 9 chars:
        rEff ≈ 82.15 → q=82 admits, q=83 rejects (float compare, no
        rounding)" including the PRP-fencepost comment explaining
        q_reject = ceil(rEff) ⇒ last-admit 82. The corrected spec text
        must agree with this exactly. READ-ONLY.

- file: test/store.test.ts (:422-460)
  why: Pinning tests for drift site 2 — "exactly one eviction pass
        (a full 256 batch), size back within the cap"; batch evicts the
        256 lowest evictionScore victims; userTyped protection. READ-ONLY.

- file: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/P1M2T4S1/PRP.md
  why: Parallel sibling task editing README.md. It explicitly does NOT
        touch spec/ — no overlap. Do not edit README here.
  gotcha: "S1 may land before/after this task; the two diffs are
        disjoint (README/docs vs spec/04+spec/09)."

- file: AGENTS.md
  why: Binding spec-maintenance policy: interactive sessions MUST keep
        spec and code in agreement; a change shipping code (or tests)
        without the matching spec edit is incomplete. This task IS the
        matching spec edit recorded as drift by the PRD.

- file: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/architecture/system_context.md
  why: §Spec-sync obligations — the authoritative statement of this
        task's Mode B role (spec-text hygiene riding in the final docs
        task).
```

### Current Codebase tree (relevant part)

```bash
spec/
  04-tokenization-and-scoring.md   # EDIT — one figure in the measured-effect paragraph
  09-testing-and-acceptance.md     # EDIT — one bullet's eviction wording
  06-candidate-store.md            # READ-ONLY — governing eviction clause
test/
  score.test.ts                    # READ-ONLY — drift-1 pin (:118-145)
  store.test.ts                    # READ-ONLY — drift-2 pin (:422-460)
README.md                          # untouched here (owned by S1)
```

### Desired Codebase tree

Same tree; only the two spec files gain in-place text corrections.

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: This is a TEXT-ONLY task. If a spec edit would require a code
# or test change to stay honest, STOP — the PRD says the implementation
# and tests are correct; only the spec text is wrong.

# GOTCHA (site 1): do not "fix" the figure by changing the formula's
# semantics (e.g. adding floor/rounding to R_eff) — the no-rounding float
# compare is a pinned contract (test/score.test.ts fencepost comment).
# The EXAMPLE follows the formula, not vice versa.

# GOTCHA (site 1): the sentence's other integers (110, 133, 152, 184)
# use the same "admits q<N" shape. Under R_eff they are also floors of
# irrational-ish values, but their last-admit integers are what the pinned
# probes assert (110 admits/139 rejects at 10 chars; 183/184 at 14) —
# verify against test/score.test.ts "ramp probes" before leaving them;
# change ONLY figures that contradict a pinned probe. Known-contradictory:
# only the 9-char "q<82".

# GOTCHA (site 2): spec/06 is the governing clause for eviction; spec/09
# merely describes test coverage. The fix must make 09 describe the batch
# behavior, never weaken or restate 06's rule differently.

# GOTCHA: run the full suite AFTER the edits — confirms nothing (tests,
# docs tooling, README link checks) keyed off the old wording. Expected:
# zero behavioral change.

# CONVENTION: spec files use prose + backticked inline code; keep the
# edit style identical to surrounding text (no new headings, no lists).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY the pins
  - READ test/score.test.ts:118-145 (9-char boundary + fencepost comment)
  - READ test/store.test.ts:422-460 (eviction pass/batch assertions)
  - READ spec/06:50-60 (batch-of-256 governing clause)
  - RUN: npx vitest --run test/score.test.ts test/store.test.ts
    (confirm green baseline before editing)

Task 2: EDIT spec/04-tokenization-and-scoring.md (~:309)
  - FIND: "at 9 chars admits q<82, 10 → q<110"
  - REPLACE: "at 9 chars admits q≤82 (R_eff(9) ≈ 82.15, float compare —
    q=83 is the first reject), 10 → q<110"
    (or an equivalently minimal correction; the q≤82 figure is mandatory)
  - PRESERVE: the surrounding example words (`government` yes;
    `everything` q=139 no) and every other figure that matches a pin.
  - Check the sibling figures (110/133/152/184) against the ramp-probe
    test; adjust ONLY any that contradict a pinned probe.

Task 3: EDIT spec/09-testing-and-acceptance.md (~:86)
  - FIND: "- Eviction: insert 20,001 → exactly one eviction, lowest
    evictionScore; userTyped survives."
  - REPLACE: "- Eviction: insert 20,001 → exactly one eviction pass — a
    full 256-victim batch per spec/06's batch-of-256 amortization —
    dropping the lowest evictionScore victims; userTyped survives."
    (or equivalent minimal reword; must convey: one PASS, batch of 256,
    lowest-score victims, spec/06 governs)
  - PRESERVE: the bullet list structure and the two neighboring bullets
    (upsert merge semantics; prefix index rebuild) untouched.

Task 4: VALIDATE
  - npm run check && npm test            # unchanged, green
  - git diff --stat                      # ONLY spec/04*.md + spec/09*.md
  - git diff spec/                       # re-read: minimal, prose-consistent
  - grep -rn "exactly one eviction" spec/ README.md docs/ 2>/dev/null
    # expect: no remaining stale single-victim phrasing anywhere
    # (if README/other docs contain it, REPORT it — do not edit; only
    # spec/04 and spec/09 are in this task's write scope. Known: the
    # actual test NAME in test/store.test.ts says "exactly one eviction
    # pass (a full 256 batch)" — that's correct, leave it.)
```

### Implementation Patterns & Key Details

```markdown
<!-- Exact minimal edits; implementer may smooth phrasing to match
     surrounding prose, but the semantic content is fixed. -->

<!-- spec/04, before -->
nothing below 9 chars changes; at
9 chars admits q<82, 10 → q<110 (`government` yes; `everything`
q=139 no), 11 → q<133

<!-- spec/04, after -->
nothing below 9 chars changes; at
9 chars admits q≤82 (R_eff(9) ≈ 82.15, float compare — q=83 is the
first reject), 10 → q<110 (`government` yes; `everything`
q=139 no), 11 → q<133

<!-- spec/09, before -->
- Eviction: insert 20,001 → exactly one eviction, lowest evictionScore;
  userTyped survives.

<!-- spec/09, after -->
- Eviction: insert 20,001 → exactly one eviction pass (a full 256-victim
  batch, per spec/06's batch-of-256 rule), dropping the lowest
  evictionScore victims; userTyped survives.
```

### Integration Points

```yaml
SPEC:
  - spec/06:58 is the governing eviction clause — READ-ONLY here; the
    spec/09 edit must defer to it, not amend it.
DOCS:
  - README.md / docs/M1-DoD.md: owned by parallel task P1.M2.T4.S1 —
    not touched by this task.
CODE/TESTS:
  - none. Implementation and tests already follow the corrected text
    (that is the definition of this drift).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
grep -n '<<<<<<<\|>>>>>>>' spec/04*.md spec/09*.md   # no diff markers
git diff spec/ | head -60                            # review minimality
```

### Level 2: Unit Tests (must be unchanged)

```bash
npm run check && npm test
# Expected: identical pass/fail profile as before the edits (all green).
# The spec edits must not touch any file tests read... they don't
# (tests never parse spec/), so this is a regression guard only.
```

### Level 3: Consistency Review (the real gate)

```bash
# Cross-check each corrected sentence against its pin:
#   spec/04 9-char figure  ↔  test/score.test.ts:128-138
#   spec/09 eviction bullet ↔  test/store.test.ts:422-460 + spec/06:58
# Confirm no remaining contradiction:
grep -n "q<82" spec/04*.md                       # expect no output
grep -n "exactly one eviction," spec/09*.md      # expect no output
```

### Level 4: Scope Verification

```bash
git diff --stat
# Expected: exactly
#   spec/04-tokenization-and-scoring.md
#   spec/09-testing-and-acceptance.md
# Anything else ⇒ out of scope; revert it.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run check` and `npm test` pass unchanged
- [ ] `git diff --stat` shows only spec/04*.md and spec/09*.md

### Feature Validation
- [ ] spec/04 9-char example: q=82 admits, consistent with R_eff(9)≈82.15 float compare and test/score.test.ts:129
- [ ] All other spec/04 boundary figures verified against the ramp-probe pins (changed only if contradictory)
- [ ] spec/09:86 describes a 256-victim batch eviction pass deferring to spec/06:58
- [ ] PRD-recorded drift items both resolved; no new drift introduced

### Code Quality Validation
- [ ] Minimal diff — prose style, backticks, and structure match surrounding text
- [ ] No headings/lists added or removed
- [ ] Governing clauses (spec/04 formula/table, spec/06 eviction rule) untouched

### Documentation
- [ ] No README/docs/M1-DoD changes (owned by P1.M2.T4.S1)
- [ ] Stale-phrasing sweep run (`grep` in Level 3); leftovers outside spec/04+spec/09 reported, not edited

## Anti-Patterns to Avoid

- ❌ Don't change code or tests to match the spec — the spec text is the wrong side
- ❌ Don't add rounding/floor semantics to R_eff — the no-rounding contract is pinned
- ❌ Don't rewrite paragraphs — single-figure / single-bullet surgical edits
- ❌ Don't touch spec/06 (it's the governing, correct clause)
- ❌ Don't edit README.md or docs/ — parallel sibling owns them
- ❌ Don't "improve" other spec passages you happen to notice — report, don't edit

---

**Confidence Score: 10/10** — pure text task with both drift sites located
to the line, both pins read verbatim, both governing clauses quoted, and a
strict scope guard. No code dependency; the only judgment (sibling boundary
figures) is bounded by "change only what contradicts a pinned probe".

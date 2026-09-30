---
name: "P1.M2.T1.S2 (bugfix 001_1a2f4ffe408f) — End-to-end no-duplicate assertion (ingest → store → rankMatches)"
---

## Goal

**Feature Goal**: Close BUG-002's user-visible symptom with a pipeline-level regression pin: after ingesting `'rename FOO_1_ and USER_2_TOKEN_ constants'` through the REAL IngestPipeline + CandidateStore, the store holds the trailing-'_' keys (`foo_1_`, `user_2_token_`) and NOT their trimmed twins, and `rankMatches(store, 'foo_')` / `'user_2'` each return exactly one candidate — the duplicate-menu-candidates class can never silently return.

**Deliverable**: One new test block (describe or it-group) appended to `test/ingest-pipeline.test.ts`, following that file's existing harness (`stubDict` / `makePipeline`) and its BUG-residue describe precedent. Test-only — no source, spec, config, or API changes.

**Success Definition**: The pin passes against S1's fixed tokenize(); asserts both store-level absence of the twins and rankMatches-level single-candidate results; `npm run check` + `npm test` green; S1's segment-level tests untouched.

## Why

- BUG-002's damage surfaces only through the full pipeline (ingest stores both tokens → rankMatches offers both) — S1's fix is verified at the tokenize level, but the user-visible contract ("typing `foo_` offers ONE completion, not `['FOO_1','FOO_1_']`") needs an end-to-end pin so a future tokenizer change that reintroduces overlapping spans fails HERE, at the symptom, not just at a structural invariant.
- Plural pruning (query.ts:553–565) demonstrably never covered this class (exact key+'s' pairs only; `foo_1_` is `foo_1`+'_', not +'s') — so ranking cannot rescue it; admission must never see both tokens. This pin encodes that.

## What

Append to `test/ingest-pipeline.test.ts` (near the BUG-003-residue describe at ~:637):

```ts
describe("trailing-'_' literals store once — no duplicate candidates (BUG-002, PRD h3.1)", () => {
  it("processText('rename FOO_1_ and USER_2_TOKEN_ constants') stores foo_1_/user_2_token_ and NOT the trimmed twins; rankMatches offers exactly one candidate per probe", async () => {
    const h = makePipeline();
    await h.pipeline.processText("rename FOO_1_ and USER_2_TOKEN_ constants", true);

    // Store level: the whole identifier (with trailing '_') is the token;
    // the trimmed literal fork must never become a candidate.
    expect(h.store.get("foo_1_")).toBeDefined();
    expect(h.store.get("foo_1")).toBeUndefined();
    expect(h.store.get("user_2_token_")).toBeDefined();
    expect(h.store.get("user_2_token")).toBeUndefined();

    // Menu level (the user-visible symptom): one completion target, not
    // ['FOO_1','FOO_1_']. Pre-fix both keys stored → both offered (plural
    // pruning covers only key+'s' pairs — query.ts:553-565 — never '_').
    const fooMatches = rankMatches(h.store, "foo_");
    expect(fooMatches.map((m) => m.key)).toEqual(["foo_1_"]);
    expect(fooMatches[0]!.display).toBe("FOO_1_");

    const userMatches = rankMatches(h.store, "user_2");
    expect(userMatches.map((m) => m.key)).toEqual(["user_2_token_"]);
    expect(userMatches[0]!.display).toBe("USER_2_TOKEN_");
  });
});
```

Notes:
- Use the file's own `stubDict()` — the underscore identifiers are dictionary-absent → group 0 admission, exactly the repro conditions ("no mocking" in the contract = no pipeline/store mocking; the dict stub is this file's established pattern, and everything runs in RAM on real modules).
- `fromUser: true` matches the verified repro (r2-tokenizer-overlap.md Claim 2).
- Do NOT duplicate S1's tokenizer-level cases (they live in test/segment.test.ts); this is the ingest→store→rank seam only.

### Success Criteria

- [ ] Store holds `foo_1_`/`user_2_token_`; `foo_1`/`user_2_token` undefined
- [ ] `rankMatches(h.store, 'foo_')` → exactly `['foo_1_']` (display `FOO_1_`); `'user_2'` → exactly `['user_2_token_']` (display `USER_2_TOKEN_`)
- [ ] No source/spec/config edits; S1's segment tests untouched
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

An implementer needs: the exact repro text + expected pre/post behavior, the harness helpers with their signatures, where the block goes, the stub-dict admission semantics, and the plural-pruning non-coverage rationale for the comment. All below (verified against the live test file and the architecture memo).

### Documentation & References

```yaml
- file: test/ingest-pipeline.test.ts
  why: THE file to extend. Verified: stubDict(): Dictionary at :89 (absent →
        null → group 0); makePipeline(opts) at :110 → {pipeline, store, counts};
        rankMatches imported at :17 from ../src/core/query.js; pipeline→rankMatches
        assertion precedent at :662; BUG-residue describe naming precedent at :637.
  pattern: describe title cites the BUG id + PRD heading; inline comments cite
           file:line for the non-coverage rationale.

- file: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/P1M2T1S1/PRP.md
  why: THE upstream contract: the containment defer in tokenize pass 4 —
        after it, 'FOO_1_' is one base token, no 'FOO_1' literal forks.
        Assume delivered exactly.

- docfile: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/architecture/r2-tokenizer-overlap.md
  section: "Claim 2 — repro. VERIFIED"
  why: The exact repro (processText text, both twin keys, both rankMatches
        outputs ['FOO_1','FOO_1_'] / ['USER_2_TOKEN','USER_2_TOKEN_']) and the
        plural-pruning non-coverage citation (query.ts:553-565).

- file: src/core/query.ts (:553–565)
  why: Plural pruning — exact key+'s' pairs only; read to confirm the
        comment's claim, do NOT modify it (the fix is upstream at tokenize).

- file: src/pi/ingest.ts + src/core/store.ts
  why: The real modules under test — processText(text, fromUser) signature,
        store.get(key) / entries() accessors. No changes.
```

### Current Codebase tree (relevant)

```bash
test/ingest-pipeline.test.ts   # APPEND the BUG-002 describe
```

### Desired Codebase tree

```bash
test/ingest-pipeline.test.ts   # + trailing-'_' no-duplicate end-to-end pin
```

### Known Gotchas & Library Quirks

```typescript
// GOTCHA: rankMatches display casing = most recent sighting — with a single
// occurrence the display is the as-typed casing ('FOO_1_', 'USER_2_TOKEN_').
// Assert display exactly; it is part of the no-duplicate contract.

// GOTCHA: makePipeline() wires a default yieldFn counter — fine for a
// sub-64KB message; no chunk-boundary concern here (chunk stitching is
// BUG-004's task, P1.M2.T3).

// GOTCHA: 'constants'/'rename' are ordinary words — the stub dict may or may
// not admit them; do NOT assert on their keys. Assert ONLY the foo_/user_2
// families (the contract's scope).

// GOTCHA: if rankMatches returns [] for 'foo_' (fix regressed the other way —
// token dropped entirely), the exact-array assertion fails with a clear diff;
// that is also a valid catch, not a test bug.

// GOTCHA: keep the underscore probes as typed lowercase — matching is
// case-insensitive but the store keys are lowercase; asserting on keys
// (not displays) for the count, displays for the casing.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD the describe/it block to test/ingest-pipeline.test.ts
  - PLACEMENT: after the "parent-secret propagation" describe (~:637 block end)
  - CONTENT: the test in "What" verbatim (adjust helper names only if the
    file's differ — verified: makePipeline/rankMatches/stubDict)
  - COMMENTS: cite BUG-002, PRD h3.1, query.ts:553-565 non-coverage, and the
    r2 Claim-2 repro

Task 2: VALIDATE
  - npx vitest --run test/ingest-pipeline.test.ts -v   # new pin green
  - npx vitest --run test/segment.test.ts -v           # S1's cases still green
  - npm run check && npm test
```

### Integration Points

```yaml
NONE:
  - Test-only; closes BUG-002's evidence trail (S1 = fix + tokenizer pins,
    S2 = end-to-end symptom pin). P1.M2.T4's README sweep may cite this pin.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check    # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/ingest-pipeline.test.ts -v
npm test
```

### Level 3: Regression semantics (read the run)

- If the pin FAILS red before S1's fix lands (parallel race): that is correct TDD evidence — coordinate per the task tree (S1 is Implementing; this pin is its acceptance). Do not weaken the assertions to pass.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` + `npm test` green; no source files touched

### Feature Validation

- [ ] Store: twins absent, whole trailing-'_' keys present
- [ ] rankMatches: exactly one candidate per probe, correct display casing
- [ ] Comments cite BUG-002 + the plural-pruning non-coverage rationale

### Code Quality Validation

- [ ] Follows the file's harness/naming conventions; no duplication of S1's segment-level cases

## Anti-Patterns to Avoid

- ❌ Don't mock the pipeline, store, or rankMatches — real modules only
- ❌ Don't touch plural pruning, segment.ts, or S1's tests
- ❌ Don't assert on incidental words ('rename', 'constants') — scope is the underscore families
- ❌ Don't weaken exact-array assertions to `toContain` — the duplicate symptom IS the count

**Confidence Score: 10/10** — pure test addition, repro and expected outputs pre-verified by the architecture scout's real run, harness names and placement confirmed in the live file.

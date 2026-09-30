# PRP — P1.M2.T3.S2: Chunk-boundary regression battery (BUG-004)

## Goal

**Feature Goal**: Add the regression test battery that permanently pins the
BUG-004 chunk-boundary token-carry fix implemented by P1.M2.T3.S1 (running in
parallel — treat its PRP as a contract). Today no test exercises a slice
boundary falling INSIDE a token (the shredding bug was untested); this battery
closes that gap so the fix can never silently regress.

**Deliverable**: New `describe` block(s) in `test/ingest-pipeline.test.ts`
(a dedicated describe for the carry battery, following the existing
per-topic describe style, e.g. the BUG-002 block at line ~729). Test-only —
NO production code changes, no spec changes.

**Success Definition**: All new tests pass against the S1 implementation;
all existing pinned chunk tests keep passing UNCHANGED
(:197 yield count, :208 one ordinal, :336 drain reuse, :523 whitespace-gap
chains, :541 punctuation-gap breaks, :554 only '\n' breaks runs);
`npm run check` + `npm test` green.

## Why

- BUG-004 was live-verified but untested — a fixed-but-unpinned bug is one
  refactor away from returning. This battery is the durable closure of
  BUG-004.
- The carry introduces subtle failure modes (double admission, run breaks,
  junk halves) that only boundary-placed fixtures can catch; the battery
  enumerates each seam class (in-token, non-class char, hyphen/filename
  token, final-slice mid-token).

## What

All tests live in `test/ingest-pipeline.test.ts` using the existing helpers
(`makePipeline({ chunkBytes, onAdmittedTokens })`, `userMsg`, `drainNow`,
`h.store`, `h.counts.yields`).

**(a) The exact PRD repro — at BOTH scales:**
- Real scale: `chunkBytes` default 65536, text =
  `'a'.repeat(65536 - 5) + 'Zorpwibble quuxblat ' + 'b'.repeat(70000)` —
  assert `store.get('zorpwibble')` defined, `store.get('ibble')` undefined,
  run `[['zorpwibble','quuxblat']]` forms (via `onAdmittedTokens` capture),
  and `topSuccessors('zorpwibble')` non-empty (record the runs first, as the
  existing tests do: `store.recordBigramRuns(calls[0]!)`).
- Small-chunk analogue: same assertions with a tiny `chunkBytes` (e.g. 8–12)
  placing the seam inside `Zorpwibble` — fast, and it pins the seam logic
  independent of the 64KB constant.

**(b) Boundary at a non-class char → no carry, no double count:**
seam lands on a space (and separately on a comma / newline): the token is
admitted exactly once, `sessionCount` correct, no junk halves. (These
partially overlap the pinned :523/:541/:554 run tests — here assert the
CANDIDATE side, not the run side.)

**(c) Junction inside a hyphen/filename-shaped token → stitched to ONE
token:** e.g. seam inside `well-known-path` or `src/core/segment.ts` —
assert the whole token is stored once (and its halves — e.g. `known` as a
subword is fine, but a seam-created junk fragment is not — verify against
the S1 PRP's TOKEN_CHAR_RE class `[A-Za-z0-9._@:+/~=-]`, which includes
`-` and `.`, so these stitch).

**(d) Final slice ending mid-token → admitted whole:** text whose last
chunk ends mid-identifier (e.g. `chunkBytes: 8`, text ending in
`...granit`): the token `granit` is admitted whole (S1 contract: final
slice carries nothing). Assert `store.get('granit')` defined.

**(e) Optional (documented limitation pin):** a secret straddling a seam
stays unmaskable (maskSecrets is per-segment; r4-chunk-stitching.md §risks).
Pin as a comment-annotated `it` documenting the CURRENT limitation (e.g.
secret halves not rejected) so any future hardening changes it knowingly.

### Success Criteria

- [ ] (a)–(d) all present and passing; (e) optional but preferred
- [ ] Real-64KB repro included (not only the small analogue)
- [ ] No existing test edited or deleted; no production code touched
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

An implementer with no prior knowledge needs: the S1 carry contract (what
behavior to pin), the exact repro strings, the helper names/signatures in
the test file, and the list of must-not-change pinned tests. All below.

### Documentation & References

```yaml
- docfile: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/architecture/r4-chunk-stitching.md
  why: source of the repro, the token-char class, the seam-class taxonomy,
        and §Tests list of must-keep tests. section: "Tests" + "risks".

- file: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/P1M2T3S1/PRP.md
  why: THE CONTRACT for the behavior under test — read fully before writing
        tests. Key pins: TOKEN_CHAR_RE = /[A-Za-z0-9._@:+/~=-]/; MAX_CARRY
        = 1024 (excess dropped → degrades to old shredding for >1KB runs —
        do NOT test that as a bug); final slice carries nothing; yield
        fires once per slice iteration even for emptied slices; carry is
        trimmed from the raw slice BEFORE openTail accounting (runs stitch).
  critical: S1 also adds ONE small-chunk repro test of its own — check the
        file before writing to avoid duplicating its exact case; extend,
        don't repeat.

- file: test/ingest-pipeline.test.ts
  why: conventions + the must-keep pins. Read fully. Helpers:
        makePipeline({chunkBytes, onAdmittedTokens}) returns {pipeline,
        store, counts}; userMsg(text); drainNow(h); deepFreeze; stubDict.
        Existing describe blocks at :146 (PRD §05 h2.29/h2.30), :370
        (onAdmittedTokens runs), :729 (BUG-002 battery — the model for a
        bug-driven describe block).
  gotcha: MUST-KEEP, unchanged: :197 (yields = slice count), :208 (one
        ordinal per multi-chunk message), :336 (drain reuse), :523
        (whitespace-gap boundary chains), :541 (punctuation gap breaks —
        comma is NOT a class char), :554 (only '\n' breaks a run).

- file: src/pi/ingest.ts (post-S1)
  why: the implementation under test — processText carry loop. Read-only
        reference for expected yield counts and carry semantics; do not modify.
```

### Current Codebase tree (relevant)

```bash
src/pi/ingest.ts               # S1's carry implementation (read-only here)
test/ingest-pipeline.test.ts   # EXTEND: new carry describe block(s)
```

### Desired Codebase tree

```bash
test/ingest-pipeline.test.ts   # + ~8-12 its in a new describe
```

### Known Gotchas & Library Quirks

```python
# CRITICAL: S1 lands in PARALLEL — if its code/test isn't merged yet, your
#   battery will fail against the unfixed ingest.ts. That is EXPECTED during
#   development; coordinate ordering: S1 first, then this battery goes green.
#   If S1's one repro test already exists, don't duplicate it verbatim.
# The 64KB repro string is ~135KB — fine for one test, but use the
#   small-chunk analogue for iteration speed; keep both in the final battery.
# Run-assertion pattern: bigram successors are NOT auto-recorded by the
#   pipeline — tests call h.store.recordBigramRuns(calls[0]!) themselves
#   (see existing :523 test).
# h.counts.yields lets you assert the seam actually happened — always assert
#   it before asserting carry behavior, otherwise the test can pass vacuously
#   (single slice, no boundary).
# MAX_CARRY (1024) overflow DROPS the excess (degrades to shredding) by
#   design — don't write a test asserting stitching for a >1024-char run.
# Vitest fake timers: drainNow uses vi.advanceTimersByTime; the default-yield
#   path test uses real timers — match whichever the neighboring tests use.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ contract + code
  - READ plan/.../P1M2T3S1/PRP.md fully; READ src/pi/ingest.ts processText
    (post-S1 if merged, else pre-S1 knowing the target contract); re-read
    test/ingest-pipeline.test.ts helpers and the six must-keep pins.

Task 2: ADD describe block "chunk-boundary token carry (BUG-004, PRD h3.3)"
  after the BUG-002 describe (~line 729+), same style (comment header citing
  PRD h3.3 + the r4 research note).

Task 3: WRITE tests (a)-(e) per the What section, each asserting
  h.counts.yields matches slice count first, then store/run assertions.
  NAMING: sentence-style it() strings like the existing suite.
  - (a1) real 64KB repro: zorpwibble defined, ibble undefined, run
    [['zorpwibble','quuxblat']] forms, topSuccessors('zorpwibble') non-empty
  - (a2) small-chunk analogue (chunkBytes ~10, seam inside Zorpwibble)
  - (b) seam at space / comma / newline → token admitted once, correct
    sessionCount, no halves
  - (c) seam inside hyphen token ('well-known-path') and filename token
    ('src/core/segment.ts') → one whole token, no seam junk
  - (d) final slice ends mid-token ('granit') → admitted whole
  - (e) optional: secret straddling seam stays unmaskable — pin current
    limitation with explanatory comment (r4 §risks)

Task 4: RUN + verify
  - npx vitest --run test/ingest-pipeline.test.ts
  - confirm the six pinned tests untouched and green; npm test; npm run check
```

### Implementation Patterns & Key Details

```typescript
// Pattern skeleton (follow the :523 test exactly):
it("a chunk boundary inside a token carries the halves — token admitted whole (BUG-004)", async () => {
  const calls: string[][][] = [];
  const h = makePipeline({ chunkBytes: 10, onAdmittedTokens: (r) => calls.push(r) });
  // 'Zorpwibble' = 10 chars; 'a'.repeat(7) + 'Zorpwibble quuxblat' puts the
  // seam inside the token (slice 1 ends at offset 10 = 'a'.repeat(7)+'Zor').
  h.pipeline.onMessageEnd(userMsg("a".repeat(7) + "Zorpwibble quuxblat"));
  await drainNow(h);
  expect(h.counts.yields).toBeGreaterThan(1); // the seam really happened
  expect(h.store.get("zorpwibble")).toBeDefined();
  expect(h.store.get("ibble")).toBeUndefined();
  expect(calls).toEqual([[["zorpwibble", "quuxblat"]]]);
  h.store.recordBigramRuns(calls[0]!);
  expect(h.store.topSuccessors("zorpwibble")).toEqual([{ next: "quuxblat", count: 1 }]);
});
```

### Integration Points

```yaml
NO production changes. NO spec changes (S1 owns the spec/05 sentence).
Closes BUG-004 (regression pins) — mention BUG-004 in the describe header.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check     # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/ingest-pipeline.test.ts   # focused
npm test                                         # whole suite green
grep -n "chunk" test/ingest-pipeline.test.ts    # confirm pins untouched
```

### Level 3: Integration

N/A — test-only; the 64KB repro test IS the integration-scale check.

### Level 4: Domain-specific

Re-verify each seam class maps to the right expectation using
TOKEN_CHAR_RE `[A-Za-z0-9._@:+/~=-]`: comma/space NOT in class (no carry);
`-` `.` in class (carry/stitch). Cite the class in test comments.

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green
- [ ] (a) real-64KB repro + small-chunk analogue both present
- [ ] (b) non-class seam: no carry, no double count
- [ ] (c) hyphen/filename junctions stitch to one token
- [ ] (d) final-slice mid-token admitted whole
- [ ] (e) limitation pin present (optional but preferred)
- [ ] Six pinned tests unchanged: :197, :208, :336, :523, :541, :554
- [ ] Every seam test asserts yields > 1 (no vacuous pass)
- [ ] No production or spec files modified

## Anti-Patterns to Avoid

- ❌ Don't edit or "improve" the six pinned tests
- ❌ Don't duplicate S1's own repro test verbatim — extend coverage
- ❌ Don't assert carry for >MAX_CARRY (1024) runs — degradation is by design
- ❌ Don't write store-only assertions without proving the seam happened (yields)
- ❌ Don't touch src/pi/ingest.ts or spec/ to make a test pass — report a
      contract violation to the S1 owner instead

## Confidence Score: 9/10
The contract (S1 PRP), the repro strings, the seam taxonomy, and the test
conventions are all pinned; the only risk is merge ordering with the
parallel S1 implementation, which the PRP explicitly addresses.

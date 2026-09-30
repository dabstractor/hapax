---
name: "P1.M2.T1.S1 (bugfix 001_1a2f4ffe408f) — Containment defer in tokenize pass 4 + segment tests + spec/04 sync"
---

## Goal

**Feature Goal**: Fix BUG-002 — tokenize() violates its documented
disjoint-span invariant for rule-4c technical literals whose trailing
'_' trim straddles a base token (both 'FOO_1' literal and 'FOO_1_' base
emitted → duplicate menu candidates). The fix is a containment defer in
pass 4: a kept base/hexish token that CONTAINS the trimmed literal span
(equal or larger) wins and no literal is emitted — consistent with the
existing equal-span defer and spec/04's "literals absorb only
strictly-contained tokens" clause.

**Deliverable**:
1. One-line condition change + comment updates in `src/core/segment.ts`
   (pass-4 defer at :569; overlap-safety comment at :660)
2. TDD tests in `test/segment.test.ts`: new rule-4c case + trailing-'_'
   inputs added to the disjoint-spans invariant cases
3. Spec/04 "Strictly additive" bullet extension (:101–106, Mode A —
   spec and code land together per AGENTS.md)

**Success Definition**: `tokenize('FOO_1_')` returns exactly `['FOO_1_']`
(base class); 'USER_2_TOKEN_' likewise single-token; the disjoint-spans
invariant holds for all new inputs; ALL adjacent invariants keep passing
('2560x1440@2' absorption, opaque-literal equal-span pins, hexish, CJK,
path, filename); spec/04 bullet extended with the FOO_1_ example;
`npm run check` + `npm test` green.

## Why

- BUG-002 (Minor): '_' is the ONLY character in both BASE_RE's word class
  and LITERAL_SYMBOL_CHARS — the sole straddle class. The base pass
  captures an identifier starting inside the literal's span and extending
  past its post-trim end; the strict-containment absorber misses it and
  the overlap-safety branch emits BOTH. Both become store candidates →
  `rankMatches(store,'foo_')` offers `['FOO_1','FOO_1_']` (plural pruning
  doesn't cover '_' pairs) — duplicate completion targets for a real
  identifier class (Python keyword-avoidance / C naming, trailing '_').
- The alternative (overlap absorption) was REJECTED: it contradicts
  spec/04:104–105 ("literals absorb only strictly-contained tokens") and
  would complete 'FOO_1' by deleting a typed '_'. The chosen defer keeps
  the base token — the identifier the user actually typed ('_' is a word
  char per rule 1).

## What

### 1. src/core/segment.ts — the one-line fix

At the pass-4 literal defer (line ~569, after `const o = out[ck];`):

```diff
-      if (o !== undefined && o.start === start && o.end === end) {
-        continue; // equal-span token wins — pass is additive-only
-      }
+      if (o !== undefined && o.start <= start && end <= o.end) {
+        continue; // containing token wins — pass is additive-only.
+        // Equal span is the subset case; a kept base/hexish token that
+        // CONTAINS the trimmed literal span (equal or larger) wins and
+        // no literal is emitted. The trailing-'_' trim case: 'FOO_1_'
+        // keeps its base token (the '_' is a word char for rule 1), no
+        // 'FOO_1' literal forks. Only '_' can straddle (sole char in
+        // both BASE_RE's class and LITERAL_SYMBOL_CHARS); o is the only
+        // candidate container (base spans are disjoint, so only a base
+        // starting at/before the literal start can overlap).
+      }
```

Rationale notes to keep: equality is the subset case; `o` is the first
not-yet-passed `out` token ending after `start` (cursor advanced at
line ~568).

### 2. src/core/segment.ts — overlap-safety comment (~line 660)

The branch STAYS as a defensive guard (code untouched); update its
comment: the old "`\b` boundaries make this unreachable" claim is FALSE
for rule 4c (LITERAL_RE has no `\b` — it mirrored the hexish pass's `\b`
note); under the containment defer this branch is dead for the
trailing-'_' class but remains the correct last-resort guard.

### 3. spec/04-tokenization-and-scoring.md — "Strictly additive" bullet (:101–106, Mode A)

Current first sentence: "A literal with EXACTLY the span of a kept
base/hexish/compound token defers to that token (`utf8Reader` keeps
camelCase subword splitting; `0f3a9c2` stays hexish-flagged); literals
absorb only strictly-contained tokens (`2560x1440@2` absorbs its `x1440`
tail)."

Extend: "A literal whose post-trim span EQUALS OR IS CONTAINED IN a kept
base/hexish/compound token defers to that token (`utf8Reader` keeps
camelCase subword splitting; `0f3a9c2` stays hexish-flagged; `FOO_1_`
keeps its base token — the trailing-'_' trim cannot fork a `FOO_1`
literal); literals absorb only strictly-contained tokens
(`2560x1440@2` absorbs its `x1440` tail)." Lands WITH the code
(AGENTS.md binding policy — code without the spec edit is incomplete).

### 4. test/segment.test.ts — TDD

In the "technical literals (2026-10 rule 4c)" describe (~line 615, the
`raws` helper is defined there):

```ts
it("trailing-'_' trim defers to the containing base token (BUG-002): 'FOO_1_' is ONE base token", () => {
  // '_' is a word char for the base pass but a trim symbol for the
  // literal pass — the only straddle character. Pre-fix this emitted
  // the 'FOO_1' literal [0,5) AND the 'FOO_1_' base [0,6): overlapping
  // spans → duplicate store candidates ('foo_1' + 'foo_1_').
  expect(raws("FOO_1_")).toEqual(["FOO_1_"]);
  expect(tokenize("FOO_1_")[0]).toMatchObject({ literal: false });
  expect(raws("rename FOO_1_ ok")).toEqual(["rename", "FOO_1_", "ok"]);
  expect(raws("call API_V2_KEY_ now")).toEqual([
    "call", "API_V2_KEY_", "now",
  ]);
});
```

In the disjoint-spans invariant case list (:293–305, "spans are valid
slice bounds, disjoint and ascending across mixed inputs"), ADD to
`cases`:
- `"FOO_1_"` (straddle class at line start)
- `"rename FOO_1_ ok"`
- `"USER_2_TOKEN_"`

These make the structural invariant test itself cover the shape that
regressed.

### Success Criteria

- [ ] `tokenize('FOO_1_')` → exactly `['FOO_1_']`, base class (literal flag false)
- [ ] `tokenize('rename FOO_1_ ok')` / `('call API_V2_KEY_ now')` single trailing-'_' tokens, no literal forks
- [ ] Disjoint-spans invariant passes for the three new inputs
- [ ] Adjacent invariants UNCHANGED and green: '2560x1440@2' absorption (:617–631), 'utf8Reader'/'2ndReader' class pins (:679–690), hexish, CJK, path, filename tests
- [ ] spec/04 bullet extended; code + spec landed together
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

An implementer needs: the exact line + condition, why `o` is the only
candidate container, why fix (a) was rejected, the false-comment
correction, the exact test homes with current content, the spec bullet's
current text, and the must-keep-passing list. All below (verified
against the live code by the architecture scout and re-verified by me).

### Documentation & References

```yaml
- file: src/core/segment.ts
  why: The fix surface. Pass-4 literal loop ~517-575 (defer at :569-570);
        final-merge absorber :655 and overlap-safety :658-662; BASE_RE :75;
        LITERAL_SYMBOL_CHARS :109; invariant doc :314-317; the PATH
        equal-span defer :549-553 is a SEPARATE site — leave it.
  pattern: heavy inline comments citing spec rules — match style in the
           replacement comment.
  gotcha: do NOT touch the path defer (:549-553, "structurally
          impossible for paths" — paths contain '/'); do NOT touch the
          :655 absorber or :658-662 branch CODE (comment only).

- file: test/segment.test.ts
  why: Test homes. raws helper in the rule-4c describe (~615); disjoint
        invariant cases array (~293-305); must-keep cases at :617-631,
        :679-690, hexish :96-100/:128-150, CJK :692-703, paths :805-821.
  gotcha: no existing assertion becomes false under this fix (verified —
          no test expects both 'FOO_1' and 'FOO_1_' or a trailing-'_'
          literal); if any existing test fails, the fix over-reached.

- file: spec/04-tokenization-and-scoring.md
  why: Mode A spec edit — "Strictly additive" bullet at :101-106 (text
        quoted in "What" §3). spec/ is the source of truth; the edit
        widens "EXACTLY the span" to "equal to or contained in" with the
        FOO_1_ example.

- docfile: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/architecture/r2-tokenizer-overlap.md
  why: The live-verified root-cause + fix-design memo: exact line
        numbers, the repro set (FOO_1_, cY1Z_, API_V2_KEY_), the
        rejected-alternative rationale, must-change vs must-keep test
        lists, spec citations.

- docfile: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/prd_snapshot.md
  section: h2.3/h3.1 (Issue 1 / BUG-002) + h2.5 recommendation
  why: The defect + both fix directions. NOTE: the snapshot's "trailing
        '*'" wording is a transcription artifact — the straddle char is
        '_' (LITERAL_SYMBOL_CHARS contains '_' not '*'); the code and
        architecture doc are authoritative.

- docfile: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/P1M1T2S3/PRP.md
  why: The parallel predecessor (widget chain e2e + spec/07 clause) —
        different files, no overlap; read only to confirm no conflicts.
```

### Current Codebase tree (relevant)

```bash
src/core/segment.ts          # MODIFY: :569 condition + comments (:569, :660)
test/segment.test.ts         # MODIFY: new rule-4c case + invariant inputs
spec/04-tokenization-and-scoring.md  # MODIFY: :101-106 bullet (Mode A)
```

### Known Gotchas & Library Quirks

```typescript
// CRITICAL: the change is `o.start <= start && end <= o.end` — BOTH
// inequalities widen from === ; o must CONTAIN the trimmed literal span.
// o is out[ck], the first not-yet-passed out-token ending after `start`
// (cursor advanced at :568) — the ONLY candidate container, because base
// spans are disjoint: only a base starting at/before the literal start
// can overlap, and only '_' (word char for base, trim char for literal)
// can carry it past the literal's end.

// GOTCHA: this defer must fire BEFORE the literal is pushed to
// `literals` — it's the `continue` in the pass-4 loop, not a merge change.

// GOTCHA: do not "also fix" the final-merge overlap-safety branch (:658-662)
// — its code stays as the defensive guard; only its false comment
// ("\b boundaries make this unreachable") is corrected.

// GOTCHA: '2ndReader' must stay a literal: digit-initial literal has NO
// containing base (base 'ndReader' starts INSIDE the span — o.start >
// start, defer correctly does not fire). The opaque/equal-span pins at
// :679-690 guard exactly this.

// GOTCHA: '2560x1440@2' must keep absorbing its strictly-contained bases
// (:655 absorber untouched) — the new defer only fires when the BASE is
// the CONTAINER, not the containee.

// GOTCHA: spec edit is BINDING (AGENTS.md): shipping the code without
// the spec/04 bullet extension (or vice versa) is incomplete — land both.
```

## Implementation Blueprint

### Implementation Tasks (ordered — TDD)

```yaml
Task 1: WRITE the failing tests (test/segment.test.ts)
  - ADD the trailing-'_' case to the rule-4c describe (code in "What" §4)
  - ADD 'FOO_1_', 'rename FOO_1_ ok', 'USER_2_TOKEN_' to the
    disjoint-spans invariant cases array (:293-305)
  - RUN: npx vitest --run test/segment.test.ts → RED (the new case sees
    both 'FOO_1' and 'FOO_1_'; the invariant case fails on overlap)

Task 2: IMPLEMENT the containment defer (src/core/segment.ts)
  - CHANGE :569 condition to (o.start <= start && end <= o.end) with the
    comment in "What" §1
  - UPDATE the :660 overlap-safety comment (code untouched)
  - RUN: npx vitest --run test/segment.test.ts → GREEN including all
    must-keep cases

Task 3: SPEC SYNC (spec/04-tokenization-and-scoring.md, Mode A)
  - EXTEND the "Strictly additive" bullet (:101-106) per "What" §3
    (widens "EXACTLY the span" → "equal to or contained in", adds FOO_1_)
  - Verify the surrounding rule-4c text (:74-100) needs no other edit

Task 4: FULL validation
  - npm run check
  - npm test (whole suite — hexish/CJK/path/filename/ingest/query suites
    all green; the end-to-end no-duplicate assertion is P1.M2.T1.S2's)
```

### Implementation pattern

```typescript
// Pass-4 literal loop — the site (post-cursor-advance), final form:
while (ck < out.length && out[ck].end <= start) ck++; // ends before us
const o = out[ck];
if (o !== undefined && o.start <= start && end <= o.end) {
  continue; // containing token wins — pass is additive-only (BUG-002)
}
literals.push({ raw: text.slice(start, end), start, end });
```

### Integration Points

```yaml
NONE new:
  - P1.M2.T1.S2 adds the end-to-end no-duplicate assertion
    (processText → store → rankMatches) on top of this fix — this task
    provides tokenize-level correctness only.
  - No query/store/provider changes; the union filter (:604-632) and
    absorber (:655) untouched.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check        # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/segment.test.ts -v   # new + all must-keep cases green
npm test                                    # full suite green
```

### Level 3: Manual repro confirmation (optional, mirrors the scout harness)

```bash
node --input-type=module -e "
import { tokenize } from './src/core/segment.ts';
console.log(JSON.stringify(tokenize('FOO_1_')));  // expect ONE token
" 2>/dev/null || npx vitest --run test/segment.test.ts -t "trailing"
```

### Level 4: Spec conformance re-read

Re-read spec/04 rules 1, 4c, and the extended "Strictly additive" bullet
against the implementation: base '_' word-char semantics, trim rules,
containment defer, absorption clause — no contradictions.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors
- [ ] `npm test` full suite green

### Feature Validation

- [ ] `raws('FOO_1_')` === `['FOO_1_']`, base class
- [ ] 'USER_2_TOKEN_', 'API_V2_KEY_' single-token, no literal forks
- [ ] Disjoint-spans invariant covers the new inputs
- [ ] Adjacent invariants green (absorption, opaque/equal-span, hexish, CJK, path, filename)

### Code Quality Validation

- [ ] Comments cite the spec rules and the BUG-002 rationale
- [ ] :655 absorber and :658-662 branch code untouched
- [ ] Path defer (:549-553) untouched
- [ ] Spec edit landed WITH the code (binding)

## Anti-Patterns to Avoid

- ❌ Don't widen the :655 absorber or absorb straddling tokens (rejected fix (a) — contradicts spec/04:104-105, deletes typed '_')
- [ ] ❌ Don't touch the path-pass defer or the merge-loop code
- ❌ Don't ship the code without the spec/04 bullet edit (AGENTS.md binding)
- ❌ Don't skip TDD — the invariant test must be the regression proof
- ❌ Don't chase the PRD snapshot's '*' wording — the straddle char is '_'

**Confidence Score: 9/10** — the fix is one verified line with a
live-confirmed repro, an explicit rejected-alternative rationale, exact
test homes, and a quoted spec bullet to extend.

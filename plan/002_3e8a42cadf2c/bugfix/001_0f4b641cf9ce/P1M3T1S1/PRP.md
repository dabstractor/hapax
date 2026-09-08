# PRP — bugfix 001_0f4b641cf9ce P1.M3.T1.S1: code-point-correct before-side Unicode boundary guard in tokenize

## Goal

**Feature Goal**: Fix BUG-004 (Minor Issue 1, PRD h3.3). PRD §04 rule 3
requires an ASCII word candidate to be bounded by non-letters on BOTH sides
where ANY Unicode letter counts — `tokenize('𝔘sword')` must yield `[]`.
Today the before-side guard calls `isUniLetter(text.codePointAt(m.index - 1))`;
for an astral (surrogate-pair) letter immediately before a match, that offset
holds the lone LOW surrogate (0xDC00–0xDFFF), which is not `\p{L}`, so the run
leaks (`'sword'` is admitted). The after side is already correct. This task
adds an `isUniLetterBefore(text, index)` helper that backs up one extra code
unit over a low surrogate and tests the combined code point, uses it at BOTH
before-side guard sites (base pass and hexish pass), and removes the
"Accepted v1 trade-off" JSDoc note.

**Deliverable**:
1. Modified `src/core/segment.ts` — `isUniLetterBefore` helper + two guard-site
   replacements + JSDoc update (Mode A docs).
2. Extended `test/segment.test.ts` — astral before-side cases (TDD: write
   first, watch `𝔘sword` fail, then fix).

**Success Definition**: `tokenize('𝔘sword')` → `[]`; all existing rule-3,
hexish, offset, and astral-offset tests stay green; `npm run check` and
`npm test` pass.

## Why

- PRD §04 rule 3 (R2 delta): "a non-ASCII letter adjacent to an ASCII run
  disqualifies the whole run" — ΩbsidianMirror/𝔘sword must yield nothing.
  Ingesting text containing `𝔘sword` currently admits `sword` to the store;
  typing `sw` offers it (verified by probe, bug report h3.3).
- BMP letters (草, é, Ω, Þ) are already handled on both sides (single UTF-16
  units); only the astral BEFORE side deviates.
- Consumed downstream by P1.M4.T1.S1 (full regression) and P1.M4.T2.S1
  (README known-limitations sweep — that task removes the README mention;
  THIS task fixes the JSDoc only).

## What

### Behavior contract

1. **Helper** (place directly after `isUniLetter` in src/core/segment.ts):
   ```ts
   /**
    * Rule 3 before-side check, code-point-correct: when the code unit at
    * index-1 is a low surrogate (0xDC00–0xDFFF), the guard position holds
    * the SECOND half of an astral letter — back up one more unit so
    * codePointAt() resolves the full surrogate pair (codePointAt at a HIGH
    * surrogate already returns the pair; that is why the after-side checks
    * never needed this). String edges resolve to undefined/NaN → false.
    */
   function isUniLetterBefore(text: string, index: number): boolean {
     const cu = text.charCodeAt(index - 1); // NaN at index 0 → falls through
     if (cu >= 0xdc00 && cu <= 0xdfff) {
       return isUniLetter(text.codePointAt(index - 2));
     }
     return isUniLetter(text.codePointAt(index - 1));
   }
   ```
   Edge safety: `charCodeAt(-1)` → NaN, comparisons false → falls to
   `codePointAt(-1)` → undefined → `isUniLetter(undefined)` → false (existing
   behavior). A low surrogate at the string START (lone/invalid) → index-2
   out of range → undefined → false, matching the current lenient stance.

2. **Guard-site replacements** (exactly two; after-side untouched):
   - Base pass (~src/core/segment.ts:130-131):
     ```ts
     const dead =
       isUniLetterBefore(text, m.index) ||
       isUniLetter(text.codePointAt(m.index + m[0].length));
     ```
   - Hexish pass (~:179-182):
     ```ts
     if (isUniLetterBefore(text, start) || isUniLetter(text.codePointAt(end))) {
     ```
     Keep the surrounding dead-tail bookkeeping (`bases[k].dead = true`,
     `continue`) byte-identical — a hexish span killed by an astral prefix
     must still kill its absorbed base tails (`𝔘0f3a9c2` must not leak
     `f3a9c2`).

3. **JSDoc (Mode A)**: delete the two sentences in `isUniLetter`'s doc
   starting "Limitation: an astral letter …" through "Accepted v1
   trade-off." Replace with one sentence noting the before side resolves
   surrogate pairs via `isUniLetterBefore`. Do NOT touch README (P1.M4.T2.S1
   owns that sweep).

4. **No behavior change anywhere else**: masking, span offsets, hexish/base
   merge cursor math, length caps, dead-token skipping — all untouched. The
   astral letter still occupies 2 UTF-16 units; `m.index - 2` never lands
   inside the ASCII match because the match starts at `index`.

## All Needed Context

### Documentation & References

```yaml
- file: src/core/segment.ts
  why: the module under change — isUniLetter (~L86–91) + its JSDoc (~L78–85),
        base-pass dead check (~L130-131), hexish-pass guard (~L179-182)
  pattern: guard style isUniLetter(codePointAt(...)); dead/absorb bookkeeping
           around the hexish guard must stay identical
  gotcha: BASE_RE/HEXISH_RE are /g with mutable lastIndex — never restructure
          the exec loops

- file: test/segment.test.ts
  why: rule-3 suite at ~L144–160 (ΩbsidianMirror, hexish adjacency,
        deadbeef草), astral-offset cases at L238/L268–273 (𝕏, 草sword)
  pattern: raws() helper + describe/it; extend the existing rule-3 describe

- file: plan/002_3e8a42cadf2c/architecture/core-engine-findings.md
  why: documents the BUG-004 root-cause analysis this task implements
  section: the isUniLetter / astral-surrogate finding

- url: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/codePointAt
  why: codePointAt at a HIGH surrogate returns the full pair (after side
       already correct); at a LOW surrogate returns the surrogate alone
- url: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/charCodeAt
  why: charCodeAt for the low-surrogate range test (0xDC00–0xDFFF)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: BOTH before-side sites must switch to isUniLetterBefore — fixing
// only the base pass leaves '𝔘0f3a9c2' leaking hexish tails.
// CRITICAL: keep the hexish-pass dead-tail loop (bases[k].dead = true) when
// the guard trips — absorbed inner base tails must die with the span.
// '𝔘' = U+1D518 (mathematical Fraktur U) — 2 UTF-16 units; use any astral
// letter in tests (𝔘, 𝕏). BMP cases (Ω é Þ 草) are 1 unit.
// NodeNext: test imports use ../src/core/segment.js
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EXTEND test/segment.test.ts FIRST (TDD)
  - FOLLOW pattern: existing rule-3 describe block (~L144), raws() helper
  - ADD cases:
    * tokenize("𝔘sword") → []            // THE bug — red before the fix
    * tokenize("sword𝔘") → []            // pin already-correct after side
    * tokenize("ΩbsidianMirror") → []    // pin existing BMP case (present)
    * tokenize("Þórhildur") → []
    * BMP both sides: "éabc" → [], "abcé" → []
    * astral between runs: "aa𝔘bb" → []  // both runs die
    * hexish astral prefix: "𝔘0f3a9c2" → [] AND no "f3a9c2" in any raw
    * hexish astral suffix: "0f3a9c2𝔘" → [] (pin)
    * non-adjacent astral: "𝔘 sword" → ["sword"] (unaffected)
    * existing 𝕏 offset case (L238) stays green
  - PLACEMENT: test/segment.test.ts (tests are NOT colocated with src)

Task 2: MODIFY src/core/segment.ts
  - ADD isUniLetterBefore helper (exact shape in What §1) after isUniLetter
  - REPLACE the two before-side guard calls (What §2)
  - UPDATE isUniLetter JSDoc: remove the trade-off note (What §3)

Task 3: VERIFY
  - npm run check && npm test
```

### Integration Points

```yaml
# None new — tokenize()'s public signature and RawToken shape unchanged.
# Downstream: expandCandidates/shapeGate/admit consume RawTokens blindly.
# P1.M4.T1.S1 reruns the full suite; P1.M4.T2.S1 removes the README
# known-limitations mention of this trade-off (do not edit README here).
```

## Validation Loop

### Level 1: Syntax & Style
```bash
npm run check
```

### Level 2: Unit Tests
```bash
npx vitest --run test/segment.test.ts
npm test
```

### Level 3: Direct repro check
```bash
node --input-type=module -e "console.log('see test: 𝔘sword → []')"
# The TDD test added in Task 1 IS the repro; it must be red before Task 2
# and green after.
```

## Final Validation Checklist

- [ ] `tokenize('𝔘sword')` → `[]` (new test, green)
- [ ] Both guard sites use `isUniLetterBefore`; after-side checks unchanged
- [ ] `𝔘0f3a9c2` yields nothing AND no `f3a9c2` tail leak
- [ ] All pre-existing segment tests (Ω, 草, deadbeef草, 𝕏 offsets, hexish
      merge) green
- [ ] "Accepted v1 trade-off" note removed from JSDoc; replaced with
      code-point-correct description
- [ ] README untouched (P1.M4.T2.S1's scope)
- [ ] `npm run check` + `npm test` green
- [ ] No changes to RawToken shape, span semantics, or regex loops

## Anti-Patterns to Avoid

- ❌ Don't change the after-side checks — they are already correct
- ❌ Don't touch the /g exec loops or lastIndex handling
- ❌ Don't fix only the base pass — the hexish before-guard has the same bug
- ❌ Don't let the hexish guard skip its dead-tail bookkeeping
- ❌ Don't edit README known-limitations here (docs sweep owns it)

**Confidence Score: 10/10** — 20-line, single-module fix with the root cause
(surrogate-pair codePointAt semantics), exact insertion sites, and full test
matrix pinned; no external dependencies or parallel-task overlap.

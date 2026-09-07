---
name: "P1.M2.T1.S1 — Base tokenization: identifiers, hexish tokens, CJK skip"
---

## Goal

**Feature Goal**: Implement pure base tokenization in `src/core/segment.ts` — `tokenize(text: string): RawToken[]` — that extracts ASCII identifier/word tokens and letter-containing hexish tokens, skips CJK/non-ASCII runs, and terminates tokens at punctuation/whitespace. This is stage 1 of the segment → shapeGate → score → store → query pipeline.

**Deliverable**: `src/core/segment.ts` exporting `tokenize()`, the `RawToken` type added to `src/core/types.ts`, and `test/segment.test.ts` covering all PRD §09 base-tokenization cases.

**Success Definition**: All PRD §09 segment cases pass (`f3a9c2e` captured; `123456` not; 41+ hex chars not; CJK run skipped with ASCII resuming after; `state-of-the-art` → 3 tokens); `npm run check` and `npm test` pass; module is pure (zero imports beyond types).

## Why

- The ingest pipeline (P1.M3.T2) calls this on every message in ≤64KB slices — it is the entry point of the entire vocabulary pipeline.
- Downstream: P1.M2.T1.S2 (camelCase/snake_case subword splitting + normalization) consumes the `RawToken[]` this task emits; shapeGate (T2) and score (T3) operate on its output. The contract must be exact.

## What

- `tokenize(text: string): RawToken[]` where `RawToken = { raw: string; hexish: boolean }`.
- Base pass: regex `/[A-Za-z][A-Za-z0-9_]{0,63}/g` — identifiers/words, ASCII only, length capped at 64 by the quantifier. Filter out length-1 matches (PRD rule: base tokens are length 2–64). Emit with `hexish: false`.
- Hexish pass: regex `/(?=[0-9a-fA-F]*[A-Fa-f])(?:[0-9a-fA-F]{6,40})\b/g` — 6–40 hex chars containing at least one letter `[a-fA-F]`. Emit with `hexish: true`, **deduped** against base-pass captures (a hexish token starting with a letter like `abcdef` also matches the base regex; keep only the base-pass occurrence — order: base token first).
- CJK / non-ASCII: never matched by the ASCII-only regexes — runs are skipped automatically; ASCII words resume after the run. No CJK tokens emitted.
- Punctuation/whitespace terminate tokens: `state-of-the-art` → `state`, `of`, `the`, `art`; no hyphen or apostrophe joining.
- Bounds: whole non-hexish tokens length 2–64; hexish tokens length 6–40 — assert in tests.

### Success Criteria

- [ ] `tokenize` returns tokens in document order (base pass order; hexish-only tokens appear in their textual position relative to base tokens — implement via a single sorted-by-position merge OR base order then dedupe; document the choice)
- [ ] PRD §09 base cases all pass (see Implementation Tasks Task 3)
- [ ] No pi imports, no node imports — pure module
- [ ] Allocation-light: `exec`-loop or `matchAll` over precompiled regexes; no per-character scanning

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase: they need the exact regexes (below), the `RawToken` shape, the fact that `src/core/types.ts` is the shared declaration module, the test file location/conventions, and the downstream consumer contract (S2). All provided below.

### Documentation & References

```yaml
- file: src/core/types.ts
  why: Shared declaration module (P1.M1.T1.S2, COMPLETE). ADD RawToken here.
  pattern: Pure declarations, JSDoc comments referencing PRD sections, no imports.
  gotcha: types.ts has "NO imports, NO runtime code" — keep RawToken a plain interface.

- file: src/core/dictionary.ts
  why: Reference for module style in src/core/ (header doc-comment, ESM, .js import extensions).

- file: test/dictionary.test.ts
  why: Test conventions — top doc-comment stating scope, describe/it, real fixtures, imports use "../src/core/segment.js" (.js extension in ESM).
  pattern: import { describe, expect, it } from "vitest";

- file: plan/001_88fc3a66fd74/prd_snapshot.md
  section: h2.22 "Segmentation" + §09 "segment.test.ts" unit-test list
  why: Authoritative spec for rules and test cases.

- url: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec
  why: exec-loop pattern for allocation-light scanning.
```

### Current Codebase tree (relevant)

```bash
src/core/types.ts        # shared contracts (COMPLETE) — add RawToken here
src/core/dictionary.ts   # loader (COMPLETE)
test/                    # flat test dir: dictionary.test.ts, types.test.ts, ...
```

### Desired Codebase tree with files added

```bash
src/core/types.ts        # MODIFIED: + RawToken interface (JSDoc'd)
src/core/segment.ts      # NEW: tokenize() — pure, no imports beyond nothing
test/segment.test.ts     # NEW: PRD §09 base-tokenization cases
```

### Known Gotchas & Library Quirks

```typescript
// CRITICAL: 41+ contiguous hex chars produce NO hexish match: `\b` requires a word
// boundary after 6–40 chars, but every position inside the run is followed by a
// word character, so backtracking never finds a boundary. This is the desired
// behavior (PRD: 41+ chars not captured) — verify with a test.

// GOTCHA: hexish tokens starting with a LETTER (e.g. "abcdef") also match the
// base regex. Dedupe by match position (Set of base-pass start indices) or raw
// string equality; base-pass token wins (hexish:false).

// GOTCHA: hexish tokens starting with a DIGIT (e.g. "0f3a9c2") only come from
// the second scan — the scan is genuinely additive.

// GOTCHA: base regex allows single-char matches ([A-Za-z] alone). PRD says base
// tokens are length 2–64 — filter length-1 matches out in tokenize(). Do NOT
// filter < 4 here; admission minimum (≥4) is shapeGate's job (P1.M2.T2.S1).

// GOTCHA: length-64 cap comes from {0,63} quantifier — a 70-char identifier
// matches its first 64 chars only if position 64 is not [A-Za-z0-9_]; since it
// is, there is NO boundary issue (no \b in base regex) — the base regex simply
// matches greedily 64 chars mid-identifier. Acceptable per PRD (regex is the spec).

// PATTERN: precompile regexes at module scope (const BASE_RE = /.../g) and use
// lastIndex-based exec loops; note a /g regex carries mutable lastIndex — either
// reset it or create per-call. For thread-safety simplicity, define factory
// functions or reset lastIndex = 0 before each loop.
```

## Implementation Blueprint

### Data model (added to src/core/types.ts)

```typescript
/** Output of src/core/segment.ts tokenize(). PRD §04 segmentation. */
export interface RawToken {
  /** the matched text, original casing (normalization is P1.M2.T1.S2) */
  raw: string;
  /** true when the token came from the hexish scan (6–40 hex chars,
   *  at least one letter a–f; commit-hash-shaped). Hexish tokens are
   *  opaque — subword splitting (S2) skips them. */
  hexish: boolean;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/core/types.ts
  - ADD: RawToken interface exactly as in blueprint above (JSDoc referencing PRD §04)
  - PRESERVE: everything else; no imports, no runtime code
  - PLACEMENT: near the top with the other pipeline-stage types (before GateResult)

Task 2: CREATE src/core/segment.ts
  - IMPLEMENT: export function tokenize(text: string): RawToken[]
  - HEADER: doc-comment: pure module, no pi imports, PRD §04 rules 1–4, consumed by
    P1.M2.T1.S2 (subword expansion)
  - LOGIC:
    1. Base pass: exec-loop with /[A-Za-z][A-Za-z0-9_]{0,63}/g; skip matches with
       length < 2; record token + start index + end index.
    2. Hexish pass: exec-loop with /(?=[0-9a-fA-F]*[A-Fa-f])(?:[0-9a-fA-F]{6,40})\b/g;
       skip a hexish match if its span overlaps a base-pass token span (letter-initial
       hexish like "abcdef" is already captured as a base token).
    3. Merge in ascending start order (base tokens and hexish-only tokens
       interleave by position; spans never overlap after dedupe).
    4. Return RawToken[] — hexish:true only for hexish-only-scan tokens.
  - NAMING: tokenize (exact — S2 and ingest import it by this name)
  - PLACEMENT: src/core/segment.ts

Task 3: CREATE test/segment.test.ts
  - HEADER: doc-comment citing PRD §09 segment suite, scope = base tokenization
    (subword splitting tests belong to P1.M2.T1.S2's suite)
  - FOLLOW pattern: test/dictionary.test.ts (describe/it, vitest imports, .js import
    extensions: import { tokenize } from "../src/core/segment.js"; import RawToken
    from "../src/core/types.js")
  - CASES (each its own it()):
    - identifiers/words: "fix state Tokenized Hello" → 4 tokens, hexish all false
    - length bounds: 2-char and 64-char identifiers emitted (length 2 ≤ len ≤ 64
      asserted for non-hexish); 1-char words ("a I b") omitted
    - hyphen/apostrophe: "state-of-the-art" → ["state","of","the","art"];
      "don't" → ["don","t"]? NO — "t" is length 1 → ["don"]
    - hexish captured: "f3a9c2e" → one token, hexish:true
    - hexish digit-leading: "0f3a9c2" → hexish:true (second scan additive)
    - hexish dedupe: "abcdef" → one token, hexish:false (base pass wins)
    - hexish no-letter: "123456" → NOT captured
    - hexish too long: 41 hex chars with letters (e.g. "abcdef" repeated to 42)
      → NOT captured; 40-char hexish with a letter → captured
    - hexish too short: 5 hex chars with letter → not captured as hexish; may be
      base token if letter-initial and length ≥ 2 (assert actual behavior:
      "abcde" → base token hexish:false)
    - CJK skip: "前回の session トークン" → only ["session"] (plus "トークン"?
      NO — non-ASCII, skipped); ASCII resumes after run: "fix 方法 error" →
      ["fix","error"]
    - empty string → []
    - bounds invariant: for every token, hexish ? 6 ≤ raw.length ≤ 40
      : 2 ≤ raw.length ≤ 64 (run as a property check over a mixed fixture)
  - PLACEMENT: test/segment.test.ts
```

### Implementation pattern

```typescript
// src/core/segment.ts (sketch)
const BASE_RE = /[A-Za-z][A-Za-z0-9_]{0,63}/g;
const HEXISH_RE = /(?=[0-9a-fA-F]*[A-Fa-f])(?:[0-9a-fA-F]{6,40})\b/g;

export function tokenize(text: string): RawToken[] {
  const out: RawToken[] = [];
  const spans: Array<[number, number]> = []; // base-pass spans for dedupe
  BASE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  // PATTERN: collect base matches; then hexish scan skipping overlapping spans;
  // merge sort by start. See gotchas re: lastIndex reset.
  ...
  return out;
}
```

### Integration Points

```yaml
NONE this task:
  - No store/dictionary/pipeline integration — tokenize is standalone pure.
  - S2 (next) will add splitSubwords(rawToken) and normalization, composing with tokenize.
  - Ingest (P1.M3.T2) later calls tokenize on extracted text chunks (≤64KB).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit        # or: npm run check — expected: zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/segment.test.ts -v   # all cases green
npm test                                    # full suite still green (types/dictionary/build-dict tests unaffected)
```

### Level 3: Integration Testing

None — pure module with no runtime integration. (Manual smoke: `node -e` after
tsc is optional and unnecessary given test coverage.)

### Level 4: Performance sanity (informational — hard gates come in P1.M4.T1.S2)

```bash
# quick sanity only: 64KB synthetic slice should tokenize in well under a few ms
npx vitest bench 2>/dev/null || true
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` — zero TS errors
- [ ] `npm test` — all suites pass including new test/segment.test.ts
- [ ] No new dependencies; src/core/segment.ts has no imports (or only type import of RawToken from types.ts)

### Feature Validation

- [ ] All PRD §09 base segment cases pass: hexish `f3a9c2e` captured; `123456` not; 41+ hex chars not; CJK run skipped with ASCII resuming after; `state-of-the-art` → 3 tokens
- [ ] Bounds asserted in tests (non-hexish 2–64, hexish 6–40)
- [ ] Hexish dedupe correct (`abcdef` → single base token)

### Code Quality Validation

- [ ] Follows types.ts JSDoc style; module doc-comment present
- [ ] Precompiled module-scope regexes with lastIndex handling
- [ ] No anti-patterns: no hardcoded config, no broad try/catch, no pi imports

## Anti-Patterns to Avoid

- ❌ Don't do camelCase/snake_case splitting here — that is P1.M2.T1.S2 (scope boundary)
- ❌ Don't lowercase/normalize here — normalization is S2
- ❌ Don't apply shape-gate rules (min length 4, entropy) — that's P1.M2.T2
- ❌ Don't use String.match() in a loop producing throwaway arrays on a hot path — prefer exec-loop
- ❌ Don't forget `/g` regexes are stateful (lastIndex) across calls

**Confidence Score: 9/10** — spec is verbatim in PRD with exact regexes and enumerated test cases; only subtle point is hexish dedupe and ordering, both specified above.
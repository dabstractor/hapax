---
name: "P1.M2.T1.S2 — camelCase/snake_case subword splitting + normalization"
---

## Goal

**Feature Goal**: Implement `expandCandidates(token: RawToken): CandidateDraft[]` in `src/core/segment.ts` — take one raw token from `tokenize()` (P1.M2.T1.S1) and emit the whole token plus every camelCase/snake_case sub-word of length ≥ 4, normalized (lowercase keys, sighting casing display, properName hint).

**Deliverable**: `expandCandidates()` + exported `CandidateDraft` type in `src/core/segment.ts`; subword-splitting tests in `test/segment.test.ts` (the PRD §09 camelCase/snake_case cases).

**Success Definition**: PRD §09 cases pass (`fixRoundingError` → whole + `Rounding` + `Error`; `HTTPServer` → whole + `HTTP` + `Server`; `session_token_valid` → whole + `session` + `token` + `valid`); `npm run check` and `npm test` green; module stays pure (no imports beyond a type-only import of `RawToken`).

## Why

- This is stage 2 of the core pipeline (segment → shapeGate → score → store → query). The output shape is the exact input of the shape gate (P1.M2.T2.*) and score admission (P1.M2.T3.S1).
- Sub-words enable mid-identifier completion (`roun` → `Rounding` from `fixRoundingError`); the whole token is what users usually Tab.

## What

- `expandCandidates(token: RawToken): CandidateDraft[]`.
- `CandidateDraft = { key: string (lowercase); display: string (casing as seen in THIS sighting); properName: boolean (first char of the candidate's display is uppercase); isSubword: boolean; parentKey?: string (lowercase key of the whole token, set only on sub-words) }`.
- Splitting rules (PRD §04 h3.4):
  1. Hexish tokens (`token.hexish === true`) are **opaque**: return exactly one draft — the whole token, `isSubword: false`, no `parentKey`.
  2. Split the raw string on `_` segments (empty segments dropped).
  3. Within each segment, split camelCase boundaries: a boundary before an uppercase char `C` when (a) the previous char is lowercase or a digit (lower→upper: `fixR` → `fix|R`), or (b) the previous char is uppercase AND the next char after `C` is lowercase (acronym-lowercase: `HTTPServer` → `HTTP|Server`).
  4. Emit candidates: first the **whole token** (raw string, `isSubword: false`, no `parentKey`), then each sub-word with length ≥ 4 (`isSubword: true`, `parentKey` = whole token's lowercase key). Sub-words shorter than 4 are dropped as standalone candidates — the whole token survives regardless of length (shape-gate length rules are P1.M2.T2's job, not here).
  5. Underscores do not appear in any candidate (not in the whole token either — `session_token_valid`'s whole-token key is... see Gotchas: the whole token KEEPS underscores; only sub-words strip them).
- Normalization (PRD §04 h3.5): `key` is lowercase; `display` is the casing of this sighting (most-recent-casing merging is the STORE's concern — P1.M2.T4.S1 — not segment's); `properName = display[0]` is A–Z.

### Success Criteria

- [ ] All three PRD §09 cases pass exactly (see Task 3)
- [ ] Hexish tokens return a single whole-token draft
- [ ] Every draft has `key === key.toLowerCase()`; `parentKey` set iff `isSubword`
- [ ] No length filtering except sub-word ≥ 4

## All Needed Context

### Context Completeness Check

Everything the implementer needs: upstream `RawToken`/`tokenize` contract (from the S1 PRP, quoted below), exact splitting algorithm, exact output shape, downstream consumers, test conventions. No pi/node knowledge required.

### Documentation & References

```yaml
- file: src/core/types.ts
  why: Holds RawToken (added by S1). Read-only for this task — CandidateDraft is NOT added here.
  pattern: JSDoc'd pure declarations, NO imports, NO runtime code.
  gotcha: types.ts already declares Candidate and Sighting (store-level). Do not duplicate or rename — CandidateDraft is segment-stage and lives in segment.ts per the work-item contract.

- file: src/core/segment.ts  (created by P1.M2.T1.S1, in parallel — it WILL exist)
  why: Home module. S1 adds tokenize() + the RawToken-consuming scaffold; you add expandCandidates + export CandidateDraft.
  contract from S1 PRP: tokenize(text): RawToken[]; RawToken = { raw: string; hexish: boolean }; hexish tokens are documented opaque for subword splitting.
  gotcha: S1's PRP ends with hexish = true only for hexish-only-scan tokens; a letter-initial pure-hex word like "abcdef" arrives hexish:false and IS split like any word (abcdef has no boundaries → whole token only — fine).

- file: test/dictionary.test.ts
  why: Test conventions: flat test/ dir, vitest describe/it, ESM imports with .js extension ("../src/core/segment.js").
  pattern: top-of-file doc-comment stating scope.

- file: plan/001_88fc3a66fd74/prd_snapshot.md
  section: §04 h3.4 (camelCase/snake_case splitting), h3.5 (Normalization), §09 segment.test.ts list
  why: Authoritative spec — the splitting/normalization rules are quoted verbatim in this PRP's "What" section.

- file: plan/001_88fc3a66fd74/architecture/core_contracts.md
  why: Downstream handoff chain: shapeGate.ts passesShape(CandidateDraft), score.ts admit(quant|null, draft) with subword clamp needing parentKey/isSubword.
  gotcha: architecture doc's older sketch names SegToken/wholeKey — SUPERSEDED by the work-item contract: CandidateDraft/parentKey. Follow the item contract.

- file: plan/001_88fc3a66fd74/P1M2T1S1/PRP.md
  why: Exact upstream contract being implemented in parallel; treat as done.
```

### Current Codebase tree (relevant)

```bash
src/core/types.ts        # shared contracts — RawToken being added by S1
src/core/segment.ts      # NEW from S1: tokenize()
test/segment.test.ts     # NEW from S1: base-tokenization cases — you extend it
```

### Desired Codebase tree with files added

```bash
src/core/segment.ts      # MODIFIED: + export interface CandidateDraft, + expandCandidates(token: RawToken): CandidateDraft[]
test/segment.test.ts     # MODIFIED: + describe("expandCandidates") subword/normalization cases
```

### Known Gotchas & Library Quirks

```typescript
// WHOLE TOKEN KEEPS UNDERSCORES: "session_token_valid" whole candidate is
// display "session_token_valid", key "session_token_valid" — underscores intact
// (users Tab the identifier as typed). Only sub-words are the _-stripped parts.
// PRD: "Each base token yields the whole token plus its sub-words."

// GOTCHA: acronym rule (b) needs lookahead: split before the LAST uppercase of
// an acronym run when followed by lowercase. HTTPServer: boundary before S only
// (prev H upper, next 'e' lower) → HTTP|Server. HTTPS: no boundary (no following
// lowercase) → whole "HTTPS" only... but as a standalone token HTTPS has length 5,
// fine; and HTTPServer's "HTTP" sub-word is length 4 → kept.

// GOTCHA: digits do not create boundaries ("utf8Reader" → utf8|Reader via rule (a)
// at R only — '8' before R is lower→upper boundary). Accept: prev is digit ⇒ rule (a).

// GOTCHA: properName is per-candidate, from ITS display: in "fixRoundingError"
// fix=false, Rounding=true, Error=true. Whole-token properName from whole display.

// GOTCHA: sub-word < 4 dropped — but the WHOLE token of length 2-3 (e.g. "id",
// "ok") still emits (isSubword:false). Do NOT apply any other length rules here.

// GOTCHA: hexish tokens skip splitting entirely (single whole-token draft),
// even if they contain pattern-looking letters ("deadbeef" arriving hexish:true).

// GOTCHA: "__init__" → segments ["init"] → sub-word "init" (len 4, kept) + whole
// token "__init__" — underscores kept in whole display, key "__init__".
```

## Implementation Blueprint

### Data model (exported from src/core/segment.ts — NOT types.ts)

```typescript
/** One candidate occurrence produced by segment.ts. Input shape for the
 *  shape gate (P1.M2.T2) and score admission (P1.M2.T3.S1). PRD §04. */
export interface CandidateDraft {
  /** lowercase — lookup/store key */
  key: string;
  /** casing of this sighting (recency-merge is the store's job) */
  display: string;
  /** first char of display is uppercase at extraction */
  properName: boolean;
  isSubword: boolean;
  /** lowercase key of the parent whole token; set iff isSubword */
  parentKey?: string;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/core/segment.ts — add CandidateDraft + expandCandidates
  - ADD: export interface CandidateDraft (exact shape above, JSDoc'd)
  - IMPLEMENT: export function expandCandidates(token: RawToken): CandidateDraft[]
    1. If token.hexish → return [wholeDraft(token.raw)] (no splitting).
    2. wholeKey = token.raw.toLowerCase().
    3. segments = token.raw.split("_").filter(s => s.length > 0).
    4. For each segment, scan chars; split before index i when
       seg[i] is A–Z and (/[a-z0-9]/.test(seg[i-1]) || (i+1 < seg.length && /[a-z]/.test(seg[i+1]))).
       (Guard i=0: no split at 0.)
    5. Collect all sub-words across segments, in order; filter length >= 4.
    6. Return [whole draft] + sub-word drafts (each { key: sub.toLowerCase(),
       display: sub, properName: sub[0] is A–Z, isSubword: true, parentKey: wholeKey }).
  - HEADER: doc-comment noting PRD §04 h3.4/h3.5, hexish opacity, downstream
    consumers (shapeGate, score).
  - KEEP: tokenize() from S1 untouched.
  - PLACEMENT: after tokenize() in the same file.

Task 2: EXTEND test/segment.test.ts
  - ADD: describe("expandCandidates") block. Cases (each its own it()):
    - fixRoundingError → 3 drafts: whole (key "fixroundingerror", isSubword false,
      no parentKey), Rounding (properName true, parentKey "fixroundingerror"),
      Error (properName true). "fix" absent (len < 4).
    - HTTPServer → whole + HTTP + Server (HTTP properName true; boundary correct).
    - session_token_valid → whole (underscores kept in display/key) + session +
      token + valid (all properName false, isSubword true, parentKey
      "session_token_valid").
    - plain word "tokenizer" → single whole draft (no splitting).
    - short word "ok" → single whole draft (len 2 survives; shape gate rejects later).
    - hexish { raw: "f3a9c2e", hexish: true } → exactly 1 draft, isSubword false.
    - acronym no boundary: "HTTPS" → 1 draft (whole only).
    - digit boundary: "utf8Reader" → whole + utf8 + Reader (utf8 len 4 kept).
    - "__init__" → whole "__init__" + init (parentKey "__init__").
    - normalization: every draft has key === key.toLowerCase(); parentKey present
      iff isSubword; display === sub/whole as-seen casing.
  - IMPORT: import { expandCandidates, type CandidateDraft } from "../src/core/segment.js";
    import type { RawToken } from "../src/core/types.js";
  - DO NOT touch S1's tokenize tests.

Task 3: VALIDATE (see Validation Loop)
```

### Implementation pattern

```typescript
// Boundary scan core (sketch)
function splitCamel(seg: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i < seg.length; i++) {
    const c = seg[i];
    if (c >= "A" && c <= "Z") {
      const prev = seg[i - 1];
      const next = seg[i + 1] ?? "";
      if (/[a-z0-9]/.test(prev) || (prev >= "A" && prev <= "Z" && next >= "a" && next <= "z")) {
        parts.push(seg.slice(start, i));
        start = i;
      }
    }
  }
  parts.push(seg.slice(start));
  return parts;
}
```

### Integration Points

```yaml
NONE this task:
  - Pure function; no store/dictionary/config wiring.
  - Next consumers (do not implement here): shapeGate passesShape(draft) length rules
    whole 4–64 / subword 4–32; score admit() bands + subword clamp using
    draft.isSubword / draft.parentKey.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/segment.test.ts -v   # both S1 tokenize cases and new expandCandidates cases green
npm test                                     # full suite green
```

### Level 3: Integration Testing

None — pure module, no runtime integration.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors; `npm test` all green
- [ ] segment.ts imports nothing at runtime (type-only import of RawToken is fine)

### Feature Validation

- [ ] PRD §09 cases exact: fixRoundingError / HTTPServer / session_token_valid
- [ ] Hexish opaque; sub-words < 4 dropped; whole token always survives
- [ ] Keys lowercase; parentKey iff isSubword; properName per-candidate

### Code Quality Validation

- [ ] CandidateDraft exported from segment.ts (not types.ts), no duplication with Candidate/Sighting
- [ ] JSDoc comments follow types.ts/segment.ts style
- [ ] No anti-patterns: no hardcoded config knobs, no broad try/catch, no pi imports

## Anti-Patterns to Avoid

- ❌ Don't move CandidateDraft to types.ts (contract: export from segment.ts)
- ❌ Don't split hexish tokens
- ❌ Don't drop short WHOLE tokens, don't apply 4–64/4–32 length gates (shapeGate's job)
- ❌ Don't do recency/most-recent-casing merging here (store's job)
- ❌ Don't apply dictionary admission or salience (score.ts, later tasks)
- ❌ Don't reuse the same mutable /g regex state across calls if any regex is introduced

**Confidence Score: 9/10** — spec is verbatim from PRD with enumerated test cases; the only naming ambiguity (SegToken/wholeKey vs CandidateDraft/parentKey) is resolved in favor of the work-item contract.
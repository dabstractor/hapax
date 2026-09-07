---
name: "P1.M2.T2.S1 — Shape gate: length, entropy, unigram-run, consonant-run rules"
---

## Goal

**Feature Goal**: Implement `passesShape(draft: CandidateDraft): GateResult` in `src/core/shapeGate.ts` — the always-on admission filter applied to every segmented candidate before dictionary lookup. This task implements the four non-secret rules (length, character entropy, unigram run, consonant run); secret-shape rejection is a separate sibling task (P1.M2.T2.S2).

**Deliverable**: `src/core/shapeGate.ts` exporting `passesShape(draft: CandidateDraft): GateResult` plus `test/shapeGate.test.ts` covering PRD §04 gate cases for this task's rules.

**Success Definition**: `zendesk`, `lwlock`, `NREL`, `f3a9c2e` (hexish 6–12) pass; `aaaaa` (unigramRun), `qqqxxxzzzvvv` (consonantRun), low-entropy strings, and length violations reject with the correct `GateRejectReason`. `npm run check` and `npm test` green.

## Why

- Stage 3 of the core pipeline (segment → **shapeGate** → score → store → query). The gate is the load-bearing filter for dictionary-absent words — everything absent from the dictionary enters here or not at all (PRD §04).
- Output feeds the ingest pipeline (P1.M3.T2.S2) and reject-reason counters surfaced by `/acwords` (P1.M3.T4.S1) via `IngestStats.rejectedByGate`.

## What

Implement `passesShape(draft: CandidateDraft): GateResult` in a **new pure module** `src/core/shapeGate.ts`. Types come from existing declarations: `GateResult`, `GateRejectReason` (already in `src/core/types.ts`), `CandidateDraft` (exported from `src/core/segment.ts` by P1.M2.T1.S2 — treat as done).

### Rules (this task's scope — NOT secret rules)

Evaluate in this order; first failure wins:

1. **Length** (`tooShort` / `tooLong`): on `draft.key` (lowercase; same length as display).
   - Whole token (`isSubword === false`): must be 4–64 chars. `< 4` → `tooShort`; `> 64` → `tooLong`.
   - Sub-word (`isSubword === true`): must be 4–32 chars. `< 4` → `tooShort`; `> 32` → `tooLong`.
2. **Secret** — NOT implemented here. Sibling task P1.M2.T2.S2 adds a secret-shape check. Leave a clearly-marked insertion point in the check sequence (see Blueprint) but do NOT implement any secret logic. Reason precedence contract: tooShort/tooLong first, then `secret`, then the rules below.
3. **Low entropy** (`lowEntropy`): Shannon entropy of the draft's character distribution < 1.5 bits/char. Compute over `draft.key` (case-folded): `H = -Σ p_c · log2(p_c)` over each distinct char's frequency `p_c`. Reject when `H < 1.5`.
4. **Unigram run** (`unigramRun`): any single character repeated consecutively ≥ 4 times (e.g. `aaaaa`, `aaaaaaa`). Replaces/kills the PRD's `aaaaaaaargh`-style repetition.
5. **Consonant run** (`consonantRun`): any run of ≥ 6 consecutive characters that are all consonant letters (a–z except `aeiou`) with no vowel and no digit inside the run (e.g. `qqqxxxzzzvvv`).

Accepts (must pass): `zendesk`, `lwlock`, `NREL`, `f3a9c2e` (hexish whole token, 6–12 chars passes — note `f3a9c2e` contains digits so its consonant runs are broken; entropy of 7 distinct-ish chars ≥ 1.5).

### Success Criteria

- [ ] All four rules implemented with exact reason codes from `GateRejectReason`
- [ ] Hexish 6–12 candidates (`f3a9c2e`) pass the gate
- [ ] `ok === true` results carry no `reason`; rejects always carry exactly one
- [ ] Module is pure: imports only types (`RawToken` not needed; type-only imports of `CandidateDraft`, `GateResult`, `GateRejectReason`)

## All Needed Context

### Context Completeness Check

The implementer needs: exact upstream `CandidateDraft` shape (quoted below), exact `GateResult`/`GateRejectReason` declarations (in `src/core/types.ts`), rule thresholds and precedence, entropy formula, and test conventions. No pi/node/external-library knowledge required — pure TypeScript + vitest.

### Documentation & References

```yaml
- file: src/core/types.ts
  why: GateResult and GateRejectReason already declared here — DO NOT redeclare or move.
  pattern: GateRejectReason = 'tooShort'|'tooLong'|'lowEntropy'|'unigramRun'|'secret'|'consonantRun'
  gotcha: 'secret' exists in the union but is NOT produced by this task (P1.M2.T2.S2 owns it).

- file: src/core/segment.ts
  why: Exports CandidateDraft (P1.M2.T1.S2, being implemented in parallel — treat as done).
  contract: CandidateDraft = { key: string (lowercase); display: string; properName: boolean;
           isSubword: boolean; parentKey?: string }. Key length === display length (lowercasing preserves length).

- file: test/segment.test.ts
  why: Test conventions — flat test/ dir, vitest describe/it, ESM imports with .js extension
        ("../src/core/shapeGate.js"), top-of-file doc-comment stating scope.

- file: plan/001_88fc3a66fd74/prd_snapshot.md
  section: §04 h2.23 (Shape gate)
  why: Authoritative spec, quoted in this PRP's "What" section.

- file: plan/001_88fc3a66fd74/P1M2T1S2/PRP.md
  why: Upstream contract for CandidateDraft production (expandCandidates).
```

### Current Codebase tree (relevant)

```bash
src/core/types.ts        # GateResult, GateRejectReason, IngestStats (declared)
src/core/segment.ts      # tokenize() (S1 done) + CandidateDraft/expandCandidates (S2 in flight)
test/segment.test.ts     # conventions reference
```

### Desired Codebase tree with files added

```bash
src/core/shapeGate.ts    # NEW: passesShape(draft: CandidateDraft): GateResult
test/shapeGate.test.ts   # NEW: this task's rule coverage
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// ENTROPY ON LOWERCASE KEY, not display — the distribution is over chars of
// draft.key. "NREL" → "nrel": 4 distinct chars of 4 → H = 2.0 bits/char ≥ 1.5 → pass.

// ENTROPY EDGE: a 4-char key with all-distinct chars → H = 2.0 (pass).
// "aaaa" → H = 0 → lowEntropy AND unigramRun; precedence: lowEntropy fires first
// (secret slot is empty in this task). PRD lists entropy before unigram-run.

// UNIGRAM RUN ≥ 4: exactly 4 in a row rejects ("aaaa"). "aaa" inside a longer
// word ("faaamily", run of 3) does NOT reject on this rule.

// CONSONANT RUN: only ASCII letters count; a digit or vowel resets the run.
// "qqqxxxzzzvvv" → one 12-consonant run → reject. "strncpy" (7 consonants, no
// vowel/digit) → REJECTS (consonantRun) — that is correct per PRD rule 4.
// Note "y" is NOT a vowel here (vowels = aeiou).
// "lwlock" passes: l-w-l-o... run "lwl" = 3 < 6, then vowel 'o' — max run 3.

// HEXISH PASS-THROUGH: do NOT special-case hexish in this task. f3a9c2e passes
// on the general rules alone (digits break consonant runs; entropy high enough).
// Hexish ≥ 20 is rejected only by the pure-hex secret rule (T2.S2), not here.

// LENGTH ON SUB-WORDS: sub-word cap is 32, not 64. A whole token > 64 can never
// arrive from tokenize() (regex caps at 64) but the gate still enforces it.

// LENGTH CHECKS THE KEY, which equals the token text — underscores included.
// Whole "__init__" is 8 chars → within 4–64 → passes length.
```

## Implementation Blueprint

### Module shape

```typescript
/**
 * Shape gate — PRD §04 h2.23 (length/entropy/unigram-run/consonant-run rules).
 * Secret-shape rejection (reason 'secret') is P1.M2.T2.S2; this module exposes
 * a single insertion point for it so precedence stays: length → secret →
 * entropy → unigramRun → consonantRun.
 */
import type { CandidateDraft } from "./segment.js";
import type { GateResult } from "./types.js";

export function passesShape(draft: CandidateDraft): GateResult {
  const s = draft.key;
  const max = draft.isSubword ? 32 : 64;
  if (s.length < 4) return { ok: false, reason: "tooShort" };
  if (s.length > max) return { ok: false, reason: "tooLong" };
  // P1.M2.T2.S2: secret-shape check slots HERE (returns { ok:false, reason:'secret' }).
  if (charEntropy(s) < 1.5) return { ok: false, reason: "lowEntropy" };
  if (hasRun(s, 4, () => true)) return { ok: false, reason: "unigramRun" };
  if (hasConsonantRun(s, 6)) return { ok: false, reason: "consonantRun" };
  return { ok: true };
}

function charEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}
// unigram-run and consonant-run: single left-to-right scan counting
// consecutive equal chars (unigram) and consecutive non-vowel non-digit
// letters (consonant).
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/core/shapeGate.ts
  - IMPLEMENT: passesShape(draft: CandidateDraft): GateResult exactly per rules above
  - HELPERS: private charEntropy(s), unigram-run scanner, consonant-run scanner
    (single-pass, allocation-light — the gate runs on every candidate)
  - SECRET SLOT: comment-marked insertion point between length and entropy checks;
    do NOT implement secret logic (T2.S2 owns it)
  - TYPE-ONLY IMPORTS: CandidateDraft from ./segment.js, GateResult from ./types.js
  - NAMING: passesShape (exact contract name); file src/core/shapeGate.ts

Task 2: CREATE test/shapeGate.test.ts
  - FOLLOW pattern: test/segment.test.ts (describe/it, ESM .js imports, top doc-comment)
  - IMPORT: import { passesShape } from "../src/core/shapeGate.js";
            import type { CandidateDraft } from "../src/core/segment.js";
  - HELPER: const draft = (key: string, isSubword = false): CandidateDraft => ({
      key, display: key, properName: false, isSubword, ...(isSubword ? { parentKey: "p" } : {}) });
  - CASES (each its own it()):
    * length: "abc" → {ok:false,reason:"tooShort"}; "zendesk" → ok;
      subword "abc" → tooShort; whole 65-char → tooLong; subword 33-char → tooLong;
      whole 64-char ok; subword 32-char ok; 4-char all-distinct ("abcd") ok
    * entropy: "aaaa" → lowEntropy (H=0); string of 2 alternating chars ×8
      ("abababab") → H=1.0 < 1.5 → lowEntropy; "nrel" → H=2.0 → ok
    * unigramRun: "aaaaa" → unigramRun — NOTE "aaaa" already dies as lowEntropy;
      to isolate the rule use a mixed string with one 4+ run, e.g. "waaaaaard"
      (wa-a… chars w,a,a,a,a,a,r,d: entropy ≈1.75 ≥1.5, run of 5 a's) → unigramRun
    * consonantRun: "qqqxxxzzzvvv" → consonantRun; "strncpy" → consonantRun;
      "lwlock" → ok; "zz9zzz" → ok (digit breaks the run)
    * hexish accept: "f3a9c2e" whole-token draft → ok
    * accepts: zendesk, lwlock, nrel, f3a9c2e all ok with no reason field
    * precedence: "aaaa" → lowEntropy not unigramRun (entropy checked first);
      "qqq" → tooShort (length before everything)
    * ok results: expect(result).toEqual({ ok: true }) — no reason key

Task 3: VALIDATE (Validation Loop below)
```

### Integration Points

```yaml
NONE this task:
  - Pure module; no store/dictionary/config wiring.
  - Consumers (do NOT implement here): P1.M3.T2.S2 ingest pipeline calls
    passesShape per candidate before dictionary lookup; rejects increment
    IngestStats.rejectedByGate[reason]. P1.M2.T2.S2 will add the secret check
    inside this module at the marked slot.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/shapeGate.test.ts -v   # all cases green
npm test                                      # full suite green (existing tests untouched)
```

### Level 3: Integration Testing

None — pure module, no runtime integration.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors; `npm test` all green
- [ ] No runtime imports — only type imports from ./segment.js and ./types.js

### Feature Validation

- [ ] All rules reject with exact reasons: tooShort/tooLong (whole 4–64, subword 4–32), lowEntropy (<1.5 bits/char over key), unigramRun (≥4), consonantRun (≥6, no vowel/digit)
- [ ] Precedence: length → [secret slot, unimplemented] → entropy → unigram → consonant
- [ ] zendesk, lwlock, NREL, f3a9c2e all pass; ok results carry no reason
- [ ] Secret logic NOT implemented (T2.S2 owns it)

### Code Quality Validation

- [ ] JSDoc header follows segment.ts/dictionary.ts style; PRD §04 h2.23 referenced
- [ ] Single-pass scanners, no per-call regex state reuse, no allocations beyond a small Map in entropy
- [ ] No anti-patterns: no config knobs (thresholds are baked constants per PRD), no broad try/catch

## Anti-Patterns to Avoid

- ❌ Don't implement secret-shape rules — that's P1.M2.T2.S2
- ❌ Don't special-case hexish tokens in the gate logic — general rules suffice for 6–12 pass; hexish ≥ 20 rejection is T2.S2's pure-hex rule
- ❌ Don't make thresholds configurable (PRD: baked constants, not a tuning surface)
- ❌ Don't count entropy over `display` (casing) — use `key`
- ❌ Don't redeclare GateResult/GateRejectReason — they exist in types.ts
- ❌ Don't mutate the draft; the gate is read-only
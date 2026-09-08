# PRP — P1.M1.T2.S3 (plan 002): debug.ts — strip the phrase dump and its imports

---

## Goal

**Feature Goal**: Make `src/pi/debug.ts` fully phrase-free: `formatAcwordsDump`
renders ONLY the store section (size/cap/ordinal/histogram), the top-50
salience section, and the ingest-stats section, with zero phrase imports,
zero phrase code, and zero stale references to a phrase dump. No successor
sample is (re-)added here — that belongs to P1.M3.T2.S1 (R5).

**Deliverable**:
- `src/pi/debug.ts`: phrase dump, phrase helpers, and phrase imports deleted;
  header doc comment corrected to state that the successor-index sample section
  is appended later by P1.M3.T2.S1 (not this item).
- `test/debug.test.ts`: the `describe 'acwords dump — phrases + successor
  sample'` block (4 cases) deleted; all remaining word-store cases green.

**Success Definition**:
- `grep -rn -i "phrase" src/pi/debug.ts test/debug.test.ts` returns no hits.
- `npm run check` (tsc --noEmit) clean; `npx vitest --run test/debug.test.ts`
  and full `npm test` green.
- `formatAcwordsDump` output contains exactly three sections separated by
  blank lines: `hapax candidate store` / `top 50 by salience` / `ingest stats`.

## IMPORTANT — current reality (verified against HEAD b46f7c6)

S1 (commit `b46f7c6 refactor(core): swap phrase layer for bare bigram counts`)
already performed the *compile-preserving deletions* its PRP authorized in
`src/pi/debug.ts` and `test/debug.test.ts`:

- `TOP_PHRASES`, `phraseDisplay`, `phrasesSection`, and its spread entry in the
  `formatAcwordsDump` join are **already deleted**. The file is 147 lines.
- Imports of `firstWord`/`phraseSalience` (query.js), `PHRASE_CAP` (store.js),
  and the `PhraseEntry` type are **already removed**.
- The `describe 'acwords dump — phrases + successor sample'` block with its 4
  cases is **already pruned** from `test/debug.test.ts`.

**The only surviving defect** is the stale header doc comment in
`src/pi/debug.ts` (lines ~6–12), which claims "The M2 phrase dump is a REMOVED
design (PRD 002 delta R1); **P1.M1.T2.S3 adds a successor sample section**".
That claim is wrong per the item contract: this item must NOT add the successor
sample — P1.M3.T2.S1 does, and it consumes this item's phrase-free
`formatAcwordsDump` as its base. The architecture note in
`plan/002_3e8a42cadf2c/architecture/core_phrase_layer_map.md` §debug.ts
refers to pre-S1 line numbers (109 / 114–120 / 122–160 / 182) that no longer
apply — do not try to delete at those anchors; verify current state instead.

So this item is primarily a **verification + doc-comment correction** pass, not
a large deletion. Implementer MUST first re-verify the current state of both
files rather than assuming the deletions are still pending.

## User Persona

**Target User**: hapax maintainer/developer using `/acwords` (with
`debug: true`) as the only observability surface for tuning (PRD §09 h2.52).

**Use Case**: Developer dumps the candidate store mid-session to inspect
top-50 salience ordering, rank-group histogram, and shape-gate rejection counts.

**Pain Points Addressed**: The old dump showed a "hapax phrases" section for a
design that no longer exists (R1 removed the phrase layer), producing
misleading tuning signal and dangling phrase-type dependencies.

## Why

- PRD 002 delta R1: one-word invariant — no multi-word candidates; the only
  phrase behavior is successor chaining. The phrase dump section and its
  imports are dead code against the post-S1 store, which no longer exports
  `PHRASE_CAP`, `phraseEntries`, or `PhraseEntry`.
- PRD h2.48 defines the dump as: top-50 candidates by salience, store size,
  rank-group histogram, gate rejection counts, and (M2 / P1.M3.T2.S1) a
  successor-index sample. This item delivers the phrase-free prefix that
  P1.M3.T2.S1 appends to.
- Keeping the section-builder helpers (`storeSection`, `topSection`,
  `statsSection`) intact means P1.M3.T2.S1's successor sample lands in exactly
  one place later.

## What

### Success Criteria

- [ ] `formatAcwordsDump` renders exactly: storeSection, blank, topSection,
      blank, statsSection (joined with `\n`).
- [ ] No identifier or comment in `src/pi/debug.ts` or `test/debug.test.ts`
      references phrases, `PHRASE_CAP`, `PhraseEntry`, `phraseSalience`,
      `firstWord`, or `topSuccessors`.
- [ ] The header doc comment correctly states that the successor-index sample
      section is added by P1.M3.T2.S1, not this item.
- [ ] `registerAcwordsCommand`, `AcwordsCommandDeps`, `GROUP_LABEL`, `TOP_N`,
      `topCandidates`, and all three section builders are unchanged in
      behavior.
- [ ] Full `npm test` green.

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase: they get the exact current file
state (quoted below), the exact stale comment to fix, the grep-based
verification gates, and the test commands — sufficient to finish in one pass.

### Documentation & References

```yaml
- url: (PRD snapshot) plan/002_3e8a42cadf2c/prd_snapshot.md — §08 h2.48 (debug command), §09 h2.52 (tuning protocol, "no phrase multipliers exist")
  why: defines the /acwords dump surface this item finalizes
  critical: successor sample is an M2/R5 (P1.M3.T2.S1) concern — do NOT add it here

- file: src/pi/debug.ts
  why: the file being finalized; already phrase-free at HEAD b46f7c6
  pattern: small pure section-builder helpers joined in formatAcwordsDump
  gotcha: header comment (lines ~6–12) still claims P1.M1.T2.S3 adds a successor sample — WRONG, fix it

- file: test/debug.test.ts
  why: verification suite; phrase describe block already pruned by S1
  pattern: see() upsert helper, fakeStats literal with all six gate keys, statsStub, fakePi, topRows parser
  gotcha: do not touch the 11 dump cases + 3 registration cases; they must stay green

- file: plan/002_3e8a42cadf2c/architecture/core_phrase_layer_map.md
  why: original line-anchored deletion inventory (§debug.ts)
  gotcha: line anchors are PRE-S1 (223-line file); current file is 147 lines — anchors 109/114–120/122–160/182 are stale

- file: plan/002_3e8a42cadf2c/P1M1T2S2/PRP.md
  why: sibling item, currently being implemented — words-only rankMatches in src/core/query.ts
  gotcha: S2 removes firstWord/phraseSalience from query.ts exports; debug.ts must not import them (it already doesn't)
```

### Current Codebase tree (relevant slice)

```bash
src/pi/debug.ts        # 147 lines, phrase-free already; stale header comment only
test/debug.test.ts     # phrase cases already pruned; 11 dump + 3 registration cases remain
src/core/query.ts      # S2 territory (words-only rankMatches) — do not touch here
src/core/store.ts      # post-S1: recordBigramRuns/topSuccessors — debug.ts must not use topSuccessors yet
```

### Desired Codebase tree with changes

```bash
src/pi/debug.ts        # same 147-ish lines; ONLY the header doc comment corrected
test/debug.test.ts     # unchanged (or unchanged-equivalent)
```

### Known Gotchas of our codebase

```python
# CRITICAL: the architecture map's line numbers for debug.ts are pre-S1 and stale.
# CRITICAL: pi's ctx.ui.notify levels are "info"|"warning"|"error" — no "warn" (existing code already correct).
# CRITICAL: do NOT re-add a successor sample (store.topSuccessors) to the dump — P1.M3.T2.S1 (R5) owns that; adding it here would collide with that item.
# Imports use .js extensions (ESM + tsc NodeNext): "../core/store.js" etc.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY current state of src/pi/debug.ts
  - READ src/pi/debug.ts end-to-end
  - CONFIRM: no TOP_PHRASES / phraseDisplay / phrasesSection / phrase imports exist
  - IF any phrase residue IS present (e.g., S1 was partially applied when you start):
    DELETE it exactly as the item contract describes (TOP_PHRASES, phraseDisplay,
    phrasesSection + spread entry; imports firstWord/phraseSalience from
    ../core/query.js, PHRASE_CAP from ../core/store.js, PhraseEntry type from
    ../core/types.js), keeping storeSection/topSection/statsSection untouched.

Task 2: FIX the stale header doc comment in src/pi/debug.ts (lines ~6–12)
  - REPLACE the sentence claiming "P1.M1.T2.S3 adds a successor sample section"
    with wording that states: the dump is phrase-free by design (PRD 002 delta R1);
    the successor-index sample section is appended by P1.M3.T2.S1 (R5) by adding
    one builder and one spread entry, mirroring the existing section helpers.
  - ALSO scrub the remaining phrase mention on the line starting
    "The M2 phrase dump is a REMOVED design" if the wording reads stale after
    your edit — the final header must contain zero lowercase/uppercase "phrase"
    references.
  - PRESERVE all other header content (P1.M3.T4.S1 registration note, privacy note).

Task 3: VERIFY test/debug.test.ts
  - CONFIRM the describe 'acwords dump — phrases + successor sample' block is
    absent; if present, delete its 4 it() cases as a block, keeping fixtures
    (see, fakeStats, statsStub, fakePi, topRows) and all other cases intact.
  - CONFIRM no import or usage of phrase APIs.

Task 4: REPO-WIDE residue sweep (read-only grep)
  - RUN: grep -rn -i "phrase" src/pi/debug.ts test/debug.test.ts  → expect empty
  - RUN: grep -n "topSuccessors" src/pi/debug.ts → expect empty (successor sample is P1.M3.T2.S1's job)
```

### Implementation Patterns & Key Details

```typescript
// Corrected header comment shape (src/pi/debug.ts, top-of-file):
// * ...registered with pi only when config.debug is true... The formatter is
// * pure...never message bodies (PRD §08 privacy). The dump is word-only by
// * design (PRD 002 delta R1). P1.M3.T2.S1 (R5) appends the successor-index
// * sample section by adding one builder and one spread entry below — build
// * sections through the small helpers so a new section lands in one place.

// formatAcwordsDump — TARGET (already the current body; do not change logic):
//   return [
//     ...storeSection(store.size, ordinal, histogram),
//     "",
//     ...topSection(rows),
//     "",
//     ...statsSection(stats),
//   ].join("\n");
```

### Integration Points

```yaml
NONE:
  - no store/query/type contract changes in this item (S1/S2 own those)
  - no config, no registration changes
  - P1.M3.T2.S1 consumes formatAcwordsDump as-is and appends its section
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run check          # tsc --noEmit — expect zero errors
# (no ruff/mypy — this is a TypeScript project; tsc is the gate)
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest --run test/debug.test.ts   # all remaining dump + registration cases green
npm test                              # full suite green (word-store cases intact)
```

### Level 3: Integration Testing (System Validation)

```bash
# Residue gates (expect empty output each):
grep -rn -i "phrase" src/pi/debug.ts test/debug.test.ts
grep -n "topSuccessors" src/pi/debug.ts

# Optional behavioral spot-check of the dump shape:
node --input-type=module -e "
import { CandidateStore } from './src/core/store.js';
import { formatAcwordsDump } from './src/pi/debug.js';
const s = new CandidateStore();
const dump = formatAcwordsDump(s, { wordsSeen:0, admitted:0, rejectedByGate:{tooShort:0,tooLong:0,lowEntropy:0,unigramRun:0,secret:0,consonantRun:0} });
console.log(dump);
"
# Expect exactly three sections: 'hapax candidate store', 'top 50 by salience:',
# 'ingest stats' — and no 'hapax phrases' or 'successor sample' lines.
```

### Level 4: Creative & Domain-Specific Validation

None applicable — read-only formatter cleanup; PRD h2.52 tuning protocol
(fixture-driven) is unaffected because no tuning constants change.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean
- [ ] `npm test` green (full suite)
- [ ] Residue greps empty (see Level 3)

### Feature Validation

- [ ] Dump renders exactly storeSection / topSection / statsSection
- [ ] No successor sample re-added (deferred to P1.M3.T2.S1)
- [ ] Header doc comment corrected, zero "phrase" references
- [ ] Word-store test cases all green

### Code Quality Validation

- [ ] No logic changes to `topCandidates`, section builders, or
      `registerAcwordsCommand`
- [ ] Comment style matches existing JSDoc conventions in the file
- [ ] No files outside `src/pi/debug.ts` (and, if residue found,
      `test/debug.test.ts`) modified

## Anti-Patterns to Avoid

- ❌ Don't re-add a successor sample "while you're in there" — it collides with
  P1.M3.T2.S1 (R5)
- ❌ Don't trust the architecture map's pre-S1 line anchors — re-read the file
- ❌ Don't touch `src/core/query.ts`, `src/core/store.ts`, or `src/pi/ingest.ts`
  (S1 done, S2 in flight)
- ❌ Don't delete or weaken existing green test cases
```

**Confidence Score: 9/10** — the deletion is already complete at HEAD; the PRP
captures the exact residual work (stale comment + verification gates) and the
fallback deletion instructions if the starting tree differs.
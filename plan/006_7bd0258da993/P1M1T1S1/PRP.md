# PRP — P1.M1.T1.S1 (plan 006): Casing class on occurrences (types + segment + occurrence classification)

---

## Goal

**Feature Goal**: Implement spec/04 h2.26-adjacent casing classification
(spec §04 Normalization/casing-evidence groundwork): every candidate
occurrence carries a three-way `CasingClass` — `'lower' | 'mid-cap' |
'structural-cap'` — derived from its first ASCII char and its
structural-start flag, threaded from `tokenize` through `CandidateDraft`
into `Sighting` so occurrence context reaches the store (consumed by
P1.M1.T1.S2's uppercase-run walk and P1.M1.T2.S1's tallies).

**Deliverable**:
- `export type CasingClass = "lower" | "mid-cap" | "structural-cap"` in
  `src/core/types.ts` (with Mode-A JSDoc: fields, derivation rule, spec
  anchor 04)
- `Sighting.casing: CasingClass` (types.ts ~line 41–49)
- `CandidateDraft.casing: CasingClass` (segment.ts ~line 722–736),
  set in `expandCandidates`
- One-line producer update at ingest's single Sighting construction
  (src/pi/ingest.ts ~line 628–636) so the new REQUIRED field compiles
- Tests: `test/segment.test.ts` classification cases +
  `test/types.test.ts` type-contract extension

**Success Definition**: classification rule pinned by tests (`Zendesk`
mid-sentence → mid-cap; sentence-initial `Check` → structural-cap;
`zendesk` → lower); full `npm run check` + `npm test` green; the store
itself untouched (no schema change beyond the Sighting payload field —
tallies are P1.M1.T2.S1).

## Why

Spec §04 (2026-10 casing-evidence model): casing evidence is tallied,
never recency-merged — each candidate keeps capitalized/lowercase tallies,
with sentence-initial (structural-start) capitalized sightings counting
conditionally. The store cannot tally what it never receives: today the
only casing signals surviving to the store are `Sighting.display` (the raw
string) and boolean `properName`. This task adds the classification
primitive every downstream casing feature needs: the run walk (S2)
recognizes run members via `mid-cap`/`structural-cap` occurrences; the
tallies (T2.S1) branch on the three classes exactly as the spec's
normalization rule describes (structural-cap counts toward capitalized
only while no lowercase sighting exists, etc.).

## What

Classification rule (per occurrence, spec 04 h2.26/h3.5 groundwork):

```
first char of the token's raw is uppercase ASCII (isUpperAscii)
  → sentenceStart ? 'structural-cap' : 'mid-cap'
else → 'lower'
```

- Derived ONCE per occurrence in `expandCandidates` (segment.ts), where
  both inputs (`token.raw`, `token.sentenceStart`) are already in hand —
  `properName` is currently computed as
  `isUpperAscii(raw[0]) && !sentenceStart` (line ~768), i.e.
  `properName === (casing === "mid-cap")` — keep both; the boolean stays
  (existing consumers), the class is additive richer (distinguishes
  structural-cap from lower, which properName conflates as false).
- Thread: `CandidateDraft.casing` → ingest's Sighting construction →
  `Sighting.casing`. Store's `upsert` receives it (store logic untouched).
- Paths/hexish/literals keep raw casing in `display`; their `casing` is
  classified by the same first-char rule (verbatim display rules govern
  them elsewhere — classification is harmless metadata; document that
  path keys' first char is the trimmed key's, classification uses
  `token.raw.charAt(0)` per the contract's "raw casing" note).
- `tokenize()`/`RawToken` UNCHANGED (sentenceStart already exists there).

### Success Criteria

- [ ] `expandCandidates` on mid-sentence `Zendesk` → draft.casing `mid-cap`
- [ ] Sentence-initial/structural-start `Check` ("Done. Check", "- Check",
      "## Check", line-initial) → `structural-cap`
- [ ] `zendesk` → `lower`
- [ ] Uppercase-after-colon ("Note: Check") → `structural-cap` (clause
      punctuation is in isSentenceStartBefore's rule (c))
- [ ] `properName` behavior byte-identical (mid-cap ⇔ properName true)
- [ ] `Sighting.casing` reaches `store.upsert` (types-level + one ingest
      producer change)
- [ ] test/types.test.ts Sighting literal updated and typechecks
- [ ] `npm run check` + `npm test` green; store.ts untouched

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: the derivation rule, the
exact interfaces and construction sites (verified line anchors), the
existing sentenceStart machinery, and the test conventions are all below.

### Documentation & References

```yaml
- file: src/core/types.ts
  why: ADD CasingClass + Sighting.casing here. Verified:
    - Sighting interface (lines 41–49): { key, display, ordinal, fromUser,
      properName, rankGroup } — "The unit the ingest pipeline feeds
      store.upsert. Produced by segment + shapeGate + score for each
      admitted candidate occurrence."
    - RawToken (line 68+): { raw, hexish, literal?, path?, trimFrom?,
      trimTo?, start, end, sentenceStart } — UNCHANGED (sentenceStart
      already carries the structural-start flag from tokenize).
    - Successor (line ~60) and the rest: untouched.
  pattern: JSDoc-per-field density (see Sighting/RawToken docs) — write
    CasingClass and casing in the same style with the spec anchor.

- file: src/core/segment.ts
  why: ADD CandidateDraft.casing + derivation in expandCandidates.
    Verified:
    - CandidateDraft (lines 722–736): { key, display, properName,
      path? } — "One candidate occurrence produced by segment.ts.
      Segment-stage only."
    - isUpperAscii (lines 738–740): `(c) => c >= "A" && c <= "Z"`
      (ASCII-only, tokenize never emits non-ASCII into tokens).
    - expandCandidates (~745–775): computes
      `const nameInitial = isUpperAscii(token.raw.charAt(0)) && !token.sentenceStart;`
      (line ~768) — the casing derivation slots right here.
    - sentenceStart machinery (NOT to modify, context only):
      isSentenceStartBefore (lines ~418–445) — bounded walk-back
      (O(1)/token; unbounded scans once blew the 800 KB perf gate —
      keep any new logic equally bounded). Returns true for (a) first
      word of line/message, (b) bullet/heading/list marker
      (`- ` `* ` `## ` `1. `), (c) sentence/clause punctuation
      (`. ! ? ; :`) after whitespace+closers. Applied at token emission
      (:461 base/hexish) and the compound/fn sites (:660).
  pattern: expandCandidates is PURE (no state, type-only imports) —
    the derivation is a pure expression of token.raw + token.sentenceStart.

- file: src/pi/ingest.ts
  why: The ONLY Sighting construction site (verified: lines 628–636):
        const sighting: Sighting = {
          key: ...,
          display: draft.display,     // :630
          ...
          properName: draft.properName,  // :633
        };
        this.#store.upsert(sighting);    // :636
    ADD `casing: draft.casing,` to this literal — nothing else in ingest
    changes. (grep-verified: this is the sole Sighting literal in src/;
    test fixtures construct Sighting in test/types.test.ts and various
    helpers — see Gotchas.)

- file: test/segment.test.ts
  why: Classification cases. Conventions (read the file): describe
    titles cite spec sections; tokenize/expandCandidates called with
    literal strings; toEqual on full draft objects where feasible
    (NOTE: existing expandCandidates tests assert full CandidateDraft
    shapes — adding a REQUIRED casing field will break every toEqual
    on drafts; update them mechanically by adding the expected casing
    per case).
  gotcha: check how drafts are asserted (full-object toEqual vs
    field picks) before writing; the file is large — grep
    `expandCandidates(` to find the block.

- file: test/types.test.ts
  why: Extend the type-contract describe (verified shape above): the
    Sighting literal at ~line 37 gains `casing: 'mid-cap'`; add a
    CasingClass satisfies-check line like the existing RankGroup one.

- docfile: plan/006_7bd0258da993/architecture/01-core-pipeline-r1.md
  section: §3 (casing info today: raw carries casing; sentenceStart
    derived per token; NO casing-class field exists)
  why: Confirms the gap this task fills and that S2 (run walk) and
    T2.S1 (tallies) consume the new field.

- prd: spec/04 h3.5 Normalization (casing tallies — the downstream
    consumer's exact branching semantics) + h2.26 Capitalized runs
    (run detection uses the same structural-start boundary; note the
    spec says the structural-start exclusion does NOT apply to run
    DETECTION — S2's concern, not yours: your job is to preserve the
    information so S2 can choose) — reproduced in selected_prd_content.
```

### Current Codebase tree (relevant excerpt)

```bash
hapax/
├── src/core/
│   ├── types.ts       # MODIFY: CasingClass + Sighting.casing (+ JSDoc)
│   └── segment.ts     # MODIFY: CandidateDraft.casing + derivation in expandCandidates
├── src/pi/
│   └── ingest.ts      # MODIFY: one line at the Sighting literal (:628–636)
└── test/
    ├── segment.test.ts  # MODIFY: classification cases + mechanical draft-shape updates
    └── types.test.ts    # MODIFY: Sighting literal + CasingClass satisfies check
```

### Known Gotchas of our Codebase & Library Quirks

```python
# GOTCHA — required vs optional field: make Sighting.casing and
#   CandidateDraft.casing REQUIRED. Optional fields invite "forgot to
#   classify" bugs and force non-null assertions downstream (S2/T2.S1
#   branch on the class constantly). The compile cost is exactly two
#   producer sites (expandCandidates, ingest) plus test literals —
#   grep `: Sighting` and `Sighting = {` across src/ and test/ to catch
#   every construction (test/helpers, fixtures, store/query tests build
#   Sightings via sighting() helpers — update the helper(s), not each call).
# GOTCHA — full-object toEqual pins: test/segment.test.ts (and possibly
#   score/shapeGate tests) assert complete CandidateDraft objects; a new
#   required field breaks them ALL. Fix by adding the expected casing per
#   case (mechanical; run vitest, read each diff). Same for store.test.ts
#   if its sighting helper produces full objects consumed by toEqual on
#   stored Candidates — store.upsert consumes the field but Candidate
#   (store schema) is UNTOUCHED, so stored-shape assertions stay green.
# GOTCHA — properName === (casing === "mid-cap") INVARIANT: keep both
#   derivations from the same two inputs; do not let them drift (derive
#   casing first, then properName = casing === "mid-cap" — one source
#   of truth, zero extra computation).
# GOTCHA — classification reads token.raw.charAt(0) (the DISPLAY form),
#   not the trimmed path key: for paths the trimmed key's first char can
#   differ (leading '/' trimmed) — but paths never start uppercase after
#   trim in practice, and the contract says "paths/hexish/literals keep
#   raw casing" — classify on raw[0], document it.
# GOTCHA — isUpperAscii is module-local in segment.ts (:738): the
#   derivation lives in expandCandidates (same module) — no export
#   needed; do NOT duplicate the test in types.ts.
# GOTCHA — perf: the derivation is O(1) per draft; do NOT add any new
#   text scanning (isSentenceStartBefore already did the bounded walk —
#   reuse its output via token.sentenceStart; never re-walk).
# GOTCHA — hexish tokens can start uppercase (F3A9C2E): they classify
#   like any token (structural-cap/mid-cap/lower); harmless metadata.
```

## Implementation Blueprint

### Data models and structure

```typescript
// src/core/types.ts
/** Casing class of ONE candidate occurrence (spec §04 h2.26/h3.5,
 *  2026-10 casing-evidence groundwork). Derived per occurrence in
 *  segment.expandCandidates from the token's first ASCII char and its
 *  structural-start flag:
 *    uppercase first char + structural start → "structural-cap"
 *      (orthographic capital: sentence/line/bullet/heading/clause start)
 *    uppercase first char, mid-sentence       → "mid-cap"
 *      (proper-name evidence)
 *    anything else                            → "lower"
 *  Consumed downstream: the capitalized-run walk (§04 h2.26) and the
 *  casing tallies (§04 h3.5 — structural-cap sightings count toward the
 *  capitalized tally only while no lowercase sighting exists). */
export type CasingClass = "lower" | "mid-cap" | "structural-cap";

// Sighting gains:
/** casing class of THIS occurrence (see CasingClass) — occurrence
 *  context for the store's casing tallies (§04 h3.5). */
casing: CasingClass;

// src/core/segment.ts — CandidateDraft gains:
/** casing class of this occurrence (derived from raw[0] +
 *  token.sentenceStart; see CasingClass in types.ts). properName is
 *  exactly (casing === "mid-cap"). */
casing: CasingClass;

// expandCandidates derivation (beside the existing nameInitial line):
const casing: CasingClass = !isUpperAscii(token.raw.charAt(0))
  ? "lower"
  : token.sentenceStart ? "structural-cap" : "mid-cap";
const nameInitial = casing === "mid-cap";   // refactor: one source of truth
// ...and include `casing` in the returned draft object(s) (all of them —
// the path draft site included; verify every return in expandCandidates).
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: TDD — classification cases FIRST (test/segment.test.ts)
  - ADD a describe ("expandCandidates — casing classification (spec §04
    h3.5 groundwork)") pinning the Success Criteria matrix:
      mid-sentence "then Zendesk logs" → mid-cap
      "Done. Check" / "- Check" / "## Check" / line-initial "Check" → structural-cap
      "Note: Check" → structural-cap (clause punctuation rule (c))
      plain "zendesk" / "sessionToken" → lower
      properName parity: mid-cap ⇔ properName true on the same drafts
  - EXPECT RED (no casing field).

Task 2: IMPLEMENT types.ts
  - CasingClass export + JSDoc (spec anchor 04 h2.26/h3.5); Sighting.casing
    required field + JSDoc.

Task 3: IMPLEMENT segment.ts
  - CandidateDraft.casing + JSDoc; the derivation + nameInitial refactor
    in expandCandidates; include casing in EVERY draft return site of
    expandCandidates (read the whole function — the path-draft branch
    constructs its own draft).

Task 4: PRODUCER + compile sweep
  - src/pi/ingest.ts :628–636 Sighting literal gains `casing: draft.casing,`.
  - grep construction sites: `grep -rn "Sighting = {\|: Sighting\b" src/ test/`
    — update test sighting() helpers (one place each) rather than calls.
  - FIX all full-object toEqual breaks (mechanical; each failure names
    the missing field — add the correct expected casing).

Task 5: test/types.test.ts
  - Sighting literal gains casing; add
    `expect('mid-cap' satisfies CasingClass).toBe('mid-cap');` style check.

Task 6: FULL REGRESSION
  - npm run check
  - npm test   # every suite green — store.ts, query.ts, score.ts untouched
```

### Implementation Patterns & Key Details

```typescript
// The invariant worth a comment at the derivation site:
//   properName === (casing === "mid-cap")
// structural-cap and lower both yield properName false — the class
// carries strictly more information than the boolean (it distinguishes
// WHY the capital was suppressed), which is exactly what S2's run walk
// needs (run detection deliberately ignores structural-start — spec
// h2.26 — so it must see structural-cap as "uppercase occurrence").
```

### Integration Points

```yaml
DOWNSTREAM (do NOT implement):
  - P1.M1.T1.S2 (run walk): reads occurrence casing (mid-cap OR
    structural-cap = uppercase occurrence) + spans for adjacency.
  - P1.M1.T2.S1 (tallies): branches casing === lower / mid-cap /
    structural-cap per the §04 h3.5 tally rule (structural-cap counts
    toward capitalized only while no lowercase sighting exists).
STORE: upsert receives Sighting.casing but Candidate's stored schema is
  unchanged this task (tallies land in T2.S1). No store.ts edits.
PERF: O(1) per draft; ingest budget unaffected.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — required-field producers all updated
```

### Level 2: Unit Tests (TDD)

```bash
npx vitest --run test/segment.test.ts             # classification describe green
npx vitest --run test/segment.test.ts -t casing -v
npx vitest --run test/types.test.ts               # type-contract extended
npm test                                          # full suite green
```

### Level 3: Integration

```bash
npx vitest --run test/ingest-pipeline.test.ts test/store.test.ts test/ingest.test.ts
# producer change is one field; these must stay green after the helper updates
```

### Level 4: Domain-Specific

```bash
# Tally-rule precursor sanity (spec's own exemplars, via expandCandidates):
npx vitest --run test/segment.test.ts -t "structural-cap"
# "Done. Check", "- Check", "## Check", "Note: Check", line-initial — all structural-cap
```

## Final Validation Checklist

- [ ] CasingClass exported with Mode-A JSDoc (derivation rule + spec anchor)
- [ ] Sighting.casing + CandidateDraft.casing REQUIRED fields with docs
- [ ] Classification matrix pinned (mid-cap / structural-cap incl. colon+bullet+heading+line-initial / lower)
- [ ] properName parity invariant held (single derivation site)
- [ ] ingest producer updated; all Sighting/test-helper construction sites compile
- [ ] All full-object toEqual pins updated; full suite green
- [ ] store.ts untouched; tokenize/RawToken untouched; no new text scanning
- [ ] `npm run check` + `npm test` green

## Anti-Patterns to Avoid

- ❌ Don't make casing optional (downstream branches on it constantly; required forces classification at every producer)
- ❌ Don't re-walk text for the structural-start check — reuse token.sentenceStart (the perf-gate history forbids unbounded scans)
- ❌ Don't let properName and casing derive independently (drift bug) — derive casing, define properName from it
- ❌ Don't touch store.ts schema, tokenize, score.ts, or the tallies (T2.S1)
- ❌ Don't special-case paths/hexish out of classification (raw[0] rule applies uniformly)
- ❌ Don't update each Sighting call site when a test helper exists — update the helper

---

**Confidence Score**: 9/10 — the interfaces, construction sites
(:628–636 producer, helpers), the sentenceStart machinery, and the
existing properName derivation were all read from live source this
session; the main mechanical risk (full-object toEqual churn) is named
with its fix recipe.

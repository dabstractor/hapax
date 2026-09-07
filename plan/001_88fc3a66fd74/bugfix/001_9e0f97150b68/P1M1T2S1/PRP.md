# PRP — P1.M1.T2.S1 (bugfix 001_9e0f97150b68): Recalibrate REJECT/MID band constants against real-corpus ranks

---

## Goal

**Feature Goal**: Fix BUG-001's band half — the §04 log-quantization curve
(denominator fixed at DICT_N=70,000) means q ≥ 220 covers only ranks 0–3, so
even a perfectly ordered corpus can never reject "with"/"this"/"them". Retune
the two baked constants in `src/core/score.ts` —
`REJECT_COMMON_THRESHOLD` (currently 220, ~L49) and `MID_FREQ_THRESHOLD`
(currently 120, ~L54) — measured against the regenerated
`dict/common-en.bin` (P1.M1.T1.S2), so the top ~1,000 real corpus ranks are
rejected, the next few thousand land rank group 2, and the tail stays group 1.

**Deliverable**:
- New values for both constants in `src/core/score.ts`, pinned by measurement
  (a `node -e` calibration probe over the vendored TSV ranks + regenerated
  artifact), starting points REJECT≈100 / MID≈40 (external_deps.md §2).
- Updated JSDoc band tables: module header, both constant doc comments, plus
  stale band comments in `src/core/types.ts`, `src/pi/config.ts`, `src/pi/debug.ts`.
- Band-literal cleanup in tests: `test/score.test.ts` boundary cases converted
  to use the imported constants; `test/helpers/bench-fixtures.ts` and
  `test/provider.test.ts`/`test/ingest-pipeline.test.ts` literals updated.
- A committed calibration script or recorded measurement table (research/
  artifact or tools/calibrate-bands.mjs — optional but recommended) so the
  values are reproducible.

**Success Definition**: `admit()` rejects `lookup('the')`, `lookup('with')`,
`lookup('this')`, `lookup('them')`; "context"-class words reject or land
group 2; `npm test` and `npm run check` green with the new constants; quant(),
DICT_N, the HAPX binary format, and DICT_VERSION are byte-for-byte untouched.

## Why

- BUG-001 (Critical, h2.1/h3.0): with REJECT=220 and the 70k-denominator curve,
  only ranks 0–3 reach q≥220 — the no-hijack invariant ("user can type an
  entire session and never trigger a menu for 'the'/'context'", §07) is
  mathematically unreachable regardless of corpus quality. P1.M1.T1.S2 fixes
  rank ORDERING; this item fixes the BANDS. Both halves are required.
- The bands are the sanctioned "only tuning surface" (spec/04, spec/08): baked
  constants, tuned in-codebase — never config/env. This is the correct,
  format-preserving fix; the curve-change alternative requires a format version
  bump (spec/03 L102–103) and is explicitly out of scope unless band widening
  demonstrably fails calibration review.
- P1.M1.T2.S2 (calibration test + prose no-menu e2e gate) consumes these
  constants — its assertions will be written against whatever values land here.

## What

1. Verify the regenerated artifact exists (P1.M1.T1.S2 output):
   `loadDictionary('dict/common-en.bin')` → version 1, ~49–50k entries.
2. Measure: for candidate constants, compute q for boundary ranks using the
   ACTUAL artifact (not just the formula — TSV filtering means rank in file ≠
   dictionary rank). Probe words at corpus ranks ~500, ~1,000, ~5,000, ~10,000
   and the BUG-001 word set.
3. Choose REJECT so the reject set covers at least the top ~1,000 corpus ranks
   ('the/with/this/them/context' all rejected) and MID so ranks ~1k–~7k are
   group 2, tail group 1. Round to clean values (e.g. 100/40) when the measured
   boundary falls within ±5% of rank targets — do not chase false precision.
4. Update `src/core/score.ts`: both constants + JSDoc (module header band
   table and per-constant comments — include the measured rank↔q mapping and
   the calibration rationale).
5. Update stale band references in comments: `src/core/types.ts` (RankGroup
   doc, L13–14), `src/pi/config.ts` (L30), `src/pi/debug.ts` (L27).
6. Update tests (see Blueprint Task 4) — prefer importing the constants over
   new literals where practical.
7. Do NOT touch: `quant()`, `DICT_N`, `tools/build-dict.mjs`, the binary
   format, `DICT_VERSION`, `src/core/dictionary.ts`.

### Success Criteria

- [ ] `admit(draft('the'|'with'|'this'|'them'), dict)` → `"reject"` measured
      against the shipped artifact
- [ ] "context"-class words (test empirically: `lookup('context')`,
      `lookup('because')`, `lookup('would')`) reject or land group 2
- [ ] Reject band covers ≥ ~1,000 top corpus ranks; group-2 band ≈ next few
      thousand; tail group 1 (measurement table recorded)
- [ ] `test/score.test.ts` boundary cases updated and passing (exact boundary
      q = REJECT−1/REJECT, MID−1/MID)
- [ ] Full `npm test` + `npm run check` green
- [ ] `git diff tools/build-dict.mjs src/core/dictionary.ts` → empty

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed?" — Yes: current constant values and locations, exact quant curve and
its inverse, all 11 hard-coded band literals in `test/score.test.ts` plus the
5 other files with band literals/comments (from grep), the measurement
methodology, and the strict scope fence are all reproduced below.

### Documentation & References

```yaml
- file: src/core/score.ts (L~49 REJECT_COMMON_THRESHOLD=220, L~54 MID_FREQ_THRESHOLD=120)
  why: THE deliverable. admit() banding: q===null→0; q<REJECT && q<MID→1...
  pattern: constants are `export const X = N as const` with JSDoc citing PRD §04 h2.24 + §08.
  critical: admit() logic itself needs NO change — only the constant values and docs.
            Banding order in code: q>=REJECT→reject, q>=MID→2, else 1; null→0 first.

- file: tools/build-dict.mjs (L34 DICT_N=70_000, L65-70 quant)
  why: the frozen curve: quant(r)=255-floor(254*log2(1+r)/log2(1+70000)).
  critical: DO NOT MODIFY. Inverse for planning: rank_max(q=T) =
        2^((255-T)*log2(70001)/254) - 1. rank100→q150, rank500→q114,
        rank1000→q98, rank5000→q64, rank20000→q30.

- file: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/P1M1T1S2/PRP.md
  why: CONTRACT for the input artifact: regenerated dict/common-en.bin from
        tools/corpus/en-50k.tsv (hermitdave/FrequencyWords 2018 RAW,
        tab-converted), entryCount ≈49–50k, version 1, 'the'≈255.
  gotcha: if the artifact is not yet regenerated when you start, do the
        measurement against `tools/corpus/en-50k.tsv` rank + quant() math and
        confirm final values against the artifact before finishing.

- docfile: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/architecture/external_deps.md
  section: §2 Quantization math
  why: verified arithmetic, starting points REJECT≈100 (top ~900 ranks) /
        MID≈40 (ranks ~900–7,500 group 2), and the out-of-scope fallback curve.

- docfile: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/architecture/system_context.md
  section: BUG-001
  why: root cause + measured bad lookups (the=103, that=73, with=71 under the
        old artifact) — the regression baseline this fix must invert.

- file: test/score.test.ts
  why: 11 band literals: header comment (L3-4), export assertions (L62-64
        toBe(220)/toBe(120)), boundary cases q=119/120 (L81-82) and q=219/220
        (L89-90), subword reject case q=220 (L129-131).
  pattern: convert literal boundary q values to REJECT_COMMON_THRESHOLD /
        MID_FREQ_THRESHOLD and ±1 expressions so the suite survives retunes;
        keep the export-value assertions but update expected numbers (they are
        the deliberate pin — P1.M1.T2.S2 relies on the constants being exact).

- file: test/helpers/bench-fixtures.ts (L133-140, L191)
  why: synthetic-q distribution hard-codes 120/220 split points for a
        50/30/20 group mix — switch to imported constants to preserve the mix.

- files: test/provider.test.ts (L279-294 "q ≥ 220 rejects" case),
         test/ingest-pipeline.test.ts (L72 comment, L213 granite q=150→group 2)
  why: literal band values in cases/comments. granite=150 stays group 2 under
        REJECT≈100 — VERIFY, and if any fixture q value changes band under the
        new constants, adjust the fixture q (not the assertion intent).

- files: src/core/types.ts (L13-14), src/pi/config.ts (L30), src/pi/debug.ts (L27)
  why: stale "(220/120)" band comments — documentation-only updates.
```

### Current Codebase tree (relevant)

```bash
src/core/score.ts          # constants live here (~L49, ~L54) + module header table
src/core/types.ts          # RankGroup doc comment cites 120/220
src/pi/config.ts, src/pi/debug.ts   # comment mentions
test/score.test.ts         # band boundary suite (11 literals)
test/helpers/bench-fixtures.ts      # synthetic q distribution
test/provider.test.ts, test/ingest-pipeline.test.ts  # band-dependent cases
dict/common-en.bin         # regenerated by P1.M1.T1.S2 (assumed landed)
tools/corpus/en-50k.tsv    # vendored corpus (rank order = line order)
tools/build-dict.mjs       # FROZEN for this task
```

### Desired Codebase tree

```bash
src/core/score.ts          # constants retuned + JSDoc updated
test/score.test.ts         # boundaries via imported constants + pinned values
test/helpers/bench-fixtures.ts, test/provider.test.ts, test/ingest-pipeline.test.ts
                           # literals converted/verified
tools/calibrate-bands.mjs  # NEW (recommended): measurement probe, committed
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: dictionary rank ≠ TSV line number. build-dict filters keys
// (KEY_RE) before ranking, so ~10 top TSV lines (e.g. "'t") are legally
// dropped and every later word shifts up. MEASURE q via loadDictionary on the
// real artifact; use TSV line numbers only as an approximation.

// CRITICAL: keep `as const` on both exports and keep them exported by name —
// test/score.test.ts imports them; P1.M1.T2.S2's calibration test will too.

// GOTCHA: inverse mapping is exponential — near REJECT≈100 a ±1 constant
// change moves the rank boundary by ~5%; near MID≈40 by ~3%. Round to clean
// values; the rank targets are "~top 1,000" not exactly 1,024.

// GOTCHA: subword clamp tests use q≥220 to force 'reject' — after retuning,
// 'the' in the REAL dict rejects, but synthetic-dict tests must use the new
// constant, not 220, or the clamp test silently stops testing rejection.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: CREATE tools/calibrate-bands.mjs (measurement probe, ~40 lines)
  - Load dict/common-en.bin via src/core/dictionary.ts (jiti/tsx runner OR
    duplicate the tiny loader inline — the repo already runs TS tooling in
    tests; simplest: node with the compiled loader or a small inline HAPX
    reader, since the format is 24-byte header + sections).
  - For a word list [the, of, and, to, a, in, that, is, was, it, for, with,
    as, his, on, be, at, by, i, this, had, not, are, but, from, have, they,
    context, because, would, them, first, time, people, world, work, system,
    data, code], print lookup(word).
  - Also print q at corpus ranks 100/500/1000/2000/5000/10000/20000/40000
    (take the word at that TSV line, look it up).
  - OUTPUT: a table rank↔word↔q used to pin the constants; commit the script.

Task 2: EDIT src/core/score.ts — constants + docs
  - Set the measured values (expected landing zone REJECT≈100, MID≈40).
  - Rewrite module-header band table (L11-16 region) and both constant JSDoc
    comments: cite the calibration probe, the rank coverage of each band
    (e.g. "REJECT≈100 → rejects top ~900 corpus ranks incl. the/with/this/
    them/context"), BUG-001, and the "only tuning surface, baked per §08"
    rationale. Keep `as const`.

Task 3: EDIT stale doc comments
  - src/core/types.ts L13-14 RankGroup comment; src/pi/config.ts L30;
    src/pi/debug.ts L27. Replace "(220/120)" with the new pair.

Task 4: EDIT test/score.test.ts
  - Update pinned export assertions to the new values (they pin exactness).
  - Rewrite boundary cases to use constants: dict({x: MID_FREQ_THRESHOLD - 1})
    → 1, {x: MID_FREQ_THRESHOLD} → 2, {x: REJECT_COMMON_THRESHOLD - 1} → 2,
    {x: REJECT_COMMON_THRESHOLD} → "reject"; subword clamp case likewise.
  - Update header comment L3-4.

Task 5: EDIT other band-dependent tests
  - test/helpers/bench-fixtures.ts: replace literals 120/220/119/219/100/36
    spans with expressions over imported constants preserving the 50/30/20 mix.
  - test/provider.test.ts L279-294: rename/retarget case to the constant.
  - test/ingest-pipeline.test.ts: verify granite q=150 stays group 2 under the
    new REJECT; fix comment L72; if any synthetic q crosses a new boundary,
    adjust the q fixture to preserve test intent.

Task 6: VALIDATE (see loop)
```

### Implementation Patterns & Key Details

```ts
// Boundary-safe test pattern (retune-proof):
import { MID_FREQ_THRESHOLD, REJECT_COMMON_THRESHOLD } from "../src/core/score.js";
it("pins the calibrated band constants", () => {
  expect(REJECT_COMMON_THRESHOLD).toBe(100); // ← measured value, update Task 2
  expect(MID_FREQ_THRESHOLD).toBe(40);
});
it("exact band boundaries", () => {
  expect(admit(draft("w1"), dict({ w1: MID_FREQ_THRESHOLD - 1 }))).toBe(1);
  expect(admit(draft("w2"), dict({ w2: MID_FREQ_THRESHOLD }))).toBe(2);
  expect(admit(draft("w3"), dict({ w3: REJECT_COMMON_THRESHOLD - 1 }))).toBe(2);
  expect(admit(draft("w4"), dict({ w4: REJECT_COMMON_THRESHOLD }))).toBe("reject");
});

// Calibration probe sketch (against real artifact):
// node tools/calibrate-bands.mjs →
//   rank  100 <word> q=150   rank 1000 <word> q=98   ...
//   the=255 with=1?? this=1?? them=9? context=9? ...
// Pick REJECT = largest "clean" value ≤ q(rank-1000 word); MID similarly
// at the ~rank-7000 boundary. Verify BUG-001 word set all ≥ REJECT.
```

### Integration Points

```yaml
CODE:
  - src/core/score.ts: constant values only (admit() logic, salience, clamp unchanged)
  - comments only: src/core/types.ts, src/pi/config.ts, src/pi/debug.ts

TESTS:
  - test/score.test.ts, test/helpers/bench-fixtures.ts,
    test/provider.test.ts, test/ingest-pipeline.test.ts

FROZEN (must show empty diff):
  - tools/build-dict.mjs, src/core/dictionary.ts, dict format, DICT_VERSION

DOWNSTREAM:
  - P1.M1.T2.S2 calibration test imports these constants and asserts
    lookup('the') ≥ REJECT_COMMON_THRESHOLD etc. against the shipped artifact;
    its prose no-menu e2e gate assumes the/with/this/them reject here.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check        # tsc --noEmit → exit 0
```

### Level 2: Unit Tests

```bash
node tools/calibrate-bands.mjs        # print rank↔q table; pin constants from it
npm test -- test/score.test.ts        # band suite green with new constants
npm test                              # full suite green (watch provider/ingest/acceptance)
```

### Level 3: Behavior spot-check

```bash
# After retune, against the shipped artifact (script or node -e):
# lookup('the')  >= REJECT  → admit rejects
# lookup('with') >= REJECT; lookup('this') >= REJECT; lookup('them') >= REJECT
# lookup('context') >= REJECT or in [MID, REJECT) → reject-or-group-2
# a rare word (e.g. 'hapax') < MID → group 1/0
git diff --stat tools/build-dict.mjs src/core/dictionary.ts   # EMPTY
```

### Level 4: Regression intent

- Re-read BUG-001 repro (system_context.md): ingest prose.jsonl, type "with" →
  NO menu item for "with" (this e2e is formalized in P1.M1.T2.S2; here a
  manual probe is sufficient).

## Final Validation Checklist

### Technical

- [ ] `npm run check` exit 0; `npm test` exit 0 (all 523+ tests)
- [ ] `git diff tools/build-dict.mjs src/core/dictionary.ts` empty
- [ ] quant()/DICT_N/format/DICT_VERSION untouched

### Feature

- [ ] the/with/this/them rejected by admit() against shipped artifact
- [ ] context-class reject-or-group-2; reject band ≈ top ~1k ranks
- [ ] Constants pinned by measurement (calibration table/script committed)
- [ ] P1.M1.T2.S2 can consume exact constants via import

### Code Quality

- [ ] JSDoc band tables updated in score.ts header + both constants
- [ ] Stale 220/120 comments updated (types.ts, config.ts, debug.ts)
- [ ] Test boundary cases use imported constants where practical
- [ ] No config/env surface introduced (bands stay baked per §08)

## Anti-Patterns to Avoid

- ❌ Changing quant(), DICT_N, the curve, or DICT_VERSION (format bump is a
  separate decision with spec/03 L102-103 consequences — out of scope)
- ❌ Guessing constants without measuring against the regenerated artifact
  (TSV line ≠ dictionary rank due to KEY_RE filtering)
- ❌ Leaving synthetic test literals at 119/120/219/220 — the clamp test would
  silently stop exercising rejection
- ❌ Making bands configurable (config/env) — PRD §08 forbids it
- ❌ Updating score.ts constants but not the 3 stale comment sites or
  bench-fixtures distribution

---

**Confidence Score: 9/10** — the arithmetic, exact literal locations, upstream
artifact contract, and scope fence are all pinned; residual risk is only that
the regenerated artifact ranks slightly differently than the TSV preview,
which the measurement step absorbs by design.
---
name: "P1.M2.T1.S1 (bugfix 001_0f4b641cf9ce) — Proper-noun relief band in admit() with unit tests"
---

## Goal

**Feature Goal**: Fix BUG-002 (M2 acceptance item 7 unreachable: National /
Energy / Laboratory are admission-rejected) via a **whole-token-only
proper-noun relief band** in `admit()` — capitalized, non-subword,
dictionary-attested candidates below a ceiling admit at group 2 instead of
rejecting — rather than a blanket REJECT retune (which would re-admit
lowercase `context` and break the calibration no-menu gate).

**Deliverable**:
- `export const PROPER_NOUN_ADMIT_CEILING = 120 as const` + the relief
  branch in `admit()` in `src/core/score.ts`
- Updated JSDoc (module header + admit() doc-block) documenting the relief
  band, ceiling rationale, and the known spec/04 (220/120) drift — Mode A;
  `spec/*.md` itself is READ-ONLY
- New unit tests in `test/score.test.ts` (TDD: write them first) using the
  existing `draft()` / `dict()` stub helpers

**Success Definition**: capitalized `National` at q=90 admits group 2;
lowercase `national` at q=90 still rejects; capitalized `The` at q=240
rejects; boundary q=120 rejects / q=119 admits; sub-words of a relieved
parent stay clamped at group 2; `node tools/calibrate-bands.mjs` exits 0;
`npm run check` + `npm test` fully green (including calibration.test.ts).

## Why

- BUG-002 (Major): the BUG-001 band retune (REJECT=50, MID=20) rejects the
  PRD's own M2 acceptance phrase — shipped-dict lookups national=90,
  energy=94, laboratory=57 all ≥ 50 → 'reject', never stored. Bigrams form
  only between ADMITTED whole tokens (PRD §06), so the successor index for
  "National Renewable Energy Laboratory" is empty and integration item 7
  ("accept National → zero-typed-char Renewable → Tab → Energy → Tab →
  Laboratory") can never pass. Only `renewable` (q=19) admits today.
- A blanket retune (REJECT ≥ 95) would re-admit lowercase `context` (51) /
  `posts` (47) and break `test/calibration.test.ts`'s no-menu gate — hence
  the targeted relief band (architecture/core-engine-findings.md, chosen
  fix). Capitalized occurrences only: lowercase `energy` in prose still
  rejects, so prose menu noise stays calibrated.
- Admission alone restores chaining: admitted whole tokens enter adjacency
  runs → bigrams form (§06) — no separate bigram-path change needed here.

## What

In `src/core/score.ts`:

```ts
/** Relief ceiling for capitalized whole tokens (BUG-002 fix): a
 *  properName-flagged, non-subword, dictionary-attested candidate with
 *  REJECT_COMMON_THRESHOLD ≤ q < PROPER_NOUN_ADMIT_CEILING admits at
 *  group 2 instead of rejecting. Baked per PRD §08; 120 = the original
 *  spec §04 mid-band boundary. Must satisfy 94 < ceiling ≤ 156 so
 *  national(90)/energy(94)/laboratory(57) admit while The(240)/This(197)/
 *  With(179)/Them(156) stay rejected. */
export const PROPER_NOUN_ADMIT_CEILING = 120 as const;
```

In `admit()`, after the four-row table and BEFORE the `if (result ===
"reject") return result;` early return:

```ts
if (
  result === "reject" &&
  !draft.isSubword &&
  draft.properName &&
  q !== null &&
  q < PROPER_NOUN_ADMIT_CEILING
) {
  result = 2; // proper-noun relief (BUG-002)
}
```

Rules encoded:
- Whole tokens only (`!draft.isSubword`) — sub-words keep the existing
  clamp, no relief.
- Capitalized occurrences only (`draft.properName` = first char of display
  uppercase at extraction, set by `expandCandidates` in segment.ts).
- Dictionary-attested only (`q !== null`) — absent words already admit at
  group 0 without relief.
- q must be BELOW the ceiling (strict): ceiling itself rejects.

Downstream interplay (verify, don't change): in the ingest pipeline
(`#admitSegment` / `#computeAdmitMemo` in src/pi/ingest.ts), a relieved
parent sets `wholeGroup = 2`, so its sub-words clamp to
`min(2, max(table, 3)) = 2` — sub-words of a relieved parent never rank
above group 2. `properName` also already feeds salience (W_PROPER_NAME=0.8)
— unchanged.

### Success Criteria

- [ ] `PROPER_NOUN_ADMIT_CEILING` exported from src/core/score.ts, value 120 (verified in-range against the shipped dict via tools/calibrate-bands.mjs)
- [ ] Relief branch in admit() exactly as specified (all five guard conditions)
- [ ] Unit tests (TDD, written first) cover: relieved capitalized mid-word; lowercase same word rejects; capitalized above-ceiling rejects; strict boundary (ceiling → reject, ceiling−1 → admit); sub-word of relieved parent clamps at 2; relief immune/absent for q === null (absent words unaffected — group 0 either way, but a capitalized absent word must still be 0, not 2)
- [ ] `node tools/calibrate-bands.mjs` exit 0; `npm run check`; `npm test` all green (calibration.test.ts, score.test.ts, acceptance suites untouched and green)

## All Needed Context

### Context Completeness Check

An implementer needs: the exact current admit() code, the shipped-dict q
values, the two existing test helpers, the calibration script, the
constraint interval for the ceiling, and the mode-A doc requirements. All
below — plus the full current admit() semantics quoted in the item and
reproduced here.

### Documentation & References

```yaml
- file: src/core/score.ts
  why: The ONLY source file to modify. admit() at ~L109–135; constants at
        ~L60–100 (REJECT_COMMON_THRESHOLD=50, MID_FREQ_THRESHOLD=20, both
        heavily JSDoc'd — match that style for the new constant).
  pattern: `export const X = N as const` + JSDoc citing PRD §08, calibration
           history, and measured dict values.
  gotcha: the relief must run BEFORE the reject early-return and BEFORE the
          subword clamp; 'reject' currently returns unclamped — keep that
          true for non-relieved rejects.

- file: test/score.test.ts
  why: Where the unit tests go. Uses local helpers `draft(word, isSubword?)`
        building a CandidateDraft and `dict({word: q})` stubbing Dictionary
        (lookup → map value ?? null). Existing describes: "admit — baked
        thresholds", "admit — whole-token bands", "admit — subword clamp".
  pattern: boundary cases expressed via imported constants (e.g.
           PROPER_NOUN_ADMIT_CEILING and PROPER_NOUN_ADMIT_CEILING - 1) so
           the suite survives a retune; header doc-comment updated with the
           relief-band scope.
  gotcha: the draft() helper sets properName from the word's casing — check
          the helper; if it defaults properName to false, pass overrides
          (e.g. draft("National", false, { properName: true })) or rely on
          casing if the helper derives it.

- file: tools/calibrate-bands.mjs
  why: Sanity-check the ceiling against the shipped dict BEFORE committing
        to 120 (must stay within (94, 156]). Run: node tools/calibrate-bands.mjs
        (Node ≥ 23.6). It imports the REAL admit() — after the change it
        exercises the relief path against the real artifact.
  gotcha: the script's acceptance assertions cover lowercase probes
          (the/with/this/them/context) — unaffected by the capitalized-only
          relief; if it fails, the relief logic leaked to non-properName or
          subword drafts.

- file: test/calibration.test.ts
  why: The no-menu gate that forbids a blanket retune. All its probes are
        lowercase — the relief (properName === true required) cannot touch
        it. Must stay green unchanged.

- file: src/core/segment.ts (CandidateDraft, L231–241)
  why: The input contract — properName = "first char of display is
        uppercase at extraction", set by expandCandidates.

- docfile: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/core-engine-findings.md
  why: The chosen-fix memo — verbatim relief condition, ceiling interval
        (94 < ceiling ≤ 156), rationale vs blanket retune, downstream
        admission⇒bigram consequence.

- docfile: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/prd_snapshot.md
  section: h3.1 (Issue 2 / BUG-002)
  why: The defect being fixed + the PRD recommendation this implements.

- docfile: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M1T2S2/PRP.md
  why: The parallel predecessor (editor-sim test for trigger consumption in
        chains) — provider-test scope only, no score.ts overlap; read to
        confirm no conflicts.
```

### Current Codebase tree (relevant)

```bash
src/core/score.ts        # admit(), band constants — MODIFY
test/score.test.ts       # admit unit suite — MODIFY (new describe/cases)
tools/calibrate-bands.mjs # calibration probe — RUN, verify ceiling
test/calibration.test.ts # no-menu gate — must stay green, untouched
```

### Desired Codebase tree

```bash
src/core/score.ts        # MODIFIED: + PROPER_NOUN_ADMIT_CEILING + relief branch + JSDoc
test/score.test.ts       # MODIFIED: relief-band describe (TDD)
```

### Known Gotchas & Library Quirks

```typescript
// CRITICAL: the ceiling interval (94, 156] is load-bearing — below/equal 94
// and energy(94) still rejects; above 156 and Them(156) admits. 120 sits
// safely inside (and equals the original spec §04 mid-band boundary).

// GOTCHA: q < ceiling is STRICT — at exactly 120 the candidate rejects.
// Pin both boundary values in tests via the imported constant.

// GOTCHA: relief fires only for dictionary-attested words (q !== null).
// A capitalized absent word is already group 0 — a relief that returned 2
// for it would DEMOTE it (2 is worse-ranked than 0); the q !== null guard
// prevents that.

// GOTCHA: sub-words never relieve. The clamp stays exactly as-is; a
// sub-word of a relieved parent computes min(2, max(table, 2+1)) = 2.

// GOTCHA: 'reject' remains clamp-immune for non-relieved cases — keep the
// existing early-return ordering (relief first, then the reject return,
// then the clamp).

// GOTCHA: test/score.test.ts stubs the Dictionary (no real binary) — use
// the dict({word: q}) helper; the shipped-dict interaction (national=90
// etc.) is exercised by P1.M2.T1.S2/S3, not this suite.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies — TDD)

```yaml
Task 1: WRITE the failing tests first (test/score.test.ts)
  - ADD describe("admit — proper-noun relief band (BUG-002)") with cases:
    * capitalized 'National' at q=90 (between REJECT_COMMON_THRESHOLD and
      ceiling) → 2 (admitted)
    * lowercase 'national' at q=90 → 'reject' (properName false)
    * capitalized 'The' at q=240 → 'reject' (≥ ceiling)
    * boundary: capitalized at PROPER_NOUN_ADMIT_CEILING → 'reject';
      at PROPER_NOUN_ADMIT_CEILING - 1 → 2 (import the constant; the
      pre-implementation run fails to compile/undefined-constant — that is
      the TDD red)
    * sub-word of a relieved parent: admit(draft("Energy", true),
      dict({energy: 94}), 2) → 2 (clamped, never above parent+1)
    * capitalized absent word (q null, e.g. 'Zorpwibble') → 0 (relief does
      not apply; already admits rarest)
  - USE existing helpers draft()/dict(); check how draft() sets properName
    and pass overrides if it defaults false
  - UPDATE the file header doc-comment to mention the relief band
  - RUN: npx vitest --run test/score.test.ts → red (new cases fail)

Task 2: IMPLEMENT the relief (src/core/score.ts)
  - ADD export const PROPER_NOUN_ADMIT_CEILING = 120 as const with the
    JSDoc in "What" (cite BUG-002, the (94,156] interval, calibration,
    PRD §08 baked-constant status)
  - INSERT the relief branch in admit() after the band table, before the
    reject early-return (exact code in "What")
  - RUN: npx vitest --run test/score.test.ts → green

Task 3: UPDATE the documentation (Mode A — same file)
  - Module header (top doc-comment): extend the ADMISSION paragraph with
    the relief row — "capitalized whole token with REJECT ≤ q < CEILING →
    group 2 (proper-noun relief, BUG-002)"
  - admit() doc-block: document the relief conditions, the ceiling
    rationale (M2 integration item 7 vs the calibration no-menu gate), and
    the KNOWN drift from spec/04's original 220/120 table — spec/*.md is
    READ-ONLY, the drift note lives in JSDoc only

Task 4: CALIBRATION sanity-check
  - node tools/calibrate-bands.mjs → exit 0 (lowercase probes unaffected;
    real admit() exercised against the shipped artifact)
  - Confirm the ceiling stays within (94, 156] against the printed
    rank↔word↔q table (national/energy/laboratory admit capitalized;
    the/with/this/them reject even capitalized)
  - If the interval check suggests a different value, adjust the constant
    and the boundary tests still hold (they use the imported constant)

Task 5: FULL validation
  - npm run check; npm test (calibration, adversarial, acceptance suites
    all green — no regressions)
```

### Implementation pattern

```typescript
// src/core/score.ts — admit() after the change (relevant excerpt)
const q = dictionary.lookup(draft.key);
let result: AdmissionResult;
if (q === null) result = 0;
else if (q >= REJECT_COMMON_THRESHOLD) result = "reject";
else if (q >= MID_FREQ_THRESHOLD) result = 2;
else result = 1;

// Proper-noun relief (BUG-002): capitalized whole tokens below the ceiling
// admit at group 2 — M2 integration item 7 (National Renewable Energy
// Laboratory) without re-admitting lowercase prose words.
if (
  result === "reject" &&
  !draft.isSubword &&
  draft.properName &&
  q !== null &&
  q < PROPER_NOUN_ADMIT_CEILING
) {
  result = 2;
}

if (result === "reject") return result;
// … existing subword clamp unchanged …
```

### Integration Points

```yaml
NONE new:
  - Downstream consumer P1.M2.T1.S2 re-runs the tuning protocol suites
    (calibration / shipped-dict / adversarial) against the changed admit().
  - Downstream consumer P1.M2.T1.S3 pins the full NREL phrase e2e
    (real dict + IngestPipeline + chain) — NOT this task's scope.
  - No ingest.ts/store.ts changes: admitted whole tokens automatically
    enter adjacency runs → bigrams form (§06).
  - No config surface: baked constant per PRD §08.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check                     # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/score.test.ts -v     # relief cases green (TDD red→green)
npx vitest --run test/calibration.test.ts -v  # no-menu gate untouched, green
npm test                                     # full suite green
```

### Level 3: Calibration (real artifact)

```bash
node tools/calibrate-bands.mjs    # exit 0; ceiling verified within (94, 156]
```

### Level 4: Behavior reasoning check (in-suite, no new harness)

- Lowercase prose words (context=51, posts=47) still reject → calibration
  no-menu invariant intact (covered by calibration.test.ts green).
- The relief is capitalized-only by construction (`draft.properName` comes
  from extraction-time casing in expandCandidates) — no test-double can
  fake it without setting the flag.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors
- [ ] `npm test` full suite green
- [ ] `node tools/calibrate-bands.mjs` exit 0

### Feature Validation

- [ ] Capitalized National (q=90) admits group 2; lowercase rejects
- [ ] Capitalized The (q=240) rejects; boundary 120/119 pinned via the imported constant
- [ ] Sub-words never relieve; sub-word of relieved parent clamps at 2
- [ ] Capitalized absent words stay group 0
- [ ] Relief condition has all five guards (reject, !isSubword, properName, q !== null, q < ceiling)

### Code Quality Validation

- [ ] JSDoc matches the existing constant style (PRD §08 citation, calibration history, measured values)
- [ ] Module header + admit() doc-block updated (Mode A), spec/04 drift documented in JSDoc only
- [ ] TDD order followed (tests written red first)
- [ ] No scope creep: no ingest/store/provider changes, no blanket retune, no spec/*.md edits

## Anti-Patterns to Avoid

- ❌ Don't retune REJECT_COMMON_THRESHOLD / MID_FREQ_THRESHOLD — the blanket path is explicitly rejected by calibration.test.ts
- ❌ Don't apply relief to sub-words or lowercase occurrences
- ❌ Don't hardcode 120 in the tests — import PROPER_NOUN_ADMIT_CEILING
- ❌ Don't place the relief after the reject early-return (dead code) or after the clamp
- ❌ Don't edit spec/*.md (READ-ONLY) — documentation lives in JSDoc
- ❌ Don't add a config/env surface for the ceiling (PRD §08)

**Confidence Score: 9/10** — the fix condition, interval, dict values, test
helpers, and calibration tool are all verified in-repo; the change is a
single guarded branch plus one constant.
